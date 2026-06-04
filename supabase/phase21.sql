-- =============================================================================
-- StreakUp — Phase 21: HQ customer override RPC (reliable + auditable)
--
-- Fixes override failures when hq_owner cafe scope is resolved via slug,
-- caps shields to cafe.max_shields, and returns structured error reasons.
-- Safe to re-run.
-- =============================================================================

begin;

drop function if exists public.hq_override_customer_secure(uuid, int, int, text);

create or replace function public.hq_override_customer_secure(
  p_customer_id uuid,
  p_streak       int  default null,
  p_shields      int  default null,
  p_full_name    text default null,
  p_cafe_id      uuid default null,
  p_slug         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_profile    public.profiles%rowtype;
  v_cafe_id    uuid;
  v_customer   public.customers%rowtype;
  v_cafe       public.cafes%rowtype;
  v_before     jsonb;
  v_after      jsonb;
  v_cap        int;
  v_name       text;
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

  -- Resolve tenant scope (mirrors hq_list_customers_secure)
  if v_profile.role = 'super_admin'::public.streakup_role then
    v_cafe_id := p_cafe_id;
    if v_cafe_id is null and coalesce(trim(p_slug), '') <> '' then
      select c.id into v_cafe_id from public.cafes c where c.slug = trim(p_slug) limit 1;
    end if;
  elsif v_profile.role = 'hq_owner'::public.streakup_role then
    v_cafe_id := coalesce(v_profile.cafe_id, p_cafe_id);
    if v_cafe_id is null and coalesce(trim(p_slug), '') <> '' then
      select c.id into v_cafe_id
      from public.cafes c
      where c.slug = trim(p_slug)
      limit 1;
    end if;
  end if;

  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'reason', 'cafe_scope_required');
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  if v_customer.cafe_id is distinct from v_cafe_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_streak is null and p_shields is null and p_full_name is null then
    return jsonb_build_object('ok', false, 'reason', 'no_changes');
  end if;

  if p_streak is not null and p_streak < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_streak');
  end if;

  if p_shields is not null and p_shields < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_shields');
  end if;

  select * into v_cafe from public.cafes where id = v_cafe_id;
  v_cap := coalesce(v_cafe.max_shields, 2147483647);

  if p_shields is not null and p_shields > v_cap then
    return jsonb_build_object(
      'ok',     false,
      'reason', 'shields_above_cap',
      'cap',    v_cap
    );
  end if;

  v_before := jsonb_build_object(
    'current_streak', v_customer.current_streak,
    'longest_streak', v_customer.longest_streak,
    'shields',        v_customer.shields,
    'full_name',      coalesce(v_customer.full_name, '')
  );

  v_name := case
    when p_full_name is null then v_customer.full_name
    else nullif(trim(left(p_full_name, 120)), '')
  end;

  update public.customers
  set current_streak = coalesce(p_streak, current_streak),
      longest_streak = greatest(
        longest_streak,
        coalesce(p_streak, current_streak)
      ),
      shields        = coalesce(p_shields, shields),
      full_name      = coalesce(v_name, full_name),
      updated_at     = now()
  where id = p_customer_id
  returning * into v_customer;

  v_after := jsonb_build_object(
    'current_streak', v_customer.current_streak,
    'longest_streak', v_customer.longest_streak,
    'shields',        v_customer.shields,
    'full_name',      coalesce(v_customer.full_name, '')
  );

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
    v_customer.cafe_id,
    null,
    v_uid,
    'user',
    'customer.override',
    'customer',
    p_customer_id,
    jsonb_build_object(
      'actor_role', v_profile.role::text,
      'before',     v_before,
      'after',      v_after,
      'requested',  jsonb_strip_nulls(
        jsonb_build_object(
          'streak',    p_streak,
          'shields',   p_shields,
          'full_name', p_full_name
        )
      )
    )
  );

  return jsonb_build_object(
    'ok',       true,
    'cafe_id',  v_customer.cafe_id,
    'customer', jsonb_build_object(
      'id',             v_customer.id,
      'current_streak', v_customer.current_streak,
      'longest_streak', v_customer.longest_streak,
      'shields',        v_customer.shields,
      'full_name',      coalesce(v_customer.full_name, '')
    )
  );
exception
  when others then
    return jsonb_build_object(
      'ok',      false,
      'reason',  'internal_error',
      'message', left(SQLERRM, 240)
    );
end;
$$;

revoke all on function public.hq_override_customer_secure(uuid, int, int, text, uuid, text) from public;
grant execute on function public.hq_override_customer_secure(uuid, int, int, text, uuid, text) to authenticated;

commit;
