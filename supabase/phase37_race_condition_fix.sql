-- =============================================================================
-- StreakUp — Phase 37: Concurrency hardening (anti double-tap)
--
-- Goals (NON-BREAKING):
--   1) Make it physically impossible to record two `check_in` visits for the
--      same customer on the same cafe-local calendar day.
--   2) Ensure `record_visit_idempotent` handles the uniqueness conflict
--      gracefully (returns a stable response; does not throw).
--
-- Notes on "cafe timezone":
--   - `record_visit_idempotent` computes `v_visit_date` using the cafe's
--     configured timezone, so `public.visits.visit_date` is already the
--     cafe-local calendar date. The unique index below enforces that rule.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Physical uniqueness: one check-in per customer per cafe per day
-- -----------------------------------------------------------------------------
-- Partial unique index keeps other visit event types flexible.
create unique index if not exists visits_one_checkin_per_day_uidx
  on public.visits (customer_id, cafe_id, visit_date)
  where event_type = 'check_in'::public.visit_event_type;

comment on index public.visits_one_checkin_per_day_uidx is
  'Concurrency lock: physically prevents duplicate same-day check_ins per (customer, cafe). visit_date is cafe-local.';

-- -----------------------------------------------------------------------------
-- 2) RPC patch: treat uniqueness conflicts as "already_checked_in"
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

  -- Idempotency key reservation (still used for transport retries / offline replays)
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

  -- Insert visit. For check-ins, the unique index enforces one-per-day and we
  -- treat conflicts as a clean "already_checked_in" response.
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
      -- Another request already inserted today's check-in.
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

