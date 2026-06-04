-- =============================================================================
-- StreakUp — Phase 10: White-label (logos + palette), webhooks outbox, billing prep,
-- plan limits, storage policies, locale exposure for anon.
-- Run AFTER phase9.sql in the Supabase SQL editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Café branding: extended palette (nullable = inherit platform defaults in UI)
-- -----------------------------------------------------------------------------
alter table public.cafes
  add column if not exists accent_color text,
  add column if not exists background_color text;

-- -----------------------------------------------------------------------------
-- SaaS billing prep (Stripe-friendly columns + one row per café)
-- -----------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists plan_tier text not null default 'starter',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

create unique index if not exists subscriptions_one_per_cafe_uidx
  on public.subscriptions (cafe_id);

-- -----------------------------------------------------------------------------
-- Plan catalog (limits JSON: -1 = unlimited, 0 = disabled)
-- -----------------------------------------------------------------------------
create table if not exists public.plan_tiers (
  code text primary key,
  display_name text not null,
  limits jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.plan_tiers (code, display_name, limits, sort_order)
values
  (
    'starter',
    'Starter',
    '{"max_branches":1,"max_api_keys":0,"max_outbound_webhooks":0,"full_white_label":false}'::jsonb,
    10
  ),
  (
    'growth',
    'Growth',
    '{"max_branches":10,"max_api_keys":3,"max_outbound_webhooks":2,"full_white_label":false}'::jsonb,
    20
  ),
  (
    'enterprise',
    'Enterprise',
    '{"max_branches":-1,"max_api_keys":-1,"max_outbound_webhooks":-1,"full_white_label":true}'::jsonb,
    30
  )
on conflict (code) do update
set display_name = excluded.display_name,
    limits = excluded.limits,
    sort_order = excluded.sort_order;

alter table public.plan_tiers enable row level security;

drop policy if exists plan_tiers_select_all on public.plan_tiers;
create policy plan_tiers_select_all
on public.plan_tiers
for select
to authenticated
using (true);

drop policy if exists plan_tiers_select_anon on public.plan_tiers;
create policy plan_tiers_select_anon
on public.plan_tiers
for select
to anon
using (true);

drop policy if exists plan_tiers_write_super on public.plan_tiers;
create policy plan_tiers_write_super
on public.plan_tiers
for all
to authenticated
using (public.streakup_is_super_admin())
with check (public.streakup_is_super_admin());

-- -----------------------------------------------------------------------------
-- Outbound webhooks + durable outbox (Edge Function dispatcher drains queue)
-- -----------------------------------------------------------------------------
create table if not exists public.outbound_webhooks (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  label text not null default 'default',
  url text not null,
  events text[] not null default array['visit.recorded'::text],
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_webhooks_https_chk check (url ~* '^https://'),
  constraint outbound_webhooks_events_chk check (cardinality(events) > 0)
);

create index if not exists outbound_webhooks_cafe_id_idx on public.outbound_webhooks (cafe_id);

create table if not exists public.webhook_outbox (
  id uuid primary key default gen_random_uuid(),
  outbound_webhook_id uuid not null references public.outbound_webhooks (id) on delete cascade,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists webhook_outbox_pending_idx
  on public.webhook_outbox (status, created_at);

alter table public.outbound_webhooks enable row level security;
alter table public.webhook_outbox enable row level security;

-- HQ owners manage their café’s hooks; super admins see all.
drop policy if exists outbound_webhooks_select_scoped on public.outbound_webhooks;
create policy outbound_webhooks_select_scoped
on public.outbound_webhooks
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
);

drop policy if exists outbound_webhooks_write_hq on public.outbound_webhooks;
create policy outbound_webhooks_write_hq
on public.outbound_webhooks
for insert
to authenticated
with check (
  cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
);

drop policy if exists outbound_webhooks_update_hq on public.outbound_webhooks;
create policy outbound_webhooks_update_hq
on public.outbound_webhooks
for update
to authenticated
using (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
)
with check (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
);

drop policy if exists outbound_webhooks_delete_hq on public.outbound_webhooks;
create policy outbound_webhooks_delete_hq
on public.outbound_webhooks
for delete
to authenticated
using (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
);

-- Outbox is automation-only: no direct dashboard reads required.
drop policy if exists webhook_outbox_deny_all on public.webhook_outbox;
create policy webhook_outbox_deny_all
on public.webhook_outbox
for all
to authenticated
using (false)
with check (false);

-- -----------------------------------------------------------------------------
-- Plan limits helper (defaults to starter when no subscription row)
-- -----------------------------------------------------------------------------
create or replace function public.streakup_plan_limits_for_cafe(p_cafe_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tier text;
  v_limits jsonb;
begin
  select coalesce(
    (
      select s.plan_tier
      from public.subscriptions s
      where s.cafe_id = p_cafe_id
      order by s.created_at desc
      limit 1
    ),
    'starter'
  )
  into v_tier;

  select pt.limits
  into v_limits
  from public.plan_tiers pt
  where pt.code = v_tier
  limit 1;

  if v_limits is null then
    select pt.limits
    into v_limits
    from public.plan_tiers pt
    where pt.code = 'starter'
    limit 1;
  end if;

  return coalesce(v_limits, '{}'::jsonb);
end;
$$;

revoke all on function public.streakup_plan_limits_for_cafe(uuid) from public;
grant execute on function public.streakup_plan_limits_for_cafe(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- HQ: mint API key with plan guard (replaces phase9 body)
-- -----------------------------------------------------------------------------
create or replace function public.hq_issue_api_key(p_label text default 'default')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_profile public.profiles;
  v_cafe_id uuid;
  v_prefix text;
  v_secret text;
  v_hash text;
  v_id uuid;
  v_label text;
  v_guard int := 0;
  v_limits jsonb;
  v_max int;
  v_cnt bigint;
begin
  v_profile := public.streakup_profile();
  if v_profile is null then
    raise exception 'not_authenticated';
  end if;

  if v_profile.role <> 'hq_owner'::public.streakup_role or v_profile.cafe_id is null then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.cafes c
    where c.id = v_profile.cafe_id
      and c.status = 'active'::public.cafe_status
  ) then
    raise exception 'cafe_inactive';
  end if;

  v_cafe_id := v_profile.cafe_id;
  v_limits := public.streakup_plan_limits_for_cafe(v_cafe_id);
  v_max := coalesce((v_limits->>'max_api_keys')::int, 0);

  if v_max = 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_forbidden', 'reason', 'api_keys_not_included');
  end if;

  if v_max > 0 then
    select count(*) into v_cnt
    from public.api_keys k
    where k.cafe_id = v_cafe_id
      and k.revoked_at is null;

    if v_cnt >= v_max::bigint then
      return jsonb_build_object('ok', false, 'error', 'plan_limit', 'reason', 'max_api_keys');
    end if;
  end if;

  v_label := coalesce(nullif(trim(p_label), ''), 'default');

  loop
    v_prefix := encode(gen_random_bytes(8), 'hex');
    exit when not exists (select 1 from public.api_keys k where k.public_prefix = v_prefix);
    v_guard := v_guard + 1;
    if v_guard > 25 then
      raise exception 'prefix_generation_failed';
    end if;
  end loop;

  v_secret := encode(gen_random_bytes(24), 'hex');
  v_hash := encode(extensions.digest(convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');

  insert into public.api_keys (cafe_id, label, public_prefix, secret_hash, scopes)
  values (
    v_cafe_id,
    v_label,
    v_prefix,
    v_hash,
    array['visits:write']::text[]
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'public_prefix', v_prefix,
    'api_key', 'streakup_' || v_prefix || '_' || v_secret
  );
end;
$$;

revoke all on function public.hq_issue_api_key(text) from public;
grant execute on function public.hq_issue_api_key(text) to authenticated;

-- -----------------------------------------------------------------------------
-- HQ: register outbound webhook with HTTPS + plan limits
-- -----------------------------------------------------------------------------
create or replace function public.hq_create_outbound_webhook(
  p_url text,
  p_label text default 'integration',
  p_events text[] default array['visit.recorded'::text]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_cafe_id uuid;
  v_limits jsonb;
  v_max int;
  v_cnt bigint;
  v_id uuid;
  v_url text := trim(p_url);
  v_lab text := coalesce(nullif(trim(p_label), ''), 'integration');
begin
  v_profile := public.streakup_profile();
  if v_profile is null or v_profile.role <> 'hq_owner'::public.streakup_role or v_profile.cafe_id is null then
    raise exception 'forbidden';
  end if;

  v_cafe_id := v_profile.cafe_id;

  if not exists (
    select 1 from public.cafes c
    where c.id = v_cafe_id
      and c.status = 'active'::public.cafe_status
  ) then
    raise exception 'cafe_inactive';
  end if;

  if v_url is null or v_url !~* '^https://' then
    return jsonb_build_object('ok', false, 'error', 'invalid_url');
  end if;

  v_limits := public.streakup_plan_limits_for_cafe(v_cafe_id);
  v_max := coalesce((v_limits->>'max_outbound_webhooks')::int, 0);

  if v_max = 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_forbidden', 'reason', 'webhooks_not_included');
  end if;

  if v_max > 0 then
    select count(*) into v_cnt from public.outbound_webhooks w where w.cafe_id = v_cafe_id;
    if v_cnt >= v_max::bigint then
      return jsonb_build_object('ok', false, 'error', 'plan_limit', 'reason', 'max_outbound_webhooks');
    end if;
  end if;

  insert into public.outbound_webhooks (cafe_id, label, url, events)
  values (v_cafe_id, v_lab, v_url, p_events)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.hq_create_outbound_webhook(text, text, text[]) from public;
grant execute on function public.hq_create_outbound_webhook(text, text, text[]) to authenticated;

create or replace function public.hq_delete_outbound_webhook(p_hook_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_deleted int;
begin
  v_profile := public.streakup_profile();
  if v_profile is null or v_profile.role <> 'hq_owner'::public.streakup_role or v_profile.cafe_id is null then
    raise exception 'forbidden';
  end if;

  delete from public.outbound_webhooks w
  where w.id = p_hook_id
    and w.cafe_id = v_profile.cafe_id;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.hq_delete_outbound_webhook(uuid) from public;
grant execute on function public.hq_delete_outbound_webhook(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Triggers: enqueue webhook deliveries (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
create or replace function public.streakup_enqueue_visit_webhooks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.webhook_outbox (outbound_webhook_id, cafe_id, event_type, payload)
  select
    w.id,
    new.cafe_id,
    'visit.recorded',
    jsonb_strip_nulls(jsonb_build_object(
      'event', 'visit.recorded',
      'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'cafe_id', new.cafe_id,
      'branch_id', new.branch_id,
      'visit_id', new.id,
      'customer_id', new.customer_id,
      'visit_date', new.visit_date,
      'streak_after', new.streak_after,
      'event_type', new.event_type
    ))
  from public.outbound_webhooks w
  where w.cafe_id = new.cafe_id
    and w.is_enabled
    and 'visit.recorded'::text = any (w.events);

  return new;
end;
$$;

drop trigger if exists visits_enqueue_webhooks_ai on public.visits;
create trigger visits_enqueue_webhooks_ai
after insert on public.visits
for each row execute function public.streakup_enqueue_visit_webhooks();

create or replace function public.streakup_enqueue_reward_webhooks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.webhook_outbox (outbound_webhook_id, cafe_id, event_type, payload)
  select
    w.id,
    new.cafe_id,
    'reward.unlocked',
    jsonb_strip_nulls(jsonb_build_object(
      'event', 'reward.unlocked',
      'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'cafe_id', new.cafe_id,
      'customer_id', new.customer_id,
      'reward_id', new.id,
      'milestone_id', new.milestone_id
    ))
  from public.outbound_webhooks w
  where w.cafe_id = new.cafe_id
    and w.is_enabled
    and 'reward.unlocked'::text = any (w.events);

  return new;
end;
$$;

drop trigger if exists rewards_enqueue_webhooks_ai on public.rewards;
create trigger rewards_enqueue_webhooks_ai
after insert on public.rewards
for each row execute function public.streakup_enqueue_reward_webhooks();

-- -----------------------------------------------------------------------------
-- Public café profile: expose extended palette for white-label surfaces
-- -----------------------------------------------------------------------------
create or replace function public.get_cafe_public_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'slug', c.slug,
    'logo_url', c.logo_url,
    'primary_color', c.primary_color,
    'secondary_color', c.secondary_color,
    'accent_color', c.accent_color,
    'background_color', c.background_color,
    'timezone', c.timezone,
    'currency_code', c.currency_code
  )
  from public.cafes c
  where c.slug = lower(trim(p_slug))
    and c.status = 'active'::public.cafe_status
  limit 1;
$$;

revoke all on function public.get_cafe_public_profile(text) from public;
grant execute on function public.get_cafe_public_profile(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- HQ branch provisioning guard (optional): enforce max_branches on insert
-- -----------------------------------------------------------------------------
create or replace function public.streakup_enforce_branch_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limits jsonb;
  v_max int;
  v_cnt bigint;
begin
  v_limits := public.streakup_plan_limits_for_cafe(new.cafe_id);
  v_max := coalesce((v_limits->>'max_branches')::int, 1);

  if v_max = 0 then
    raise exception 'plan_branch_forbidden';
  end if;

  if v_max > 0 then
    select count(*) into v_cnt from public.branches b where b.cafe_id = new.cafe_id;
    if v_cnt >= v_max::bigint then
      raise exception 'plan_branch_limit';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists branches_plan_guard_bi on public.branches;
create trigger branches_plan_guard_bi
before insert on public.branches
for each row execute function public.streakup_enforce_branch_plan_limit();

-- -----------------------------------------------------------------------------
-- Storage: public logos bucket + scoped write policies
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'logos',
  'logos',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists logos_public_read on storage.objects;
create policy logos_public_read
on storage.objects
for select
to public
using (bucket_id = 'logos');

drop policy if exists logos_hq_owner_write on storage.objects;
create policy logos_hq_owner_write
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = (
    select p.cafe_id::text
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists logos_hq_owner_update on storage.objects;
create policy logos_hq_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = (
    select p.cafe_id::text
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'hq_owner'::public.streakup_role
  )
)
with check (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = (
    select p.cafe_id::text
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists logos_hq_owner_delete on storage.objects;
create policy logos_hq_owner_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = (
    select p.cafe_id::text
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists logos_super_admin_write on storage.objects;
create policy logos_super_admin_write
on storage.objects
for insert
to authenticated
with check (bucket_id = 'logos' and public.streakup_is_super_admin());

drop policy if exists logos_super_admin_update on storage.objects;
create policy logos_super_admin_update
on storage.objects
for update
to authenticated
using (bucket_id = 'logos' and public.streakup_is_super_admin())
with check (bucket_id = 'logos' and public.streakup_is_super_admin());

drop policy if exists logos_super_admin_delete on storage.objects;
create policy logos_super_admin_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'logos' and public.streakup_is_super_admin());

-- -----------------------------------------------------------------------------
-- Anon can read default locale row for bootstrapping UI direction
-- -----------------------------------------------------------------------------
drop policy if exists platform_config_select_default_locale_anon on public.platform_config;
create policy platform_config_select_default_locale_anon
on public.platform_config
for select
to anon
using (key = 'default_locale');

-- -----------------------------------------------------------------------------
-- Super admin subscription upsert: persist plan_tier for limits engine
-- -----------------------------------------------------------------------------
create or replace function public.super_admin_set_subscription(
  p_cafe_id uuid,
  p_plan_name text,
  p_status public.subscription_status
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_id uuid;
  v_name text := coalesce(nullif(trim(p_plan_name), ''), 'enterprise');
  v_tier text;
begin
  v_profile := public.streakup_profile();
  if v_profile is null or v_profile.role <> 'super_admin'::public.streakup_role then
    raise exception 'forbidden';
  end if;

  if not exists (select 1 from public.cafes c where c.id = p_cafe_id) then
    raise exception 'cafe_not_found';
  end if;

  v_tier := lower(v_name);
  if not exists (select 1 from public.plan_tiers pt where pt.code = v_tier) then
    v_tier := case
      when v_name ilike '%enterprise%' then 'enterprise'
      when v_name ilike '%growth%' then 'growth'
      else 'starter'
    end;
  end if;

  delete from public.subscriptions where cafe_id = p_cafe_id;

  insert into public.subscriptions (cafe_id, plan_name, plan_tier, status, provider)
  values (
    p_cafe_id,
    v_name,
    v_tier,
    coalesce(p_status, 'active'::public.subscription_status),
    'internal'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'subscription_id', v_id, 'plan_tier', v_tier);
end;
$$;

revoke all on function public.super_admin_set_subscription(uuid, text, public.subscription_status) from public;
grant execute on function public.super_admin_set_subscription(uuid, text, public.subscription_status)
  to authenticated;

commit;
