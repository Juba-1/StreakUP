-- =============================================================================
-- StreakUp — Phase 2 (run AFTER `supabase/init.sql` on the same database)
-- Paste into Supabase SQL Editor as a single script, or: supabase db execute
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Fix invalid CHECK constraint on profiles (PG forbids subqueries in CHECK)
-- -----------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_branch_cafe_fk;

create or replace function public.profiles_validate_branch_cafe()
returns trigger
language plpgsql
as $$
begin
  if new.branch_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.branches b
    where b.id = new.branch_id
      and b.cafe_id = new.cafe_id
  ) then
    raise exception 'profiles_branch_cafe_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_validate_branch_cafe_bi on public.profiles;
create trigger profiles_validate_branch_cafe_bi
before insert or update of cafe_id, branch_id on public.profiles
for each row execute function public.profiles_validate_branch_cafe();

-- -----------------------------------------------------------------------------
-- Rewards uniqueness (milestones are earned once per customer)
-- -----------------------------------------------------------------------------
create unique index if not exists rewards_customer_milestone_uidx
  on public.rewards (customer_id, milestone_id);

-- -----------------------------------------------------------------------------
-- Auth → profiles provisioning (reads auth.users.raw_user_meta_data for display only;
-- authorization keys MUST live under raw_app_meta_data / app_metadata)
-- -----------------------------------------------------------------------------
create or replace function public.upsert_profile_from_auth_user(p_user auth.users)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_meta jsonb;
  v_nested jsonb := '{}'::jsonb;
  v_role text;
  v_cafe uuid;
  v_branch uuid;
  v_display text;
  v_phone text;
begin
  v_meta := coalesce(p_user.raw_app_meta_data, '{}'::jsonb);

  if (v_meta ? 'streakup') then
    v_nested := coalesce(v_meta->'streakup', '{}'::jsonb);
    v_role := v_nested->>'role';
    v_cafe := nullif(v_nested->>'cafe_id', '')::uuid;
    v_branch := nullif(v_nested->>'branch_id', '')::uuid;
  else
    v_role := v_meta->>'streakup_role';
    v_cafe := nullif(v_meta->>'cafe_id', '')::uuid;
    v_branch := nullif(v_meta->>'branch_id', '')::uuid;
  end if;

  if v_role is null then
    return;
  end if;

  v_display := coalesce(
    nullif(trim(coalesce(p_user.raw_user_meta_data->>'full_name', '')), ''),
    split_part(p_user.email, '@', 1)
  );

  insert into public.profiles (user_id, role, cafe_id, branch_id, display_name)
  values (
    p_user.id,
    v_role::public.streakup_role,
    v_cafe,
    v_branch,
    v_display
  )
  on conflict (user_id) do update
    set role = excluded.role,
        cafe_id = excluded.cafe_id,
        branch_id = excluded.branch_id,
        display_name = coalesce(excluded.display_name, public.profiles.display_name),
        updated_at = now();

  if (v_role::public.streakup_role = 'customer'::public.streakup_role) then
    v_phone := nullif(trim(coalesce(v_nested->>'phone', v_meta->>'customer_phone', '')), '');
    if v_phone is not null and v_cafe is not null then
      update public.customers c
      set auth_user_id = p_user.id,
          updated_at = now()
      where c.cafe_id = v_cafe
        and c.phone = v_phone
        and c.auth_user_id is null;
    end if;
  end if;
exception
  when others then
    raise warning 'streakup upsert_profile_from_auth_user failed for %: %', p_user.id, sqlerrm;
end;
$$;

revoke all on function public.upsert_profile_from_auth_user(auth.users) from public;

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
begin
  perform public.upsert_profile_from_auth_user(new);
  return new;
end;
$$;

revoke all on function public.handle_auth_user_created() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_auth_user_created();

create or replace function public.handle_auth_user_app_metadata_updated()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
begin
  if new.raw_app_meta_data is distinct from old.raw_app_meta_data then
    perform public.upsert_profile_from_auth_user(new);
  end if;
  return new;
end;
$$;

revoke all on function public.handle_auth_user_app_metadata_updated() from public;

drop trigger if exists on_auth_user_app_metadata_updated on auth.users;
create trigger on_auth_user_app_metadata_updated
after update of raw_app_meta_data on auth.users
for each row execute function public.handle_auth_user_app_metadata_updated();

-- -----------------------------------------------------------------------------
-- Enterprise API key verification (Edge service-role only)
-- -----------------------------------------------------------------------------
create or replace function public.verify_enterprise_api_key(
  p_public_prefix text,
  p_secret text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.api_keys%rowtype;
  v_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_public_prefix is null
    or p_secret is null
    or length(trim(p_public_prefix)) < 4
    or length(trim(p_secret)) < 16 then
    return jsonb_build_object('valid', false, 'reason', 'invalid_shape');
  end if;

  v_hash := encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex');

  select *
  into v_row
  from public.api_keys k
  where k.public_prefix = p_public_prefix
    and k.revoked_at is null
    and k.secret_hash = v_hash
  limit 1;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'valid', true,
    'cafe_id', v_row.cafe_id,
    'api_key_id', v_row.id,
    'scopes', to_jsonb(v_row.scopes)
  );
end;
$$;

revoke all on function public.verify_enterprise_api_key(text, text) from public;
grant execute on function public.verify_enterprise_api_key(text, text) to service_role;

-- -----------------------------------------------------------------------------
-- HQ dashboard context for AI (no raw PII; aggregated + branch rollups)
-- -----------------------------------------------------------------------------
create or replace function public.hq_dashboard_ai_context()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_cafe_id uuid;
  v_window_start date := (now() at time zone 'utc')::date - 30;
begin
  v_profile := public.streakup_profile();
  if v_profile is null then
    raise exception 'not_authenticated';
  end if;

  if v_profile.role = 'super_admin'::public.streakup_role then
    raise exception 'forbidden';
  elsif v_profile.role = 'hq_owner'::public.streakup_role then
    v_cafe_id := v_profile.cafe_id;
  else
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'cafe_id', v_cafe_id,
    'window_days', 30,
    'branches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'branch_id', b.id,
          'branch_code', b.branch_code,
          'name', b.name,
          'visits_30d', coalesce(vc.cnt, 0),
          'unique_customers_30d', coalesce(vc.uq, 0)
        )
        order by b.branch_code
      )
      from public.branches b
      left join lateral (
        select
          count(*)::bigint as cnt,
          count(distinct v.customer_id)::bigint as uq
        from public.visits v
        where v.branch_id = b.id
          and v.visit_date >= v_window_start
          and v.event_type = 'check_in'::public.visit_event_type
      ) vc on true
      where b.cafe_id = v_cafe_id
    ), '[]'::jsonb),
    'cafe_totals', (
      select jsonb_build_object(
        'customers', count(*)::bigint,
        'active_customers_30d', count(*) filter (
          where exists (
            select 1
            from public.visits vv
            where vv.customer_id = c.id
              and vv.visit_date >= v_window_start
              and vv.event_type = 'check_in'::public.visit_event_type
          )
        )
      )
      from public.customers c
      where c.cafe_id = v_cafe_id
    )
  );
end;
$$;

revoke all on function public.hq_dashboard_ai_context() from public;
grant execute on function public.hq_dashboard_ai_context() to authenticated;

-- -----------------------------------------------------------------------------
-- Real streak engine (HQ-local calendar dates; cross-branch continuity)
-- -----------------------------------------------------------------------------
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
  v_cafe public.cafes%rowtype;
  v_cust public.customers%rowtype;
  v_last date;
  v_diff int;
  v_new_streak int;
  v_new_shields int;
  v_consumed boolean := false;
  v_awarded boolean := false;
  v_frozen boolean := false;
  v_dow int;
  v_cap int;
  v_milestones jsonb := '[]'::jsonb;
  v_prev_streak int;
  v_m record;
begin
  select * into v_cafe from public.cafes where id = p_cafe_id for share;
  if not found then
    raise exception 'cafe_not_found';
  end if;

  select * into v_cust from public.customers where id = p_customer_id and cafe_id = p_cafe_id for update;
  if not found then
    raise exception 'customer_not_found';
  end if;

  v_prev_streak := v_cust.current_streak;
  v_new_shields := v_cust.shields;

  v_dow := extract(dow from p_visit_date)::int;
  if v_cafe.off_days is not null
    and cardinality(v_cafe.off_days) > 0
    and v_cafe.off_days @> array[v_dow::smallint] then
    v_frozen := true;
    v_new_streak := v_cust.current_streak;
  else
    select max(v.visit_date)
    into v_last
    from public.visits v
    where v.customer_id = p_customer_id
      and v.cafe_id = p_cafe_id
      and v.event_type = 'check_in'::public.visit_event_type;

    if v_last is null then
      v_new_streak := 1;
    elsif p_visit_date = v_last then
      v_new_streak := v_cust.current_streak;
    elsif p_visit_date < v_last then
      v_new_streak := v_cust.current_streak;
    else
      v_diff := (p_visit_date - v_last);
      if v_diff = 1 then
        v_new_streak := v_cust.current_streak + 1;
      elsif v_diff = 2 then
        if v_cust.shields > 0 then
          v_new_shields := v_cust.shields - 1;
          v_consumed := true;
          v_new_streak := v_cust.current_streak + 1;
        else
          v_new_streak := 1;
        end if;
      else
        v_new_streak := 1;
      end if;
    end if;

    if (not v_frozen) and v_new_streak > v_prev_streak then
      if v_cafe.shield_every is not null
        and v_cafe.shield_every > 0
        and v_new_streak > 0
        and v_new_streak % v_cafe.shield_every = 0 then
        v_cap := coalesce(v_cafe.max_shields, 2147483647);
        if v_new_shields < v_cap then
          v_new_shields := v_new_shields + 1;
          v_awarded := true;
        end if;
      end if;
    end if;
  end if;

  update public.customers
  set current_streak = v_new_streak,
      longest_streak = greatest(longest_streak, v_new_streak),
      shields = v_new_shields,
      updated_at = now()
  where id = p_customer_id
    and cafe_id = p_cafe_id;

  if (not v_frozen) and v_new_streak > v_prev_streak then
    for v_m in
      select rm.id, rm.name, rm.days_required
      from public.reward_milestones rm
      where rm.cafe_id = p_cafe_id
        and rm.active
        and rm.days_required <= v_new_streak
        and rm.days_required > v_prev_streak
      order by rm.sort_order, rm.days_required
    loop
      insert into public.rewards (
        cafe_id,
        customer_id,
        milestone_id,
        earned_at
      )
      values (
        p_cafe_id,
        p_customer_id,
        v_m.id,
        now()
      )
      on conflict (customer_id, milestone_id) do update
        set earned_at = coalesce(public.rewards.earned_at, excluded.earned_at),
            updated_at = now();

      v_milestones := v_milestones || jsonb_build_array(
        jsonb_build_object(
          'milestone_id',
          v_m.id,
          'name',
          v_m.name,
          'days_required',
          v_m.days_required
        )
      );
    end loop;
  end if;

  return jsonb_build_object(
    'streak_after', v_new_streak,
    'shields_after', v_new_shields,
    'shield_consumed', v_consumed,
    'shield_awarded', v_awarded,
    'off_day_freeze', v_frozen,
    'dow', v_dow,
    'milestones', coalesce(v_milestones, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.streakup_engine_process_check_in(uuid, uuid, date) from public;

-- -----------------------------------------------------------------------------
-- Replace visit RPC to use the real engine + richer audit payloads
-- -----------------------------------------------------------------------------
create or replace function public.record_visit_idempotent(
  p_branch_id uuid,
  p_customer_id uuid,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_event_type public.visit_event_type default 'check_in',
  p_client_visit_date date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cafe_id uuid;
  v_tz text;
  v_visit_date date;
  v_existing_visit uuid;
  v_existing_hash text;
  v_row_id uuid;
  v_streak_after int;
  v_visit_id uuid;
  v_profile public.profiles;
  v_engine jsonb := null;
  v_meta jsonb := '{}'::jsonb;
  v_current_streak int;
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

  select b.cafe_id into v_cafe_id
  from public.branches b
  where b.id = p_branch_id;

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

  insert into public.visit_idempotency_keys (
    cafe_id,
    idempotency_key,
    payload_sha256,
    customer_id,
    branch_id,
    status
  )
  values (
    v_cafe_id,
    p_idempotency_key,
    p_payload_sha256,
    p_customer_id,
    p_branch_id,
    'pending'::public.idempotency_record_status
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

    return jsonb_build_object(
      'status', 'replay',
      'visit_id', v_existing_visit
    );
  end if;

  if not exists (
    select 1
    from public.customers cu
    where cu.id = p_customer_id
      and cu.cafe_id = v_cafe_id
  ) then
    update public.visit_idempotency_keys
    set status = 'failed'::public.idempotency_record_status,
        error = 'customer_not_in_cafe'
    where id = v_row_id;

    raise exception 'customer_not_in_cafe';
  end if;

  if p_event_type = 'check_in'::public.visit_event_type then
    v_engine := public.streakup_engine_process_check_in(v_cafe_id, p_customer_id, v_visit_date);
    v_streak_after := (v_engine->>'streak_after')::int;
    v_meta := v_engine;
  else
    select cu.current_streak into v_current_streak
    from public.customers cu
    where cu.id = p_customer_id
      and cu.cafe_id = v_cafe_id;

    v_streak_after := coalesce(v_current_streak, 0);
    v_meta := jsonb_build_object('non_check_in', true);
  end if;

  insert into public.visits (
    customer_id,
    cafe_id,
    branch_id,
    visit_date,
    streak_after,
    event_type,
    metadata
  )
  values (
    p_customer_id,
    v_cafe_id,
    p_branch_id,
    v_visit_date,
    v_streak_after,
    p_event_type,
    v_meta
  )
  returning id into v_visit_id;

  update public.visit_idempotency_keys
  set status = 'completed'::public.idempotency_record_status,
      visit_id = v_visit_id
  where id = v_row_id;

  insert into public.audit_log (
    cafe_id,
    branch_id,
    actor_user_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    payload
  )
  values (
    v_cafe_id,
    p_branch_id,
    auth.uid(),
    case when auth.role() = 'service_role' then 'service_role' else 'user' end,
    'visit.recorded',
    'visit',
    v_visit_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'payload_sha256', p_payload_sha256,
      'visit_date', v_visit_date,
      'streak_after', v_streak_after,
      'engine', v_engine,
      'event_type', p_event_type
    )
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'status', 'created',
    'visit_id', v_visit_id,
    'visit_date', v_visit_date,
    'streak_after', v_streak_after,
    'engine', v_engine,
    'event_type', p_event_type
  ));
end;
$$;

revoke all on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date)
  from public;
grant execute on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date)
  to authenticated, service_role;

drop function if exists public.streakup_compute_streak_after_stub(uuid, uuid, date);

commit;
