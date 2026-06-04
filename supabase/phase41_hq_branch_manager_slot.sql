-- =============================================================================
-- StreakUp — Phase 41: HQ branch manager slot lookup (for invite UI)
-- Run AFTER phase40_branch_manager_cashier_gate.sql
-- =============================================================================

begin;

create or replace function public.hq_branch_manager_slot_secure(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor   public.profiles%rowtype;
  v_branch  public.branches%rowtype;
  v_mgr     public.profiles%rowtype;
  v_email   text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_branch_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_branch');
  end if;

  select * into v_actor from public.profiles where user_id = auth.uid() limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_actor.role <> 'hq_owner'::public.streakup_role
     and v_actor.role <> 'super_admin'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_branch from public.branches b where b.id = p_branch_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'branch_not_found');
  end if;

  if v_actor.role = 'hq_owner'::public.streakup_role
     and v_branch.cafe_id is distinct from v_actor.cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select p.*
  into v_mgr
  from public.profiles p
  where p.role = 'branch_manager'::public.streakup_role
    and p.branch_id = p_branch_id
    and p.cafe_id = v_branch.cafe_id
  order by p.updated_at desc nulls last, p.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'assigned', false,
      'branch_id', v_branch.id,
      'branch_code', v_branch.branch_code
    );
  end if;

  select u.email into v_email from auth.users u where u.id = v_mgr.user_id limit 1;

  return jsonb_build_object(
    'ok', true,
    'assigned', true,
    'branch_id', v_branch.id,
    'branch_code', v_branch.branch_code,
    'manager_user_id', v_mgr.user_id,
    'manager_email', coalesce(v_email, '')
  );
end;
$$;

revoke all on function public.hq_branch_manager_slot_secure(uuid) from public;
grant execute on function public.hq_branch_manager_slot_secure(uuid) to authenticated;

commit;
