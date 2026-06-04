-- =============================================================================
-- StreakUp — Phase 25: HQ ROI Analytics + AI Copilot context
--
-- Tenant-isolated, security-definer RPCs for cafe owners. Revenue figures are
-- estimated from configurable avg_ticket_cents × verified check-ins (no POS yet).
-- =============================================================================

begin;

alter table public.cafes
  add column if not exists avg_ticket_cents int not null default 3500;

comment on column public.cafes.avg_ticket_cents is
  'Estimated average order value in minor units (cents/halalas) for ROI dashboards until POS integration.';

-- ---------------------------------------------------------------------------
-- Core ROI analytics payload
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
  v_cafe      public.cafes%rowtype;
  v_cafe_id   uuid;
  v_days      int;
  v_start     date;
  v_today     date;
  v_tz        text;
  v_ticket    int;
  v_streak_visits bigint;
  v_casual_visits bigint;
  v_shield_saves bigint;
  v_streak_customers bigint;
  v_casual_customers bigint;
  v_streak_rev bigint;
  v_casual_rev bigint;
  v_shield_rev bigint;
  v_uplift_pct numeric;
  v_funnel jsonb;
  v_funnel_base bigint;
  v_peak_hours jsonb;
  v_peak_days jsonb;
begin
  select * into v_profile from public.profiles where user_id = auth.uid() limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_profile.role <> 'hq_owner'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_cafe_id := v_profile.cafe_id;
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_cafe from public.cafes where id = v_cafe_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'cafe_not_found');
  end if;

  v_days  := greatest(1, least(coalesce(p_days, 30), 365));
  v_tz    := coalesce(nullif(trim(v_cafe.timezone), ''), 'UTC');
  v_today := (now() at time zone v_tz)::date;
  v_start := v_today - (v_days - 1);
  v_ticket := greatest(coalesce(v_cafe.avg_ticket_cents, 3500), 100);

  -- Streak-attributed visits: returning streak momentum (day 2+)
  select count(*) into v_streak_visits
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.visit_date between v_start and v_today
    and v.event_type = 'check_in'::public.visit_event_type
    and v.streak_after >= 2;

  select count(*) into v_casual_visits
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.visit_date between v_start and v_today
    and v.event_type = 'check_in'::public.visit_event_type
    and v.streak_after = 1;

  select count(distinct v.customer_id) into v_streak_customers
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.visit_date between v_start and v_today
    and v.event_type = 'check_in'::public.visit_event_type
    and v.streak_after >= 2;

  select count(distinct v.customer_id) into v_casual_customers
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.visit_date between v_start and v_today
    and v.event_type = 'check_in'::public.visit_event_type
    and v.streak_after = 1;

  v_streak_rev := v_streak_visits * v_ticket;
  v_casual_rev := v_casual_visits * v_ticket;

  -- Shield revenue rescue: check-ins that consumed a shield + midnight auto-saves
  select count(*) into v_shield_saves
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.visit_date between v_start and v_today
    and (
      coalesce((v.metadata->>'shield_consumed')::boolean, false)
      or coalesce((v.metadata->>'shield_auto_consumed')::boolean, false)
    );

  v_shield_rev := v_shield_saves * v_ticket;

  -- Ticket uplift proxy: revenue-per-active-customer in streak vs casual cohorts
  if v_casual_customers > 0 and v_streak_customers > 0 then
    v_uplift_pct := round(
      (
        (v_streak_rev::numeric / v_streak_customers)
        / nullif(v_casual_rev::numeric / v_casual_customers, 0)
        - 1
      ) * 100,
      1
    );
  else
    v_uplift_pct := 0;
  end if;

  -- Milestone funnel (customers who ever reached streak day N)
  select count(*)::bigint into v_funnel_base
  from public.customers c
  where c.cafe_id = v_cafe_id
    and c.longest_streak >= 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', m.day,
      'customers', m.cnt,
      'rate_pct', case when v_funnel_base > 0 then round(100.0 * m.cnt / v_funnel_base, 1) else 0 end
    )
    order by m.day
  ), '[]'::jsonb)
  into v_funnel
  from (
    select
      d.day,
      (
        select count(*)::bigint
        from public.customers c
        where c.cafe_id = v_cafe_id
          and c.longest_streak >= d.day
      ) as cnt
    from (values (1), (3), (5), (7), (10)) as d(day)
  ) m;

  -- Peak streak check-in hours (local cafe time)
  select coalesce(jsonb_agg(
    jsonb_build_object('hour', h.hour, 'check_ins', h.cnt)
    order by h.hour
  ), '[]'::jsonb)
  into v_peak_hours
  from (
    select
      extract(hour from (v.created_at at time zone v_tz))::int as hour,
      count(*)::bigint as cnt
    from public.visits v
    where v.cafe_id = v_cafe_id
      and v.visit_date between v_start and v_today
      and v.event_type = 'check_in'::public.visit_event_type
      and v.streak_after >= 2
    group by 1
  ) h;

  -- Peak streak days of week (0=Sun)
  select coalesce(jsonb_agg(
    jsonb_build_object('dow', d.dow, 'check_ins', d.cnt)
    order by d.dow
  ), '[]'::jsonb)
  into v_peak_days
  from (
    select
      extract(dow from v.visit_date)::int as dow,
      count(*)::bigint as cnt
    from public.visits v
    where v.cafe_id = v_cafe_id
      and v.visit_date between v_start and v_today
      and v.event_type = 'check_in'::public.visit_event_type
      and v.streak_after >= 2
    group by 1
  ) d;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'window_days', v_days,
    'currency_code', v_cafe.currency_code,
    'avg_ticket_cents', v_ticket,
    'timezone', v_tz,
    'financial', jsonb_build_object(
      'streak_attributed_revenue_cents', v_streak_rev,
      'streak_visits', v_streak_visits,
      'streak_active_customers', v_streak_customers,
      'casual_revenue_cents', v_casual_rev,
      'casual_visits', v_casual_visits,
      'casual_active_customers', v_casual_customers,
      'ticket_uplift_pct', v_uplift_pct,
      'shield_rescue_revenue_cents', v_shield_rev,
      'shield_saves', v_shield_saves,
      'estimated_disclaimer', true
    ),
    'funnel', v_funnel,
    'peak_hours', v_peak_hours,
    'peak_days', v_peak_days,
    'daily_streak_visits', coalesce((
      select jsonb_agg(jsonb_build_object('d', s.day::text, 'c', coalesce(x.cnt, 0)) order by s.day)
      from generate_series(v_start, v_today, interval '1 day') s(day)
      left join lateral (
        select count(*)::bigint as cnt
        from public.visits vv
        where vv.cafe_id = v_cafe_id
          and vv.visit_date = s.day::date
          and vv.event_type = 'check_in'::public.visit_event_type
          and vv.streak_after >= 2
      ) x on true
    ), '[]'::jsonb),
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

revoke all on function public.hq_roi_analytics_secure(int) from public;
grant execute on function public.hq_roi_analytics_secure(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Anonymized AI context (no PII)
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
  v_profile public.profiles%rowtype;
  v_cafe_id uuid;
  v_drop_day int;
  v_drop_rate numeric;
  v_top_hour int;
  v_top_hour_cnt bigint;
begin
  select * into v_profile from public.profiles where user_id = auth.uid() limit 1;
  if not found or v_profile.role <> 'hq_owner'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_cafe_id := v_profile.cafe_id;
  v_roi := public.hq_roi_analytics_secure(p_days);

  if coalesce((v_roi->>'ok')::boolean, false) is not true then
    return v_roi;
  end if;

  -- Largest funnel drop between consecutive milestones
  select f.day, f.rate_pct into v_drop_day, v_drop_rate
  from jsonb_to_recordset(v_roi->'funnel') as f(day int, rate_pct numeric)
  order by rate_pct asc
  limit 1;

  select h.hour, h.check_ins into v_top_hour, v_top_hour_cnt
  from jsonb_to_recordset(v_roi->'peak_hours') as h(hour int, check_ins bigint)
  order by h.check_ins desc nulls last
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'window_days', v_roi->'window_days',
    'currency_code', v_roi->'currency_code',
    'avg_ticket_cents', v_roi->'avg_ticket_cents',
    'timezone', v_roi->'timezone',
    'financial', v_roi->'financial',
    'funnel', v_roi->'funnel',
    'peak_hours', v_roi->'peak_hours',
    'peak_days', v_roi->'peak_days',
    'totals', v_roi->'totals',
    'signals', jsonb_build_object(
      'lowest_funnel_day', v_drop_day,
      'lowest_funnel_rate_pct', v_drop_rate,
      'peak_streak_hour', v_top_hour,
      'peak_streak_hour_volume', v_top_hour_cnt
    )
  );
end;
$$;

revoke all on function public.hq_roi_ai_context(int) from public;
grant execute on function public.hq_roi_ai_context(int) to authenticated;

commit;
