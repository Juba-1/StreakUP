-- =============================================================================
-- StreakUp — Phase 18: PIN-only cashier customer lookup
--
-- WHY THIS EXISTS
--   The product mandate is "speed at the counter": a barista should only
--   type the customer's PIN — no phone number. Phase 12 introduced
--   `cashier_find_customer_secure(phone, pin)` which still required both.
--   This phase adds a new, hardened, PIN-only RPC that:
--
--     1. Scopes the lookup to a specific branch's café (no leakage across
--        tenants — same as the legacy function).
--     2. Mirrors the client-side access matrix:
--          * super_admin   → any branch
--          * hq_owner      → branches belonging to their café
--          * branch_manager → only their assigned branch
--          * cashier       → only their assigned branch
--     3. Throttles brute-force enumeration on two independent lanes:
--          - `cashier:pin-only`  → per-(café, pin) — slows down repeated
--            guessing of a specific PIN (5 fails / minute → 45s cooldown).
--          - `cashier:pin-user`  → per-cashier (auth.uid()) — caps the
--            total volume of guesses any single staff session can issue
--            (60 fails / minute → 60s cooldown). Without this lane, an
--            attacker with valid staff creds could enumerate the entire
--            10⁴ PIN space across many different PIN subjects.
--     4. Returns the customer's `full_name` and `current_streak` so the
--        POS confirm panel can greet them by name on success.
--
--   The legacy `cashier_find_customer_secure(phone, pin)` is **kept** for
--   backwards compatibility (existing offline queues, old service workers,
--   the SECURITY.md surface). New clients should call the PIN-only RPC.
--
--   PIN uniqueness is guaranteed by `customers_cafe_pin_uidx`
--   (init.sql:132) which makes this lookup deterministic — at most one
--   customer per (café, PIN).
--
-- Safe to re-run.
-- =============================================================================

begin;

create or replace function public.cashier_find_customer_by_pin(
  p_pin       text,
  p_branch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid              uuid := auth.uid();
  v_profile          public.profiles%rowtype;
  v_branch           public.branches%rowtype;
  v_customer         public.customers%rowtype;
  v_pin              text := trim(coalesce(p_pin, ''));
  v_pin_subject      text;
  v_user_subject     text;
  v_check            jsonb;
begin
  -- ── 1. Authentication ────────────────────────────────────────────────
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  -- ── 2. Input shape ───────────────────────────────────────────────────
  if v_pin !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pin');
  end if;

  if p_branch_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_branch');
  end if;

  -- ── 3. Branch must exist ─────────────────────────────────────────────
  select * into v_branch
  from public.branches
  where id = p_branch_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'branch_not_found');
  end if;

  -- ── 4. Caller profile + role gate ────────────────────────────────────
  select * into v_profile
  from public.profiles
  where user_id = v_uid
  limit 1;

  if not found
     or v_profile.role not in (
       'super_admin'::public.streakup_role,
       'hq_owner'::public.streakup_role,
       'branch_manager'::public.streakup_role,
       'cashier'::public.streakup_role
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- ── 5. Access matrix (mirrors the front-end CashierHomePage guard) ──
  if v_profile.role = 'super_admin'::public.streakup_role then
    null;
  elsif v_profile.role = 'hq_owner'::public.streakup_role then
    if v_profile.cafe_id is null
       or v_profile.cafe_id is distinct from v_branch.cafe_id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  else
    -- cashier or branch_manager
    if v_profile.branch_id is null
       or v_profile.branch_id is distinct from v_branch.id
       or v_profile.cafe_id  is distinct from v_branch.cafe_id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  -- ── 6. Rate-limit lane A — per-(café, pin) ───────────────────────────
  -- Slows down repeated guessing of the same PIN across cashiers.
  v_pin_subject := v_branch.cafe_id::text || ':pin:' || v_pin;
  v_check := public.lockout_check(
    'cashier:pin-only', v_pin_subject,
    interval '1 minute', 5, interval '45 seconds'
  );
  if (v_check->>'allowed')::boolean is distinct from true then
    return jsonb_build_object(
      'ok', false, 'reason', 'rate_limited',
      'retry_after_ms', coalesce((v_check->>'retry_after_ms')::int, 45000)
    );
  end if;

  -- ── 7. Rate-limit lane B — per-cashier session ───────────────────────
  -- Caps how many *different* PINs a single staff session may guess per
  -- minute — protects against a compromised cashier credential being
  -- used to enumerate the PIN space.
  v_user_subject := 'user:' || v_uid::text || ':branch:' || v_branch.id::text;
  v_check := public.lockout_check(
    'cashier:pin-user', v_user_subject,
    interval '1 minute', 60, interval '60 seconds'
  );
  if (v_check->>'allowed')::boolean is distinct from true then
    return jsonb_build_object(
      'ok', false, 'reason', 'rate_limited',
      'retry_after_ms', coalesce((v_check->>'retry_after_ms')::int, 60000)
    );
  end if;

  -- ── 8. The actual lookup ─────────────────────────────────────────────
  -- (cafe_id, pin_code) is UNIQUE — at most one row matches.
  select c.* into v_customer
  from public.customers c
  where c.cafe_id = v_branch.cafe_id
    and c.pin_code = v_pin
  limit 1;

  if not found then
    perform public.lockout_register_failure(
      'cashier:pin-only', v_pin_subject,
      interval '1 minute', 5, interval '45 seconds',
      'pin_mismatch'
    );
    perform public.lockout_register_failure(
      'cashier:pin-user', v_user_subject,
      interval '1 minute', 60, interval '60 seconds',
      'pin_mismatch'
    );
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- success — clear both lockout lanes for this PIN / cashier
  perform public.lockout_register_success('cashier:pin-only', v_pin_subject);
  perform public.lockout_register_success('cashier:pin-user', v_user_subject);

  return jsonb_build_object(
    'ok', true,
    'customer_id',     v_customer.id,
    'cafe_id',         v_customer.cafe_id,
    'full_name',       v_customer.full_name,
    'current_streak',  v_customer.current_streak,
    'longest_streak',  v_customer.longest_streak,
    'shields',         v_customer.shields
  );
end;
$$;

revoke all on function public.cashier_find_customer_by_pin(text, uuid) from public;
grant execute on function public.cashier_find_customer_by_pin(text, uuid) to authenticated;

commit;
