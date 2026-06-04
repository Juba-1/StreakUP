-- =============================================================================
-- StreakUp — Phase 20: Shield grants (column-driven), CRM list, portal timers
--
--  1. reward_milestones.shield_grant_amount — integer grants (no string parsing).
--  2. streakup_engine_process_check_in — grant shields from that column.
--  3. hq_list_customers_secure — LEFT JOIN visit rollup; all cafe customers.
--  4. customer_portal_begin — cafe_timezone + countdown anchor timestamps.
-- Safe to re-run (IF NOT EXISTS / create or replace).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Schema: explicit shield grants per milestone
-- ---------------------------------------------------------------------------
alter table public.reward_milestones
  add column if not exists shield_grant_amount int not null default 0;

alter table public.reward_milestones
  drop constraint if exists reward_milestones_shield_grant_chk;

alter table public.reward_milestones
  add constraint reward_milestones_shield_grant_chk
  check (shield_grant_amount >= 0);

comment on column public.reward_milestones.shield_grant_amount is
  'Streak shields awarded when this milestone is first unlocked (0 = none).';

-- Remove the discarded string-matching helper from the bad Phase 20 attempt.
drop function if exists public.milestone_shield_grant(text, text);

-- ---------------------------------------------------------------------------
-- Engine — milestone shield grants from shield_grant_amount column
-- ---------------------------------------------------------------------------
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
  v_milestone_shields  int := 0;
  v_frozen             boolean := false;
  v_already_today      boolean := false;
  v_dow                int;
  v_cap                int;
  v_milestones         jsonb := '[]'::jsonb;
  v_prev_streak        int;
  v_grant              int;
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

  v_prev_streak := v_cust.current_streak;
  v_new_shields := v_cust.shields;

  v_dow := extract(dow from p_visit_date)::int;
  if v_cafe.off_days is not null
    and cardinality(v_cafe.off_days) > 0
    and v_cafe.off_days @> array[v_dow::smallint] then
    v_frozen     := true;
    v_new_streak := v_cust.current_streak;
  else
    select max(v.visit_date) into v_last
    from public.visits v
    where v.customer_id = p_customer_id
      and v.cafe_id     = p_cafe_id
      and v.event_type  = 'check_in'::public.visit_event_type;

    if v_last is null then
      v_new_streak := 1;
    elsif p_visit_date = v_last then
      v_new_streak    := v_cust.current_streak;
      v_already_today := true;
    elsif p_visit_date < v_last then
      v_new_streak := v_cust.current_streak;
    else
      v_diff := (p_visit_date - v_last);

      if v_diff = 1 then
        v_new_streak := v_cust.current_streak + 1;
      elsif v_diff = 2 then
        if v_cust.shields > 0 then
          v_new_shields := v_cust.shields - 1;
          v_consumed    := true;
          v_new_streak  := v_cust.current_streak + 1;
        else
          v_new_streak := 1;
        end if;
      else
        v_new_streak := 1;
      end if;
    end if;

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

  if (not v_frozen) and (not v_already_today) and v_new_streak > v_prev_streak then
    for v_m in
      select rm.id, rm.name, rm.days_required, rm.shield_grant_amount
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

      v_grant := greatest(0, coalesce(v_m.shield_grant_amount, 0));
      if v_grant > 0 then
        v_milestone_shields := v_milestone_shields + v_grant;
      end if;

      v_milestones := v_milestones || jsonb_build_array(
        jsonb_build_object(
          'milestone_id',      v_m.id,
          'name',              v_m.name,
          'days_required',     v_m.days_required,
          'shields_granted',   v_grant
        )
      );
    end loop;

    if v_milestone_shields > 0 then
      v_cap := coalesce(v_cafe.max_shields, 2147483647);
      v_new_shields := least(v_cap, v_new_shields + v_milestone_shields);
      v_awarded     := true;
    end if;
  end if;

  update public.customers
  set current_streak = v_new_streak,
      longest_streak = greatest(longest_streak, v_new_streak),
      shields        = v_new_shields,
      updated_at     = now()
  where id      = p_customer_id
    and cafe_id = p_cafe_id;

  return jsonb_build_object(
    'streak_after',              v_new_streak,
    'shields_after',             v_new_shields,
    'shield_consumed',           v_consumed,
    'shield_awarded',            v_awarded,
    'milestone_shields_granted', v_milestone_shields,
    'off_day_freeze',            v_frozen,
    'already_visited_today',     v_already_today,
    'dow',                       v_dow,
    'milestones',                coalesce(v_milestones, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.streakup_engine_process_check_in(uuid, uuid, date) from public;

-- ---------------------------------------------------------------------------
-- Seed helper — include shield_grant_amount in inserts
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_reward_milestones(p_cafe_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_cafe_id is null then
    return;
  end if;

  insert into public.reward_milestones
    (cafe_id, name, days_required, reward_label, shield_grant_amount, sort_order, active)
  values
    (p_cafe_id, 'Warm-Up',     3,  'Complimentary upgrade',     0, 10, true),
    (p_cafe_id, 'Regular',     5,  'Free pastry of the day',    0, 20, true),
    (p_cafe_id, 'Loyalist',    10, 'Free beverage',             1, 30, true),
    (p_cafe_id, 'Streak Pro',  21, 'Signature combo on us',     1, 40, true),
    (p_cafe_id, 'Legend',      50, 'VIP loyalty perk',          2, 50, true)
  on conflict (cafe_id, name) do nothing;
end;
$$;

revoke all on function public.seed_default_reward_milestones(uuid) from public;

-- ---------------------------------------------------------------------------
-- CRM list — every customer for the cafe (zero visits included)
-- ---------------------------------------------------------------------------
drop function if exists public.hq_list_customers_secure(uuid, text, int, int);
drop function if exists public.hq_list_customers_secure(uuid, text, text, int, int);

create or replace function public.hq_list_customers_secure(
  p_cafe_id uuid default null,
  p_slug    text default null,
  p_search  text default '',
  p_limit   int  default 50,
  p_offset  int  default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_cafe_id uuid;
  v_rows    jsonb;
  v_total   bigint;
  v_search  text := trim(coalesce(p_search, ''));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_profile from public.profiles where user_id = v_uid limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_profile.role = 'super_admin'::public.streakup_role then
    v_cafe_id := p_cafe_id;
    if v_cafe_id is null and coalesce(trim(p_slug), '') <> '' then
      select c.id into v_cafe_id from public.cafes c where c.slug = trim(p_slug) limit 1;
    end if;
    if v_cafe_id is null then
      return jsonb_build_object('ok', false, 'reason', 'cafe_id_required_for_super_admin');
    end if;
  elsif v_profile.role = 'hq_owner'::public.streakup_role then
    v_cafe_id := coalesce(v_profile.cafe_id, p_cafe_id);
    if v_cafe_id is null and coalesce(trim(p_slug), '') <> '' then
      select c.id into v_cafe_id
      from public.cafes c
      where c.slug = trim(p_slug)
      limit 1;
    end if;
    if v_cafe_id is null then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  p_limit  := greatest(1, least(coalesce(p_limit, 50), 200));
  p_offset := greatest(0, coalesce(p_offset, 0));

  select count(*) into v_total
  from public.customers c
  where c.cafe_id = v_cafe_id
    and (
      v_search = ''
      or coalesce(c.full_name, '') ilike '%' || v_search || '%'
      or c.pin_code ilike '%' || v_search || '%'
      or coalesce(c.phone, '') ilike '%' || v_search || '%'
    );

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
      'last_visit_date', lv.last_visit_date
    ) as row_data
    from public.customers c
    left join (
      select
        v.customer_id,
        max(v.visit_date) as last_visit_date
      from public.visits v
      where v.cafe_id    = v_cafe_id
        and v.event_type = 'check_in'::public.visit_event_type
      group by v.customer_id
    ) lv on lv.customer_id = c.id
    where c.cafe_id = v_cafe_id
      and (
        v_search = ''
        or coalesce(c.full_name, '') ilike '%' || v_search || '%'
        or c.pin_code ilike '%' || v_search || '%'
        or coalesce(c.phone, '') ilike '%' || v_search || '%'
      )
    order by c.created_at desc
    limit p_limit offset p_offset
  ) sub;

  return jsonb_build_object(
    'ok',      true,
    'cafe_id', v_cafe_id,
    'total',   v_total,
    'limit',   p_limit,
    'offset',  p_offset,
    'rows',    coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.hq_list_customers_secure(uuid, text, text, int, int) from public;
grant execute on function public.hq_list_customers_secure(uuid, text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Portal — timezone + countdown anchors for dual timers
-- ---------------------------------------------------------------------------
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
  v_tz            text;
  v_next_midnight timestamptz;
  v_streak_expiry timestamptz;
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

  if v_customer_id is null or v_customer.id is null then
    return jsonb_build_object('ok', false, 'error', 'customer_resolution_failed');
  end if;

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
    'cafe_timezone',       v_tz,
    'next_visit_opens_at', v_next_midnight,
    'streak_expires_at',   v_streak_expiry
  );
end;
$$;

revoke all on function public.customer_portal_begin(text, text, text, text) from public;
grant execute on function public.customer_portal_begin(text, text, text, text) to anon, authenticated;

commit;
