-- =============================================================================
-- StreakUp — Phase 36: Win‑Back cooldown for "lifetime" rewards
--
-- Product goal
--   "once_per_lifetime" stops farming but can demotivate legitimate returners.
--   This phase introduces an OPTIONAL per-milestone cooldown:
--
--     reward_milestones.reactivate_after_inactivity_days (int)
--
--   If a customer breaks their streak AND has been fully inactive for >= X days,
--   we automatically "reactivate" lifetime milestones so they can be earned again
--   as a welcome-back incentive.
--
-- Architecture
--   - We DO NOT delete rewards history.
--   - We create a per-(customer, milestone) reactivation marker and treat any
--     earned_at BEFORE that marker as "historical" (does not block re-earning).
--
-- Safe to re-run.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Schema: optional cooldown on reward_milestones
-- -----------------------------------------------------------------------------
alter table public.reward_milestones
  add column if not exists reactivate_after_inactivity_days int;

alter table public.reward_milestones
  drop constraint if exists reward_milestones_reactivate_days_chk;
alter table public.reward_milestones
  add constraint reward_milestones_reactivate_days_chk
  check (reactivate_after_inactivity_days is null or reactivate_after_inactivity_days between 1 and 365);

comment on column public.reward_milestones.reactivate_after_inactivity_days is
  'Optional win-back: if a streak breaks and the customer was inactive >= X days, lifetime rewards reactivate (welcome back).';

-- -----------------------------------------------------------------------------
-- 2) Reactivation markers (per customer + milestone)
-- -----------------------------------------------------------------------------
create table if not exists public.customer_reward_reactivations (
  customer_id uuid not null references public.customers(id) on delete cascade,
  milestone_id uuid not null references public.reward_milestones(id) on delete cascade,
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  reactivated_at timestamptz not null default now(),
  inactivity_days int not null,
  primary key (customer_id, milestone_id)
);

create index if not exists customer_reward_reactivations_cafe_idx
  on public.customer_reward_reactivations (cafe_id, reactivated_at desc);

alter table public.customer_reward_reactivations enable row level security;
-- No direct PostgREST access; SECURITY DEFINER functions read/write it.

-- -----------------------------------------------------------------------------
-- 3) Helper: effective lifetime lock check for a milestone
-- -----------------------------------------------------------------------------
-- This helper answers: "Has this customer already earned this lifetime milestone
-- in the currently active era?"
--
-- Win-back reactivation works by writing a per-(customer, milestone) cutoff
-- timestamp. Any earned_at prior to the cutoff is treated as historical and
-- does not block re-earning after a long inactivity streak break.
create or replace function public._milestone_lifetime_locked(
  p_customer_id uuid,
  p_milestone_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with cutoff as (
    select r.reactivated_at
    from public.customer_reward_reactivations r
    where r.customer_id = p_customer_id
      and r.milestone_id = p_milestone_id
  )
  select exists (
    select 1
    from public.rewards rw
    where rw.customer_id = p_customer_id
      and rw.milestone_id = p_milestone_id
      and rw.earned_at is not null
      and (
        (select reactivated_at from cutoff) is null
        or rw.earned_at > (select reactivated_at from cutoff)
      )
  );
$$;

revoke all on function public._milestone_lifetime_locked(uuid, uuid) from public;
grant execute on function public._milestone_lifetime_locked(uuid, uuid) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4) Update sync helper to respect reactivation cutoffs
-- -----------------------------------------------------------------------------
-- `_sync_customer_physical_rewards` is a defensive, idempotent backfill:
-- it ensures a physical reward row exists when a milestone is eligible.
--
-- Why this exists:
-- - The portal and cashier UIs both read from `public.rewards`.
-- - Some customers may predate later phases or have incomplete reward rows.
-- - This function allows the system to "heal forward" without manual repairs.
--
-- Concurrency:
-- - Safe under repeated calls. Uses `ON CONFLICT` on (customer_id, milestone_id).
create or replace function public._sync_customer_physical_rewards(
  p_cafe_id uuid,
  p_customer_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current int;
begin
  select cu.current_streak into v_current
  from public.customers cu
  where cu.id = p_customer_id
    and cu.cafe_id = p_cafe_id;

  if v_current is null then
    return;
  end if;

  insert into public.rewards (cafe_id, customer_id, milestone_id, earned_at)
  select p_cafe_id, p_customer_id, rm.id, now()
  from public.reward_milestones rm
  where rm.cafe_id = p_cafe_id
    and rm.active
    and rm.fulfillment_type = 'physical'::public.reward_fulfillment_type
    and rm.days_required <= v_current
    and (
      rm.claim_limit = 'every_streak_cycle'::public.reward_claim_limit
      or (
        rm.claim_limit = 'once_per_lifetime'::public.reward_claim_limit
        and public._milestone_lifetime_locked(p_customer_id, rm.id) is not true
      )
    )
  on conflict (customer_id, milestone_id) do update
    set earned_at  = coalesce(public.rewards.earned_at, excluded.earned_at),
        updated_at = now()
  where public.rewards.earned_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) Engine: on streak break + long inactivity → mark reactivations
-- -----------------------------------------------------------------------------
-- `streakup_engine_process_check_in` is the authoritative streak engine.
--
-- High-level responsibilities:
-- - Serialize updates by locking the customer row (`FOR UPDATE`).
-- - Compute streak progression using cafe-local calendar dates (visit_date).
-- - Consume shields (grace-aware) to bridge missed days, or break streak cycles.
-- - Award shields and milestones when crossing thresholds.
-- - Win-back mechanism: when a streak truly breaks and the customer has been
--   inactive >= configured days for a lifetime milestone, write a reactivation
--   marker so the milestone can be earned again as a welcome-back incentive.
--
-- Important: this function does NOT write `public.visits` rows. That is the
-- job of `record_visit_idempotent`, which also provides transport idempotency.
create or replace function public.streakup_engine_process_check_in(
  p_cafe_id uuid,
  p_customer_id uuid,
  p_visit_date date
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cafe               public.cafes%rowtype;
  v_cust               public.customers%rowtype;
  v_last               date;
  v_missed             int;
  v_new_streak         int;
  v_new_shields        int;
  v_shields_used       int := 0;
  v_consumed           boolean := false;
  v_awarded            boolean := false;
  v_streak_broken      boolean := false;
  v_milestone_shields  int := 0;
  v_already_today      boolean := false;
  v_grace_today        boolean := false;
  v_dow                int;
  v_cap                int;
  v_milestones         jsonb := '[]'::jsonb;
  v_prev_streak        int;
  v_grant              int;
  v_m                  record;
  v_skip_milestone     boolean;
  v_inactive_days      int := 0;
  v_reactivated_any    boolean := false;
begin
  select * into v_cafe from public.cafes where id = p_cafe_id for share;
  if not found then raise exception 'cafe_not_found'; end if;

  select * into v_cust
  from public.customers
  where id = p_customer_id and cafe_id = p_cafe_id
  for update;
  if not found then raise exception 'customer_not_found'; end if;

  v_prev_streak := v_cust.current_streak;
  v_new_shields := v_cust.shields;
  v_dow := extract(dow from p_visit_date)::int;
  v_grace_today := public.cafe_date_is_grace(v_cafe.grace_days, v_cafe.off_days, p_visit_date);

  select max(v.visit_date) into v_last
  from public.visits v
  where v.customer_id = p_customer_id
    and v.cafe_id = p_cafe_id
    and v.event_type = 'check_in'::public.visit_event_type;

  if v_last is not null and p_visit_date > v_last then
    v_inactive_days := greatest(0, (p_visit_date - v_last));
  end if;

  if v_last is null then
    v_new_streak := 1;
    v_missed := 0;
  elsif p_visit_date = v_last then
    v_new_streak := v_cust.current_streak;
    v_already_today := true;
    v_missed := 0;
  elsif p_visit_date < v_last then
    v_new_streak := v_cust.current_streak;
    v_missed := 0;
  else
    v_missed := public.streakup_missed_checkin_days(
      v_cafe.grace_days, v_cafe.off_days, v_last, p_visit_date
    );

    if v_missed = 0 then
      v_new_streak := v_cust.current_streak + 1;
    elsif v_missed <= v_new_shields then
      v_shields_used := v_missed;
      v_new_shields := v_new_shields - v_missed;
      v_consumed := true;
      v_new_streak := v_cust.current_streak + 1;
    else
      v_streak_broken := v_prev_streak > 0;
      v_new_streak := 1;
      if v_streak_broken then
        perform public.streakup_archive_cycle_rewards(p_cafe_id, p_customer_id);
      end if;
    end if;
  end if;

  -- Win-back reactivation: only when a streak truly breaks AND the customer was inactive long enough.
  if v_streak_broken and v_inactive_days > 0 then
    for v_m in
      select rm.id, rm.reactivate_after_inactivity_days
      from public.reward_milestones rm
      where rm.cafe_id = p_cafe_id
        and rm.active
        and rm.claim_limit = 'once_per_lifetime'::public.reward_claim_limit
        and rm.reactivate_after_inactivity_days is not null
        and rm.reactivate_after_inactivity_days > 0
        and rm.reactivate_after_inactivity_days <= v_inactive_days
        and exists (
          select 1 from public.rewards r
          where r.customer_id = p_customer_id
            and r.milestone_id = rm.id
            and r.earned_at is not null
        )
    loop
      insert into public.customer_reward_reactivations (customer_id, milestone_id, cafe_id, reactivated_at, inactivity_days)
      values (p_customer_id, v_m.id, p_cafe_id, now(), v_inactive_days)
      on conflict (customer_id, milestone_id) do update
        set reactivated_at = excluded.reactivated_at,
            inactivity_days = excluded.inactivity_days;
      v_reactivated_any := true;
    end loop;
  end if;

  if (not v_already_today) and v_new_streak > v_prev_streak then
    if v_cafe.shield_every is not null
      and v_cafe.shield_every > 0
      and v_new_streak > 0
      and v_new_streak % v_cafe.shield_every = 0 then
      v_cap := coalesce(v_cafe.max_shields, 2147483647);
      if v_new_shields < v_cap then
        v_new_shields := v_new_shields + 1;
        v_awarded := true;
      end if;
    end if;
  end if;

  if (not v_already_today) and v_new_streak > v_prev_streak then
    for v_m in
      select rm.id, rm.name, rm.days_required, rm.shield_grant_amount,
             rm.fulfillment_type, rm.icon_type, rm.claim_limit
      from public.reward_milestones rm
      where rm.cafe_id = p_cafe_id
        and rm.active
        and rm.days_required <= v_new_streak
        and rm.days_required > v_prev_streak
      order by rm.sort_order, rm.days_required
    loop
      v_skip_milestone := false;

      if v_m.claim_limit = 'once_per_lifetime'::public.reward_claim_limit then
        v_skip_milestone := public._milestone_lifetime_locked(p_customer_id, v_m.id);
      end if;

      if v_skip_milestone then
        continue;
      end if;

      v_grant := greatest(0, coalesce(v_m.shield_grant_amount, 0));

      if v_m.fulfillment_type = 'physical'::public.reward_fulfillment_type then
        insert into public.rewards (cafe_id, customer_id, milestone_id, earned_at)
        values (p_cafe_id, p_customer_id, v_m.id, now())
        on conflict (customer_id, milestone_id) do update
          set earned_at  = coalesce(public.rewards.earned_at, excluded.earned_at),
              updated_at = now();
      end if;

      if v_m.fulfillment_type = 'digital_shield'::public.reward_fulfillment_type
         or v_grant > 0 then
        if v_grant > 0 then
          v_milestone_shields := v_milestone_shields + v_grant;
        elsif v_m.fulfillment_type = 'digital_shield'::public.reward_fulfillment_type then
          v_milestone_shields := v_milestone_shields + 1;
        end if;
      end if;

      v_milestones := v_milestones || jsonb_build_array(
        jsonb_build_object(
          'milestone_id',      v_m.id,
          'name',              v_m.name,
          'days_required',     v_m.days_required,
          'fulfillment_type',  v_m.fulfillment_type::text,
          'claim_limit',       v_m.claim_limit::text,
          'shields_granted',   case
            when v_m.fulfillment_type = 'digital_shield'::public.reward_fulfillment_type
              then greatest(1, v_grant)
            else v_grant
          end
        )
      );
    end loop;

    if v_milestone_shields > 0 then
      v_cap := coalesce(v_cafe.max_shields, 2147483647);
      v_new_shields := least(v_cap, v_new_shields + v_milestone_shields);
      v_awarded := true;
    end if;
  end if;

  update public.customers
  set current_streak = v_new_streak,
      longest_streak = greatest(longest_streak, v_new_streak),
      shields        = v_new_shields,
      updated_at     = now()
  where id = p_customer_id and cafe_id = p_cafe_id;

  return jsonb_build_object(
    'streak_after',              v_new_streak,
    'shields_after',             v_new_shields,
    'shield_consumed',           v_consumed,
    'shields_consumed',          v_shields_used,
    'shield_awarded',            v_awarded,
    'streak_broken',             v_streak_broken,
    'inactivity_days',           v_inactive_days,
    'win_back_reactivated',      v_reactivated_any,
    'missed_checkin_days',       coalesce(v_missed, 0),
    'milestone_shields_granted', v_milestone_shields,
    'grace_day_today',           v_grace_today,
    'already_visited_today',     v_already_today,
    'dow',                       v_dow,
    'milestones',                coalesce(v_milestones, '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) Portal milestone projection: include welcome_back + proper lifetime lock
-- -----------------------------------------------------------------------------
create or replace function public.customer_portal_milestones_for_customer(
  p_cafe_id uuid,
  p_customer_id uuid,
  p_current_streak int
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with rx as (
    select r.milestone_id, r.reactivated_at, r.inactivity_days
    from public.customer_reward_reactivations r
    where r.customer_id = p_customer_id
      and r.cafe_id = p_cafe_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                  rm.id,
        'name',                rm.name,
        'days_required',       rm.days_required,
        'reward_label',        rm.reward_label,
        'icon_type',           rm.icon_type,
        'discount_percentage', rm.discount_percentage,
        'fulfillment_type',    rm.fulfillment_type::text,
        'claim_limit',         rm.claim_limit::text,
        'reactivate_after_inactivity_days', rm.reactivate_after_inactivity_days,
        'sort_order',          rm.sort_order,
        'earned_at',           r.earned_at,
        'claimed_at',          r.claimed_at,
        'welcome_back_bonus',  (
          rm.claim_limit = 'once_per_lifetime'::public.reward_claim_limit
          and rx.reactivated_at is not null
          and (
            r.earned_at is null
            or r.earned_at <= rx.reactivated_at
          )
        ),
        'lifetime_achieved',   (
          rm.claim_limit = 'once_per_lifetime'::public.reward_claim_limit
          and public._milestone_lifetime_locked(p_customer_id, rm.id)
          and p_current_streak < rm.days_required
        )
      )
      order by rm.sort_order, rm.days_required
    ),
    '[]'::jsonb
  )
  from public.reward_milestones rm
  left join public.rewards r
    on r.milestone_id = rm.id and r.customer_id = p_customer_id
  left join rx
    on rx.milestone_id = rm.id
  where rm.cafe_id = p_cafe_id
    and rm.active;
$$;

commit;

