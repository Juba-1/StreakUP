-- =============================================================================
-- StreakUp — Phase 15: Bulletproof customer_portal_begin
--
-- WHAT THIS FIXES
--   The Phase 13/14 implementation relied on PL/pgSQL's implicit `FOUND` variable
--   to decide whether the customer row had already been resolved through a
--   resumed portal session. That is fragile because:
--
--     * The cafe lookup at the top of the function sets `FOUND = true`.
--     * When the resume-path block is entirely skipped (new customer entering
--       a phone for the first time, with no session token) `FOUND` stays true
--       from the cafe lookup, so `if not found then ... end if` is skipped and
--       the customer lookup/insert never runs.
--     * The final `insert into customer_portal_sessions` then fires with
--       `v_customer.id = NULL` and trips the NOT NULL constraint on
--       `customer_id`, surfacing as the user-reported crash:
--         null value in column "customer_id" of relation "customer_portal_sessions"
--
-- WHAT'S NEW
--   * Explicit `v_resumed` boolean flag — no reliance on `FOUND` across blocks.
--   * `insert ... returning id` is captured into a local variable so even if a
--     trigger rewrites the row (e.g. PIN allocator) the customer id is safe.
--   * Defensive assertion before touching `customer_portal_sessions` so future
--     regressions surface as a clean error code instead of a constraint crash.
--   * Optional `resumed` field on the response so clients can fire different
--     UX micro-interactions for new vs. returning visitors.
--   * Phone normalization stays in `public.normalize_sa_mobile_e164` (Phase 14).
--
-- Safe to re-run. Wraps everything in a transaction so a partial apply rolls
-- back cleanly.
-- =============================================================================

begin;

create or replace function public.customer_portal_begin(
  p_slug text,
  p_phone text default null,
  p_name text default null,
  p_session_token text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_cafe         public.cafes%rowtype;
  v_customer     public.customers%rowtype;
  v_customer_id  uuid;
  v_created      boolean := false;
  v_resumed      boolean := false;
  v_subject      text;
  v_check        jsonb;
  v_phone        text;
  v_name         text := trim(coalesce(p_name, ''));
  v_token        text := trim(coalesce(p_session_token, ''));
  v_token_hash   text;
  v_new_token    text;
  v_new_hash     text;
  v_milestones   jsonb;
begin
  -- ---------------------------------------------------------------------------
  -- 1. Resolve the cafe by slug. RLS doesn't apply (SECURITY DEFINER), but we
  --    still gate on status so suspended/archived tenants can't onboard new
  --    customers.
  -- ---------------------------------------------------------------------------
  select c.* into v_cafe
  from public.cafes c
  where c.slug = trim(coalesce(p_slug, ''))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'cafe_not_found');
  end if;

  if v_cafe.status <> 'active'::public.cafe_status then
    return jsonb_build_object(
      'ok', false,
      'error', 'cafe_inactive',
      'status', v_cafe.status::text
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- 2. Fast resume path: caller supplied a persistent portal session token.
  --    A valid token short-circuits phone/name handling entirely. We track the
  --    outcome via `v_resumed` so we never rely on FOUND across blocks.
  -- ---------------------------------------------------------------------------
  if char_length(v_token) >= 24 then
    v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

    select cu.*
      into v_customer
    from public.customer_portal_sessions s
    join public.customers cu on cu.id = s.customer_id
    where s.cafe_id = v_cafe.id
      and s.token_hash = v_token_hash
      and s.expires_at > now()
    limit 1;

    if found then
      v_resumed     := true;
      v_customer_id := v_customer.id;

      update public.customer_portal_sessions
         set last_seen_at = now(),
             expires_at   = now() + interval '90 days'
       where token_hash   = v_token_hash;
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- 3. Phone-first onboarding path. Only runs when we couldn't resume by token.
  -- ---------------------------------------------------------------------------
  if not v_resumed then
    v_phone := public.normalize_sa_mobile_e164(trim(coalesce(p_phone, '')));
    if v_phone is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_phone');
    end if;

    -- Database-side brute-force shield (survives Edge isolate restarts).
    v_subject := v_cafe.id::text || ':' || v_phone;
    v_check := public.lockout_check(
      'portal:phone',
      v_subject,
      interval '1 minute',
      12,
      interval '45 seconds'
    );

    if (v_check->>'allowed')::boolean is distinct from true then
      return jsonb_build_object(
        'ok', false,
        'error', 'rate_limited',
        'retry_after_ms', coalesce((v_check->>'retry_after_ms')::int, 45000)
      );
    end if;

    -- Try an exact match first, then a normalized fallback for legacy rows
    -- inserted before Phase 14's E.164 storage discipline.
    select cu.*
      into v_customer
    from public.customers cu
    where cu.cafe_id = v_cafe.id
      and (
        cu.phone = v_phone
        or public.normalize_sa_mobile_e164(trim(cu.phone)) = v_phone
      )
    order by case when cu.phone = v_phone then 0 else 1 end
    limit 1;

    if found then
      v_customer_id := v_customer.id;

      -- Backfill display name on legacy rows that never collected one.
      if char_length(v_name) >= 2
         and coalesce(trim(v_customer.full_name), '') = ''
      then
        update public.customers
           set full_name = left(v_name, 120)
         where id = v_customer.id;

        v_customer.full_name := left(v_name, 120);
      end if;
    else
      -- Brand-new customer — name is mandatory the first time we meet them.
      if char_length(v_name) < 2 then
        perform public.lockout_register_failure(
          'portal:phone', v_subject,
          interval '1 minute', 12, interval '45 seconds',
          'name_required'
        );
        return jsonb_build_object('ok', false, 'error', 'name_required');
      end if;

      -- Capture the freshly-minted id directly so triggers (e.g. PIN
      -- allocator) can't desynchronize what we hold in memory.
      insert into public.customers (cafe_id, phone, full_name)
      values (v_cafe.id, v_phone, left(v_name, 120))
      returning id into v_customer_id;

      select cu.* into v_customer
      from public.customers cu
      where cu.id = v_customer_id;

      v_created := true;
    end if;

    perform public.lockout_register_success('portal:phone', v_subject);
  end if;

  -- ---------------------------------------------------------------------------
  -- 4. Defensive assertion. If anyone ever regresses the resolution logic
  --    above we surface a clean error code instead of a NOT NULL constraint
  --    crash on customer_portal_sessions.customer_id.
  -- ---------------------------------------------------------------------------
  if v_customer_id is null or v_customer.id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'customer_resolution_failed'
    );
  end if;

  -- ---------------------------------------------------------------------------
  -- 5. Mint / refresh the persistent portal session (unique per customer).
  -- ---------------------------------------------------------------------------
  v_new_token := encode(gen_random_bytes(24), 'hex');
  v_new_hash  := encode(digest(v_new_token, 'sha256'), 'hex');

  insert into public.customer_portal_sessions (
    cafe_id, customer_id, token_hash, expires_at, last_seen_at
  )
  values (
    v_cafe.id, v_customer_id, v_new_hash,
    now() + interval '90 days', now()
  )
  on conflict (customer_id) do update
     set token_hash   = excluded.token_hash,
         cafe_id      = excluded.cafe_id,
         expires_at   = excluded.expires_at,
         last_seen_at = excluded.last_seen_at;

  -- ---------------------------------------------------------------------------
  -- 6. Roadmap projection for the dashboard hero.
  -- ---------------------------------------------------------------------------
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',            rm.id,
        'name',          rm.name,
        'days_required', rm.days_required,
        'reward_label',  rm.reward_label,
        'sort_order',    rm.sort_order,
        'earned_at',     r.earned_at,
        'claimed_at',    r.claimed_at
      )
      order by rm.sort_order, rm.days_required
    ),
    '[]'::jsonb
  )
  into v_milestones
  from public.reward_milestones rm
  left join public.rewards r
    on r.milestone_id = rm.id
   and r.customer_id  = v_customer.id
  where rm.cafe_id = v_cafe.id;

  return jsonb_build_object(
    'ok',             true,
    'customer_id',    v_customer.id,
    'cafe_id',        v_customer.cafe_id,
    'current_streak', v_customer.current_streak,
    'longest_streak', v_customer.longest_streak,
    'shields',        v_customer.shields,
    'milestones',     v_milestones,
    'pin_code',       v_customer.pin_code,
    'display_name',   coalesce(v_customer.full_name, ''),
    'is_new',         v_created,
    'resumed',        v_resumed,
    'session_token',  v_new_token
  );
end;
$$;

revoke all on function public.customer_portal_begin(text, text, text, text) from public;
grant execute on function public.customer_portal_begin(text, text, text, text) to anon, authenticated;

commit;
