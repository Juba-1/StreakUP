-- Phase 14: Bulletproof Saudi mobile normalization for customer_portal_begin + legacy row matching.

begin;

create or replace function public.normalize_sa_mobile_e164(p_raw text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $func$
declare
  d text;
  r text;
  m text[];
begin
  if p_raw is null or btrim(p_raw) = '' then
    return null;
  end if;

  d := regexp_replace(btrim(p_raw), '\D', '', 'g');

  while left(d, 2) = '00' loop
    d := substring(d from 3);
  end loop;

  if left(d, 3) = '966' then
    r := substring(d from 4);
    m := regexp_match(left(r, 10), '^05(\d{8})$');
    if m is not null then
      return '+9665' || m[1];
    end if;
    m := regexp_match(left(r, 9), '^5(\d{8})$');
    if m is not null then
      return '+9665' || m[1];
    end if;
    if left(r, 1) = '0' then
      r := substring(r from 2);
      m := regexp_match(left(r, 9), '^5(\d{8})$');
      if m is not null then
        return '+9665' || m[1];
      end if;
    end if;
    return null;
  end if;

  m := regexp_match(left(d, 10), '^05(\d{8})$');
  if m is not null then
    return '+9665' || m[1];
  end if;

  m := regexp_match(left(d, 9), '^5(\d{8})$');
  if m is not null then
    return '+9665' || m[1];
  end if;

  return null;
end;
$func$;

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
  v_cafe public.cafes%rowtype;
  v_customer public.customers%rowtype;
  v_created boolean := false;
  v_subject text;
  v_check jsonb;
  v_phone text;
  v_name text := trim(coalesce(p_name, ''));
  v_token text := trim(coalesce(p_session_token, ''));
  v_token_hash text;
  v_new_token text;
  v_new_hash text;
  v_milestones jsonb;
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

  if char_length(v_token) >= 24 then
    v_token_hash := encode(digest(v_token, 'sha256'), 'hex');
    select cu.* into v_customer
    from public.customer_portal_sessions s
    join public.customers cu on cu.id = s.customer_id
    where s.cafe_id = v_cafe.id
      and s.token_hash = v_token_hash
      and s.expires_at > now()
    limit 1;

    if found then
      update public.customer_portal_sessions
      set last_seen_at = now(),
          expires_at = now() + interval '90 days'
      where token_hash = v_token_hash;
    end if;
  end if;

  if not found then
    v_phone := public.normalize_sa_mobile_e164(trim(coalesce(p_phone, '')));
    if v_phone is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_phone');
    end if;

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

    select cu.* into v_customer
    from public.customers cu
    where cu.cafe_id = v_cafe.id
      and (
        cu.phone = v_phone
        or public.normalize_sa_mobile_e164(trim(cu.phone)) = v_phone
      )
    limit 1;

    if not found then
      if char_length(v_name) < 2 then
        perform public.lockout_register_failure(
          'portal:phone', v_subject,
          interval '1 minute', 12, interval '45 seconds',
          'name_required'
        );
        return jsonb_build_object('ok', false, 'error', 'name_required');
      end if;

      insert into public.customers (cafe_id, phone, full_name)
      values (v_cafe.id, v_phone, left(v_name, 120))
      returning * into v_customer;
      v_created := true;
    elsif char_length(v_name) >= 2 and coalesce(trim(v_customer.full_name), '') = '' then
      update public.customers
      set full_name = left(v_name, 120)
      where id = v_customer.id;
      v_customer.full_name := left(v_name, 120);
    end if;

    perform public.lockout_register_success('portal:phone', v_subject);
  end if;

  v_new_token := encode(gen_random_bytes(24), 'hex');
  v_new_hash := encode(digest(v_new_token, 'sha256'), 'hex');

  insert into public.customer_portal_sessions (
    cafe_id, customer_id, token_hash, expires_at, last_seen_at
  )
  values (
    v_cafe.id, v_customer.id, v_new_hash, now() + interval '90 days', now()
  )
  on conflict (customer_id) do update
  set token_hash = excluded.token_hash,
      cafe_id = excluded.cafe_id,
      expires_at = excluded.expires_at,
      last_seen_at = excluded.last_seen_at;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', rm.id,
      'name', rm.name,
      'days_required', rm.days_required,
      'reward_label', rm.reward_label,
      'sort_order', rm.sort_order,
      'earned_at', r.earned_at,
      'claimed_at', r.claimed_at
    )
    order by rm.sort_order, rm.days_required
  ), '[]'::jsonb)
  into v_milestones
  from public.reward_milestones rm
  left join public.rewards r
    on r.milestone_id = rm.id and r.customer_id = v_customer.id
  where rm.cafe_id = v_cafe.id;

  return jsonb_build_object(
    'ok', true,
    'customer_id', v_customer.id,
    'cafe_id', v_customer.cafe_id,
    'current_streak', v_customer.current_streak,
    'longest_streak', v_customer.longest_streak,
    'shields', v_customer.shields,
    'milestones', v_milestones,
    'pin_code', v_customer.pin_code,
    'display_name', coalesce(v_customer.full_name, ''),
    'is_new', v_created,
    'session_token', v_new_token
  );
end;
$$;

revoke all on function public.normalize_sa_mobile_e164(text) from public;

commit;
