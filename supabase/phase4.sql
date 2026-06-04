-- =============================================================================
-- StreakUp — Phase 4 (HQ analytics RPC for charts; run after phase3.sql)
-- =============================================================================

begin;

create or replace function public.hq_analytics_series(p_days int default 30)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_cafe_id uuid;
  v_start date;
begin
  v_profile := public.streakup_profile();
  if v_profile is null then
    raise exception 'not_authenticated';
  end if;

  if v_profile.role <> 'hq_owner'::public.streakup_role then
    raise exception 'forbidden';
  end if;

  v_cafe_id := v_profile.cafe_id;
  if v_cafe_id is null then
    raise exception 'forbidden';
  end if;

  v_start := (timezone('UTC', now()))::date - greatest(p_days, 1);

  return jsonb_build_object(
    'daily_visits',
    coalesce((
      select jsonb_agg(day_row order by day_row->>'d')
      from (
        select jsonb_build_object(
          'd', d.day::text,
          'c', coalesce(v.cnt, 0)
        ) as day_row
        from (
          select generate_series(v_start, (timezone('UTC', now()))::date, interval '1 day')::date as day
        ) d
        left join lateral (
          select count(*)::bigint as cnt
          from public.visits vv
          where vv.cafe_id = v_cafe_id
            and vv.visit_date = d.day
            and vv.event_type = 'check_in'::public.visit_event_type
        ) v on true
      ) s
    ), '[]'::jsonb),
    'branch_totals',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'branch_id', b.id,
          'branch_code', b.branch_code,
          'name', b.name,
          'visits', coalesce(x.cnt, 0),
          'unique_customers', coalesce(x.uq, 0)
        )
        order by b.branch_code
      )
      from public.branches b
      left join lateral (
        select
          count(*)::bigint as cnt,
          count(distinct vv.customer_id)::bigint as uq
        from public.visits vv
        where vv.branch_id = b.id
          and vv.visit_date >= v_start
          and vv.event_type = 'check_in'::public.visit_event_type
      ) x on true
      where b.cafe_id = v_cafe_id
    ), '[]'::jsonb),
    'retention',
    (
      select jsonb_build_object(
        'active_customers_window', count(distinct vv.customer_id),
        'total_customers', (select count(*)::bigint from public.customers c where c.cafe_id = v_cafe_id)
      )
      from public.visits vv
      where vv.cafe_id = v_cafe_id
        and vv.visit_date >= v_start
        and vv.event_type = 'check_in'::public.visit_event_type
    )
  );
end;
$$;

revoke all on function public.hq_analytics_series(int) from public;
grant execute on function public.hq_analytics_series(int) to authenticated;

commit;
