-- =============================================================================
-- StreakUp — Phase 40: Cashier device gate + branch manager operations
--
-- · Cashier POS: verify branch cashier_pin → device session token (anon-safe)
-- · Device-scoped customer lookup + visit ingestion (no staff JWT on kiosk)
-- · Branch manager: branch metrics, customer list, streak dispute adjustment
--
-- Run AFTER phase39_security_lockdown.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Device sessions (hashed tokens; never store plaintext device secrets)
-- -----------------------------------------------------------------------------
create table if not exists public.cashier_device_sessions (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches (id) on delete cascade,
  cafe_id      uuid not null references public.cafes (id) on delete cascade,
  token_hash   text not null,
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint cashier_device_sessions_token_hash_chk check (token_hash ~ '^[a-f0-9]{64}$')
);

create unique index if not exists cashier_device_sessions_token_hash_uidx
  on public.cashier_device_sessions (token_hash);

create index if not exists cashier_device_sessions_branch_expires_idx
  on public.cashier_device_sessions (branch_id, expires_at desc);

alter table public.cashier_device_sessions enable row level security;
-- No policies: only SECURITY DEFINER RPCs touch this table.

-- -----------------------------------------------------------------------------
-- Public branch metadata (no PIN) for lock screen branding
-- -----------------------------------------------------------------------------
create or replace function public.cashier_branch_public_lookup(p_branch_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch public.branches%rowtype;
  v_cafe   public.cafes%rowtype;
begin
  if p_branch_code is null or length(trim(p_branch_code)) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_branch_code');
  end if;

  select b.* into v_branch
  from public.branches b
  where lower(trim(b.branch_code)) = lower(trim(p_branch_code))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'branch_not_found');
  end if;

  select c.* into v_cafe from public.cafes c where c.id = v_branch.cafe_id limit 1;

  if not found or v_cafe.status is distinct from 'active'::public.cafe_status then
    return jsonb_build_object('ok', false, 'reason', 'cafe_inactive');
  end if;

  return jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'branch_code', v_branch.branch_code,
    'branch_name', v_branch.name,
    'cafe_id', v_branch.cafe_id,
    'cafe_name', v_cafe.name,
    'cafe_slug', v_cafe.slug
  );
end;
$$;

revoke all on function public.cashier_branch_public_lookup(text) from public;
grant execute on function public.cashier_branch_public_lookup(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Verify cashier device PIN → issue device session token
-- -----------------------------------------------------------------------------
create or replace function public.verify_cashier_device_pin(
  p_branch_code text,
  p_pin         text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_branch      public.branches%rowtype;
  v_cafe        public.cafes%rowtype;
  v_pin         text := trim(coalesce(p_pin, ''));
  v_subject     text;
  v_check       jsonb;
  v_token       text;
  v_hash        text;
begin
  if p_branch_code is null or length(trim(p_branch_code)) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_branch_code');
  end if;

  if v_pin !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pin');
  end if;

  select b.* into v_branch
  from public.branches b
  where lower(trim(b.branch_code)) = lower(trim(p_branch_code))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'branch_not_found');
  end if;

  select c.* into v_cafe from public.cafes c where c.id = v_branch.cafe_id limit 1;
  if not found or v_cafe.status is distinct from 'active'::public.cafe_status then
    return jsonb_build_object('ok', false, 'reason', 'cafe_inactive');
  end if;

  v_subject := v_branch.cafe_id::text || ':cashier_device:' || v_branch.id::text;
  v_check := public.lockout_check(
    'cashier:device-pin', v_subject,
    interval '1 minute', 8, interval '90 seconds'
  );

  if (v_check->>'allowed')::boolean is distinct from true then
    return jsonb_build_object(
      'ok', false, 'reason', 'rate_limited',
      'retry_after_ms', coalesce((v_check->>'retry_after_ms')::int, 90000)
    );
  end if;

  if trim(v_branch.cashier_pin) is distinct from v_pin then
    perform public.lockout_register_failure(
      'cashier:device-pin', v_subject,
      interval '1 minute', 8, interval '90 seconds',
      'pin_mismatch'
    );
    return jsonb_build_object('ok', false, 'reason', 'invalid_pin');
  end if;

  perform public.lockout_register_success('cashier:device-pin', v_subject);

  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash  := encode(digest(v_token, 'sha256'), 'hex');

  insert into public.cashier_device_sessions (branch_id, cafe_id, token_hash, expires_at, last_seen_at)
  values (v_branch.id, v_branch.cafe_id, v_hash, now() + interval '12 hours', now());

  return jsonb_build_object(
    'ok', true,
    'device_token', v_token,
    'branch_id', v_branch.id,
    'branch_code', v_branch.branch_code,
    'branch_name', v_branch.name,
    'cafe_id', v_branch.cafe_id,
    'expires_at', (now() + interval '12 hours')
  );
end;
$$;

revoke all on function public.verify_cashier_device_pin(text, text) from public;
grant execute on function public.verify_cashier_device_pin(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Internal: validate device token for a branch
-- -----------------------------------------------------------------------------
create or replace function public._cashier_assert_device_session(
  p_device_token text,
  p_branch_id    uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token text := trim(coalesce(p_device_token, ''));
  v_hash  text;
  v_row   public.cashier_device_sessions%rowtype;
begin
  if char_length(v_token) < 32 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_device_token');
  end if;

  if p_branch_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_branch');
  end if;

  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  select s.* into v_row
  from public.cashier_device_sessions s
  where s.token_hash = v_hash
    and s.branch_id = p_branch_id
    and s.expires_at > now()
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'device_unauthorized');
  end if;

  update public.cashier_device_sessions
     set last_seen_at = now(),
         expires_at   = greatest(expires_at, now() + interval '12 hours')
   where id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'branch_id', v_row.branch_id,
    'cafe_id', v_row.cafe_id
  );
end;
$$;

revoke all on function public._cashier_assert_device_session(text, uuid) from public;

-- -----------------------------------------------------------------------------
-- Device-mode customer lookup (customer PIN at counter)
-- -----------------------------------------------------------------------------
create or replace function public.cashier_find_customer_by_device(
  p_device_token text,
  p_branch_id    uuid,
  p_pin          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate     jsonb;
  v_cafe_id  uuid;
  v_customer public.customers%rowtype;
  v_pin      text := trim(coalesce(p_pin, ''));
  v_subject  text;
  v_check    jsonb;
begin
  v_gate := public._cashier_assert_device_session(p_device_token, p_branch_id);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;

  v_cafe_id := (v_gate->>'cafe_id')::uuid;

  if v_pin !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pin');
  end if;

  v_subject := v_cafe_id::text || ':pin:' || v_pin;
  v_check := public.lockout_check('cashier:pin-only', v_subject, interval '1 minute', 5, interval '45 seconds');
  if (v_check->>'allowed')::boolean is distinct from true then
    return jsonb_build_object(
      'ok', false, 'reason', 'rate_limited',
      'retry_after_ms', coalesce((v_check->>'retry_after_ms')::int, 45000)
    );
  end if;

  select c.* into v_customer
  from public.customers c
  where c.cafe_id = v_cafe_id and c.pin_code = v_pin
  limit 1;

  if not found then
    perform public.lockout_register_failure(
      'cashier:pin-only', v_subject,
      interval '1 minute', 5, interval '45 seconds',
      'pin_mismatch'
    );
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform public.lockout_register_success('cashier:pin-only', v_subject);

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer.id,
    'cafe_id', v_customer.cafe_id,
    'full_name', v_customer.full_name,
    'current_streak', v_customer.current_streak,
    'longest_streak', v_customer.longest_streak,
    'shields', v_customer.shields
  );
end;
$$;

revoke all on function public.cashier_find_customer_by_device(text, uuid, text) from public;
grant execute on function public.cashier_find_customer_by_device(text, uuid, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Device-mode visit recording (delegates to record_visit_idempotent as service)
-- -----------------------------------------------------------------------------
create or replace function public.cashier_record_visit_by_device(
  p_device_token     text,
  p_branch_id          uuid,
  p_customer_id        uuid,
  p_idempotency_key    text,
  p_payload_sha256     text,
  p_event_type         public.visit_event_type default 'check_in',
  p_client_visit_date  date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_gate   jsonb;
  v_res    jsonb;
  v_cafe_id uuid;
  v_tz     text;
  v_today_cafe date;
  v_visit_date date;
  v_row_id uuid;
  v_streak_after int;
  v_visit_id uuid;
  v_engine jsonb := null;
  v_meta jsonb := '{}'::jsonb;
  v_current_streak int;
  v_already_today boolean := false;
  v_existing_visit uuid;
  v_existing_hash text;
begin
  v_gate := public._cashier_assert_device_session(p_device_token, p_branch_id);
  if coalesce((v_gate->>'ok')::boolean, false) is not true then
    return v_gate;
  end if;

  v_cafe_id := (v_gate->>'cafe_id')::uuid;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_idempotency_key');
  end if;

  if p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload_sha256');
  end if;

  if not exists (
    select 1 from public.customers cu
    where cu.id = p_customer_id and cu.cafe_id = v_cafe_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_in_cafe');
  end if;

  select c.timezone into v_tz from public.cafes c where c.id = v_cafe_id;
  v_today_cafe := (timezone(coalesce(nullif(trim(v_tz), ''), 'UTC'), now()))::date;
  v_visit_date := coalesce(p_client_visit_date, v_today_cafe);
  if v_visit_date > v_today_cafe then
    v_visit_date := v_today_cafe;
  end if;

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
    where vik.cafe_id = v_cafe_id and vik.idempotency_key = p_idempotency_key;

    if v_existing_hash is distinct from p_payload_sha256 then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_key_conflict');
    end if;

    return jsonb_build_object('status', 'replay', 'visit_id', v_existing_visit);
  end if;

  if coalesce(p_event_type, 'check_in'::public.visit_event_type) = 'check_in'::public.visit_event_type then
    v_engine := public.streakup_engine_process_check_in(v_cafe_id, p_customer_id, v_visit_date);
    v_streak_after := (v_engine->>'streak_after')::int;
    v_already_today := coalesce((v_engine->>'already_visited_today')::boolean, false);
    v_meta := v_engine;
  else
    select cu.current_streak into v_current_streak
    from public.customers cu where cu.id = p_customer_id;
    v_streak_after := coalesce(v_current_streak, 0);
    v_meta := jsonb_build_object('non_check_in', true);
  end if;

  if coalesce(p_event_type, 'check_in'::public.visit_event_type) = 'check_in'::public.visit_event_type then
    insert into public.visits (
      customer_id, cafe_id, branch_id, visit_date, streak_after, event_type, metadata
    )
    values (p_customer_id, v_cafe_id, p_branch_id, v_visit_date, v_streak_after, 'check_in', v_meta)
    on conflict (customer_id, cafe_id, visit_date)
      where event_type = 'check_in'::public.visit_event_type
    do nothing
    returning id into v_visit_id;

    if v_visit_id is null then
      select v.id into v_visit_id
      from public.visits v
      where v.customer_id = p_customer_id
        and v.cafe_id = v_cafe_id
        and v.visit_date = v_visit_date
        and v.event_type = 'check_in'::public.visit_event_type
      limit 1;

      update public.visit_idempotency_keys
      set status = 'completed'::public.idempotency_record_status, visit_id = v_visit_id
      where cafe_id = v_cafe_id and idempotency_key = p_idempotency_key;

      return jsonb_strip_nulls(jsonb_build_object(
        'status', 'already_checked_in',
        'visit_id', v_visit_id,
        'visit_date', v_visit_date,
        'streak_after', v_streak_after,
        'already_visited_today', true,
        'engine', v_engine,
        'event_type', 'check_in'
      ));
    end if;
  else
    insert into public.visits (
      customer_id, cafe_id, branch_id, visit_date, streak_after, event_type, metadata
    )
    values (p_customer_id, v_cafe_id, p_branch_id, v_visit_date, v_streak_after, p_event_type, v_meta)
    returning id into v_visit_id;
  end if;

  update public.visit_idempotency_keys
  set status = 'completed'::public.idempotency_record_status, visit_id = v_visit_id
  where cafe_id = v_cafe_id and idempotency_key = p_idempotency_key;

  insert into public.audit_log (
    cafe_id, branch_id, actor_user_id, actor_type, action, entity_type, entity_id, payload
  )
  values (
    v_cafe_id, p_branch_id, null, 'cashier_device',
    'visit.recorded', 'visit', v_visit_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'visit_date', v_visit_date,
      'streak_after', v_streak_after,
      'event_type', coalesce(p_event_type, 'check_in')::text
    )
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'status', 'created',
    'visit_id', v_visit_id,
    'visit_date', v_visit_date,
    'streak_after', v_streak_after,
    'already_visited_today', v_already_today,
    'engine', v_engine,
    'event_type', coalesce(p_event_type, 'check_in')
  ));
end;
$$;

revoke all on function public.cashier_record_visit_by_device(text, uuid, uuid, text, text, public.visit_event_type, date) from public;
grant execute on function public.cashier_record_visit_by_device(text, uuid, uuid, text, text, public.visit_event_type, date)
  to anon, authenticated;

-- record_visit_idempotent unchanged from phase39 (staff JWT / service_role only)
-- -----------------------------------------------------------------------------
-- Branch manager: branch-scoped metrics
-- -----------------------------------------------------------------------------
create or replace function public.branch_manager_branch_stats_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile   public.profiles%rowtype;
  v_branch    public.branches%rowtype;
  v_tz        text;
  v_today     date;
  v_visits_7  bigint;
  v_visits_td bigint;
  v_unique_30 bigint;
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

  select b.* into v_branch from public.branches b where b.id = v_profile.branch_id limit 1;
  if not found or v_branch.cafe_id is distinct from v_profile.cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select coalesce(nullif(trim(c.timezone), ''), 'UTC') into v_tz
  from public.cafes c where c.id = v_profile.cafe_id;

  v_today := (now() at time zone v_tz)::date;

  select count(*)::bigint into v_visits_td
  from public.visits v
  where v.branch_id = v_profile.branch_id
    and v.visit_date = v_today
    and v.event_type = 'check_in'::public.visit_event_type;

  select count(*)::bigint into v_visits_7
  from public.visits v
  where v.branch_id = v_profile.branch_id
    and v.visit_date >= v_today - 6
    and v.event_type = 'check_in'::public.visit_event_type;

  select count(distinct v.customer_id)::bigint into v_unique_30
  from public.visits v
  where v.branch_id = v_profile.branch_id
    and v.visit_date >= v_today - 29
    and v.event_type = 'check_in'::public.visit_event_type;

  return jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'branch_code', v_branch.branch_code,
    'branch_name', v_branch.name,
    'visits_today', v_visits_td,
    'visits_7d', v_visits_7,
    'unique_customers_30d', v_unique_30,
    'cafe_timezone', v_tz
  );
end;
$$;

revoke all on function public.branch_manager_branch_stats_secure() from public;
grant execute on function public.branch_manager_branch_stats_secure() to authenticated;

-- -----------------------------------------------------------------------------
-- Branch manager: list customers seen at this branch
-- -----------------------------------------------------------------------------
create or replace function public.branch_manager_list_customers_secure(
  p_search text default '',
  p_limit  int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_search  text := lower(trim(coalesce(p_search, '')));
  v_lim     int;
  v_off     int;
  v_total   bigint;
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

  v_lim := greatest(1, least(coalesce(p_limit, 50), 100));
  v_off := greatest(0, coalesce(p_offset, 0));

  select count(distinct c.id)::bigint into v_total
  from public.customers c
  where c.cafe_id = v_profile.cafe_id
    and exists (
      select 1 from public.visits v
      where v.customer_id = c.id
        and v.branch_id = v_profile.branch_id
    )
    and (
      v_search = ''
      or lower(coalesce(c.full_name, '')) like '%' || v_search || '%'
      or c.pin_code like '%' || v_search || '%'
    );

  select coalesce(jsonb_agg(row_data order by row_data->>'last_visit' desc nulls last), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', c.id,
      'full_name', coalesce(c.full_name, ''),
      'pin_code', c.pin_code,
      'current_streak', c.current_streak,
      'longest_streak', c.longest_streak,
      'shields', c.shields,
      'last_visit', lv.last_visit
    ) as row_data
    from public.customers c
    inner join lateral (
      select max(v.visit_date) as last_visit
      from public.visits v
      where v.customer_id = c.id
        and v.branch_id = v_profile.branch_id
        and v.event_type = 'check_in'::public.visit_event_type
    ) lv on true
    where c.cafe_id = v_profile.cafe_id
      and (
        v_search = ''
        or lower(coalesce(c.full_name, '')) like '%' || v_search || '%'
        or c.pin_code like '%' || v_search || '%'
      )
    order by lv.last_visit desc nulls last, c.full_name
    limit v_lim offset v_off
  ) sub;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'limit', v_lim,
    'offset', v_off,
    'rows', v_rows
  );
end;
$$;

revoke all on function public.branch_manager_list_customers_secure(text, int, int) from public;
grant execute on function public.branch_manager_list_customers_secure(text, int, int) to authenticated;

-- -----------------------------------------------------------------------------
-- Branch manager: adjust streak (disputes) — branch-scoped customers only
-- -----------------------------------------------------------------------------
create or replace function public.branch_manager_adjust_streak_secure(
  p_customer_id uuid,
  p_streak      int,
  p_note        text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile  public.profiles%rowtype;
  v_customer public.customers%rowtype;
  v_before   jsonb;
  v_after    jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = auth.uid() limit 1;
  if not found or v_profile.role <> 'branch_manager'::public.streakup_role then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_streak is null or p_streak < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_streak');
  end if;

  select * into v_customer
  from public.customers c
  where c.id = p_customer_id
  for update;

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

  v_before := jsonb_build_object(
    'current_streak', v_customer.current_streak,
    'longest_streak', v_customer.longest_streak
  );

  update public.customers
  set current_streak = p_streak,
      longest_streak = greatest(longest_streak, p_streak),
      updated_at = now()
  where id = p_customer_id
  returning * into v_customer;

  v_after := jsonb_build_object(
    'current_streak', v_customer.current_streak,
    'longest_streak', v_customer.longest_streak
  );

  insert into public.audit_log (
    cafe_id, branch_id, actor_user_id, actor_type, action, entity_type, entity_id, payload
  )
  values (
    v_profile.cafe_id, v_profile.branch_id, auth.uid(), 'user',
    'customer.branch_manager_override', 'customer', p_customer_id,
    jsonb_build_object(
      'before', v_before,
      'after', v_after,
      'note', nullif(trim(coalesce(p_note, '')), '')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'current_streak', v_customer.current_streak,
      'longest_streak', v_customer.longest_streak,
      'full_name', coalesce(v_customer.full_name, '')
    )
  );
end;
$$;

revoke all on function public.branch_manager_adjust_streak_secure(uuid, int, text) from public;
grant execute on function public.branch_manager_adjust_streak_secure(uuid, int, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Branch manager: broaden customer SELECT to anyone with a visit at their branch
-- (phase35 already does this; ensure policy name is current)
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
    and cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and exists (
      select 1 from public.visits v
      where v.customer_id = customers.id
        and v.branch_id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
    )
  )
);

-- branch_manager can update customers at their branch (streak disputes via UI + RPC)
drop policy if exists customers_update_branch_manager on public.customers;
create policy customers_update_branch_manager
on public.customers
for update
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
  or (
    (select p.role from public.profiles p where p.user_id = auth.uid()) = 'branch_manager'::public.streakup_role
    and cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and exists (
      select 1 from public.visits v
      where v.customer_id = customers.id
        and v.branch_id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
    )
  )
)
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
  or (
    (select p.role from public.profiles p where p.user_id = auth.uid()) = 'branch_manager'::public.streakup_role
    and cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and exists (
      select 1 from public.visits v
      where v.customer_id = customers.id
        and v.branch_id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
    )
  )
);

commit;
