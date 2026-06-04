-- =============================================================================
-- StreakUp — Phase 42: Branch manager operational powers
-- Run AFTER phase41_hq_branch_manager_slot.sql
--
-- · Branch context (portal links + cashier PIN read)
-- · Cashier PIN update (branch-scoped, invalidates device sessions)
-- · Lifetime reward dispute tools (branch-scoped guests only)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Dashboard context: one round-trip for links + PIN
-- -----------------------------------------------------------------------------
create or replace function public.branch_manager_branch_context_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_branch  public.branches%rowtype;
  v_slug    text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = auth.uid() limit 1;
  if not found or v_profile.role <> 'branch_manager'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.branch_id is null or v_profile.cafe_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_branch');
  end if;

  select b.* into v_branch
  from public.branches b
  where b.id = v_profile.branch_id
    and b.cafe_id = v_profile.cafe_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select c.slug into v_slug
  from public.cafes c
  where c.id = v_profile.cafe_id
  limit 1;

  if v_slug is null or length(trim(v_slug)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'missing_slug');
  end if;

  return jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'branch_code', v_branch.branch_code,
    'branch_name', v_branch.name,
    'cashier_pin', v_branch.cashier_pin,
    'cafe_slug', trim(v_slug),
    'customer_portal_path', '/my-streak/' || trim(v_slug),
    'cashier_portal_path', '/cashier/' || trim(v_branch.branch_code)
  );
end;
$$;

revoke all on function public.branch_manager_branch_context_secure() from public;
grant execute on function public.branch_manager_branch_context_secure() to authenticated;

-- -----------------------------------------------------------------------------
-- Cashier PIN update — exact branch only
-- -----------------------------------------------------------------------------
create or replace function public.branch_manager_update_cashier_pin(
  p_branch_id uuid,
  p_pin       text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_branch  public.branches%rowtype;
  v_clean   text;
  v_before  text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_branch_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_branch');
  end if;

  select * into v_profile from public.profiles where user_id = auth.uid() limit 1;
  if not found or v_profile.role <> 'branch_manager'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.branch_id is distinct from p_branch_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.cafe_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_branch');
  end if;

  v_clean := regexp_replace(trim(coalesce(p_pin, '')), '\D', '', 'g');
  if length(v_clean) < 4 or length(v_clean) > 8 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pin');
  end if;

  select b.* into v_branch
  from public.branches b
  where b.id = p_branch_id
    and b.cafe_id = v_profile.cafe_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_before := v_branch.cashier_pin;

  update public.branches
  set cashier_pin = v_clean,
      updated_at = now()
  where id = p_branch_id;

  delete from public.cashier_device_sessions s
  where s.branch_id = p_branch_id;

  insert into public.audit_log (
    cafe_id, branch_id, actor_user_id, actor_type, action, entity_type, entity_id, payload
  )
  values (
    v_profile.cafe_id, p_branch_id, auth.uid(), 'user',
    'branch.cashier_pin_updated', 'branch', p_branch_id,
    jsonb_build_object('pin_rotated', true, 'had_pin', v_before is not null)
  );

  return jsonb_build_object(
    'ok', true,
    'branch_id', p_branch_id,
    'cashier_pin', v_clean
  );
end;
$$;

revoke all on function public.branch_manager_update_cashier_pin(uuid, text) from public;
grant execute on function public.branch_manager_update_cashier_pin(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Lifetime rewards for a branch guest (dispute resolution)
-- -----------------------------------------------------------------------------
create or replace function public.branch_manager_list_customer_lifetime_rewards_secure(
  p_customer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_cafe_id uuid;
  v_rows    jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = auth.uid() limit 1;
  if not found or v_profile.role <> 'branch_manager'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.branch_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_branch');
  end if;

  select c.cafe_id into v_cafe_id
  from public.customers c
  where c.id = p_customer_id;

  if not found or v_cafe_id is distinct from v_profile.cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  if not exists (
    select 1 from public.visits v
    where v.customer_id = p_customer_id
      and v.branch_id = v_profile.branch_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_at_branch');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'milestone_id',     rm.id,
        'name',             rm.name,
        'days_required',    rm.days_required,
        'reward_label',     rm.reward_label,
        'icon_type',        rm.icon_type,
        'fulfillment_type', rm.fulfillment_type::text,
        'earned_at',        r.earned_at,
        'claimed_at',       r.claimed_at,
        'reward_id',        r.id
      )
      order by rm.days_required
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.rewards r
  inner join public.reward_milestones rm on rm.id = r.milestone_id
  where r.customer_id = p_customer_id
    and rm.cafe_id = v_cafe_id
    and rm.claim_limit = 'once_per_lifetime'::public.reward_claim_limit
    and r.earned_at is not null;

  return jsonb_build_object('ok', true, 'rewards', v_rows);
end;
$$;

revoke all on function public.branch_manager_list_customer_lifetime_rewards_secure(uuid) from public;
grant execute on function public.branch_manager_list_customer_lifetime_rewards_secure(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Reset lifetime reward for a branch guest
-- -----------------------------------------------------------------------------
create or replace function public.branch_manager_reset_customer_lifetime_reward_secure(
  p_customer_id  uuid,
  p_milestone_id uuid,
  p_note         text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile   public.profiles%rowtype;
  v_customer  public.customers%rowtype;
  v_milestone public.reward_milestones%rowtype;
  v_deleted   int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = auth.uid() limit 1;
  if not found or v_profile.role <> 'branch_manager'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.branch_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_branch');
  end if;

  select * into v_customer from public.customers where id = p_customer_id for update;
  if not found or v_customer.cafe_id is distinct from v_profile.cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  if not exists (
    select 1 from public.visits v
    where v.customer_id = p_customer_id
      and v.branch_id = v_profile.branch_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_at_branch');
  end if;

  select * into v_milestone
  from public.reward_milestones rm
  where rm.id = p_milestone_id
    and rm.cafe_id = v_customer.cafe_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'milestone_not_found');
  end if;

  if v_milestone.claim_limit <> 'once_per_lifetime'::public.reward_claim_limit then
    return jsonb_build_object('ok', false, 'reason', 'not_lifetime_reward');
  end if;

  delete from public.rewards r
  where r.customer_id = p_customer_id
    and r.milestone_id = p_milestone_id;

  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_claim_to_reset');
  end if;

  insert into public.audit_log (
    cafe_id, branch_id, actor_user_id, actor_type, action, entity_type, entity_id, payload
  )
  values (
    v_customer.cafe_id, v_profile.branch_id, auth.uid(), 'user',
    'customer.branch_manager_lifetime_reward_reset', 'customer', p_customer_id,
    jsonb_build_object(
      'milestone_id', p_milestone_id,
      'milestone_name', v_milestone.name,
      'days_required', v_milestone.days_required,
      'note', nullif(trim(coalesce(p_note, '')), '')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'milestone_id', p_milestone_id,
    'customer_id', p_customer_id
  );
end;
$$;

revoke all on function public.branch_manager_reset_customer_lifetime_reward_secure(uuid, uuid, text) from public;
grant execute on function public.branch_manager_reset_customer_lifetime_reward_secure(uuid, uuid, text) to authenticated;

commit;
