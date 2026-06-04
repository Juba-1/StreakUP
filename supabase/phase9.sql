-- =============================================================================
-- StreakUp — Phase 9: Live control plane, API keys, platform config, tenant ops
-- Run AFTER phase8 (or phase7 + admin features). Paste entire script in SQL editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Unique API key prefix (collision-safe minting in hq_issue_api_key)
-- -----------------------------------------------------------------------------
create unique index if not exists api_keys_public_prefix_uidx on public.api_keys (public_prefix);

-- -----------------------------------------------------------------------------
-- Platform-wide configuration (non-secret JSON values only)
-- -----------------------------------------------------------------------------
create table if not exists public.platform_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.platform_config enable row level security;

drop policy if exists platform_config_select_authenticated on public.platform_config;
create policy platform_config_select_authenticated
on public.platform_config
for select
to authenticated
using (true);

drop policy if exists platform_config_insert_super on public.platform_config;
create policy platform_config_insert_super
on public.platform_config
for insert
to authenticated
with check (public.streakup_is_super_admin());

drop policy if exists platform_config_update_super on public.platform_config;
create policy platform_config_update_super
on public.platform_config
for update
to authenticated
using (public.streakup_is_super_admin())
with check (public.streakup_is_super_admin());

drop policy if exists platform_config_delete_super on public.platform_config;
create policy platform_config_delete_super
on public.platform_config
for delete
to authenticated
using (public.streakup_is_super_admin());

insert into public.platform_config (key, value)
values
  ('maintenance_mode', 'false'::jsonb),
  ('default_locale', '"en"'::jsonb),
  ('global_announcement', '{"enabled":false,"title":"","body":"","severity":"info"}'::jsonb)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- HQ: mint enterprise API key (secret returned ONCE; only SHA-256 stored)
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
-- HQ: revoke API key (soft revoke)
-- -----------------------------------------------------------------------------
create or replace function public.hq_revoke_api_key(p_key_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_updated int;
begin
  v_profile := public.streakup_profile();
  if v_profile is null then
    raise exception 'not_authenticated';
  end if;

  if v_profile.role <> 'hq_owner'::public.streakup_role or v_profile.cafe_id is null then
    raise exception 'forbidden';
  end if;

  update public.api_keys k
  set revoked_at = now()
  where k.id = p_key_id
    and k.cafe_id = v_profile.cafe_id
    and k.revoked_at is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_already_revoked');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.hq_revoke_api_key(uuid) from public;
grant execute on function public.hq_revoke_api_key(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Super admin: subscription row for a café (replace strategy; one row per cafe)
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
begin
  v_profile := public.streakup_profile();
  if v_profile is null or v_profile.role <> 'super_admin'::public.streakup_role then
    raise exception 'forbidden';
  end if;

  if not exists (select 1 from public.cafes c where c.id = p_cafe_id) then
    raise exception 'cafe_not_found';
  end if;

  delete from public.subscriptions where cafe_id = p_cafe_id;

  insert into public.subscriptions (cafe_id, plan_name, status, provider)
  values (
    p_cafe_id,
    coalesce(nullif(trim(p_plan_name), ''), 'enterprise'),
    coalesce(p_status, 'active'::public.subscription_status),
    'internal'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'subscription_id', v_id);
end;
$$;

revoke all on function public.super_admin_set_subscription(uuid, text, public.subscription_status) from public;
grant execute on function public.super_admin_set_subscription(uuid, text, public.subscription_status)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Super admin: set café operational status
-- -----------------------------------------------------------------------------
create or replace function public.super_admin_set_cafe_status(
  p_cafe_id uuid,
  p_status public.cafe_status
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_n int;
begin
  v_profile := public.streakup_profile();
  if v_profile is null or v_profile.role <> 'super_admin'::public.streakup_role then
    raise exception 'forbidden';
  end if;

  update public.cafes c
  set status = p_status,
      updated_at = now()
  where c.id = p_cafe_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'cafe_not_found');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.super_admin_set_cafe_status(uuid, public.cafe_status) from public;
grant execute on function public.super_admin_set_cafe_status(uuid, public.cafe_status) to authenticated;

-- -----------------------------------------------------------------------------
-- Enterprise API key verify: require café ACTIVE
-- -----------------------------------------------------------------------------
create or replace function public.verify_enterprise_api_key(
  p_public_prefix text,
  p_secret text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.api_keys%rowtype;
  v_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_public_prefix is null
    or p_secret is null
    or length(trim(p_public_prefix)) < 4
    or length(trim(p_secret)) < 16 then
    return jsonb_build_object('valid', false, 'reason', 'invalid_shape');
  end if;

  v_hash := encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex');

  select k.*
  into v_row
  from public.api_keys k
  inner join public.cafes c on c.id = k.cafe_id
  where k.public_prefix = p_public_prefix
    and k.revoked_at is null
    and k.secret_hash = v_hash
    and c.status = 'active'::public.cafe_status
  limit 1;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'valid', true,
    'cafe_id', v_row.cafe_id,
    'api_key_id', v_row.id,
    'scopes', to_jsonb(v_row.scopes)
  );
end;
$$;

revoke all on function public.verify_enterprise_api_key(text, text) from public;
grant execute on function public.verify_enterprise_api_key(text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Visit ingestion: block when parent café is not ACTIVE
-- -----------------------------------------------------------------------------
create or replace function public.record_visit_idempotent(
  p_branch_id uuid,
  p_customer_id uuid,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_event_type public.visit_event_type default 'check_in',
  p_client_visit_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cafe_id uuid;
  v_cafe_status public.cafe_status;
  v_tz text;
  v_visit_date date;
  v_existing_visit uuid;
  v_existing_hash text;
  v_row_id uuid;
  v_streak_after int;
  v_visit_id uuid;
  v_profile public.profiles;
  v_engine jsonb := null;
  v_meta jsonb := '{}'::jsonb;
  v_current_streak int;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'invalid_idempotency_key';
  end if;

  if p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_payload_sha256';
  end if;

  if auth.role() is distinct from 'service_role' then
    v_profile := public.streakup_profile();
    if v_profile is null then
      raise exception 'not_authenticated';
    end if;

    if v_profile.role = 'super_admin'::public.streakup_role then
      null;
    elsif v_profile.role = 'hq_owner'::public.streakup_role then
      if v_profile.cafe_id is null then
        raise exception 'forbidden';
      end if;
    elsif v_profile.role in ('branch_manager', 'cashier') then
      if v_profile.branch_id is distinct from p_branch_id then
        raise exception 'forbidden';
      end if;
    else
      raise exception 'forbidden';
    end if;
  end if;

  select b.cafe_id, c.status
  into v_cafe_id, v_cafe_status
  from public.branches b
  inner join public.cafes c on c.id = b.cafe_id
  where b.id = p_branch_id;

  if v_cafe_id is null then
    raise exception 'branch_not_found';
  end if;

  if v_cafe_status is distinct from 'active'::public.cafe_status then
    raise exception 'cafe_not_active';
  end if;

  if auth.role() is distinct from 'service_role' then
    if v_profile.role = 'hq_owner'::public.streakup_role
      and v_profile.cafe_id is distinct from v_cafe_id then
      raise exception 'forbidden';
    end if;

    if v_profile.role in ('branch_manager', 'cashier')
      and v_profile.cafe_id is distinct from v_cafe_id then
      raise exception 'forbidden';
    end if;
  end if;

  select c.timezone into v_tz from public.cafes c where c.id = v_cafe_id;
  v_visit_date := coalesce(
    p_client_visit_date,
    (timezone(v_tz, now()))::date
  );

  insert into public.visit_idempotency_keys (
    cafe_id,
    idempotency_key,
    payload_sha256,
    customer_id,
    branch_id,
    status
  )
  values (
    v_cafe_id,
    p_idempotency_key,
    p_payload_sha256,
    p_customer_id,
    p_branch_id,
    'pending'::public.idempotency_record_status
  )
  on conflict (cafe_id, idempotency_key) do nothing
  returning id into v_row_id;

  if v_row_id is null then
    select vik.visit_id, vik.payload_sha256
    into v_existing_visit, v_existing_hash
    from public.visit_idempotency_keys vik
    where vik.cafe_id = v_cafe_id
      and vik.idempotency_key = p_idempotency_key;

    if v_existing_hash is distinct from p_payload_sha256 then
      raise exception 'idempotency_key_conflict';
    end if;

    return jsonb_build_object(
      'status', 'replay',
      'visit_id', v_existing_visit
    );
  end if;

  if not exists (
    select 1
    from public.customers cu
    where cu.id = p_customer_id
      and cu.cafe_id = v_cafe_id
  ) then
    update public.visit_idempotency_keys
    set status = 'failed'::public.idempotency_record_status,
        error = 'customer_not_in_cafe'
    where id = v_row_id;

    raise exception 'customer_not_in_cafe';
  end if;

  if p_event_type = 'check_in'::public.visit_event_type then
    v_engine := public.streakup_engine_process_check_in(v_cafe_id, p_customer_id, v_visit_date);
    v_streak_after := (v_engine->>'streak_after')::int;
    v_meta := v_engine;
  else
    select cu.current_streak into v_current_streak
    from public.customers cu
    where cu.id = p_customer_id
      and cu.cafe_id = v_cafe_id;

    v_streak_after := coalesce(v_current_streak, 0);
    v_meta := jsonb_build_object('non_check_in', true);
  end if;

  insert into public.visits (
    customer_id,
    cafe_id,
    branch_id,
    visit_date,
    streak_after,
    event_type,
    metadata
  )
  values (
    p_customer_id,
    v_cafe_id,
    p_branch_id,
    v_visit_date,
    v_streak_after,
    p_event_type,
    v_meta
  )
  returning id into v_visit_id;

  update public.visit_idempotency_keys
  set status = 'completed'::public.idempotency_record_status,
      visit_id = v_visit_id
  where id = v_row_id;

  insert into public.audit_log (
    cafe_id,
    branch_id,
    actor_user_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    payload
  )
  values (
    v_cafe_id,
    p_branch_id,
    auth.uid(),
    case when auth.role() = 'service_role' then 'service_role' else 'user' end,
    'visit.recorded',
    'visit',
    v_visit_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'payload_sha256', p_payload_sha256,
      'visit_date', v_visit_date,
      'streak_after', v_streak_after,
      'engine', v_engine,
      'event_type', p_event_type
    )
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'status', 'created',
    'visit_id', v_visit_id,
    'visit_date', v_visit_date,
    'streak_after', v_streak_after,
    'engine', v_engine,
    'event_type', p_event_type
  ));
end;
$$;

revoke all on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date)
  from public;
grant execute on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Post-login routing: block staff when their café is not ACTIVE
-- -----------------------------------------------------------------------------
create or replace function public.staff_bootstrap_path()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_slug text;
  v_branch_code text;
  v_path text;
  v_status public.cafe_status;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'path', '/login', 'role', null, 'reason', 'not_authenticated');
  end if;

  v_profile := public.streakup_profile();

  if v_profile is null then
    return jsonb_build_object('ok', false, 'path', '/login', 'role', null, 'reason', 'no_profile');
  end if;

  if exists (
    select 1
    from public.platform_config pc
    where pc.key = 'maintenance_mode'
      and pc.value = 'true'::jsonb
  )
    and v_profile.role is distinct from 'super_admin'::public.streakup_role then
    return jsonb_build_object(
      'ok', false,
      'path', '/login',
      'role', v_profile.role::text,
      'reason', 'maintenance_mode'
    );
  end if;

  if v_profile.role = 'super_admin'::public.streakup_role then
    return jsonb_build_object('ok', true, 'path', '/admin/overview', 'role', v_profile.role::text);
  end if;

  if v_profile.role = 'hq_owner'::public.streakup_role then
    if v_profile.cafe_id is null then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_cafe');
    end if;
    select c.slug, c.status into v_slug, v_status
    from public.cafes c
    where c.id = v_profile.cafe_id
    limit 1;
    if v_slug is null or length(trim(v_slug)) = 0 then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_slug');
    end if;
    if v_status is distinct from 'active'::public.cafe_status then
      return jsonb_build_object(
        'ok', false,
        'path', '/login',
        'role', v_profile.role::text,
        'reason', 'cafe_inactive',
        'cafe_status', v_status::text
      );
    end if;
    return jsonb_build_object('ok', true, 'path', '/hq/' || trim(v_slug), 'role', v_profile.role::text);
  end if;

  if v_profile.role in ('branch_manager'::public.streakup_role, 'cashier'::public.streakup_role) then
    if v_profile.branch_id is null then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_branch');
    end if;
    select b.branch_code, c.status
    into v_branch_code, v_status
    from public.branches b
    inner join public.cafes c on c.id = b.cafe_id
    where b.id = v_profile.branch_id
    limit 1;
    if v_branch_code is null or length(trim(v_branch_code)) = 0 then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_branch_code');
    end if;
    if v_status is distinct from 'active'::public.cafe_status then
      return jsonb_build_object(
        'ok', false,
        'path', '/login',
        'role', v_profile.role::text,
        'reason', 'cafe_inactive',
        'cafe_status', v_status::text
      );
    end if;
    if v_profile.role = 'branch_manager'::public.streakup_role then
      v_path := '/branch/' || trim(v_branch_code);
    else
      v_path := '/cashier/' || trim(v_branch_code);
    end if;
    return jsonb_build_object('ok', true, 'path', v_path, 'role', v_profile.role::text);
  end if;

  if v_profile.role = 'customer'::public.streakup_role then
    if v_profile.cafe_id is null then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_cafe');
    end if;
    select c.slug, c.status into v_slug, v_status
    from public.cafes c
    where c.id = v_profile.cafe_id
    limit 1;
    if v_slug is null or length(trim(v_slug)) = 0 then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_slug');
    end if;
    if v_status is distinct from 'active'::public.cafe_status then
      return jsonb_build_object(
        'ok', false,
        'path', '/login',
        'role', v_profile.role::text,
        'reason', 'cafe_inactive',
        'cafe_status', v_status::text
      );
    end if;
    return jsonb_build_object('ok', true, 'path', '/my-streak/' || trim(v_slug), 'role', v_profile.role::text);
  end if;

  return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'unknown_role');
end;
$$;

revoke all on function public.staff_bootstrap_path() from public;
grant execute on function public.staff_bootstrap_path() to authenticated;

commit;
