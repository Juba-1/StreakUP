-- =============================================================================
-- StreakUp — Phase 35: Branch isolation hardening (RLS)
--
-- Goal
--   - Ensure Branch Manager + Cashier can NEVER see or enumerate other branches.
--   - Ensure Cashier cannot directly enumerate the customer base via PostgREST.
--   - Keep HQ Owner top-down visibility across all branches in their cafe.
--
-- Notes
--   - Cashier workflows use SECURITY DEFINER RPCs (e.g. cashier_find_customer_by_pin)
--     and do NOT require broad PostgREST SELECT on customers.
--   - Visit ingestion is already protected server-side:
--       * Edge Function `record-visit` asserts (branchId, customerId) belong to the cafe for API keys
--       * RPC `record_visit_idempotent` enforces branch_id = profile.branch_id for cashier/manager
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- branches: prevent cross-branch enumeration for branch roles
-- -----------------------------------------------------------------------------
drop policy if exists branches_select_scoped on public.branches;
create policy branches_select_scoped
on public.branches
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    -- HQ owner: all branches within their cafe
    (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
    and cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
  )
  or (
    -- branch_manager / cashier: ONLY their branch row
    (select p.role from public.profiles p where p.user_id = auth.uid()) in ('branch_manager', 'cashier')
    and id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
  )
);

-- -----------------------------------------------------------------------------
-- customers: remove cashier cafe-wide enumeration
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
    -- Branch managers: only customers who have any visit in their branch
    (select p.role from public.profiles p where p.user_id = auth.uid()) = 'branch_manager'::public.streakup_role
    and exists (
      select 1
      from public.visits v
      where v.customer_id = customers.id
        and v.branch_id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
    )
  )
  -- cashiers: NO direct customer enumeration via PostgREST
);

commit;

