-- =============================================================================
-- StreakUp — Phase 22: Milestone icon themes + discount badges
--
--  - reward_milestones.icon_type — visual theme for customer roadmap nodes
--  - reward_milestones.discount_percentage — optional % reward (discount icon)
--  - customer_portal_begin — expose new fields in milestone projection
--  - seed_default_reward_milestones — themed defaults
-- Safe to re-run.
-- =============================================================================

begin;

alter table public.reward_milestones
  add column if not exists icon_type text not null default 'gift';

alter table public.reward_milestones
  add column if not exists discount_percentage int;

alter table public.reward_milestones
  drop constraint if exists reward_milestones_icon_type_chk;

alter table public.reward_milestones
  add constraint reward_milestones_icon_type_chk
  check (
    icon_type in (
      'coffee',
      'pastry',
      'cold_drink',
      'gift',
      'shield',
      'crown',
      'discount',
      'flame'
    )
  );

alter table public.reward_milestones
  drop constraint if exists reward_milestones_discount_pct_chk;

alter table public.reward_milestones
  add constraint reward_milestones_discount_pct_chk
  check (
    discount_percentage is null
    or (discount_percentage >= 1 and discount_percentage <= 100)
  );

comment on column public.reward_milestones.icon_type is
  'Roadmap node icon theme: coffee, pastry, cold_drink, gift, shield, crown, discount, flame.';

comment on column public.reward_milestones.discount_percentage is
  'Optional percentage off (1–100) when icon_type = discount.';

-- Backfill nulls for legacy rows
update public.reward_milestones
set icon_type = 'gift'
where icon_type is null or trim(icon_type) = '';

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
    (cafe_id, name, days_required, reward_label, shield_grant_amount, icon_type, discount_percentage, sort_order, active)
  values
    (p_cafe_id, 'Warm-Up',     3,  'Complimentary upgrade',     0, 'coffee',      null, 10, true),
    (p_cafe_id, 'Regular',     5,  'Free pastry of the day',    0, 'pastry',      null, 20, true),
    (p_cafe_id, 'Loyalist',    10, 'Free beverage',             1, 'cold_drink',  null, 30, true),
    (p_cafe_id, 'Streak Pro',  21, '15% off your order',        1, 'discount',    15,   40, true),
    (p_cafe_id, 'Legend',      50, 'VIP loyalty perk',          2, 'crown',       null, 50, true)
  on conflict (cafe_id, name) do nothing;
end;
$$;

revoke all on function public.seed_default_reward_milestones(uuid) from public;

-- Portal projection — include gamification fields
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
        'id',                  rm.id,
        'name',                rm.name,
        'days_required',       rm.days_required,
        'reward_label',        rm.reward_label,
        'icon_type',           rm.icon_type,
        'discount_percentage', rm.discount_percentage,
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
    'cafe_timezone',       v_tz,
    'next_visit_opens_at', v_next_midnight,
    'streak_expires_at',   v_streak_expiry
  );
end;
$$;

revoke all on function public.customer_portal_begin(text, text, text, text) from public;
grant execute on function public.customer_portal_begin(text, text, text, text) to anon, authenticated;

commit;
