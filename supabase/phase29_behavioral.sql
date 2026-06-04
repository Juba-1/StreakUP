-- =============================================================================
-- StreakUp — Phase 29: Behavioral analytics + smart reward bifurcation
--
-- 1. fulfillment_type on reward_milestones (physical vs digital_shield)
-- 2. Engine: digital shields auto-grant only — no cashier-redeemable row
-- 3. hq_roi_analytics_secure → behavioral habit-formation metrics (no revenue)
-- 4. Cashier + portal aligned to physical rewards only
-- 5. Realtime on rewards for instant "claimed" UX
-- Run AFTER phase28_cashier_rewards.sql
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Reward fulfillment bifurcation
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'reward_fulfillment_type') then
    create type public.reward_fulfillment_type as enum ('physical', 'digital_shield');
  end if;
end$$;

alter table public.reward_milestones
  add column if not exists fulfillment_type public.reward_fulfillment_type;

-- Classify existing rows: shield-icon milestones = digital; everything else = physical
update public.reward_milestones rm
set fulfillment_type = 'digital_shield'::public.reward_fulfillment_type
where rm.fulfillment_type is null
  and rm.icon_type = 'shield';

update public.reward_milestones rm
set fulfillment_type = 'physical'::public.reward_fulfillment_type
where rm.fulfillment_type is null;

alter table public.reward_milestones
  alter column fulfillment_type set not null;

alter table public.reward_milestones
  alter column fulfillment_type set default 'physical'::public.reward_fulfillment_type;

comment on column public.reward_milestones.fulfillment_type is
  'physical = cashier redemption required; digital_shield = auto-granted to shields inventory only.';

-- ---------------------------------------------------------------------------
-- Streak engine — bifurcated milestone handling (no change to streak math)
-- ---------------------------------------------------------------------------
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
  v_diff               int;
  v_new_streak         int;
  v_new_shields        int;
  v_consumed           boolean := false;
  v_awarded            boolean := false;
  v_milestone_shields  int := 0;
  v_frozen             boolean := false;
  v_already_today      boolean := false;
  v_dow                int;
  v_cap                int;
  v_milestones         jsonb := '[]'::jsonb;
  v_prev_streak        int;
  v_grant              int;
  v_m                  record;
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
  if v_cafe.off_days is not null
    and cardinality(v_cafe.off_days) > 0
    and v_cafe.off_days @> array[v_dow::smallint] then
    v_frozen := true;
    v_new_streak := v_cust.current_streak;
  else
    select max(v.visit_date) into v_last
    from public.visits v
    where v.customer_id = p_customer_id
      and v.cafe_id = p_cafe_id
      and v.event_type = 'check_in'::public.visit_event_type;

    if v_last is null then
      v_new_streak := 1;
    elsif p_visit_date = v_last then
      v_new_streak := v_cust.current_streak;
      v_already_today := true;
    elsif p_visit_date < v_last then
      v_new_streak := v_cust.current_streak;
    else
      v_diff := (p_visit_date - v_last);
      if v_diff = 1 then
        v_new_streak := v_cust.current_streak + 1;
      elsif v_diff = 2 then
        if v_cust.shields > 0 then
          v_new_shields := v_cust.shields - 1;
          v_consumed := true;
          v_new_streak := v_cust.current_streak + 1;
        else
          v_new_streak := 1;
        end if;
      else
        v_new_streak := 1;
      end if;
    end if;

    if (not v_frozen) and (not v_already_today) and v_new_streak > v_prev_streak then
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
  end if;

  if (not v_frozen) and (not v_already_today) and v_new_streak > v_prev_streak then
    for v_m in
      select rm.id, rm.name, rm.days_required, rm.shield_grant_amount, rm.fulfillment_type, rm.icon_type
      from public.reward_milestones rm
      where rm.cafe_id = p_cafe_id
        and rm.active
        and rm.days_required <= v_new_streak
        and rm.days_required > v_prev_streak
      order by rm.sort_order, rm.days_required
    loop
      v_grant := greatest(0, coalesce(v_m.shield_grant_amount, 0));

      -- Path B: physical items → rewards ledger (cashier redeems)
      if v_m.fulfillment_type = 'physical'::public.reward_fulfillment_type then
        insert into public.rewards (cafe_id, customer_id, milestone_id, earned_at)
        values (p_cafe_id, p_customer_id, v_m.id, now())
        on conflict (customer_id, milestone_id) do update
          set earned_at  = coalesce(public.rewards.earned_at, excluded.earned_at),
              updated_at = now();
      end if;

      -- Path A: digital shields → inventory only (always apply shield_grant_amount)
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
    'shield_awarded',            v_awarded,
    'milestone_shields_granted', v_milestone_shields,
    'off_day_freeze',            v_frozen,
    'already_visited_today',     v_already_today,
    'dow',                       v_dow,
    'milestones',                coalesce(v_milestones, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Behavioral analytics (replaces revenue estimation in hq_roi_analytics_secure)
-- ---------------------------------------------------------------------------
create or replace function public.hq_roi_analytics_secure(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile   public.profiles%rowtype;
  v_cafe_id   uuid;
  v_days      int;
  v_start     date;
  v_today     date;
  v_tz        text;
  v_adopters  bigint;
  v_starters  bigint;
  v_funnel    jsonb;
  v_funnel_base bigint;
  v_survival_d3 numeric;
  v_survival_d5 numeric;
  v_survival_d7 numeric;
  v_survival_d10 numeric;
  v_velocity_days numeric;
  v_stickiness_pct numeric;
  v_repeat_rate numeric;
  v_casual_avg numeric;
  v_streaker_avg numeric;
  v_weekly_velocity jsonb;
  v_cohort_stickiness jsonb;
begin
  select * into v_profile from public.profiles where user_id = auth.uid() limit 1;
  if not found or v_profile.role <> 'hq_owner'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  v_cafe_id := v_profile.cafe_id;
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_days := greatest(1, least(coalesce(p_days, 30), 365));
  select coalesce(nullif(trim(c.timezone), ''), 'UTC') into v_tz
  from public.cafes c where c.id = v_cafe_id;
  v_today := (now() at time zone v_tz)::date;
  v_start := v_today - (v_days - 1);

  -- Unique customers who ever checked in (system adopters)
  select count(distinct v.customer_id) into v_adopters
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.event_type = 'check_in'::public.visit_event_type;

  -- Customers who started a streak journey (reached day 2+ at least once)
  select count(*)::bigint into v_starters
  from public.customers c
  where c.cafe_id = v_cafe_id
    and c.longest_streak >= 2;

  select count(*)::bigint into v_funnel_base
  from public.customers c
  where c.cafe_id = v_cafe_id
    and c.longest_streak >= 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', m.day,
      'customers', m.cnt,
      'rate_pct', case when v_funnel_base > 0 then round(100.0 * m.cnt / v_funnel_base, 1) else 0 end
    ) order by m.day
  ), '[]'::jsonb)
  into v_funnel
  from (
    select d.day,
      (select count(*)::bigint from public.customers c
       where c.cafe_id = v_cafe_id and c.longest_streak >= d.day) as cnt
    from (values (1), (3), (5), (7), (10)) as d(day)
  ) m;

  select
    case when v_funnel_base > 0 then round(100.0 * (select count(*) from public.customers c where c.cafe_id = v_cafe_id and c.longest_streak >= 3) / v_funnel_base, 1) else 0 end,
    case when v_funnel_base > 0 then round(100.0 * (select count(*) from public.customers c where c.cafe_id = v_cafe_id and c.longest_streak >= 5) / v_funnel_base, 1) else 0 end,
    case when v_funnel_base > 0 then round(100.0 * (select count(*) from public.customers c where c.cafe_id = v_cafe_id and c.longest_streak >= 7) / v_funnel_base, 1) else 0 end,
    case when v_funnel_base > 0 then round(100.0 * (select count(*) from public.customers c where c.cafe_id = v_cafe_id and c.longest_streak >= 10) / v_funnel_base, 1) else 0 end
  into v_survival_d3, v_survival_d5, v_survival_d7, v_survival_d10;

  -- Visit velocity: mean gap between consecutive check-ins (active streakers, window)
  select round(avg(gap_days)::numeric, 2) into v_velocity_days
  from (
    select (lead(v.visit_date) over (partition by v.customer_id order by v.visit_date) - v.visit_date) as gap_days
    from public.visits v
    where v.cafe_id = v_cafe_id
      and v.visit_date between v_start and v_today
      and v.event_type = 'check_in'::public.visit_event_type
  ) g
  where g.gap_days is not null and g.gap_days > 0;

  -- Repeat rate: % of adopters with 2+ visits in window
  select case when v_adopters > 0 then round(
    100.0 * (
      select count(*)::bigint from (
        select v.customer_id
        from public.visits v
        where v.cafe_id = v_cafe_id
          and v.visit_date between v_start and v_today
          and v.event_type = 'check_in'::public.visit_event_type
        group by v.customer_id
        having count(*) >= 2
      ) sub
    ) / v_adopters, 1) else 0 end into v_repeat_rate;

  -- Stickiness proxy: avg visits per customer — casual (1 visit ever) vs power (longest>=7)
  select coalesce(avg(cnt), 0) into v_casual_avg
  from (
    select count(*)::numeric as cnt
    from public.visits v
    join public.customers c on c.id = v.customer_id and c.cafe_id = v_cafe_id
    where v.cafe_id = v_cafe_id
      and v.visit_date between v_start and v_today
      and v.event_type = 'check_in'::public.visit_event_type
    group by v.customer_id
    having (select count(*) from public.visits vv where vv.customer_id = v.customer_id and vv.event_type = 'check_in') = 1
  ) x;

  select coalesce(avg(cnt), 0) into v_streaker_avg
  from (
    select count(*)::numeric as cnt
    from public.visits v
    join public.customers c on c.id = v.customer_id and c.longest_streak >= 7
    where v.cafe_id = v_cafe_id
      and v.visit_date between v_start and v_today
      and v.event_type = 'check_in'::public.visit_event_type
    group by v.customer_id
  ) y;

  if v_casual_avg > 0 then
    v_stickiness_pct := round(greatest(0, (v_streaker_avg / v_casual_avg - 1) * 100), 1);
  else
    v_stickiness_pct := 0;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('week', w.wk, 'check_ins', w.cnt) order by w.wk
  ), '[]'::jsonb)
  into v_weekly_velocity
  from (
    select date_trunc('week', v.visit_date)::date as wk, count(*)::bigint as cnt
    from public.visits v
    where v.cafe_id = v_cafe_id
      and v.visit_date between v_start and v_today
      and v.event_type = 'check_in'::public.visit_event_type
    group by 1
  ) w;

  select coalesce(jsonb_agg(
    jsonb_build_object('tier', t.tier, 'avg_visits', round(t.avg_v, 2), 'customers', t.n) order by t.ord
  ), '[]'::jsonb)
  into v_cohort_stickiness
  from (
    select 'casual' as tier, 1 as ord, count(*)::bigint as n, coalesce(avg(vc), 0)::numeric as avg_v
    from (
      select c.id, count(v.*)::numeric as vc
      from public.customers c
      left join public.visits v on v.customer_id = c.id and v.cafe_id = c.cafe_id
        and v.visit_date between v_start and v_today
        and v.event_type = 'check_in'::public.visit_event_type
      where c.cafe_id = v_cafe_id
      group by c.id
      having count(v.*) <= 2
    ) q
    union all
    select 'activated', 2, count(*)::bigint, coalesce(avg(vc), 0)::numeric
    from (
      select c.id, count(v.*)::numeric as vc
      from public.customers c
      left join public.visits v on v.customer_id = c.id and v.cafe_id = c.cafe_id
        and v.visit_date between v_start and v_today
        and v.event_type = 'check_in'::public.visit_event_type
      where c.cafe_id = v_cafe_id and c.longest_streak between 3 and 6
      group by c.id
    ) q
    union all
    select 'power', 3, count(*)::bigint, coalesce(avg(vc), 0)::numeric
    from (
      select c.id, count(v.*)::numeric as vc
      from public.customers c
      left join public.visits v on v.customer_id = c.id and v.cafe_id = c.cafe_id
        and v.visit_date between v_start and v_today
        and v.event_type = 'check_in'::public.visit_event_type
      where c.cafe_id = v_cafe_id and c.longest_streak >= 7
      group by c.id
    ) q
  ) t;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'window_days', v_days,
    'timezone', v_tz,
    'behavioral', jsonb_build_object(
      'total_adopters', v_adopters,
      'streak_starters', v_starters,
      'commitment_rate_d3_pct', v_survival_d3,
      'commitment_rate_d5_pct', v_survival_d5,
      'commitment_rate_d7_pct', v_survival_d7,
      'commitment_rate_d10_pct', v_survival_d10,
      'avg_return_interval_days', coalesce(v_velocity_days, 0),
      'repeat_visit_rate_pct', v_repeat_rate,
      'stickiness_uplift_pct', v_stickiness_pct,
      'casual_avg_visits', round(v_casual_avg, 2),
      'power_avg_visits', round(v_streaker_avg, 2)
    ),
    'funnel', v_funnel,
    'weekly_velocity', v_weekly_velocity,
    'cohort_stickiness', v_cohort_stickiness,
    'totals', jsonb_build_object(
      'customers', (select count(*)::bigint from public.customers c where c.cafe_id = v_cafe_id),
      'active_streaks', (select count(*)::bigint from public.customers c where c.cafe_id = v_cafe_id and c.current_streak > 0),
      'total_check_ins', (
        select count(*)::bigint from public.visits v
        where v.cafe_id = v_cafe_id
          and v.visit_date between v_start and v_today
          and v.event_type = 'check_in'::public.visit_event_type
      )
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- AI context — behavioral only
-- ---------------------------------------------------------------------------
create or replace function public.hq_roi_ai_context(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_roi jsonb;
  v_top_hour int;
  v_top_cnt bigint;
begin
  select * into v_roi from public.hq_roi_analytics_secure(p_days);
  if coalesce((v_roi->>'ok')::boolean, false) is not true then
    return v_roi;
  end if;

  select f.day, (f.rate_pct)::numeric into v_top_hour, v_top_cnt
  from jsonb_to_recordset(v_roi->'funnel') as f(day int, rate_pct numeric)
  order by rate_pct asc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'window_days', v_roi->'window_days',
    'timezone', v_roi->'timezone',
    'behavioral', v_roi->'behavioral',
    'funnel', v_roi->'funnel',
    'weekly_velocity', v_roi->'weekly_velocity',
    'cohort_stickiness', v_roi->'cohort_stickiness',
    'totals', v_roi->'totals',
    'signals', jsonb_build_object(
      'lowest_funnel_day', v_top_hour,
      'lowest_funnel_rate_pct', v_top_cnt
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cashier: physical rewards only
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
  v_gate   jsonb;
  v_cafe_id uuid;
  v_rows   jsonb;
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
-- Realtime: customer sees claimed_at updates instantly
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rewards'
    ) then
      alter publication supabase_realtime add table public.rewards;
    end if;
  end if;
exception when others then
  null;
end$$;

-- ---------------------------------------------------------------------------
-- Customer portal — fulfillment_type on milestones
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
