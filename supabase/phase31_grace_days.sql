-- =============================================================================
-- StreakUp — Phase 31: Grace days engine (أيام الإجازة)
--
-- · grace_days[] on cafes (0=Sun … 6=Sat) — migrated from legacy off_days
-- · Skipping a grace day does NOT break streak or consume shields
-- · Visiting on a grace day counts as a normal check-in (+1)
-- · Nightly shield cron skips when yesterday was a grace day
-- Run AFTER phase30_owner_dashboard.sql
-- =============================================================================

begin;

alter table public.cafes
  add column if not exists grace_days smallint[] not null default '{}'::smallint[];

comment on column public.cafes.grace_days is
  'Weekly rest days: missing these days does not break streaks; visiting still advances streak.';

-- Migrate legacy off_days → grace_days where empty
update public.cafes c
set grace_days = c.off_days
where cardinality(coalesce(c.grace_days, '{}'::smallint[])) = 0
  and cardinality(coalesce(c.off_days, '{}'::smallint[])) > 0;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.cafe_date_is_grace(
  p_grace_days smallint[],
  p_legacy_off_days smallint[],
  p_date date
) returns boolean
language sql
immutable
as $$
  select case
    when cardinality(coalesce(p_grace_days, '{}'::smallint[])) > 0 then
      coalesce(p_grace_days, '{}'::smallint[]) @> array[extract(dow from p_date)::smallint]
    when cardinality(coalesce(p_legacy_off_days, '{}'::smallint[])) > 0 then
      coalesce(p_legacy_off_days, '{}'::smallint[]) @> array[extract(dow from p_date)::smallint]
    else false
  end;
$$;

create or replace function public.streakup_effective_gap_days(
  p_grace_days smallint[],
  p_legacy_off_days smallint[],
  p_from date,
  p_to date
) returns int
language plpgsql
immutable
as $$
declare
  v_cursor date;
  v_count  int := 0;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    return 0;
  end if;
  v_cursor := p_from;
  while v_cursor < p_to loop
    v_cursor := v_cursor + 1;
    if not public.cafe_date_is_grace(p_grace_days, p_legacy_off_days, v_cursor) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Core streak engine — grace-aware gap math
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
  v_effective_gap      int;
  v_new_streak         int;
  v_new_shields        int;
  v_consumed           boolean := false;
  v_awarded            boolean := false;
  v_milestone_shields  int := 0;
  v_already_today      boolean := false;
  v_grace_today        boolean := false;
  v_dow                int;
  v_cap                int;
  v_milestones         jsonb := '[]'::jsonb;
  v_prev_streak        int;
  v_grant              int;
  v_m                  record;
begin
  select * into v_cafe from public.cafes where id = p_cafe_id for share;
  if not found then raise exception 'cafe_not_found'; end if;

  select * into v_cust
  from public.customers
  where id = p_customer_id and cafe_id = p_cafe_id
  for update;
  if not found then raise exception 'customer_not_found'; end if;

  v_prev_streak := v_cust.current_streak;
  v_new_shields := v_cust.shields;
  v_dow := extract(dow from p_visit_date)::int;
  v_grace_today := public.cafe_date_is_grace(v_cafe.grace_days, v_cafe.off_days, p_visit_date);

  select max(v.visit_date) into v_last
  from public.visits v
  where v.customer_id = p_customer_id
    and v.cafe_id = p_cafe_id
    and v.event_type = 'check_in'::public.visit_event_type;

  if v_last is null then
    v_new_streak := 1;
  elsif p_visit_date = v_last then
    v_new_streak := v_cust.current_streak;
    v_already_today := true;
  elsif p_visit_date < v_last then
    v_new_streak := v_cust.current_streak;
  else
    v_effective_gap := public.streakup_effective_gap_days(
      v_cafe.grace_days, v_cafe.off_days, v_last, p_visit_date
    );

    if v_effective_gap = 1 then
      v_new_streak := v_cust.current_streak + 1;
    elsif v_effective_gap = 2 then
      if v_cust.shields > 0 then
        v_new_shields := v_cust.shields - 1;
        v_consumed := true;
        v_new_streak := v_cust.current_streak + 1;
      else
        v_new_streak := 1;
      end if;
    elsif v_effective_gap = 0 then
      v_new_streak := v_cust.current_streak;
    else
      v_new_streak := 1;
    end if;
  end if;

  if (not v_already_today) and v_new_streak > v_prev_streak then
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

  if (not v_already_today) and v_new_streak > v_prev_streak then
    for v_m in
      select rm.id, rm.name, rm.days_required, rm.shield_grant_amount, rm.fulfillment_type, rm.icon_type
      from public.reward_milestones rm
      where rm.cafe_id = p_cafe_id
        and rm.active
        and rm.days_required <= v_new_streak
        and rm.days_required > v_prev_streak
      order by rm.sort_order, rm.days_required
    loop
      v_grant := greatest(0, coalesce(v_m.shield_grant_amount, 0));

      if v_m.fulfillment_type = 'physical'::public.reward_fulfillment_type then
        insert into public.rewards (cafe_id, customer_id, milestone_id, earned_at)
        values (p_cafe_id, p_customer_id, v_m.id, now())
        on conflict (customer_id, milestone_id) do update
          set earned_at  = coalesce(public.rewards.earned_at, excluded.earned_at),
              updated_at = now();
      end if;

      if v_m.fulfillment_type = 'digital_shield'::public.reward_fulfillment_type
         or v_grant > 0 then
        if v_grant > 0 then
          v_milestone_shields := v_milestone_shields + v_grant;
        elsif v_m.fulfillment_type = 'digital_shield'::public.reward_fulfillment_type then
          v_milestone_shields := v_milestone_shields + 1;
        end if;
      end if;

      v_milestones := v_milestones || jsonb_build_array(
        jsonb_build_object(
          'milestone_id',      v_m.id,
          'name',              v_m.name,
          'days_required',     v_m.days_required,
          'fulfillment_type',  v_m.fulfillment_type::text,
          'shields_granted',   case
            when v_m.fulfillment_type = 'digital_shield'::public.reward_fulfillment_type
              then greatest(1, v_grant)
            else v_grant
          end
        )
      );
    end loop;

    if v_milestone_shields > 0 then
      v_cap := coalesce(v_cafe.max_shields, 2147483647);
      v_new_shields := least(v_cap, v_new_shields + v_milestone_shields);
      v_awarded := true;
    end if;
  end if;

  update public.customers
  set current_streak = v_new_streak,
      longest_streak = greatest(longest_streak, v_new_streak),
      shields        = v_new_shields,
      updated_at     = now()
  where id = p_customer_id and cafe_id = p_cafe_id;

  return jsonb_build_object(
    'streak_after',              v_new_streak,
    'shields_after',             v_new_shields,
    'shield_consumed',           v_consumed,
    'shield_awarded',            v_awarded,
    'milestone_shields_granted', v_milestone_shields,
    'grace_day_today',           v_grace_today,
    'already_visited_today',     v_already_today,
    'effective_gap_days',        coalesce(v_effective_gap, 0),
    'dow',                       v_dow,
    'milestones',                coalesce(v_milestones, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Nightly shield cron — do not consume shields for grace-day skips
-- ---------------------------------------------------------------------------
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
  v_yesterday_grace boolean;
begin
  for v_cafe in
    select id, timezone, grace_days, off_days, coalesce(timezone, 'UTC') as tz
    from public.cafes
    where status = 'active'::public.cafe_status
  loop
    v_today     := (now() at time zone v_cafe.tz)::date;
    v_yesterday := v_today - 1;

    v_yesterday_grace := public.cafe_date_is_grace(
      v_cafe.grace_days, v_cafe.off_days, v_yesterday
    );

    if v_yesterday_grace then
      continue;
    end if;

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
        and (
          select max(v.visit_date)
          from public.visits v
          where v.customer_id = c.id
            and v.cafe_id     = c.cafe_id
            and v.event_type  = 'check_in'::public.visit_event_type
        ) = v_today - 2
        and not exists (
          select 1 from public.visits sv
          where sv.customer_id = c.id
            and sv.cafe_id     = c.cafe_id
            and sv.visit_date  = v_yesterday
            and sv.event_type  = 'system'::public.visit_event_type
            and (sv.metadata->>'shield_auto_consumed')::boolean = true
        )
    loop
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

      update public.customers
      set shields    = shields - 1,
          updated_at = now()
      where id = v_cust.id;

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

-- ---------------------------------------------------------------------------
-- Public profile + portal — expose grace day state
-- ---------------------------------------------------------------------------
create or replace function public.get_cafe_public_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'slug', c.slug,
    'logo_url', c.logo_url,
    'primary_color', c.primary_color,
    'secondary_color', c.secondary_color,
    'accent_color', c.accent_color,
    'background_color', c.background_color,
    'timezone', c.timezone,
    'currency_code', c.currency_code,
    'grace_days', coalesce(
      case when cardinality(c.grace_days) > 0 then c.grace_days else c.off_days end,
      '{}'::smallint[]
    )
  )
  from public.cafes c
  where c.slug = lower(trim(p_slug))
    and c.status = 'active'::public.cafe_status
  limit 1;
$$;

-- Patch customer_portal_begin return payload (full body from phase30 + grace flags)
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
  v_grace_today   boolean := false;
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

  perform public._sync_customer_physical_rewards(v_cafe.id, v_customer_id);

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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                  rm.id,
        'name',                rm.name,
        'days_required',       rm.days_required,
        'reward_label',        rm.reward_label,
        'icon_type',           rm.icon_type,
        'discount_percentage', rm.discount_percentage,
        'fulfillment_type',    rm.fulfillment_type::text,
        'sort_order',          rm.sort_order,
        'earned_at',           r.earned_at,
        'claimed_at',          r.claimed_at
      )
      order by rm.sort_order, rm.days_required
    ),
    '[]'::jsonb
  )
  into v_milestones
  from public.reward_milestones rm
  left join public.rewards r
    on r.milestone_id = rm.id and r.customer_id = v_customer.id
  where rm.cafe_id = v_cafe.id
    and rm.active;

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

commit;
