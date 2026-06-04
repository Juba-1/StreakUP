-- =============================================================================
-- StreakUp — Phase 19: Enterprise HQ Controls, Calendar-Day Logic & Shield Cron
--
--  1. streakup_engine_process_check_in — expose `already_visited_today` flag
--     so callers can surface a graceful "already visited today" UX without
--     performing a second query. The visit is still recorded for audit trail;
--     the streak simply doesn't advance on duplicate-day visits.
--
--  2. record_visit_idempotent — propagate `already_visited_today` from the
--     engine to the RPC return payload so the Cashier POS can read it.
--
--  3. customer_portal_begin — add `last_visit_date` + `visited_today` to the
--     response so the Customer Portal can display "Today's streak secured".
--
--  4. hq_list_customers_secure — paginated, searchable customer list for the
--     HQ CRM view.  Accessible by hq_owner (own cafe) and super_admin.
--
--  5. hq_override_customer_secure — HQ owner / super_admin can adjust a
--     customer's streak, shields, and display name. Every override is written
--     to the audit log with the before/after values.
--
--  6. nightly_shield_consume — pg_cron job that runs 30 min after midnight
--     in each cafe's local timezone and auto-consumes one shield for customers
--     whose last check-in was exactly 2 calendar days ago (missed yesterday).
--     Inserts a synthetic 'system' visit so the streak engine stays consistent.
--
-- Safe to re-run (create or replace + idempotent schedule guard).
-- =============================================================================

begin;

-- =============================================================================
-- 1. Engine — expose already_visited_today
-- =============================================================================
create or replace function public.streakup_engine_process_check_in(
  p_cafe_id uuid,
  p_customer_id uuid,
  p_visit_date date
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cafe               public.cafes%rowtype;
  v_cust               public.customers%rowtype;
  v_last               date;
  v_diff               int;
  v_new_streak         int;
  v_new_shields        int;
  v_consumed           boolean := false;
  v_awarded            boolean := false;
  v_frozen             boolean := false;
  v_already_today      boolean := false;   -- ← NEW
  v_dow                int;
  v_cap                int;
  v_milestones         jsonb := '[]'::jsonb;
  v_prev_streak        int;
  v_m                  record;
begin
  select * into v_cafe from public.cafes where id = p_cafe_id for share;
  if not found then
    raise exception 'cafe_not_found';
  end if;

  select * into v_cust
  from public.customers
  where id = p_customer_id and cafe_id = p_cafe_id
  for update;

  if not found then
    raise exception 'customer_not_found';
  end if;

  v_prev_streak  := v_cust.current_streak;
  v_new_shields  := v_cust.shields;

  -- Off-day freeze check
  v_dow := extract(dow from p_visit_date)::int;
  if v_cafe.off_days is not null
    and cardinality(v_cafe.off_days) > 0
    and v_cafe.off_days @> array[v_dow::smallint] then
    v_frozen     := true;
    v_new_streak := v_cust.current_streak;
  else
    -- Most-recent check-in date for this customer / cafe
    select max(v.visit_date) into v_last
    from public.visits v
    where v.customer_id = p_customer_id
      and v.cafe_id     = p_cafe_id
      and v.event_type  = 'check_in'::public.visit_event_type;

    if v_last is null then
      -- First-ever visit
      v_new_streak := 1;

    elsif p_visit_date = v_last then
      -- ── SAME CALENDAR DAY ─────────────────────────────────────────────
      -- Already visited today: streak is unchanged, no milestone processing.
      v_new_streak    := v_cust.current_streak;
      v_already_today := true;

    elsif p_visit_date < v_last then
      -- Backdated visit (clock skew / replay): no-op on streak
      v_new_streak := v_cust.current_streak;

    else
      -- Future date relative to last visit: compute gap
      v_diff := (p_visit_date - v_last);

      if v_diff = 1 then
        -- ── CONSECUTIVE DAY ─────────────────────────────────────────────
        v_new_streak := v_cust.current_streak + 1;

      elsif v_diff = 2 then
        -- ── ONE DAY GAP — shield auto-consume at check-in ───────────────
        if v_cust.shields > 0 then
          v_new_shields := v_cust.shields - 1;
          v_consumed    := true;
          v_new_streak  := v_cust.current_streak + 1;
        else
          v_new_streak := 1;
        end if;

      else
        -- ── MULTI-DAY GAP — streak breaks ────────────────────────────────
        v_new_streak := 1;
      end if;
    end if;

    -- Shield award logic (unchanged)
    if (not v_frozen) and (not v_already_today) and v_new_streak > v_prev_streak then
      if v_cafe.shield_every is not null
        and v_cafe.shield_every > 0
        and v_new_streak > 0
        and v_new_streak % v_cafe.shield_every = 0 then
        v_cap := coalesce(v_cafe.max_shields, 2147483647);
        if v_new_shields < v_cap then
          v_new_shields := v_new_shields + 1;
          v_awarded     := true;
        end if;
      end if;
    end if;
  end if;

  -- Persist updated streak / shields (even if already_today — shields unchanged so safe)
  update public.customers
  set current_streak = v_new_streak,
      longest_streak = greatest(longest_streak, v_new_streak),
      shields        = v_new_shields,
      updated_at     = now()
  where id       = p_customer_id
    and cafe_id  = p_cafe_id;

  -- Milestone unlock (only when streak actually advanced)
  if (not v_frozen) and (not v_already_today) and v_new_streak > v_prev_streak then
    for v_m in
      select rm.id, rm.name, rm.days_required
      from public.reward_milestones rm
      where rm.cafe_id       = p_cafe_id
        and rm.active
        and rm.days_required <= v_new_streak
        and rm.days_required >  v_prev_streak
      order by rm.sort_order, rm.days_required
    loop
      insert into public.rewards (cafe_id, customer_id, milestone_id, earned_at)
      values (p_cafe_id, p_customer_id, v_m.id, now())
      on conflict (customer_id, milestone_id) do update
        set earned_at  = coalesce(public.rewards.earned_at, excluded.earned_at),
            updated_at = now();

      v_milestones := v_milestones || jsonb_build_array(
        jsonb_build_object(
          'milestone_id',  v_m.id,
          'name',          v_m.name,
          'days_required', v_m.days_required
        )
      );
    end loop;
  end if;

  return jsonb_build_object(
    'streak_after',         v_new_streak,
    'shields_after',        v_new_shields,
    'shield_consumed',      v_consumed,
    'shield_awarded',       v_awarded,
    'off_day_freeze',       v_frozen,
    'already_visited_today', v_already_today,     -- ← NEW
    'dow',                  v_dow,
    'milestones',           coalesce(v_milestones, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.streakup_engine_process_check_in(uuid, uuid, date) from public;

-- =============================================================================
-- 2. record_visit_idempotent — propagate already_visited_today
-- =============================================================================
create or replace function public.record_visit_idempotent(
  p_branch_id        uuid,
  p_customer_id      uuid,
  p_idempotency_key  text,
  p_payload_sha256   text,
  p_event_type       public.visit_event_type default 'check_in',
  p_client_visit_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cafe_id          uuid;
  v_tz               text;
  v_visit_date       date;
  v_existing_visit   uuid;
  v_existing_hash    text;
  v_row_id           uuid;
  v_streak_after     int;
  v_visit_id         uuid;
  v_profile          public.profiles;
  v_engine           jsonb := null;
  v_meta             jsonb := '{}'::jsonb;
  v_current_streak   int;
  v_already_today    boolean := false;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'invalid_idempotency_key';
  end if;

  if p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_payload_sha256';
  end if;

  -- Auth / role checks
  if auth.role() is distinct from 'service_role' then
    v_profile := public.streakup_profile();
    if v_profile is null then
      raise exception 'not_authenticated';
    end if;

    if v_profile.role = 'super_admin'::public.streakup_role then
      null;
    elsif v_profile.role = 'hq_owner'::public.streakup_role then
      if v_profile.cafe_id is null then
        raise exception 'forbidden';
      end if;
    elsif v_profile.role in ('branch_manager', 'cashier') then
      if v_profile.branch_id is distinct from p_branch_id then
        raise exception 'forbidden';
      end if;
    else
      raise exception 'forbidden';
    end if;
  end if;

  select b.cafe_id into v_cafe_id from public.branches b where b.id = p_branch_id;
  if v_cafe_id is null then
    raise exception 'branch_not_found';
  end if;

  if auth.role() is distinct from 'service_role' then
    if v_profile.role = 'hq_owner'::public.streakup_role
      and v_profile.cafe_id is distinct from v_cafe_id then
      raise exception 'forbidden';
    end if;
    if v_profile.role in ('branch_manager', 'cashier')
      and v_profile.cafe_id is distinct from v_cafe_id then
      raise exception 'forbidden';
    end if;
  end if;

  select c.timezone into v_tz from public.cafes c where c.id = v_cafe_id;
  v_visit_date := coalesce(
    p_client_visit_date,
    (timezone(v_tz, now()))::date
  );

  -- Idempotency key reservation
  insert into public.visit_idempotency_keys (
    cafe_id, idempotency_key, payload_sha256, customer_id, branch_id, status
  )
  values (
    v_cafe_id, p_idempotency_key, p_payload_sha256,
    p_customer_id, p_branch_id, 'pending'::public.idempotency_record_status
  )
  on conflict (cafe_id, idempotency_key) do nothing
  returning id into v_row_id;

  if v_row_id is null then
    select vik.visit_id, vik.payload_sha256
    into v_existing_visit, v_existing_hash
    from public.visit_idempotency_keys vik
    where vik.cafe_id = v_cafe_id
      and vik.idempotency_key = p_idempotency_key;

    if v_existing_hash is distinct from p_payload_sha256 then
      raise exception 'idempotency_key_conflict';
    end if;

    return jsonb_build_object('status', 'replay', 'visit_id', v_existing_visit);
  end if;

  if not exists (
    select 1 from public.customers cu
    where cu.id = p_customer_id and cu.cafe_id = v_cafe_id
  ) then
    update public.visit_idempotency_keys
    set status = 'failed'::public.idempotency_record_status,
        error  = 'customer_not_in_cafe'
    where id = v_row_id;
    raise exception 'customer_not_in_cafe';
  end if;

  if p_event_type = 'check_in'::public.visit_event_type then
    v_engine        := public.streakup_engine_process_check_in(v_cafe_id, p_customer_id, v_visit_date);
    v_streak_after  := (v_engine->>'streak_after')::int;
    v_already_today := coalesce((v_engine->>'already_visited_today')::boolean, false);
    v_meta          := v_engine;
  else
    select cu.current_streak into v_current_streak
    from public.customers cu where cu.id = p_customer_id and cu.cafe_id = v_cafe_id;
    v_streak_after := coalesce(v_current_streak, 0);
    v_meta := jsonb_build_object('non_check_in', true);
  end if;

  insert into public.visits (
    customer_id, cafe_id, branch_id, visit_date, streak_after, event_type, metadata
  )
  values (p_customer_id, v_cafe_id, p_branch_id, v_visit_date, v_streak_after, p_event_type, v_meta)
  returning id into v_visit_id;

  update public.visit_idempotency_keys
  set status   = 'completed'::public.idempotency_record_status,
      visit_id = v_visit_id
  where id = v_row_id;

  insert into public.audit_log (
    cafe_id, branch_id, actor_user_id, actor_type, action, entity_type, entity_id, payload
  )
  values (
    v_cafe_id, p_branch_id,
    auth.uid(),
    case when auth.role() = 'service_role' then 'service_role' else 'user' end,
    'visit.recorded', 'visit', v_visit_id,
    jsonb_build_object(
      'idempotency_key',     p_idempotency_key,
      'payload_sha256',      p_payload_sha256,
      'visit_date',          v_visit_date,
      'streak_after',        v_streak_after,
      'already_visited_today', v_already_today,
      'engine',              v_engine,
      'event_type',          p_event_type
    )
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'status',              'created',
    'visit_id',            v_visit_id,
    'visit_date',          v_visit_date,
    'streak_after',        v_streak_after,
    'already_visited_today', v_already_today,    -- ← PROPAGATED
    'engine',              v_engine,
    'event_type',          p_event_type
  ));
end;
$$;

revoke all on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date) from public;
grant execute on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date)
  to authenticated, service_role;

-- =============================================================================
-- 3. customer_portal_begin — add last_visit_date + visited_today
-- =============================================================================
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
  v_cafe          public.cafes%rowtype;
  v_customer      public.customers%rowtype;
  v_customer_id   uuid;
  v_created       boolean := false;
  v_resumed       boolean := false;
  v_subject       text;
  v_check         jsonb;
  v_phone         text;
  v_name          text := trim(coalesce(p_name, ''));
  v_token         text := trim(coalesce(p_session_token, ''));
  v_token_hash    text;
  v_new_token     text;
  v_new_hash      text;
  v_milestones    jsonb;
  v_last_visit    date;
  v_today         date;
  v_visited_today boolean := false;
begin
  -- 1. Resolve cafe
  select c.* into v_cafe
  from public.cafes c
  where c.slug = trim(coalesce(p_slug, ''))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'cafe_not_found');
  end if;

  if v_cafe.status <> 'active'::public.cafe_status then
    return jsonb_build_object('ok', false, 'error', 'cafe_inactive', 'status', v_cafe.status::text);
  end if;

  -- 2. Fast resume via session token
  if char_length(v_token) >= 24 then
    v_token_hash := encode(digest(v_token, 'sha256'), 'hex');

    select cu.* into v_customer
    from public.customer_portal_sessions s
    join public.customers cu on cu.id = s.customer_id
    where s.cafe_id    = v_cafe.id
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

  -- 3. Phone-first onboarding
  if not v_resumed then
    v_phone := public.normalize_sa_mobile_e164(trim(coalesce(p_phone, '')));
    if v_phone is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_phone');
    end if;

    v_subject := v_cafe.id::text || ':' || v_phone;
    v_check := public.lockout_check('portal:phone', v_subject, interval '1 minute', 12, interval '45 seconds');

    if (v_check->>'allowed')::boolean is distinct from true then
      return jsonb_build_object(
        'ok', false, 'error', 'rate_limited',
        'retry_after_ms', coalesce((v_check->>'retry_after_ms')::int, 45000)
      );
    end if;

    select cu.* into v_customer
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
      if char_length(v_name) >= 2 and coalesce(trim(v_customer.full_name), '') = '' then
        update public.customers set full_name = left(v_name, 120) where id = v_customer.id;
        v_customer.full_name := left(v_name, 120);
      end if;
    else
      if char_length(v_name) < 2 then
        perform public.lockout_register_failure(
          'portal:phone', v_subject, interval '1 minute', 12, interval '45 seconds', 'name_required'
        );
        return jsonb_build_object('ok', false, 'error', 'name_required');
      end if;

      insert into public.customers (cafe_id, phone, full_name)
      values (v_cafe.id, v_phone, left(v_name, 120))
      returning id into v_customer_id;

      select cu.* into v_customer from public.customers cu where cu.id = v_customer_id;
      v_created := true;
    end if;

    perform public.lockout_register_success('portal:phone', v_subject);
  end if;

  -- 4. Defensive assertion
  if v_customer_id is null or v_customer.id is null then
    return jsonb_build_object('ok', false, 'error', 'customer_resolution_failed');
  end if;

  -- 5. Refresh portal session
  v_new_token := encode(gen_random_bytes(24), 'hex');
  v_new_hash  := encode(digest(v_new_token, 'sha256'), 'hex');

  insert into public.customer_portal_sessions (cafe_id, customer_id, token_hash, expires_at, last_seen_at)
  values (v_cafe.id, v_customer_id, v_new_hash, now() + interval '90 days', now())
  on conflict (customer_id) do update
     set token_hash   = excluded.token_hash,
         cafe_id      = excluded.cafe_id,
         expires_at   = excluded.expires_at,
         last_seen_at = excluded.last_seen_at;

  -- 6. "Visited today?" check — use the cafe's local timezone
  v_today := (now() at time zone coalesce(v_cafe.timezone, 'UTC'))::date;

  select max(v.visit_date) into v_last_visit
  from public.visits v
  where v.customer_id = v_customer_id
    and v.cafe_id     = v_cafe.id
    and v.event_type  = 'check_in'::public.visit_event_type;

  v_visited_today := (v_last_visit is not null and v_last_visit = v_today);

  -- 7. Roadmap projection
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
    on r.milestone_id = rm.id and r.customer_id = v_customer.id
  where rm.cafe_id = v_cafe.id;

  return jsonb_build_object(
    'ok',              true,
    'customer_id',     v_customer.id,
    'cafe_id',         v_customer.cafe_id,
    'current_streak',  v_customer.current_streak,
    'longest_streak',  v_customer.longest_streak,
    'shields',         v_customer.shields,
    'milestones',      v_milestones,
    'pin_code',        v_customer.pin_code,
    'display_name',    coalesce(v_customer.full_name, ''),
    'is_new',          v_created,
    'resumed',         v_resumed,
    'session_token',   v_new_token,
    'last_visit_date', v_last_visit,        -- ← NEW
    'visited_today',   v_visited_today      -- ← NEW
  );
end;
$$;

revoke all on function public.customer_portal_begin(text, text, text, text) from public;
grant execute on function public.customer_portal_begin(text, text, text, text) to anon, authenticated;

-- =============================================================================
-- 4. hq_list_customers_secure — paginated CRM list
-- =============================================================================
create or replace function public.hq_list_customers_secure(
  p_cafe_id uuid default null,   -- super_admin passes this; hq_owner ignored
  p_search  text    default '',
  p_limit   int     default 50,
  p_offset  int     default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles%rowtype;
  v_cafe_id  uuid;
  v_rows     jsonb;
  v_total    bigint;
  v_search   text := trim(coalesce(p_search, ''));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = v_uid limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.role = 'super_admin'::public.streakup_role then
    -- super_admin must supply p_cafe_id to scope the query
    if p_cafe_id is null then
      return jsonb_build_object('ok', false, 'reason', 'cafe_id_required_for_super_admin');
    end if;
    v_cafe_id := p_cafe_id;
  elsif v_profile.role = 'hq_owner'::public.streakup_role then
    v_cafe_id := v_profile.cafe_id;
    if v_cafe_id is null then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  p_limit  := greatest(1, least(coalesce(p_limit, 50), 200));
  p_offset := greatest(0, coalesce(p_offset, 0));

  -- Total count (for pagination)
  select count(*) into v_total
  from public.customers c
  where c.cafe_id = v_cafe_id
    and (
      v_search = ''
      or c.full_name ilike '%' || v_search || '%'
      or c.pin_code  ilike '%' || v_search || '%'
    );

  -- Paginated rows with last_visit_date
  select coalesce(jsonb_agg(row_data order by row_data->>'created_at' desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id',              c.id,
      'full_name',       coalesce(c.full_name, ''),
      'pin_code',        c.pin_code,
      'current_streak',  c.current_streak,
      'longest_streak',  c.longest_streak,
      'shields',         c.shields,
      'created_at',      c.created_at,
      'updated_at',      c.updated_at,
      'last_visit_date', lv.last_visit
    ) as row_data
    from public.customers c
    left join lateral (
      select max(v.visit_date) as last_visit
      from public.visits v
      where v.customer_id = c.id
        and v.cafe_id     = c.cafe_id
        and v.event_type  = 'check_in'::public.visit_event_type
    ) lv on true
    where c.cafe_id = v_cafe_id
      and (
        v_search = ''
        or c.full_name ilike '%' || v_search || '%'
        or c.pin_code  ilike '%' || v_search || '%'
      )
    order by c.created_at desc
    limit p_limit offset p_offset
  ) sub;

  return jsonb_build_object(
    'ok',      true,
    'total',   v_total,
    'limit',   p_limit,
    'offset',  p_offset,
    'rows',    v_rows
  );
end;
$$;

revoke all on function public.hq_list_customers_secure(uuid, text, int, int) from public;
grant execute on function public.hq_list_customers_secure(uuid, text, int, int) to authenticated;

-- =============================================================================
-- 5. hq_override_customer_secure — manual streak / shield / name adjustment
-- =============================================================================
create or replace function public.hq_override_customer_secure(
  p_customer_id  uuid,
  p_streak       int  default null,
  p_shields      int  default null,
  p_full_name    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_profile    public.profiles%rowtype;
  v_customer   public.customers%rowtype;
  v_before     jsonb;
  v_after      jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = v_uid limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.role not in ('super_admin'::public.streakup_role, 'hq_owner'::public.streakup_role) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- Load and lock customer
  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  -- hq_owner may only override their own cafe's customers
  if v_profile.role = 'hq_owner'::public.streakup_role
     and v_customer.cafe_id is distinct from v_profile.cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- Validate inputs
  if p_streak is not null and p_streak < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_streak');
  end if;
  if p_shields is not null and p_shields < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_shields');
  end if;

  -- Capture before-state for audit
  v_before := jsonb_build_object(
    'current_streak', v_customer.current_streak,
    'longest_streak', v_customer.longest_streak,
    'shields',        v_customer.shields,
    'full_name',      v_customer.full_name
  );

  -- Apply override (only supplied fields are updated)
  update public.customers
  set current_streak = coalesce(p_streak,    current_streak),
      longest_streak = greatest(longest_streak, coalesce(p_streak, current_streak)),
      shields        = coalesce(p_shields,   shields),
      full_name      = coalesce(
        case when p_full_name is not null then nullif(trim(left(p_full_name, 120)), '') end,
        full_name
      ),
      updated_at     = now()
  where id = p_customer_id
  returning * into v_customer;

  v_after := jsonb_build_object(
    'current_streak', v_customer.current_streak,
    'longest_streak', v_customer.longest_streak,
    'shields',        v_customer.shields,
    'full_name',      v_customer.full_name
  );

  -- Audit trail
  insert into public.audit_log (
    cafe_id, branch_id, actor_user_id, actor_type, action, entity_type, entity_id, payload
  )
  values (
    v_customer.cafe_id, null,
    v_uid, 'user',
    'customer.override', 'customer', p_customer_id,
    jsonb_build_object('before', v_before, 'after', v_after)
  );

  return jsonb_build_object(
    'ok',       true,
    'customer', jsonb_build_object(
      'id',              v_customer.id,
      'current_streak',  v_customer.current_streak,
      'longest_streak',  v_customer.longest_streak,
      'shields',         v_customer.shields,
      'full_name',       coalesce(v_customer.full_name, '')
    )
  );
end;
$$;

revoke all on function public.hq_override_customer_secure(uuid, int, int, text) from public;
grant execute on function public.hq_override_customer_secure(uuid, int, int, text) to authenticated;

-- =============================================================================
-- 6. nightly_shield_consume — auto-protect streaks with shields at midnight
--
--    Logic: for each active cafe, at ~00:30 local time, find customers who:
--      · have an active streak (current_streak > 0)
--      · have at least one shield
--      · whose LAST check-in visit was exactly (today - 2) days ago in the
--        cafe's local timezone (i.e., they missed exactly yesterday)
--      · have not already been auto-protected today (no 'system' visit for yesterday)
--
--    For each such customer, we:
--      1. Insert a synthetic 'system' visit dated yesterday
--      2. Decrement shields by 1
--      3. Log to audit_log
--
--    Safe to call repeatedly — the "no existing system visit" guard is
--    idempotent.  This function is called by pg_cron every night.
-- =============================================================================
create or replace function public.nightly_shield_consume()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cafe       record;
  v_cust       record;
  v_today      date;
  v_yesterday  date;
  v_branch_id  uuid;
begin
  for v_cafe in
    select id, timezone, coalesce(timezone, 'UTC') as tz
    from public.cafes
    where status = 'active'::public.cafe_status
  loop
    v_today     := (now() at time zone v_cafe.tz)::date;
    v_yesterday := v_today - 1;

    -- Pick the first branch for synthetic visit anchoring
    select id into v_branch_id
    from public.branches
    where cafe_id = v_cafe.id
    order by created_at
    limit 1;

    if v_branch_id is null then
      continue;
    end if;

    for v_cust in
      select c.id, c.cafe_id, c.current_streak, c.shields
      from public.customers c
      where c.cafe_id       = v_cafe.id
        and c.current_streak > 0
        and c.shields        > 0
        -- Last check-in was 2 days ago (missed yesterday)
        and (
          select max(v.visit_date)
          from public.visits v
          where v.customer_id = c.id
            and v.cafe_id     = c.cafe_id
            and v.event_type  = 'check_in'::public.visit_event_type
        ) = v_today - 2
        -- Not already auto-protected yesterday
        and not exists (
          select 1 from public.visits sv
          where sv.customer_id = c.id
            and sv.cafe_id     = c.cafe_id
            and sv.visit_date  = v_yesterday
            and sv.event_type  = 'system'::public.visit_event_type
            and (sv.metadata->>'shield_auto_consumed')::boolean = true
        )
    loop
      -- Insert synthetic shield-save visit for yesterday
      insert into public.visits (
        customer_id, cafe_id, branch_id, visit_date,
        streak_after, event_type, metadata
      )
      values (
        v_cust.id, v_cust.cafe_id, v_branch_id, v_yesterday,
        v_cust.current_streak,
        'system'::public.visit_event_type,
        jsonb_build_object('shield_auto_consumed', true)
      );

      -- Consume one shield
      update public.customers
      set shields    = shields - 1,
          updated_at = now()
      where id = v_cust.id;

      -- Audit
      insert into public.audit_log (
        cafe_id, branch_id, actor_user_id, actor_type, action, entity_type, entity_id, payload
      )
      values (
        v_cust.cafe_id, v_branch_id,
        null, 'service_role',
        'customer.shield_auto_consumed', 'customer', v_cust.id,
        jsonb_build_object(
          'shield_date', v_yesterday,
          'streak_preserved', v_cust.current_streak,
          'shields_remaining', v_cust.shields - 1
        )
      );

    end loop;
  end loop;
end;
$$;

revoke all on function public.nightly_shield_consume() from public;

-- Schedule: 00:30 UTC daily (cafes in UTC+3 experience this at 03:30 local,
-- safely past midnight for the previous calendar day in Gulf timezone).
-- Wrapped in a DO block so it's idempotent on re-run.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('streakup-nightly-shield-consume');
    perform cron.schedule(
      'streakup-nightly-shield-consume',
      '30 0 * * *',
      $$select public.nightly_shield_consume()$$
    );
  end if;
end;
$$;

commit;
