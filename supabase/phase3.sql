-- =============================================================================
-- StreakUp — Phase 3 (public customer portal + cashier lookups)
-- Run AFTER `init.sql` + `phase2.sql`
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Cashiers can read customers within their HQ (fast POS phone lookup)
-- -----------------------------------------------------------------------------
drop policy if exists customers_select_scoped on public.customers;
create policy customers_select_scoped
on public.customers
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or auth_user_id = auth.uid()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
  or (
    (select p.role from public.profiles p where p.user_id = auth.uid()) = 'branch_manager'::public.streakup_role
    and exists (
      select 1
      from public.visits v
      where v.customer_id = customers.id
        and v.branch_id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
    )
  )
  or (
    (select p.role from public.profiles p where p.user_id = auth.uid()) = 'cashier'::public.streakup_role
    and cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
  )
);

-- -----------------------------------------------------------------------------
-- Public cafe branding (no secrets)
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
-- Customer portal (phone + PIN) — anon-friendly; keep PIN server-side only
-- -----------------------------------------------------------------------------
create or replace function public.customer_portal_session(p_slug text, p_phone text, p_pin text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cafe_id uuid;
  v_cust public.customers%rowtype;
  v_milestones jsonb;
  v_rewards jsonb;
begin
  if p_phone is null or length(trim(p_phone)) < 4 then
    return jsonb_build_object('ok', false, 'error', 'invalid_phone');
  end if;

  if p_pin is null or length(trim(p_pin)) < 4 then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  select c.id
  into v_cafe_id
  from public.cafes c
  where c.slug = lower(trim(p_slug))
    and c.status = 'active'::public.cafe_status
  limit 1;

  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'cafe_not_found');
  end if;

  select *
  into v_cust
  from public.customers cu
  where cu.cafe_id = v_cafe_id
    and cu.phone = trim(p_phone)
    and cu.pin_code = trim(p_pin)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'auth_failed');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', rm.id,
      'name', rm.name,
      'days_required', rm.days_required,
      'reward_label', rm.reward_label,
      'sort_order', rm.sort_order,
      'earned_at', r.earned_at,
      'claimed_at', r.claimed_at
    )
    order by rm.sort_order, rm.days_required
  ), '[]'::jsonb)
  into v_milestones
  from public.reward_milestones rm
  left join public.rewards r
    on r.milestone_id = rm.id
   and r.customer_id = v_cust.id
  where rm.cafe_id = v_cafe_id
    and rm.active;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'milestone_id', r.milestone_id,
      'earned_at', r.earned_at,
      'claimed_at', r.claimed_at
    )
  ), '[]'::jsonb)
  into v_rewards
  from public.rewards r
  where r.customer_id = v_cust.id;

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_cust.id,
    'cafe_id', v_cafe_id,
    'current_streak', v_cust.current_streak,
    'longest_streak', v_cust.longest_streak,
    'shields', v_cust.shields,
    'milestones', v_milestones,
    'rewards', v_rewards
  );
end;
$$;

revoke all on function public.customer_portal_session(text, text, text) from public;
grant execute on function public.customer_portal_session(text, text, text) to anon, authenticated;

commit;
