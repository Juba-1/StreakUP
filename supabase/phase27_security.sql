-- =============================================================================
-- StreakUp — Phase 27: platform_config security remediation
--
-- Splits non-secret UI config into platform_public_config (safe for all roles).
-- Locks platform_config to super_admin + service_role only.
-- Run AFTER phase25.sql in the Supabase SQL editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Public (non-secret) platform UI configuration
-- -----------------------------------------------------------------------------
create table if not exists public.platform_public_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.platform_public_config is
  'Non-secret platform UI flags (maintenance, locale, announcements). Readable by staff and anon.';

-- Migrate known public keys from platform_config (idempotent)
insert into public.platform_public_config (key, value, updated_at)
select pc.key, pc.value, coalesce(pc.updated_at, now())
from public.platform_config pc
where pc.key in ('maintenance_mode', 'default_locale', 'global_announcement')
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;

insert into public.platform_public_config (key, value)
values
  ('maintenance_mode', 'false'::jsonb),
  ('default_locale', '"en"'::jsonb),
  ('global_announcement', '{"enabled":false,"title":"","body":"","severity":"info"}'::jsonb)
on conflict (key) do nothing;

alter table public.platform_public_config enable row level security;

drop policy if exists platform_public_config_select_all on public.platform_public_config;
create policy platform_public_config_select_all
on public.platform_public_config
for select
to authenticated, anon
using (true);

drop policy if exists platform_public_config_write_super on public.platform_public_config;
create policy platform_public_config_write_super
on public.platform_public_config
for all
to authenticated
using (public.streakup_is_super_admin())
with check (public.streakup_is_super_admin());

grant select on public.platform_public_config to anon, authenticated;
grant insert, update, delete on public.platform_public_config to authenticated;

-- -----------------------------------------------------------------------------
-- Lock down platform_config (secrets + super-admin-only operational keys)
-- -----------------------------------------------------------------------------
drop policy if exists platform_config_select_authenticated on public.platform_config;
drop policy if exists platform_config_select_default_locale_anon on public.platform_config;

drop policy if exists platform_config_select_super on public.platform_config;
create policy platform_config_select_super
on public.platform_config
for select
to authenticated
using (public.streakup_is_super_admin());

-- Writes were already super_admin-only; ensure no broad read remains.

revoke select on public.platform_public_config from public;
revoke all on public.platform_config from anon;

-- -----------------------------------------------------------------------------
-- Post-login maintenance gate reads public config only
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
    from public.platform_public_config pc
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
