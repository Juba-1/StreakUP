-- =============================================================================
-- StreakUp — Phase 33: Reward integrity, streak gap audit, HQ lifetime overrides
--
-- · claim_limit on reward_milestones (anti farming)
-- · Multi-shield gap math + retroactive streak break on long absence
-- · HQ VIP reset for once-per-lifetime claims
-- Run AFTER phase32_super_admin_metrics.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Claim limit enum (anti reward-farming on streak reset)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'reward_claim_limit') then
    create type public.reward_claim_limit as enum (
      'once_per_lifetime',
      'every_streak_cycle'
    );
  end if;
end $$;

alter table public.reward_milestones
  add column if not exists claim_limit public.reward_claim_limit
    not null default 'once_per_lifetime';

comment on column public.reward_milestones.claim_limit is
  'once_per_lifetime = cannot re-earn after streak reset; every_streak_cycle = clears on cycle break.';

-- Early milestones default lifetime; longer arcs repeat each cycle
update public.reward_milestones rm
set claim_limit = 'once_per_lifetime'::public.reward_claim_limit
where rm.days_required <= 14
  and rm.claim_limit is distinct from 'once_per_lifetime'::public.reward_claim_limit;

update public.reward_milestones rm
set claim_limit = 'every_streak_cycle'::public.reward_claim_limit
where rm.days_required > 14
  and rm.claim_limit = 'once_per_lifetime'::public.reward_claim_limit;

-- -----------------------------------------------------------------------------
-- Missed required check-in days between last visit and new visit (grace-aware)
-- -----------------------------------------------------------------------------
create or replace function public.streakup_missed_checkin_days(
  p_grace_days smallint[],
  p_legacy_off_days smallint[],
  p_last_visit date,
  p_visit_date date
) returns int
language plpgsql
immutable
as $$
declare
  v_cursor date;
  v_missed int := 0;
begin
  if p_last_visit is null or p_visit_date is null or p_visit_date <= p_last_visit then
    return 0;
  end if;

  v_cursor := p_last_visit;
  while v_cursor < p_visit_date loop
    v_cursor := v_cursor + 1;
    if v_cursor < p_visit_date
       and not public.cafe_date_is_grace(p_grace_days, p_legacy_off_days, v_cursor) then
      v_missed := v_missed + 1;
    end if;
  end loop;

  return v_missed;
end;
$$;

-- -----------------------------------------------------------------------------
-- Clear per-cycle reward rows when a streak cycle breaks
-- -----------------------------------------------------------------------------
create or replace function public.streakup_archive_cycle_rewards(
  p_cafe_id uuid,
  p_customer_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.rewards r
  using public.reward_milestones rm
  where r.customer_id = p_customer_id
    and r.milestone_id = rm.id
    and rm.cafe_id = p_cafe_id
    and rm.claim_limit = 'every_streak_cycle'::public.reward_claim_limit;
end;
$$;

revoke all on function public.streakup_archive_cycle_rewards(uuid, uuid) from public;

-- -----------------------------------------------------------------------------
-- Physical reward sync — respect claim limits (no farming via longest_streak)
-- -----------------------------------------------------------------------------
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
  select c.current_streak into v_current
  from public.customers c
  where c.id = p_customer_id and c.cafe_id = p_cafe_id;

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
      or not exists (
        select 1 from public.rewards r
        where r.customer_id = p_customer_id
          and r.milestone_id = rm.id
          and r.earned_at is not null
      )
    )
  on conflict (customer_id, milestone_id) do update
    set earned_at  = coalesce(public.rewards.earned_at, excluded.earned_at),
        updated_at = now()
  where public.rewards.earned_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Core streak engine — multi-shield gap bridge + cycle archive
-- -----------------------------------------------------------------------------
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
        select exists (
          select 1 from public.rewards r
          where r.customer_id = p_customer_id
            and r.milestone_id = v_m.id
            and r.earned_at is not null
        ) into v_skip_milestone;
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
-- Portal milestone projection (claim_limit + lifetime_achieved)
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
        'sort_order',          rm.sort_order,
        'earned_at',           r.earned_at,
        'claimed_at',          r.claimed_at,
        'lifetime_achieved',   (
          rm.claim_limit = 'once_per_lifetime'::public.reward_claim_limit
          and r.earned_at is not null
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
  where rm.cafe_id = p_cafe_id
    and rm.active;
$$;

revoke all on function public.customer_portal_milestones_for_customer(uuid, uuid, int) from public;
grant execute on function public.customer_portal_milestones_for_customer(uuid, uuid, int) to anon, authenticated;

-- Patch customer_portal_begin — refresh customer after sync; use milestone helper
create or replace function public.customer_portal_begin(
  p_slug text,
  p_phone text default null,
  p_name text default null,
  p_session_token text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_cafe          public.cafes%rowtype;
  v_customer      public.customers%rowtype;
  v_customer_id   uuid;
  v_created       boolean := false;
  v_resumed       boolean := false;
  v_subject       text;
  v_check         jsonb;
  v_phone         text;
  v_name          text := trim(coalesce(p_name, ''));
  v_token         text := trim(coalesce(p_session_token, ''));
  v_token_hash    text;
  v_new_token     text;
  v_new_hash      text;
  v_milestones    jsonb;
  v_last_visit    date;
  v_today         date;
  v_visited_today boolean := false;
  v_grace_today   boolean := false;
  v_tz            text;
  v_next_midnight timestamptz;
  v_streak_expiry timestamptz;
begin
  select c.* into v_cafe
  from public.cafes c
  where c.slug = trim(coalesce(p_slug, ''))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'cafe_not_found');
  end if;

  if v_cafe.status <> 'active'::public.cafe_status then
    return jsonb_build_object('ok', false, 'error', 'cafe_inactive', 'status', v_cafe.status::text);
  end if;

  v_tz := coalesce(nullif(trim(v_cafe.timezone), ''), 'UTC');

  if char_length(v_token) >= 24 then
    v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

    select cu.* into v_customer
    from public.customer_portal_sessions s
    join public.customers cu on cu.id = s.customer_id
    where s.cafe_id    = v_cafe.id
      and s.token_hash = v_token_hash
      and s.expires_at > now()
    limit 1;

    if found then
      v_resumed     := true;
      v_customer_id := v_customer.id;

      update public.customer_portal_sessions
         set last_seen_at = now(),
             expires_at   = now() + interval '90 days'
       where token_hash   = v_token_hash;
    end if;
  end if;

  if not v_resumed then
    v_phone := public.normalize_sa_mobile_e164(trim(coalesce(p_phone, '')));
    if v_phone is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_phone');
    end if;

    v_subject := v_cafe.id::text || ':' || v_phone;
    v_check := public.lockout_check('portal:phone', v_subject, interval '1 minute', 12, interval '45 seconds');

    if (v_check->>'allowed')::boolean is distinct from true then
      return jsonb_build_object(
        'ok', false, 'error', 'rate_limited',
        'retry_after_ms', coalesce((v_check->>'retry_after_ms')::int, 45000)
      );
    end if;

    select cu.* into v_customer
    from public.customers cu
    where cu.cafe_id = v_cafe.id
      and (
        cu.phone = v_phone
        or public.normalize_sa_mobile_e164(trim(cu.phone)) = v_phone
      )
    order by case when cu.phone = v_phone then 0 else 1 end
    limit 1;

    if found then
      v_customer_id := v_customer.id;
      if char_length(v_name) >= 2 and coalesce(trim(v_customer.full_name), '') = '' then
        update public.customers set full_name = left(v_name, 120) where id = v_customer.id;
        v_customer.full_name := left(v_name, 120);
      end if;
    else
      if char_length(v_name) < 2 then
        perform public.lockout_register_failure(
          'portal:phone', v_subject, interval '1 minute', 12, interval '45 seconds', 'name_required'
        );
        return jsonb_build_object('ok', false, 'error', 'name_required');
      end if;

      insert into public.customers (cafe_id, phone, full_name)
      values (v_cafe.id, v_phone, left(v_name, 120))
      returning id into v_customer_id;

      select cu.* into v_customer from public.customers cu where cu.id = v_customer_id;
      v_created := true;
    end if;

    perform public.lockout_register_success('portal:phone', v_subject);
  end if;

  if v_customer_id is null or v_customer.id is null then
    return jsonb_build_object('ok', false, 'error', 'customer_resolution_failed');
  end if;

  perform public._sync_customer_physical_rewards(v_cafe.id, v_customer_id);

  select cu.* into v_customer
  from public.customers cu
  where cu.id = v_customer_id;

  v_new_token := encode(gen_random_bytes(24), 'hex');
  v_new_hash  := encode(digest(v_new_token, 'sha256'), 'hex');

  insert into public.customer_portal_sessions (cafe_id, customer_id, token_hash, expires_at, last_seen_at)
  values (v_cafe.id, v_customer_id, v_new_hash, now() + interval '90 days', now())
  on conflict (customer_id) do update
     set token_hash   = excluded.token_hash,
         cafe_id      = excluded.cafe_id,
         expires_at   = excluded.expires_at,
         last_seen_at = excluded.last_seen_at;

  v_today := (now() at time zone v_tz)::date;
  v_grace_today := public.cafe_date_is_grace(v_cafe.grace_days, v_cafe.off_days, v_today);

  select max(v.visit_date) into v_last_visit
  from public.visits v
  where v.customer_id = v_customer_id
    and v.cafe_id     = v_cafe.id
    and v.event_type  = 'check_in'::public.visit_event_type;

  v_visited_today := (v_last_visit is not null and v_last_visit = v_today);

  if v_visited_today then
    v_next_midnight := ((v_today + 1)::timestamp at time zone v_tz);
    v_streak_expiry := case
      when v_customer.current_streak > 0 then ((v_today + 2)::timestamp at time zone v_tz)
      else null
    end;
  else
    v_next_midnight := now();
    v_streak_expiry := case
      when v_customer.current_streak > 0 then ((v_today + 1)::timestamp at time zone v_tz)
      else null
    end;
  end if;

  v_milestones := public.customer_portal_milestones_for_customer(
    v_cafe.id, v_customer.id, v_customer.current_streak
  );

  return jsonb_build_object(
    'ok',                  true,
    'customer_id',         v_customer.id,
    'cafe_id',             v_customer.cafe_id,
    'current_streak',      v_customer.current_streak,
    'longest_streak',      v_customer.longest_streak,
    'shields',             v_customer.shields,
    'milestones',          v_milestones,
    'pin_code',            v_customer.pin_code,
    'display_name',        coalesce(v_customer.full_name, ''),
    'is_new',              v_created,
    'resumed',             v_resumed,
    'session_token',       v_new_token,
    'last_visit_date',     v_last_visit,
    'visited_today',       v_visited_today,
    'is_grace_day_today',  v_grace_today,
    'grace_days',          case
      when cardinality(v_cafe.grace_days) > 0 then v_cafe.grace_days
      else coalesce(v_cafe.off_days, '{}'::smallint[])
    end,
    'cafe_timezone',       v_tz,
    'next_visit_opens_at', v_next_midnight,
    'streak_expires_at',   v_streak_expiry
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- HQ: list lifetime rewards for CRM VIP panel
-- -----------------------------------------------------------------------------
create or replace function public.hq_list_customer_lifetime_rewards_secure(
  p_customer_id uuid,
  p_cafe_id uuid default null,
  p_slug text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_cafe_id uuid;
  v_rows    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = v_uid limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.role not in ('super_admin'::public.streakup_role, 'hq_owner'::public.streakup_role) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select c.cafe_id into v_cafe_id
  from public.customers c
  where c.id = p_customer_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  if p_cafe_id is not null and p_cafe_id <> v_cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  if v_profile.role = 'hq_owner'::public.streakup_role
     and v_profile.cafe_id is distinct from v_cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_slug is not null and trim(p_slug) <> '' then
    if not exists (
      select 1 from public.cafes c
      where c.id = v_cafe_id and c.slug = lower(trim(p_slug))
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'milestone_id',    rm.id,
        'name',            rm.name,
        'days_required',   rm.days_required,
        'reward_label',    rm.reward_label,
        'icon_type',       rm.icon_type,
        'fulfillment_type', rm.fulfillment_type::text,
        'earned_at',       r.earned_at,
        'claimed_at',      r.claimed_at,
        'reward_id',       r.id
      )
      order by rm.days_required
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.rewards r
  inner join public.reward_milestones rm on rm.id = r.milestone_id
  where r.customer_id = p_customer_id
    and rm.cafe_id = v_cafe_id
    and rm.claim_limit = 'once_per_lifetime'::public.reward_claim_limit
    and r.earned_at is not null;

  return jsonb_build_object('ok', true, 'rewards', v_rows);
end;
$$;

revoke all on function public.hq_list_customer_lifetime_rewards_secure(uuid, uuid, text) from public;
grant execute on function public.hq_list_customer_lifetime_rewards_secure(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- HQ: VIP reset — allow one lifetime reward to be earned again
-- -----------------------------------------------------------------------------
create or replace function public.hq_reset_customer_lifetime_reward(
  p_customer_id uuid,
  p_milestone_id uuid,
  p_cafe_id uuid default null,
  p_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_profile   public.profiles%rowtype;
  v_customer  public.customers%rowtype;
  v_milestone public.reward_milestones%rowtype;
  v_deleted   int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = v_uid limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.role not in ('super_admin'::public.streakup_role, 'hq_owner'::public.streakup_role) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_customer from public.customers where id = p_customer_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  if v_profile.role = 'hq_owner'::public.streakup_role
     and v_customer.cafe_id is distinct from v_profile.cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_cafe_id is not null and p_cafe_id <> v_customer.cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_milestone
  from public.reward_milestones rm
  where rm.id = p_milestone_id
    and rm.cafe_id = v_customer.cafe_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'milestone_not_found');
  end if;

  if v_milestone.claim_limit <> 'once_per_lifetime'::public.reward_claim_limit then
    return jsonb_build_object('ok', false, 'reason', 'not_lifetime_reward');
  end if;

  delete from public.rewards r
  where r.customer_id = p_customer_id
    and r.milestone_id = p_milestone_id;

  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_claim_to_reset');
  end if;

  insert into public.audit_log (
    cafe_id, branch_id, actor_user_id, actor_type, action, entity_type, entity_id, payload
  )
  values (
    v_customer.cafe_id, null,
    v_uid, 'user',
    'customer.lifetime_reward_reset', 'customer', p_customer_id,
    jsonb_build_object(
      'milestone_id', p_milestone_id,
      'milestone_name', v_milestone.name,
      'days_required', v_milestone.days_required
    )
  );

  return jsonb_build_object(
    'ok', true,
    'milestone_id', p_milestone_id,
    'customer_id', p_customer_id
  );
end;
$$;

revoke all on function public.hq_reset_customer_lifetime_reward(uuid, uuid, uuid, text) from public;
grant execute on function public.hq_reset_customer_lifetime_reward(uuid, uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Default seed — early rewards are lifetime-locked
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_reward_milestones(p_cafe_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_cafe_id is null then
    return;
  end if;

  insert into public.reward_milestones
    (cafe_id, name, days_required, reward_label, shield_grant_amount, sort_order, active, claim_limit)
  values
    (p_cafe_id, 'Warm-Up',     3,  'Complimentary upgrade',     0, 10, true, 'once_per_lifetime'),
    (p_cafe_id, 'Regular',     5,  'Free pastry of the day',    0, 20, true, 'once_per_lifetime'),
    (p_cafe_id, 'Loyalist',    10, 'Free beverage',             1, 30, true, 'once_per_lifetime'),
    (p_cafe_id, 'Streak Pro',  21, 'Signature combo on us',     1, 40, true, 'every_streak_cycle'),
    (p_cafe_id, 'Legend',      50, 'VIP loyalty perk',          2, 50, true, 'every_streak_cycle')
  on conflict (cafe_id, name) do nothing;
end;
$$;

commit;
