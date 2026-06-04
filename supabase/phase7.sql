-- Phase 7 — HQ pulse context for live AI banner (run after phase6.sql).
-- Aggregates are cafe-scoped; no raw PII.

begin;

create or replace function public.hq_pulse_context()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_cafe_id uuid;
  v_tz text;
  v_today date;
  v_today_visits bigint;
  v_dow int;
  v_last7 jsonb;
  v_hot jsonb;
  v_shields_30d bigint;
begin
  v_profile := public.streakup_profile();
  if v_profile is null then
    raise exception 'not_authenticated';
  end if;

  if v_profile.role = 'super_admin'::public.streakup_role then
    raise exception 'forbidden';
  elsif v_profile.role = 'hq_owner'::public.streakup_role then
    v_cafe_id := v_profile.cafe_id;
  else
    raise exception 'forbidden';
  end if;

  if v_cafe_id is null then
    raise exception 'forbidden';
  end if;

  select coalesce(c.timezone, 'UTC') into v_tz from public.cafes c where c.id = v_cafe_id;
  v_today := (timezone(v_tz, now()))::date;
  v_dow := extract(dow from timezone(v_tz, now())::timestamp)::int;

  select count(*) into v_today_visits
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.visit_date = v_today
    and v.event_type = 'check_in'::public.visit_event_type;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('date', days.d::text, 'check_ins', coalesce(counts.cnt, 0))
      order by days.d
    ),
    '[]'::jsonb
  ) into v_last7
  from (
    select generate_series(v_today - 6, v_today, interval '1 day')::date as d
  ) days
  left join lateral (
    select count(*)::bigint as cnt
    from public.visits v
    where v.cafe_id = v_cafe_id
      and v.event_type = 'check_in'::public.visit_event_type
      and v.visit_date = days.d
  ) counts on true;

  select jsonb_build_object(
    'branch_code', b.branch_code,
    'check_ins', coalesce(cnt.c, 0)
  ) into v_hot
  from public.branches b
  left join lateral (
    select count(*)::bigint as c
    from public.visits v2
    where v2.branch_id = b.id
      and v2.visit_date = v_today
      and v2.event_type = 'check_in'::public.visit_event_type
  ) cnt on true
  where b.cafe_id = v_cafe_id
  order by coalesce(cnt.c, 0) desc, b.branch_code
  limit 1;

  select count(*) into v_shields_30d
  from public.visits v
  where v.cafe_id = v_cafe_id
    and v.visit_date >= v_today - 29
    and v.event_type = 'check_in'::public.visit_event_type
    and coalesce(v.metadata->>'shield_consumed', 'false') = 'true';

  return jsonb_strip_nulls(jsonb_build_object(
    'cafe_timezone', v_tz,
    'local_date', v_today::text,
    'local_dow', v_dow,
    'today_check_ins', v_today_visits,
    'last_7d_daily', v_last7,
    'top_branch_today', v_hot,
    'shield_consumed_events_30d', v_shields_30d
  ));
end;
$$;

revoke all on function public.hq_pulse_context() from public;
grant execute on function public.hq_pulse_context() to authenticated;

commit;
