-- =============================================================================
-- StreakUp — Phase 6 (staff_bootstrap_path: one round-trip post-login; run after phase5.sql)
-- =============================================================================
-- Returns JSON: { "ok": true|false, "path": "/admin/overview|/hq/slug|...", "role": "hq_owner"|... }
-- Uses streakup_profile() so logic matches RLS-backed profile rows.

begin;

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
