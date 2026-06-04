-- =============================================================================
-- StreakUp — Phase 39: Security lockdown (red-team remediation)
--
-- Fixes (backend only):
--   V-01  profiles role/cafe/branch immutability for non–service_role
--   V-02  (reverted) customer portal retains pin_code for in-store cashier UX
--   V-03  Block direct PostgREST INSERT on public.visits (RPC path only)
--   V-05  Coerce future p_client_visit_date to café-local today
--
-- Run AFTER phase38_consent_hotfix.sql in the Supabase SQL editor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- V-01: Privilege escalation guard on profiles
-- -----------------------------------------------------------------------------
create or replace function public.profiles_lock_role_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    if new.role is distinct from old.role
       or new.cafe_id is distinct from old.cafe_id
       or new.branch_id is distinct from old.branch_id then
      raise exception 'profiles_role_scope_immutable'
        using hint = 'role, cafe_id, and branch_id may only be changed by platform provisioning';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_lock_role_scope_bu on public.profiles;
create trigger profiles_lock_role_scope_bu
before update on public.profiles
for each row execute function public.profiles_lock_role_scope();

-- -----------------------------------------------------------------------------
-- V-02: customer_portal_begin — full phase38 contract (includes pin_code for portal UI)
-- -----------------------------------------------------------------------------
create or replace function public.customer_portal_begin(
  p_slug text,
  p_phone text default null,
  p_name text default null,
  p_session_token text default null,
  p_terms_accepted boolean default null,
  p_privacy_accepted boolean default null
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
  v_grace_today   boolean := false;
  v_tz            text;
  v_next_midnight timestamptz;
  v_streak_expiry timestamptz;
  v_now           timestamptz := now();
begin
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

  v_tz := coalesce(nullif(trim(v_cafe.timezone), ''), 'UTC');

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

      if v_customer.terms_accepted_at is null or v_customer.privacy_accepted_at is null then
        if coalesce(p_terms_accepted, false) is not true or coalesce(p_privacy_accepted, false) is not true then
          return jsonb_build_object('ok', false, 'error', 'legal_consent_required');
        end if;
        update public.customers
        set terms_accepted_at   = coalesce(terms_accepted_at, v_now),
            privacy_accepted_at = coalesce(privacy_accepted_at, v_now),
            updated_at          = now()
        where id = v_customer_id;
        select cu.* into v_customer from public.customers cu where cu.id = v_customer_id;
      end if;

      if char_length(v_name) >= 2 and coalesce(trim(v_customer.full_name), '') = '' then
        update public.customers set full_name = left(v_name, 120) where id = v_customer.id;
        v_customer.full_name := left(v_name, 120);
      end if;
    else
      if coalesce(p_terms_accepted, false) is not true or coalesce(p_privacy_accepted, false) is not true then
        return jsonb_build_object('ok', false, 'error', 'legal_consent_required');
      end if;

      if char_length(v_name) < 2 then
        perform public.lockout_register_failure(
          'portal:phone', v_subject, interval '1 minute', 12, interval '45 seconds', 'name_required'
        );
        return jsonb_build_object('ok', false, 'error', 'name_required');
      end if;

      insert into public.customers (
        cafe_id, phone, full_name, terms_accepted_at, privacy_accepted_at
      )
      values (v_cafe.id, v_phone, left(v_name, 120), v_now, v_now)
      returning id into v_customer_id;

      select cu.* into v_customer from public.customers cu where cu.id = v_customer_id;
      v_created := true;
    end if;

    perform public.lockout_register_success('portal:phone', v_subject);
  else
    if v_customer.terms_accepted_at is null or v_customer.privacy_accepted_at is null then
      return jsonb_build_object('ok', false, 'error', 'legal_consent_required');
    end if;
  end if;

  if v_customer_id is null or v_customer.id is null then
    return jsonb_build_object('ok', false, 'error', 'customer_resolution_failed');
  end if;

  perform public._sync_customer_physical_rewards(v_cafe.id, v_customer_id);

  select cu.* into v_customer
  from public.customers cu
  where cu.id = v_customer_id;

  v_new_token := encode(gen_random_bytes(24), 'hex');
  v_new_hash  := encode(digest(v_new_token, 'sha256'), 'hex');

  insert into public.customer_portal_sessions (cafe_id, customer_id, token_hash, expires_at, last_seen_at)
  values (v_cafe.id, v_customer_id, v_new_hash, now() + interval '90 days', now())
  on conflict (customer_id) do update
     set token_hash   = excluded.token_hash,
         cafe_id      = excluded.cafe_id,
         expires_at   = excluded.expires_at,
         last_seen_at = excluded.last_seen_at;

  v_today := (now() at time zone v_tz)::date;
  v_grace_today := public.cafe_date_is_grace(v_cafe.grace_days, v_cafe.off_days, v_today);

  select max(v.visit_date) into v_last_visit
  from public.visits v
  where v.customer_id = v_customer_id
    and v.cafe_id     = v_cafe.id
    and v.event_type  = 'check_in'::public.visit_event_type;

  v_visited_today := (v_last_visit is not null and v_last_visit = v_today);

  if v_visited_today then
    v_next_midnight := ((v_today + 1)::timestamp at time zone v_tz);
    v_streak_expiry := case
      when v_customer.current_streak > 0 then ((v_today + 2)::timestamp at time zone v_tz)
      else null
    end;
  else
    v_next_midnight := now();
    v_streak_expiry := case
      when v_customer.current_streak > 0 then ((v_today + 1)::timestamp at time zone v_tz)
      else null
    end;
  end if;

  v_milestones := public.customer_portal_milestones_for_customer(
    v_cafe.id, v_customer.id, v_customer.current_streak
  );

  return jsonb_build_object(
    'ok',                  true,
    'customer_id',         v_customer.id,
    'cafe_id',             v_customer.cafe_id,
    'current_streak',      v_customer.current_streak,
    'longest_streak',      v_customer.longest_streak,
    'shields',             v_customer.shields,
    'milestones',          v_milestones,
    'pin_code',            v_customer.pin_code,
    'display_name',        coalesce(v_customer.full_name, ''),
    'is_new',              v_created,
    'resumed',             v_resumed,
    'session_token',       v_new_token,
    'last_visit_date',     v_last_visit,
    'visited_today',       v_visited_today,
    'is_grace_day_today',  v_grace_today,
    'grace_days',          case
      when cardinality(v_cafe.grace_days) > 0 then v_cafe.grace_days
      else coalesce(v_cafe.off_days, '{}'::smallint[])
    end,
    'cafe_timezone',       v_tz,
    'next_visit_opens_at', v_next_midnight,
    'streak_expires_at',   v_streak_expiry
  );
end;
$$;

revoke all on function public.customer_portal_begin(text, text, text, text, boolean, boolean) from public;
grant execute on function public.customer_portal_begin(text, text, text, text, boolean, boolean) to anon, authenticated;

-- V-02: Dedicated resume entrypoint (delegates to begin; includes pin_code via begin)
create or replace function public.customer_portal_resume(
  p_slug text,
  p_session_token text
)
returns jsonb
language sql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
  select public.customer_portal_begin(
    p_slug,
    null::text,
    null::text,
    p_session_token,
    null::boolean,
    null::boolean
  );
$$;

revoke all on function public.customer_portal_resume(text, text) from public;
grant execute on function public.customer_portal_resume(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- V-03: Visits must be ingested via record_visit_idempotent (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
drop policy if exists visits_insert_scoped on public.visits;

revoke insert on table public.visits from authenticated;
revoke insert on table public.visits from anon;

-- -----------------------------------------------------------------------------
-- V-05: record_visit_idempotent — clamp future client visit dates to café today
-- -----------------------------------------------------------------------------
create or replace function public.record_visit_idempotent(
  p_branch_id         uuid,
  p_customer_id       uuid,
  p_idempotency_key   text,
  p_payload_sha256    text,
  p_event_type        public.visit_event_type default 'check_in',
  p_client_visit_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cafe_id          uuid;
  v_tz               text;
  v_today_cafe       date;
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
  v_today_cafe := (timezone(coalesce(nullif(trim(v_tz), ''), 'UTC'), now()))::date;
  v_visit_date := coalesce(p_client_visit_date, v_today_cafe);

  -- V-05: no time-travel into the future (coerce silently to café-local today)
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

  if p_event_type = 'check_in'::public.visit_event_type then
    insert into public.visits (
      customer_id, cafe_id, branch_id, visit_date, streak_after, event_type, metadata
    )
    values (p_customer_id, v_cafe_id, p_branch_id, v_visit_date, v_streak_after, p_event_type, v_meta)
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
      set status   = 'completed'::public.idempotency_record_status,
          visit_id = v_visit_id
      where id = v_row_id;

      return jsonb_strip_nulls(jsonb_build_object(
        'status', 'already_checked_in',
        'visit_id', v_visit_id,
        'visit_date', v_visit_date,
        'streak_after', v_streak_after,
        'already_visited_today', true,
        'engine', v_engine,
        'event_type', p_event_type
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
      'idempotency_key',       p_idempotency_key,
      'payload_sha256',        p_payload_sha256,
      'visit_date',            v_visit_date,
      'streak_after',          v_streak_after,
      'already_visited_today', v_already_today,
      'engine',                v_engine,
      'event_type',            p_event_type
    )
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'status',                'created',
    'visit_id',              v_visit_id,
    'visit_date',            v_visit_date,
    'streak_after',          v_streak_after,
    'already_visited_today', v_already_today,
    'engine',                v_engine,
    'event_type',            p_event_type
  ));
end;
$$;

revoke all on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date) from public;
grant execute on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date)
  to authenticated, service_role;

commit;
