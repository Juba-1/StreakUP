-- =============================================================================
-- StreakUp — Phase 24: Investor analytics RPC + Web Push retention infrastructure
-- Run AFTER phase23.sql. Safe to re-run (idempotent).
-- Does NOT modify streak/visit engine logic.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Push subscriptions (customer portal — session-scoped registration)
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_uniq unique (endpoint)
);

create index if not exists push_subscriptions_cafe_idx on public.push_subscriptions (cafe_id);
create index if not exists push_subscriptions_customer_idx on public.push_subscriptions (customer_id);

alter table public.push_subscriptions enable row level security;

-- No direct client access — registrations go through SECURITY DEFINER RPC only.
drop policy if exists push_subscriptions_deny_all on public.push_subscriptions;
create policy push_subscriptions_deny_all
on public.push_subscriptions
for all
to authenticated, anon
using (false)
with check (false);

-- -----------------------------------------------------------------------------
-- Dedupe: one streak-warning push per customer per café-local calendar day
-- -----------------------------------------------------------------------------
create table if not exists public.push_warning_log (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers (id) on delete cascade,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  warning_date date not null,
  sent_at timestamptz not null default now(),
  constraint push_warning_log_customer_day_uniq unique (customer_id, warning_date)
);

create index if not exists push_warning_log_cafe_date_idx
  on public.push_warning_log (cafe_id, warning_date desc);

alter table public.push_warning_log enable row level security;

drop policy if exists push_warning_log_deny_all on public.push_warning_log;
create policy push_warning_log_deny_all
on public.push_warning_log
for all
to authenticated, anon
using (false)
with check (false);

-- -----------------------------------------------------------------------------
-- Register push subscription (portal session token)
-- -----------------------------------------------------------------------------
create or replace function public.customer_register_push_subscription(
  p_cafe_slug text,
  p_session_token text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug    text := lower(trim(coalesce(p_cafe_slug, '')));
  v_token   text := trim(coalesce(p_session_token, ''));
  v_hash    text;
  v_sess    record;
begin
  if v_slug = '' or v_token = '' or trim(coalesce(p_endpoint, '')) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  select s.customer_id, s.cafe_id
  into v_sess
  from public.customer_portal_sessions s
  join public.cafes c on c.id = s.cafe_id
  where c.slug = v_slug
    and s.token_hash = v_hash
    and s.expires_at > now()
  limit 1;

  if v_sess.customer_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  insert into public.push_subscriptions (
    customer_id,
    cafe_id,
    endpoint,
    p256dh,
    auth,
    user_agent,
    updated_at
  )
  values (
    v_sess.customer_id,
    v_sess.cafe_id,
    trim(p_endpoint),
    trim(p_p256dh),
    trim(p_auth),
    null,
    now()
  )
  on conflict (endpoint) do update
  set
    customer_id = excluded.customer_id,
    cafe_id     = excluded.cafe_id,
    p256dh      = excluded.p256dh,
    auth        = excluded.auth,
    updated_at  = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.customer_register_push_subscription(text, text, text, text, text) from public;
grant execute on function public.customer_register_push_subscription(text, text, text, text, text)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Candidates for 3-hour streak warning (café-local midnight math)
-- -----------------------------------------------------------------------------
create or replace function public.push_streak_warning_candidates(
  p_hours_remaining numeric default 3
) returns table (
  subscription_id uuid,
  customer_id uuid,
  cafe_id uuid,
  cafe_name text,
  cafe_slug text,
  endpoint text,
  p256dh text,
  auth text,
  current_streak int,
  hours_to_midnight numeric,
  local_today date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with active_cafes as (
    select
      c.id,
      c.name,
      c.slug,
      coalesce(nullif(trim(c.timezone), ''), 'UTC') as tz
    from public.cafes c
    where c.status = 'active'::public.cafe_status
  ),
  local_clock as (
    select
      ac.id as cafe_id,
      ac.name as cafe_name,
      ac.slug as cafe_slug,
      ac.tz,
      (timezone(ac.tz, now()))::date as local_today,
      extract(
        epoch from (
          (date_trunc('day', timezone(ac.tz, now())) + interval '1 day')
          - timezone(ac.tz, now())
        )
      ) / 3600.0 as hours_to_midnight
    from active_cafes ac
  )
  select
    ps.id as subscription_id,
    cu.id as customer_id,
    lc.cafe_id,
    lc.cafe_name,
    lc.cafe_slug,
    ps.endpoint,
    ps.p256dh,
    ps.auth,
    cu.current_streak,
    lc.hours_to_midnight,
    lc.local_today
  from local_clock lc
  join public.customers cu on cu.cafe_id = lc.cafe_id
  join public.push_subscriptions ps on ps.customer_id = cu.id and ps.cafe_id = cu.cafe_id
  where cu.current_streak > 0
    and lc.hours_to_midnight > 0
    and lc.hours_to_midnight <= greatest(0.25, coalesce(p_hours_remaining, 3))
    and not exists (
      select 1
      from public.visits v
      where v.customer_id = cu.id
        and v.cafe_id = lc.cafe_id
        and v.event_type = 'check_in'::public.visit_event_type
        and v.visit_date = lc.local_today
    )
    and not exists (
      select 1
      from public.push_warning_log pwl
      where pwl.customer_id = cu.id
        and pwl.warning_date = lc.local_today
    );
$$;

revoke all on function public.push_streak_warning_candidates(numeric) from public;
grant execute on function public.push_streak_warning_candidates(numeric) to service_role;

-- -----------------------------------------------------------------------------
-- Investor analytics (Super Admin only — aggregated, no PII export)
-- -----------------------------------------------------------------------------
create or replace function public.admin_investor_analytics_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_base    bigint;
  v_survival jsonb;
  v_shield   jsonb;
  v_retention jsonb;
  v_platform jsonb;
begin
  v_profile := public.streakup_profile();
  if v_profile is null or v_profile.role <> 'super_admin'::public.streakup_role then
    raise exception 'forbidden';
  end if;

  select count(*)::bigint
  into v_base
  from public.customers cu
  where cu.longest_streak >= 1 or cu.current_streak >= 1;

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
      )::bigint as midnight_saves,
      count(*)::bigint as total_shield_events
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

  with tiers as (
    select
      case
        when cu.longest_streak >= 10 then 'power'
        when cu.longest_streak >= 3 then 'activated'
        else 'casual'
      end as tier,
      cu.id as customer_id
    from public.customers cu
  ),
  visit_counts as (
    select
      t.tier,
      count(v.id)::numeric / nullif(count(distinct t.customer_id), 0) as avg_visits
    from tiers t
    left join public.visits v
      on v.customer_id = t.customer_id
     and v.event_type = 'check_in'::public.visit_event_type
    group by t.tier
  )
  select jsonb_build_object(
    'casual_avg_visits', coalesce((select avg_visits from visit_counts where tier = 'casual'), 0),
    'activated_avg_visits', coalesce((select avg_visits from visit_counts where tier = 'activated'), 0),
    'power_avg_visits', coalesce((select avg_visits from visit_counts where tier = 'power'), 0),
    'uplift_pct', case
      when coalesce((select avg_visits from visit_counts where tier = 'casual'), 0) > 0 then
        round(
          100.0 * (
            coalesce((select avg_visits from visit_counts where tier = 'activated'), 0)
            - coalesce((select avg_visits from visit_counts where tier = 'casual'), 0)
          ) / coalesce((select avg_visits from visit_counts where tier = 'casual'), 1),
          1
        )
      else 0
    end
  )
  into v_retention;

  select jsonb_build_object(
    'total_customers', (select count(*) from public.customers),
    'push_enabled_customers', (select count(distinct customer_id) from public.push_subscriptions),
    'warnings_sent_30d', (
      select count(*)
      from public.push_warning_log
      where sent_at >= now() - interval '30 days'
    )
  )
  into v_platform;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'streak_survival', v_survival,
    'shield_salvage', v_shield,
    'retention_uplift', v_retention,
    'platform', v_platform
  );
end;
$$;

revoke all on function public.admin_investor_analytics_secure() from public;
grant execute on function public.admin_investor_analytics_secure() to authenticated;

commit;

-- =============================================================================
-- Phase 24 B — Hourly cron → push-streak-warnings Edge Function
-- Prerequisites: pg_cron, pg_net, Edge secrets:
--   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:ops@…),
--   PUSH_DISPATCH_SECRET
-- Frontend .env: VITE_VAPID_PUBLIC_KEY (same public key)
-- =============================================================================
--
-- select cron.unschedule(j.jobid) from cron.job j where j.jobname = 'streakup_push_streak_warnings';
--
-- select cron.schedule(
--   'streakup_push_streak_warnings',
--   '0 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/push-streak-warnings',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-push-dispatch-secret', 'YOUR_PUSH_DISPATCH_SECRET'
--     ),
--     body := '{"hours_remaining": 3, "limit": 250}'::jsonb
--   );
--   $$
-- );
