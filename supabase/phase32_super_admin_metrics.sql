-- =============================================================================
-- StreakUp — Phase 32: Super Admin live metrics (global aggregates + tenant pulse)
--
-- Replaces hardcoded Super Admin dashboard figures with security-definer RPCs
-- that bypass tenant RLS for platform-wide aggregates (super_admin only).
--
-- Run AFTER phase31_grace_days.sql in the Supabase SQL editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Global platform health (Super Admin command center)
-- -----------------------------------------------------------------------------
create or replace function public.super_admin_global_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today   date := (timezone('utc', now()))::date;
  v_base    bigint;
  v_survival jsonb;
  v_shield   jsonb;
  v_daily    jsonb;
  v_commitment numeric;
  v_shield_saves bigint;
begin
  if not public.streakup_is_super_admin() then
    raise exception 'forbidden';
  end if;

  select count(*)::bigint
  into v_base
  from public.customers cu
  where cu.longest_streak >= 1 or cu.current_streak >= 1;

  select case
    when (select count(*) from public.customers) > 0 then
      round(
        100.0 * (select count(*) from public.customers where longest_streak >= 3)
        / (select count(*)::numeric from public.customers),
        1
      )
    else 0
  end
  into v_commitment;

  select
    count(*) filter (
      where v.event_type = 'check_in'::public.visit_event_type
        and coalesce(v.metadata->>'shield_consumed', 'false') = 'true'
    )
    + count(*) filter (
      where v.event_type = 'system'::public.visit_event_type
        and coalesce(v.metadata->>'shield_auto_consumed', 'false') = 'true'
    )
  into v_shield_saves
  from public.visits v
  where v.metadata ? 'shield_consumed'
     or v.metadata ? 'shield_auto_consumed'
     or (v.event_type = 'system'::public.visit_event_type);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'day', m.day,
        'reached', cnt.reached,
        'eligible', v_base,
        'rate_pct', case when v_base > 0 then round(100.0 * cnt.reached / v_base, 1) else 0 end
      )
      order by m.day
    ),
    '[]'::jsonb
  )
  into v_survival
  from (values (3), (5), (7), (10), (14), (21), (30)) as m(day)
  cross join lateral (
    select count(*)::bigint as reached
    from public.customers cu
    where cu.longest_streak >= m.day
  ) cnt;

  with shield_events as (
    select
      count(*) filter (
        where v.event_type = 'check_in'::public.visit_event_type
          and coalesce(v.metadata->>'shield_consumed', 'false') = 'true'
      )::bigint as check_in_saves,
      count(*) filter (
        where v.event_type = 'system'::public.visit_event_type
          and coalesce(v.metadata->>'shield_auto_consumed', 'false') = 'true'
      )::bigint as midnight_saves
    from public.visits v
    where v.metadata ? 'shield_consumed'
       or v.metadata ? 'shield_auto_consumed'
       or (v.event_type = 'system'::public.visit_event_type)
  ),
  gap_opportunities as (
    select count(*)::bigint as gaps
    from public.visits v1
    join public.visits v2
      on v2.customer_id = v1.customer_id
     and v2.cafe_id = v1.cafe_id
     and v2.event_type = 'check_in'::public.visit_event_type
     and v1.event_type = 'check_in'::public.visit_event_type
     and v2.visit_date > v1.visit_date
     and (v2.visit_date - v1.visit_date) = 2
  )
  select jsonb_build_object(
    'check_in_saves', se.check_in_saves,
    'midnight_saves', se.midnight_saves,
    'total_saves', se.check_in_saves + se.midnight_saves,
    'gap_opportunities', go.gaps,
    'salvage_rate_pct', case
      when go.gaps > 0 then round(100.0 * (se.check_in_saves + se.midnight_saves) / go.gaps, 1)
      else 0
    end
  )
  into v_shield
  from shield_events se, gap_opportunities go;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', d.d::text,
        'check_ins', coalesce(c.cnt, 0)
      )
      order by d.d
    ),
    '[]'::jsonb
  )
  into v_daily
  from generate_series(v_today - 13, v_today, interval '1 day') as d(d)
  left join lateral (
    select count(*)::bigint as cnt
    from public.visits v
    where v.visit_date = d.d::date
      and v.event_type = 'check_in'::public.visit_event_type
  ) c on true;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'headline', jsonb_build_object(
      'active_cafes', (select count(*) from public.cafes where status = 'active'),
      'total_end_users', (select count(*) from public.customers),
      'global_shield_saves', coalesce(v_shield_saves, 0),
      'avg_commitment_rate_pct', coalesce(v_commitment, 0),
      'active_streaks_now', (
        select count(*) from public.customers where current_streak >= 1
      ),
      'check_ins_today', (
        select count(*)
        from public.visits v
        where v.visit_date = v_today
          and v.event_type = 'check_in'::public.visit_event_type
      ),
      'visits_total', (select count(*) from public.visits),
      'branches_total', (select count(*) from public.branches),
      'webhooks_pending', (
        select count(*) from public.webhook_outbox where status = 'pending'
      ),
      'webhooks_live', (
        select count(*) from public.outbound_webhooks where is_enabled = true
      )
    ),
    'daily_check_ins', v_daily,
    'streak_survival', v_survival,
    'shield_salvage', v_shield
  );
end;
$$;

revoke all on function public.super_admin_global_metrics() from public;
grant execute on function public.super_admin_global_metrics() to authenticated;

-- -----------------------------------------------------------------------------
-- Tenant directory with Customer Success pulse metrics
-- -----------------------------------------------------------------------------
create or replace function public.super_admin_tenant_pulse_list(
  p_limit int default 25,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (timezone('utc', now()))::date;
  v_total bigint;
  v_rows  jsonb;
begin
  if not public.streakup_is_super_admin() then
    raise exception 'forbidden';
  end if;

  p_limit := greatest(1, least(coalesce(p_limit, 25), 100));
  p_offset := greatest(0, coalesce(p_offset, 0));

  select count(*)::bigint into v_total from public.cafes;

  select coalesce(jsonb_agg(row_data order by row_data->>'created_at' desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'slug', c.slug,
      'status', c.status,
      'timezone', c.timezone,
      'currency_code', c.currency_code,
      'created_at', c.created_at,
      'subscription_status', sub.status,
      'plan_tier', sub.plan_tier,
      'customer_count', coalesce(cust.cnt, 0),
      'check_ins_today', coalesce(today_vis.cnt, 0),
      'last_active_at', act.last_at,
      'pulse', case
        when coalesce(today_vis.cnt, 0) >= 1
          or (act.last_at is not null and act.last_at >= now() - interval '2 days')
          then 'hot'
        when act.last_at is not null and act.last_at >= now() - interval '7 days'
          then 'warm'
        when act.last_at is not null and act.last_at >= now() - interval '14 days'
          then 'cool'
        else 'inactive'
      end
    ) as row_data
    from public.cafes c
    left join lateral (
      select s.status, s.plan_tier
      from public.subscriptions s
      where s.cafe_id = c.id
      order by s.created_at desc nulls last
      limit 1
    ) sub on true
    left join lateral (
      select count(*)::bigint as cnt
      from public.customers cu
      where cu.cafe_id = c.id
    ) cust on true
    left join lateral (
      select count(*)::bigint as cnt
      from public.visits v
      where v.cafe_id = c.id
        and v.visit_date = v_today
        and v.event_type = 'check_in'::public.visit_event_type
    ) today_vis on true
    left join lateral (
      select max(v.created_at) as last_at
      from public.visits v
      where v.cafe_id = c.id
        and v.event_type = 'check_in'::public.visit_event_type
    ) act on true
    order by c.created_at desc
    limit p_limit
    offset p_offset
  ) q;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'tenants', v_rows
  );
end;
$$;

revoke all on function public.super_admin_tenant_pulse_list(int, int) from public;
grant execute on function public.super_admin_tenant_pulse_list(int, int) to authenticated;

commit;
