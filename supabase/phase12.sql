-- =============================================================================
-- StreakUp — Phase 12: Enterprise security hardening
--
-- Adds server-side defences that complement the edge/frontend Zod + rate-limit
-- layers added in the same phase:
--
--   1. Generic auth lockout table + RPC so PIN/PHONE/EMAIL brute-force attempts
--      are throttled **in the database** (survives Deno isolate restarts and
--      blocks PostgREST clients that bypass our Edge Functions).
--   2. `cashier_find_customer_secure(p_phone, p_pin)` — SECURITY DEFINER RPC
--      that replaces the cashier's direct `customers` SELECT. It scopes the
--      lookup to the authenticated cashier's cafe via `profiles.cafe_id`,
--      never exposes neighbouring customers, and records failures into the
--      new lockout table.
--   3. `customer_portal_session_secure` — drop-in wrapper for the existing
--      customer portal RPC that enforces per-(cafe, phone) lockouts and
--      returns a structured `rate_limited` error so the browser can surface
--      a countdown without leaking phone-existence signals.
--   4. Tightens `pin_code` to the documented 4–8 digit numeric shape on
--      existing tables (matches the edge/frontend `zPin` schema).
--   5. Revokes broad PostgREST write privileges from anonymous clients on the
--      customers table (defence-in-depth in case a future RLS policy regresses).
--
-- Safe to re-run: all statements are guarded with `if not exists` / `create or
-- replace` / `drop ... if exists`.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Auth lockout ledger
-- -----------------------------------------------------------------------------
create table if not exists public.auth_lockouts (
  lane          text         not null,
  subject       text         not null,
  attempts      int          not null default 0,
  window_start  timestamptz  not null default now(),
  locked_until  timestamptz,
  last_ip       inet,
  last_reason   text,
  updated_at    timestamptz  not null default now(),
  primary key (lane, subject)
);

create index if not exists auth_lockouts_window_idx
  on public.auth_lockouts (lane, window_start desc);

create index if not exists auth_lockouts_locked_until_idx
  on public.auth_lockouts (locked_until)
  where locked_until is not null;

alter table public.auth_lockouts enable row level security;

-- PostgREST clients are never allowed to read/write this table directly.
drop policy if exists auth_lockouts_denied on public.auth_lockouts;
create policy auth_lockouts_denied
on public.auth_lockouts
for all
to authenticated, anon
using (false)
with check (false);

revoke all on public.auth_lockouts from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Core lockout helpers (SECURITY DEFINER, never called directly by clients).
-- -----------------------------------------------------------------------------
create or replace function public.lockout_check(
  p_lane        text,
  p_subject     text,
  p_window      interval default interval '1 minute',
  p_max         int      default 5,
  p_cooldown    interval default interval '45 seconds'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.auth_lockouts%rowtype;
  v_now timestamptz := now();
  v_retry_after int;
begin
  select * into v_row
  from public.auth_lockouts
  where lane = p_lane and subject = p_subject
  for update;

  if not found then
    return jsonb_build_object('allowed', true, 'remaining', p_max);
  end if;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    v_retry_after := ceil(extract(epoch from (v_row.locked_until - v_now)))::int;
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limited',
      'retry_after_ms', v_retry_after * 1000
    );
  end if;

  if v_row.window_start < v_now - p_window then
    update public.auth_lockouts
      set attempts = 0, window_start = v_now, locked_until = null
      where lane = p_lane and subject = p_subject;
    return jsonb_build_object('allowed', true, 'remaining', p_max);
  end if;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(0, p_max - v_row.attempts)
  );
end;
$$;

create or replace function public.lockout_register_failure(
  p_lane     text,
  p_subject  text,
  p_window   interval default interval '1 minute',
  p_max      int      default 5,
  p_cooldown interval default interval '45 seconds',
  p_reason   text     default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_attempts int;
  v_locked_until timestamptz;
begin
  insert into public.auth_lockouts as al (lane, subject, attempts, window_start, last_reason, updated_at)
  values (p_lane, p_subject, 1, v_now, p_reason, v_now)
  on conflict (lane, subject) do update
    set attempts = case
          when al.window_start < v_now - p_window then 1
          else al.attempts + 1
        end,
        window_start = case
          when al.window_start < v_now - p_window then v_now
          else al.window_start
        end,
        last_reason = coalesce(p_reason, al.last_reason),
        updated_at = v_now
  returning attempts into v_attempts;

  if v_attempts >= p_max then
    v_locked_until := v_now + p_cooldown;
    update public.auth_lockouts
      set locked_until = v_locked_until,
          updated_at = v_now
      where lane = p_lane and subject = p_subject;
  end if;

  return jsonb_build_object(
    'attempts', v_attempts,
    'locked_until', v_locked_until
  );
end;
$$;

create or replace function public.lockout_register_success(
  p_lane    text,
  p_subject text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.auth_lockouts where lane = p_lane and subject = p_subject;
$$;

revoke all on function public.lockout_check(text, text, interval, int, interval) from public;
revoke all on function public.lockout_register_failure(text, text, interval, int, interval, text) from public;
revoke all on function public.lockout_register_success(text, text) from public;

-- -----------------------------------------------------------------------------
-- 2. Cashier secure customer lookup
-- -----------------------------------------------------------------------------
create or replace function public.cashier_find_customer_secure(
  p_phone text,
  p_pin   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_phone text := trim(coalesce(p_phone, ''));
  v_pin   text := trim(coalesce(p_pin, ''));
  v_customer public.customers%rowtype;
  v_subject text;
  v_check jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_phone !~ '^[+0-9\s\-()]{4,32}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  if v_pin !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pin');
  end if;

  select * into v_profile
  from public.profiles
  where user_id = v_uid
  limit 1;

  if not found
     or v_profile.cafe_id is null
     or v_profile.role not in ('cashier'::public.streakup_role, 'branch_manager'::public.streakup_role, 'hq_owner'::public.streakup_role) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_subject := v_profile.cafe_id::text || ':' || v_phone;

  v_check := public.lockout_check('cashier:pin', v_subject, interval '1 minute', 5, interval '45 seconds');
  if (v_check->>'allowed')::boolean is distinct from true then
    return jsonb_build_object(
      'ok', false,
      'reason', 'rate_limited',
      'retry_after_ms', coalesce((v_check->>'retry_after_ms')::int, 45000)
    );
  end if;

  select c.* into v_customer
  from public.customers c
  where c.cafe_id = v_profile.cafe_id
    and c.phone   = v_phone
    and c.pin_code = v_pin
  limit 1;

  if not found then
    perform public.lockout_register_failure(
      'cashier:pin', v_subject,
      interval '1 minute', 5, interval '45 seconds',
      'pin_mismatch'
    );
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform public.lockout_register_success('cashier:pin', v_subject);

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer.id,
    'cafe_id', v_customer.cafe_id
  );
end;
$$;

revoke all on function public.cashier_find_customer_secure(text, text) from public;
grant execute on function public.cashier_find_customer_secure(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Customer portal (phone + PIN) — add lockout wrapper
--    Keeps the original `customer_portal_session` signature so existing clients
--    work, but now every failed PIN attempt is counted against the
--    per-(cafe, phone) lane before hitting the underlying lookup.
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
  v_subject text;
  v_check jsonb;
  v_phone text := trim(coalesce(p_phone, ''));
  v_pin   text := trim(coalesce(p_pin, ''));
begin
  if v_phone !~ '^[+0-9\s\-()]{4,32}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_phone');
  end if;

  if v_pin !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin');
  end if;

  select c.id into v_cafe_id
  from public.cafes c
  where c.slug = trim(p_slug)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'cafe_not_found');
  end if;

  v_subject := v_cafe_id::text || ':' || v_phone;

  v_check := public.lockout_check('portal:pin', v_subject, interval '1 minute', 5, interval '60 seconds');
  if (v_check->>'allowed')::boolean is distinct from true then
    return jsonb_build_object(
      'ok', false,
      'error', 'rate_limited',
      'retry_after_ms', coalesce((v_check->>'retry_after_ms')::int, 60000)
    );
  end if;

  select cu.* into v_cust
  from public.customers cu
  where cu.cafe_id = v_cafe_id
    and cu.phone = v_phone
    and cu.pin_code = v_pin
  limit 1;

  if not found then
    perform public.lockout_register_failure(
      'portal:pin', v_subject,
      interval '1 minute', 5, interval '60 seconds',
      'pin_mismatch'
    );
    return jsonb_build_object('ok', false, 'error', 'auth_failed');
  end if;

  perform public.lockout_register_success('portal:pin', v_subject);

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
    on r.milestone_id = rm.id and r.customer_id = v_cust.id
  where rm.cafe_id = v_cafe_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'milestone_id', r.milestone_id,
      'earned_at', r.earned_at,
      'claimed_at', r.claimed_at
    )
    order by r.earned_at desc
  ), '[]'::jsonb)
  into v_rewards
  from public.rewards r
  where r.customer_id = v_cust.id;

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_cust.id,
    'cafe_id', v_cust.cafe_id,
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

-- -----------------------------------------------------------------------------
-- 4. Tighten `customers.pin_code` to the documented 4-8 digit numeric shape
-- -----------------------------------------------------------------------------
alter table public.customers
  drop constraint if exists customers_pin_code_chk;

alter table public.customers
  add constraint customers_pin_code_chk
  check (pin_code ~ '^[0-9]{4,8}$');

-- -----------------------------------------------------------------------------
-- 5. Defence-in-depth: strip PostgREST write grants from `customers`/`visits`
--    for anon. RLS already blocks them, but removing the privilege means a
--    future misconfigured policy cannot accidentally re-expose the rows.
-- -----------------------------------------------------------------------------
revoke insert, update, delete on public.customers from anon;
revoke insert, update, delete on public.visits    from anon;
revoke insert, update, delete on public.rewards   from anon;

commit;
