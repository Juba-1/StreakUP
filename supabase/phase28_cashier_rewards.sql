-- =============================================================================
-- StreakUp — Phase 28: Cashier reward redemption (claim loop)
--
-- Lists earned-but-unclaimed rewards and marks them claimed at the counter.
-- Does NOT modify streakup_engine_process_check_in.
-- Run AFTER phase27_security.sql.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Shared branch access gate (mirrors cashier_find_customer_by_pin)
-- -----------------------------------------------------------------------------
create or replace function public._cashier_assert_branch_access(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_branch  public.branches%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_branch_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_branch');
  end if;

  select * into v_branch from public.branches where id = p_branch_id limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'branch_not_found');
  end if;

  select * into v_profile from public.profiles where user_id = v_uid limit 1;
  if not found
     or v_profile.role not in (
       'super_admin'::public.streakup_role,
       'hq_owner'::public.streakup_role,
       'branch_manager'::public.streakup_role,
       'cashier'::public.streakup_role
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.role = 'super_admin'::public.streakup_role then
    return jsonb_build_object('ok', true, 'cafe_id', v_branch.cafe_id, 'branch_id', v_branch.id);
  elsif v_profile.role = 'hq_owner'::public.streakup_role then
    if v_profile.cafe_id is null or v_profile.cafe_id is distinct from v_branch.cafe_id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    return jsonb_build_object('ok', true, 'cafe_id', v_branch.cafe_id, 'branch_id', v_branch.id);
  else
    if v_profile.branch_id is null
       or v_profile.branch_id is distinct from v_branch.id
       or v_profile.cafe_id is distinct from v_branch.cafe_id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    return jsonb_build_object('ok', true, 'cafe_id', v_branch.cafe_id, 'branch_id', v_branch.id);
  end if;
end;
$$;

revoke all on function public._cashier_assert_branch_access(uuid) from public;

-- -----------------------------------------------------------------------------
-- List redeemable (earned, not yet claimed) rewards for a customer
-- -----------------------------------------------------------------------------
create or replace function public.cashier_list_redeemable_rewards(
  p_customer_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate   jsonb;
  v_cafe_id uuid;
  v_rows   jsonb;
begin
  v_gate := public._cashier_assert_branch_access(p_branch_id);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;

  v_cafe_id := (v_gate->>'cafe_id')::uuid;

  if p_customer_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_customer');
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.cafe_id = v_cafe_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'reward_id', r.id,
      'milestone_id', rm.id,
      'milestone_name', rm.name,
      'reward_label', coalesce(nullif(trim(rm.reward_label), ''), rm.name),
      'days_required', rm.days_required,
      'earned_at', r.earned_at
    )
    order by r.earned_at desc nulls last, rm.sort_order, rm.days_required
  ), '[]'::jsonb)
  into v_rows
  from public.rewards r
  inner join public.reward_milestones rm on rm.id = r.milestone_id
  where r.customer_id = p_customer_id
    and r.cafe_id = v_cafe_id
    and r.earned_at is not null
    and r.claimed_at is null;

  return jsonb_build_object('ok', true, 'rewards', v_rows);
end;
$$;

revoke all on function public.cashier_list_redeemable_rewards(uuid, uuid) from public;
grant execute on function public.cashier_list_redeemable_rewards(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Redeem (claim) a single reward at the counter
-- -----------------------------------------------------------------------------
create or replace function public.cashier_redeem_reward_secure(
  p_reward_id uuid,
  p_branch_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate      jsonb;
  v_cafe_id   uuid;
  v_branch_id uuid;
  v_reward    public.rewards%rowtype;
  v_customer  public.customers%rowtype;
  v_milestone public.reward_milestones%rowtype;
begin
  v_gate := public._cashier_assert_branch_access(p_branch_id);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;

  v_cafe_id := (v_gate->>'cafe_id')::uuid;
  v_branch_id := (v_gate->>'branch_id')::uuid;

  if p_reward_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_reward');
  end if;

  select r.* into v_reward
  from public.rewards r
  where r.id = p_reward_id
    and r.cafe_id = v_cafe_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'reward_not_found');
  end if;

  if v_reward.earned_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_earned');
  end if;

  if v_reward.claimed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed', 'claimed_at', v_reward.claimed_at);
  end if;

  select * into v_customer from public.customers where id = v_reward.customer_id;
  select * into v_milestone from public.reward_milestones where id = v_reward.milestone_id;

  update public.rewards
  set claimed_at = now(),
      updated_at = now()
  where id = v_reward.id;

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
    v_branch_id,
    auth.uid(),
    'user',
    'reward.redeemed',
    'reward',
    v_reward.id,
    jsonb_build_object(
      'customer_id', v_reward.customer_id,
      'milestone_id', v_reward.milestone_id,
      'milestone_name', v_milestone.name,
      'reward_label', coalesce(nullif(trim(v_milestone.reward_label), ''), v_milestone.name)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reward_id', v_reward.id,
    'claimed_at', now(),
    'customer_id', v_reward.customer_id,
    'milestone_name', v_milestone.name,
    'reward_label', coalesce(nullif(trim(v_milestone.reward_label), ''), v_milestone.name)
  );
end;
$$;

revoke all on function public.cashier_redeem_reward_secure(uuid, uuid) from public;
grant execute on function public.cashier_redeem_reward_secure(uuid, uuid) to authenticated;

commit;
