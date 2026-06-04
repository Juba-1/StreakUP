-- =============================================================================
-- StreakUp — Phase 11: Free tier catalog, Super Admin webhook telemetry RLS,
-- autonomous webhook dispatcher via pg_cron + pg_net.
-- Run AFTER phase10.sql in the Supabase SQL editor (or CLI).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Plan catalog: explicit Free tier (same commercial limits as Starter)
-- -----------------------------------------------------------------------------
insert into public.plan_tiers (code, display_name, limits, sort_order)
values (
  'free',
  'Free',
  '{"max_branches":1,"max_api_keys":0,"max_outbound_webhooks":0,"full_white_label":false}'::jsonb,
  0
)
on conflict (code) do update
set display_name = excluded.display_name,
    limits = excluded.limits,
    sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- Super Admin: read-only visibility into webhook_outbox (operations telemetry)
-- Authenticated clients still cannot insert/update/delete; triggers + service role
-- populate rows. Existing deny-all policy remains; permissive policies are OR'd.
-- -----------------------------------------------------------------------------
drop policy if exists webhook_outbox_select_super_admin on public.webhook_outbox;
create policy webhook_outbox_select_super_admin
on public.webhook_outbox
for select
to authenticated
using (public.streakup_is_super_admin());

commit;

-- =============================================================================
-- Phase 11 B — pg_cron → dispatch-webhooks (run as postgres / dashboard)
-- Prerequisites (Supabase Dashboard → Database → Extensions):
--   • pg_cron   — ON
--   • pg_net    — ON
--
-- Replace ALL placeholders before executing:
--   YOUR_PROJECT_REF     — e.g. abcdefghijklmnop (from Project URL)
--   YOUR_DISPATCH_SECRET — same value as Edge secret WEBHOOK_DISPATCH_SECRET
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Idempotent reschedule: remove prior job by name, then register.
select cron.unschedule(j.jobid)
from cron.job j
where j.jobname = 'streakup_dispatch_webhooks';

select
  cron.schedule(
    'streakup_dispatch_webhooks',
    '* * * * *', -- every minute
    $$
    select
      net.http_post(
        url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/dispatch-webhooks',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-webhook-dispatch-secret', 'YOUR_DISPATCH_SECRET'
        ),
        body := '{"limit": 40}'::jsonb
      );
    $$
  );

-- Optional: list scheduled jobs
-- select * from cron.job;
