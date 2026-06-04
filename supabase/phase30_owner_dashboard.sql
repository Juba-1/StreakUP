-- =============================================================================
-- StreakUp — Phase 30: Cafe-owner analytics + reward state machine fixes
--
-- 1. hq_roi_analytics_secure → plain-language owner metrics + claimed breakdown
-- 2. customer_portal_begin → backfill missing physical reward rows (earned_at)
-- 3. Cashier list → physical, earned, unclaimed only
-- Run AFTER phase29_behavioral.sql
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Backfill helper: ensure physical milestones have rewards rows when earned
-- ---------------------------------------------------------------------------
create or replace function public._sync_customer_physical_rewards(
  p_cafe_id uuid,
  p_customer_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_longest int;
begin
  select c.longest_streak into v_longest
  from public.customers c
  where c.id = p_customer_id and c.cafe_id = p_cafe_id;

  if v_longest is null then
    return;
  end if;

  insert into public.rewards (cafe_id, customer_id, milestone_id, earned_at)
  select p_cafe_id, p_customer_id, rm.id, now()
  from public.reward_milestones rm
  where rm.cafe_id = p_cafe_id
    and rm.active
    and rm.fulfillment_type = 'physical'::public.reward_fulfillment_type
    and rm.days_required <= v_longest
    and not exists (
      select 1 from public.rewards r
      where r.customer_id = p_customer_id
        and r.milestone_id = rm.id
    )
  on conflict (customer_id, milestone_id) do update
    set earned_at  = coalesce(public.rewards.earned_at, excluded.earned_at),
        updated_at = now();
end;
$$;

revoke all on function public._sync_customer_physical_rewards(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Cafe-owner analytics (zero jargon)
-- ---------------------------------------------------------------------------
create or replace function public.hq_roi_analytics_secure(p_days int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile          public.profiles%rowtype;
  v_cafe_id          uuid;
  v_days             int;
  v_start            date;
  v_today            date;
  v_tz               text;
  v_week_start       date;
  v_active_now       bigint;
  v_shield_saves     bigint;
  v_champions        bigint;
  v_broken_week      bigint;
  v_claimed_total    bigint;
  v_ready_to_claim   bigint;
  v_claimed_breakdown jsonb;
  v_ready_breakdown   jsonb;
begin
  select * into v_profile from public.profiles where user_id = auth.uid() limit 1;
  if not found or v_profile.role <> 'hq_owner'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  v_cafe_id := v_profile.cafe_id;
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_days := greatest(1, least(coalesce(p_days, 7), 365));
  select coalesce(nullif(trim(c.timezone), ''), 'UTC') into v_tz
  from public.cafes c where c.id = v_cafe_id;
  v_today := (now() at time zone v_tz)::date;
  v_start := v_today - (v_days - 1);
  v_week_start := v_today - 6;

  -- Metric 1: Active streaks right now
  select count(*)::bigint into v_active_now
  from public.customers c
  where c.cafe_id = v_cafe_id
    and c.current_streak > 0;

  -- Metric 2: Shield saves (shield consumed on check-in)
  select count(*)::bigint into v_shield_saves
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.visit_date between v_start and v_today
    and v.event_type = 'check_in'::public.visit_event_type
    and coalesce((v.metadata->>'shield_consumed')::boolean, false) = true;

  -- Metric 3: Streak champions (ever reached day 7+)
  select count(*)::bigint into v_champions
  from public.customers c
  where c.cafe_id = v_cafe_id
    and c.longest_streak >= 7;

  -- Metric 4: Broken streaks this week (reset to day 1 after having day 2+)
  select count(distinct v.id)::bigint into v_broken_week
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.visit_date between v_week_start and v_today
    and v.event_type = 'check_in'::public.visit_event_type
    and coalesce(v.streak_after, 0) = 1
    and coalesce((
      select prev.streak_after
      from public.visits prev
      where prev.customer_id = v.customer_id
        and prev.cafe_id = v_cafe_id
        and prev.event_type = 'check_in'::public.visit_event_type
        and prev.visit_date < v.visit_date
      order by prev.visit_date desc
      limit 1
    ), 0) >= 2;

  -- Metric 5: Claimed physical rewards in window
  select count(*)::bigint into v_claimed_total
  from public.rewards r
  inner join public.reward_milestones rm on rm.id = r.milestone_id
  where r.cafe_id = v_cafe_id
    and rm.fulfillment_type = 'physical'::public.reward_fulfillment_type
    and r.claimed_at is not null
    and (r.claimed_at at time zone v_tz)::date between v_start and v_today;

  select count(*)::bigint into v_ready_to_claim
  from public.rewards r
  inner join public.reward_milestones rm on rm.id = r.milestone_id
  where r.cafe_id = v_cafe_id
    and rm.fulfillment_type = 'physical'::public.reward_fulfillment_type
    and r.earned_at is not null
    and r.claimed_at is null;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'label', b.lbl,
      'icon_type', b.icon_type,
      'count', b.cnt
    ) order by b.cnt desc, b.lbl
  ), '[]'::jsonb)
  into v_claimed_breakdown
  from (
    select
      coalesce(nullif(trim(rm.reward_label), ''), rm.name) as lbl,
      rm.icon_type,
      count(*)::bigint as cnt
    from public.rewards r
    inner join public.reward_milestones rm on rm.id = r.milestone_id
    where r.cafe_id = v_cafe_id
      and rm.fulfillment_type = 'physical'::public.reward_fulfillment_type
      and r.claimed_at is not null
      and (r.claimed_at at time zone v_tz)::date between v_start and v_today
    group by 1, rm.icon_type
  ) b;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'label', b.lbl,
      'icon_type', b.icon_type,
      'count', b.cnt
    ) order by b.cnt desc, b.lbl
  ), '[]'::jsonb)
  into v_ready_breakdown
  from (
    select
      coalesce(nullif(trim(rm.reward_label), ''), rm.name) as lbl,
      rm.icon_type,
      count(*)::bigint as cnt
    from public.rewards r
    inner join public.reward_milestones rm on rm.id = r.milestone_id
    where r.cafe_id = v_cafe_id
      and rm.fulfillment_type = 'physical'::public.reward_fulfillment_type
      and r.earned_at is not null
      and r.claimed_at is null
    group by 1, rm.icon_type
  ) b;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'window_days', v_days,
    'timezone', v_tz,
    'owner', jsonb_build_object(
      'active_streaks_now', v_active_now,
      'shield_saves', v_shield_saves,
      'streak_champions', v_champions,
      'broken_streaks_this_week', v_broken_week,
      'rewards_claimed_total', v_claimed_total,
      'rewards_ready_to_claim', v_ready_to_claim
    ),
    'claimed_breakdown', v_claimed_breakdown,
    'ready_breakdown', v_ready_breakdown,
    'totals', jsonb_build_object(
      'customers', (select count(*)::bigint from public.customers c where c.cafe_id = v_cafe_id),
      'check_ins_window', (
        select count(*)::bigint from public.visits v
        where v.cafe_id = v_cafe_id
          and v.visit_date between v_start and v_today
          and v.event_type = 'check_in'::public.visit_event_type
      )
    )
  );
end;
$$;

create or replace function public.hq_roi_ai_context(p_days int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_roi jsonb;
begin
  select * into v_roi from public.hq_roi_analytics_secure(p_days);
  if coalesce((v_roi->>'ok')::boolean, false) is not true then
    return v_roi;
  end if;

  return jsonb_build_object(
    'ok', true,
    'window_days', v_roi->'window_days',
    'timezone', v_roi->'timezone',
    'owner', v_roi->'owner',
    'claimed_breakdown', v_roi->'claimed_breakdown',
    'ready_breakdown', v_roi->'ready_breakdown',
    'totals', v_roi->'totals'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cashier: only physical rewards that are earned & not claimed
-- ---------------------------------------------------------------------------
create or replace function public.cashier_list_redeemable_rewards(
  p_customer_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate    jsonb;
  v_cafe_id uuid;
  v_rows    jsonb;
begin
  v_gate := public._cashier_assert_branch_access(p_branch_id);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;

  v_cafe_id := (v_gate->>'cafe_id')::uuid;

  if p_customer_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_customer');
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.cafe_id = v_cafe_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  perform public._sync_customer_physical_rewards(v_cafe_id, p_customer_id);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'reward_id', r.id,
      'milestone_id', rm.id,
      'milestone_name', rm.name,
      'reward_label', coalesce(nullif(trim(rm.reward_label), ''), rm.name),
      'days_required', rm.days_required,
      'icon_type', rm.icon_type,
      'fulfillment_type', rm.fulfillment_type::text,
      'earned_at', r.earned_at
    )
    order by r.earned_at desc nulls last, rm.sort_order, rm.days_required
  ), '[]'::jsonb)
  into v_rows
  from public.rewards r
  inner join public.reward_milestones rm on rm.id = r.milestone_id
  where r.customer_id = p_customer_id
    and r.cafe_id = v_cafe_id
    and rm.fulfillment_type = 'physical'::public.reward_fulfillment_type
    and r.earned_at is not null
    and r.claimed_at is null;

  return jsonb_build_object('ok', true, 'rewards', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal: sync rewards before returning milestones
-- ---------------------------------------------------------------------------
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
        'sort_order',          rm.sort_order,
        'earned_at',           r.earned_at,
        'claimed_at',          r.claimed_at
      )
      order by rm.sort_order, rm.days_required
    ),
    '[]'::jsonb
  )
  into v_milestones
  from public.reward_milestones rm
  left join public.rewards r
    on r.milestone_id = rm.id and r.customer_id = v_customer.id
  where rm.cafe_id = v_cafe.id
    and rm.active;

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
    'cafe_timezone',       v_tz,
    'next_visit_opens_at', v_next_midnight,
    'streak_expires_at',   v_streak_expiry
  );
end;
$$;

commit;
