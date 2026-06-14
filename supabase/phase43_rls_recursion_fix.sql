-- =============================================================================
-- StreakUp — Phase 43: Fix RLS infinite recursion (customers ↔ visits)
-- Run in Supabase SQL Editor immediately.
--
-- Root cause:
--   customers_select_scoped used EXISTS (SELECT FROM visits …)
--   visits_select_scoped used EXISTS (SELECT FROM customers …)
--   → mutual RLS re-entry → "infinite recursion detected in policy"
--
-- Fix:
--   customers SELECT — cafe-scoped for all staff (no cross-table read)
--   visits SELECT — staff by branch/cafe; customers via auth_user_id only
--   Helpers — SECURITY DEFINER profile lookups (non-recursive)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Non-recursive auth context helpers (read profiles only)
-- -----------------------------------------------------------------------------
create or replace function public.streakup_my_role()
returns public.streakup_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.streakup_my_cafe_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.cafe_id
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.streakup_my_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.branch_id
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.streakup_my_role() from public;
grant execute on function public.streakup_my_role() to authenticated;

revoke all on function public.streakup_my_cafe_id() from public;
grant execute on function public.streakup_my_cafe_id() to authenticated;

revoke all on function public.streakup_my_branch_id() from public;
grant execute on function public.streakup_my_branch_id() to authenticated;

-- -----------------------------------------------------------------------------
-- customers — no cross-table reads (breaks the loop)
-- -----------------------------------------------------------------------------
drop policy if exists customers_select_scoped on public.customers;

create policy customers_select_scoped
on public.customers
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or auth_user_id = auth.uid()
  or (
    public.streakup_my_role() in (
      'hq_owner'::public.streakup_role,
      'branch_manager'::public.streakup_role,
      'cashier'::public.streakup_role
    )
    and cafe_id = public.streakup_my_cafe_id()
  )
);

drop policy if exists customers_update_branch_manager on public.customers;

create policy customers_update_branch_manager
on public.customers
for update
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    public.streakup_my_role() in (
      'hq_owner'::public.streakup_role,
      'branch_manager'::public.streakup_role
    )
    and cafe_id = public.streakup_my_cafe_id()
  )
)
with check (
  public.streakup_is_super_admin()
  or (
    public.streakup_my_role() in (
      'hq_owner'::public.streakup_role,
      'branch_manager'::public.streakup_role
    )
    and cafe_id = public.streakup_my_cafe_id()
  )
);

drop policy if exists customers_insert_super_or_hq on public.customers;

create policy customers_insert_super_or_hq
on public.customers
for insert
to authenticated
with check (
  public.streakup_is_super_admin()
  or (
    public.streakup_my_role() = 'hq_owner'::public.streakup_role
    and cafe_id = public.streakup_my_cafe_id()
  )
);

drop policy if exists customers_update_super_or_hq on public.customers;

create policy customers_update_super_or_hq
on public.customers
for update
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    public.streakup_my_role() = 'hq_owner'::public.streakup_role
    and cafe_id = public.streakup_my_cafe_id()
  )
)
with check (
  public.streakup_is_super_admin()
  or (
    public.streakup_my_role() = 'hq_owner'::public.streakup_role
    and cafe_id = public.streakup_my_cafe_id()
  )
);

-- -----------------------------------------------------------------------------
-- visits — customer check uses auth_user_id on customers (one-way, no loop)
-- -----------------------------------------------------------------------------
drop policy if exists visits_select_scoped on public.visits;

create policy visits_select_scoped
on public.visits
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    public.streakup_my_role() = 'hq_owner'::public.streakup_role
    and cafe_id = public.streakup_my_cafe_id()
  )
  or (
    public.streakup_my_role() in (
      'branch_manager'::public.streakup_role,
      'cashier'::public.streakup_role
    )
    and branch_id = public.streakup_my_branch_id()
  )
  or exists (
    select 1
    from public.customers c
    where c.id = visits.customer_id
      and c.auth_user_id = auth.uid()
  )
);

commit;
