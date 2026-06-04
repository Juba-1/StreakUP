-- =============================================================================
-- StreakUp — Phase 34: Legal consent tracking (PDPL-aligned SaaS shield)
--
-- · terms_accepted_at / privacy_accepted_at on customers, cafes, profiles
-- · record_legal_consent_secure — staff login (profiles + cafe for HQ owners)
-- · customer_portal_begin — blocks without explicit consent on enroll / refresh
-- Run AFTER phase33_reward_integrity.sql
-- =============================================================================

begin;

alter table public.customers
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_accepted_at timestamptz;

alter table public.cafes
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_accepted_at timestamptz;

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_accepted_at timestamptz;

comment on column public.customers.terms_accepted_at is 'Customer accepted StreakUp Terms of Service.';
comment on column public.customers.privacy_accepted_at is 'Customer accepted StreakUp Privacy Policy.';
comment on column public.cafes.terms_accepted_at is 'Café business accepted StreakUp terms (HQ owner).';
comment on column public.cafes.privacy_accepted_at is 'Café business accepted StreakUp privacy policy (HQ owner).';

-- Grandfather existing rows (Concierge MVP — avoids locking out current users until they re-accept on next login UI)
update public.profiles
set terms_accepted_at  = coalesce(terms_accepted_at, created_at),
    privacy_accepted_at = coalesce(privacy_accepted_at, created_at);

update public.customers
set terms_accepted_at  = coalesce(terms_accepted_at, created_at),
    privacy_accepted_at = coalesce(privacy_accepted_at, created_at);

update public.cafes
set terms_accepted_at  = coalesce(terms_accepted_at, created_at),
    privacy_accepted_at = coalesce(privacy_accepted_at, created_at);

-- -----------------------------------------------------------------------------
-- Record staff consent (LoginPage — HQ, cashier, branch, super admin)
-- -----------------------------------------------------------------------------
create or replace function public.record_legal_consent_secure()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
  v_now     timestamptz := now();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = v_uid limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  update public.profiles
  set terms_accepted_at  = coalesce(terms_accepted_at, v_now),
      privacy_accepted_at = coalesce(privacy_accepted_at, v_now),
      updated_at         = now()
  where user_id = v_uid;

  if v_profile.role = 'hq_owner'::public.streakup_role and v_profile.cafe_id is not null then
    update public.cafes
    set terms_accepted_at  = coalesce(terms_accepted_at, v_now),
        privacy_accepted_at = coalesce(privacy_accepted_at, v_now),
        updated_at         = now()
    where id = v_profile.cafe_id;
  end if;

  return jsonb_build_object('ok', true, 'recorded_at', v_now);
end;
$$;

revoke all on function public.record_legal_consent_secure() from public;
grant execute on function public.record_legal_consent_secure() to authenticated;

-- -----------------------------------------------------------------------------
-- Staff bootstrap — require recorded consent (except fresh super_admin bootstrap)
-- -----------------------------------------------------------------------------
create or replace function public.staff_bootstrap_path()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_slug text;
  v_branch_code text;
  v_path text;
  v_status public.cafe_status;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'path', '/login', 'role', null, 'reason', 'not_authenticated');
  end if;

  v_profile := public.streakup_profile();

  if v_profile is null then
    return jsonb_build_object('ok', false, 'path', '/login', 'role', null, 'reason', 'no_profile');
  end if;

  if v_profile.terms_accepted_at is null or v_profile.privacy_accepted_at is null then
    return jsonb_build_object(
      'ok', false,
      'path', '/login',
      'role', v_profile.role::text,
      'reason', 'legal_consent_required'
    );
  end if;

  if v_profile.role = 'super_admin'::public.streakup_role then
    return jsonb_build_object('ok', true, 'path', '/admin/overview', 'role', v_profile.role::text);
  end if;

  if v_profile.role = 'hq_owner'::public.streakup_role then
    if v_profile.cafe_id is null then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_cafe');
    end if;
    select c.slug, c.status into v_slug, v_status
    from public.cafes c
    where c.id = v_profile.cafe_id
    limit 1;
    if v_slug is null or length(trim(v_slug)) = 0 then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_slug');
    end if;
    if v_status is distinct from 'active'::public.cafe_status then
      return jsonb_build_object(
        'ok', false,
        'path', '/login',
        'role', v_profile.role::text,
        'reason', 'cafe_inactive',
        'cafe_status', v_status::text
      );
    end if;
    return jsonb_build_object('ok', true, 'path', '/hq/' || trim(v_slug), 'role', v_profile.role::text);
  end if;

  if v_profile.role in ('branch_manager'::public.streakup_role, 'cashier'::public.streakup_role) then
    if v_profile.branch_id is null then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_branch');
    end if;
    select b.branch_code, c.status
    into v_branch_code, v_status
    from public.branches b
    inner join public.cafes c on c.id = b.cafe_id
    where b.id = v_profile.branch_id
    limit 1;
    if v_branch_code is null or length(trim(v_branch_code)) = 0 then
      return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'missing_branch_code');
    end if;
    if v_status is distinct from 'active'::public.cafe_status then
      return jsonb_build_object(
        'ok', false,
        'path', '/login',
        'role', v_profile.role::text,
        'reason', 'cafe_inactive',
        'cafe_status', v_status::text
      );
    end if;
    v_path := case v_profile.role
      when 'branch_manager'::public.streakup_role then '/branch/' || trim(v_branch_code)
      else '/cashier/' || trim(v_branch_code)
    end;
    return jsonb_build_object('ok', true, 'path', v_path, 'role', v_profile.role::text);
  end if;

  return jsonb_build_object('ok', false, 'path', '/login', 'role', v_profile.role::text, 'reason', 'unknown_role');
end;
$$;

-- -----------------------------------------------------------------------------
-- Customer portal — consent gate + patch signature
-- -----------------------------------------------------------------------------
drop function if exists public.customer_portal_begin(text, text, text, text);

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
  v_need_consent  boolean := false;
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
    v_need_consent := true;

    if coalesce(p_terms_accepted, false) is not true or coalesce(p_privacy_accepted, false) is not true then
      return jsonb_build_object('ok', false, 'error', 'legal_consent_required');
    end if;

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
        set terms_accepted_at  = coalesce(terms_accepted_at, v_now),
            privacy_accepted_at = coalesce(privacy_accepted_at, v_now),
            updated_at         = now()
        where id = v_customer_id;
        select cu.* into v_customer from public.customers cu where cu.id = v_customer_id;
      end if;
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

commit;
