-- =============================================================================
-- StreakUp — Phase 23: Super Admin audit enrichment (human-readable + IP)
-- Run after phase22. Safe to re-run (idempotent).
-- =============================================================================

begin;

alter table public.audit_log
  add column if not exists ip_address text;

comment on column public.audit_log.ip_address is
  'Client IP when action was recorded (optional; may also appear in payload.ip_address).';

-- -----------------------------------------------------------------------------
-- Human-readable audit summaries for the control plane UI
-- -----------------------------------------------------------------------------
create or replace function public.admin_audit_action_summary(
  p_action text,
  p_payload jsonb
) returns text
language plpgsql
immutable
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  v_before := coalesce(p_payload -> 'before', '{}'::jsonb);
  v_after := coalesce(p_payload -> 'after', '{}'::jsonb);

  return case
    when p_action = 'customer.override' then
      format(
        'Changed customer streak from %s to %s · shields %s → %s',
        coalesce(v_before ->> 'current_streak', '?'),
        coalesce(v_after ->> 'current_streak', '?'),
        coalesce(v_before ->> 'shields', '?'),
        coalesce(v_after ->> 'shields', '?')
      )
    when p_action = 'cafe.provisioned' then
      format(
        'Provisioned café «%s» (%s)',
        coalesce(p_payload ->> 'name', p_payload ->> 'cafe_name', '—'),
        coalesce(p_payload ->> 'slug', '—')
      )
    when p_action = 'cafe.status_changed' then
      format(
        'Changed café status to %s',
        coalesce(p_payload ->> 'status', p_payload ->> 'new_status', '—')
      )
    when p_action = 'subscription.updated' then
      format(
        'Updated subscription to %s (%s)',
        coalesce(p_payload ->> 'plan_tier', p_payload ->> 'plan_name', '—'),
        coalesce(p_payload ->> 'status', '—')
      )
    when p_action = 'visit.recorded' then
      format(
        'Recorded visit · streak %s',
        coalesce(p_payload ->> 'current_streak', p_payload ->> 'streak', '—')
      )
    when p_action ilike '%suspend%' then
      'Suspended tenant access'
    when p_action ilike '%webhook%' then
      'Webhook pipeline event'
    else
      replace(replace(coalesce(p_action, 'unknown'), '.', ' · '), '_', ' ')
  end;
end;
$$;

revoke all on function public.admin_audit_action_summary(text, jsonb) from public;
grant execute on function public.admin_audit_action_summary(text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Super Admin global audit feed (resolved actors, no raw UUID soup)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_audit_secure(
  p_cafe_id uuid default null,
  p_action_ilike text default null,
  p_limit int default 150
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_rows jsonb;
  v_lim int := greatest(1, least(coalesce(p_limit, 150), 500));
begin
  v_profile := public.streakup_profile();
  if v_profile is null or v_profile.role <> 'super_admin'::public.streakup_role then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(row_payload order by created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      al.created_at,
      jsonb_build_object(
        'id', al.id,
        'created_at', al.created_at,
        'action', al.action,
        'action_summary', public.admin_audit_action_summary(al.action, al.payload),
        'entity_type', al.entity_type,
        'entity_label', case
          when al.entity_type = 'customer' and al.payload ? 'after' then
            coalesce(al.payload -> 'after' ->> 'full_name', 'Customer')
          when al.entity_type = 'cafe' then coalesce(c.name, 'Café')
          else al.entity_type
        end,
        'cafe_id', al.cafe_id,
        'cafe_name', c.name,
        'cafe_slug', c.slug,
        'actor_label', coalesce(
          nullif(trim(p.display_name), ''),
          nullif(trim(u.email::text), ''),
          initcap(replace(al.actor_type, '_', ' '))
        ),
        'actor_role', coalesce(p.role::text, al.actor_type),
        'ip_address', coalesce(
          nullif(trim(al.ip_address), ''),
          nullif(trim(al.payload ->> 'ip_address'), ''),
          nullif(trim(al.payload ->> 'client_ip'), ''),
          '—'
        ),
        'payload', al.payload
      ) as row_payload
    from public.audit_log al
    left join public.cafes c on c.id = al.cafe_id
    left join public.profiles p on p.user_id = al.actor_user_id
    left join auth.users u on u.id = al.actor_user_id
    where (p_cafe_id is null or al.cafe_id = p_cafe_id)
      and (
        p_action_ilike is null
        or trim(p_action_ilike) = ''
        or al.action ilike p_action_ilike
      )
    order by al.created_at desc
    limit v_lim
  ) ranked;

  return jsonb_build_object('ok', true, 'rows', v_rows);
end;
$$;

revoke all on function public.admin_list_audit_secure(uuid, text, int) from public;
grant execute on function public.admin_list_audit_secure(uuid, text, int) to authenticated;

commit;
