-- =============================================================================
-- StreakUp — Phase 1 "Titanium Foundation"
-- Run this entire file once in Supabase SQL Editor (Postgres 15+).
--
-- Includes: extensions, enums, 11 core tables, indexes, triggers, RLS,
--           SECURITY DEFINER helpers (authorization reads profiles — NOT JWT user_metadata),
--           idempotent visit ingestion RPC + streak engine placeholder.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'streakup_role') then
    create type public.streakup_role as enum (
      'super_admin',
      'hq_owner',
      'branch_manager',
      'cashier',
      'customer'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'cafe_status') then
    create type public.cafe_status as enum ('active', 'suspended', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'visit_event_type') then
    create type public.visit_event_type as enum (
      'check_in',
      'reward_redeem',
      'adjustment',
      'system'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type public.subscription_status as enum (
      'trialing',
      'active',
      'past_due',
      'canceled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'idempotency_record_status') then
    create type public.idempotency_record_status as enum (
      'pending',
      'completed',
      'failed'
    );
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- Tables (11)
-- -----------------------------------------------------------------------------

create table if not exists public.cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  logo_url text,
  primary_color text,
  secondary_color text,
  owner_password text not null,
  timezone text not null default 'UTC',
  currency_code char(3) not null default 'USD',
  off_days smallint[] not null default '{}'::smallint[],
  shield_every int,
  max_shields int,
  status public.cafe_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cafes_slug_lower_chk check (slug = lower(slug))
);

create unique index if not exists cafes_slug_uidx on public.cafes (slug);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  name text not null,
  branch_code text not null,
  manager_password text not null,
  cashier_pin text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branches_code_lower_chk check (branch_code = lower(branch_code))
);

create unique index if not exists branches_cafe_code_uidx
  on public.branches (cafe_id, branch_code);

create index if not exists branches_cafe_id_idx on public.branches (cafe_id);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  label text not null default 'default',
  public_prefix text not null,
  secret_hash text not null,
  scopes text[] not null default array['visits:write']::text[],
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists api_keys_cafe_id_idx on public.api_keys (cafe_id);
create index if not exists api_keys_public_prefix_idx on public.api_keys (public_prefix);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  phone text not null,
  pin_code text not null,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  shields int not null default 0,
  gdpr_consent_date timestamptz,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_pin_code_chk check (char_length(pin_code) between 4 and 12)
);

create unique index if not exists customers_cafe_phone_uidx on public.customers (cafe_id, phone);
create unique index if not exists customers_cafe_pin_uidx on public.customers (cafe_id, pin_code);
create index if not exists customers_cafe_id_idx on public.customers (cafe_id);
create index if not exists customers_auth_user_id_idx
  on public.customers (auth_user_id)
  where auth_user_id is not null;

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete restrict,
  visit_date date not null,
  streak_after int not null default 0,
  event_type public.visit_event_type not null default 'check_in',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists visits_cafe_visit_date_idx on public.visits (cafe_id, visit_date desc);
create index if not exists visits_branch_visit_date_idx on public.visits (branch_id, visit_date desc);
create index if not exists visits_customer_visit_date_idx on public.visits (customer_id, visit_date desc);

create table if not exists public.reward_milestones (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  name text not null,
  days_required int not null,
  reward_label text,
  shield_grant_amount int not null default 0,
  icon_type text not null default 'gift',
  discount_percentage int,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_milestones_days_chk check (days_required > 0),
  constraint reward_milestones_shield_grant_chk check (shield_grant_amount >= 0),
  constraint reward_milestones_icon_type_chk check (
    icon_type in ('coffee', 'pastry', 'cold_drink', 'gift', 'shield', 'crown', 'discount', 'flame')
  ),
  constraint reward_milestones_discount_pct_chk check (
    discount_percentage is null or (discount_percentage >= 1 and discount_percentage <= 100)
  )
);

create index if not exists reward_milestones_cafe_id_idx on public.reward_milestones (cafe_id);
create unique index if not exists reward_milestones_cafe_name_uidx
  on public.reward_milestones (cafe_id, name);

create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  milestone_id uuid not null references public.reward_milestones (id) on delete cascade,
  earned_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rewards_customer_id_idx on public.rewards (customer_id);
create index if not exists rewards_cafe_id_idx on public.rewards (cafe_id);
create unique index if not exists rewards_customer_milestone_uidx
  on public.rewards (customer_id, milestone_id);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  cafe_id uuid references public.cafes (id) on delete set null,
  branch_id uuid references public.branches (id) on delete set null,
  actor_user_id uuid,
  actor_type text not null default 'system',
  action text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_cafe_created_idx on public.audit_log (cafe_id, created_at desc);
create index if not exists audit_log_branch_created_idx on public.audit_log (branch_id, created_at desc);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.streakup_role not null,
  cafe_id uuid references public.cafes (id) on delete set null,
  branch_id uuid references public.branches (id) on delete set null,
  display_name text,
  phone_e164 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_scope_chk check (
    (role = 'super_admin' and cafe_id is null and branch_id is null)
    or (role = 'hq_owner' and cafe_id is not null and branch_id is null)
    or (
      role in ('branch_manager', 'cashier')
      and cafe_id is not null
      and branch_id is not null
    )
    or (role = 'customer' and cafe_id is not null and branch_id is null)
  ),
  constraint profiles_branch_requires_cafe_chk check (
    branch_id is null or cafe_id is not null
  )
);

create index if not exists profiles_cafe_id_idx on public.profiles (cafe_id);
create index if not exists profiles_branch_id_idx on public.profiles (branch_id);

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

create table if not exists public.visit_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  idempotency_key text not null,
  payload_sha256 text not null,
  constraint visit_idempotency_keys_payload_sha256_chk
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  customer_id uuid not null references public.customers (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  visit_id uuid references public.visits (id) on delete set null,
  status public.idempotency_record_status not null default 'pending',
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists visit_idempotency_keys_cafe_key_uidx
  on public.visit_idempotency_keys (cafe_id, idempotency_key);

create index if not exists visit_idempotency_keys_created_idx
  on public.visit_idempotency_keys (created_at desc);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes (id) on delete cascade,
  plan_name text not null default 'enterprise',
  status public.subscription_status not null default 'active',
  provider text not null default 'stripe',
  external_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_cafe_id_idx on public.subscriptions (cafe_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

-- -----------------------------------------------------------------------------
-- Referential integrity triggers (Postgres CHECK cannot use subqueries)
-- -----------------------------------------------------------------------------
create or replace function public.validate_visit_scope()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.branches b
    where b.id = new.branch_id
      and b.cafe_id = new.cafe_id
  ) then
    raise exception 'visit_branch_cafe_mismatch';
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = new.customer_id
      and c.cafe_id = new.cafe_id
  ) then
    raise exception 'visit_customer_cafe_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists visits_validate_scope_bi on public.visits;
create trigger visits_validate_scope_bi
before insert or update of customer_id, cafe_id, branch_id on public.visits
for each row execute function public.validate_visit_scope();

create or replace function public.validate_reward_scope()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.customers c
    where c.id = new.customer_id
      and c.cafe_id = new.cafe_id
  ) then
    raise exception 'reward_customer_cafe_mismatch';
  end if;

  if not exists (
    select 1
    from public.reward_milestones m
    where m.id = new.milestone_id
      and m.cafe_id = new.cafe_id
  ) then
    raise exception 'reward_milestone_cafe_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists rewards_validate_scope_bi on public.rewards;
create trigger rewards_validate_scope_bi
before insert or update of customer_id, cafe_id, milestone_id on public.rewards
for each row execute function public.validate_reward_scope();

create or replace function public.validate_visit_idempotency_scope()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.customers c
    where c.id = new.customer_id
      and c.cafe_id = new.cafe_id
  ) then
    raise exception 'idempotency_customer_cafe_mismatch';
  end if;

  if not exists (
    select 1
    from public.branches b
    where b.id = new.branch_id
      and b.cafe_id = new.cafe_id
  ) then
    raise exception 'idempotency_branch_cafe_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists visit_idempotency_keys_validate_scope_bi on public.visit_idempotency_keys;
create trigger visit_idempotency_keys_validate_scope_bi
before insert or update of customer_id, cafe_id, branch_id on public.visit_idempotency_keys
for each row execute function public.validate_visit_idempotency_scope();

-- -----------------------------------------------------------------------------
-- updated_at touch helper
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'cafes',
    'branches',
    'customers',
    'reward_milestones',
    'rewards',
    'profiles',
    'subscriptions'
  ]
  loop
    execute format(
      'drop trigger if exists %I_touch_updated_at on public.%I;
       create trigger %I_touch_updated_at
       before update on public.%I
       for each row execute function public.touch_updated_at();',
      t, t, t, t
    );
  end loop;
end$$;

-- -----------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER; read profiles table — not user_metadata)
-- -----------------------------------------------------------------------------
create or replace function public.streakup_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.*
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.streakup_profile() from public;
grant execute on function public.streakup_profile() to authenticated;

create or replace function public.streakup_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'super_admin'::public.streakup_role
  );
$$;

revoke all on function public.streakup_is_super_admin() from public;
grant execute on function public.streakup_is_super_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Streak engine placeholder (pure SQL; later swap for full engine)
-- -----------------------------------------------------------------------------
create or replace function public.streakup_compute_streak_after_stub(
  p_cafe_id uuid,
  p_customer_id uuid,
  p_visit_date date
) returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_current int;
  v_last date;
  v_tz text;
begin
  select c.timezone into v_tz from public.cafes c where c.id = p_cafe_id;
  if v_tz is null then
    raise exception 'cafe_not_found';
  end if;

  select cu.current_streak
  into v_current
  from public.customers cu
  where cu.id = p_customer_id
    and cu.cafe_id = p_cafe_id;

  if not found then
    raise exception 'customer_not_found';
  end if;

  select v.visit_date
  into v_last
  from public.visits v
  where v.customer_id = p_customer_id
    and v.cafe_id = p_cafe_id
    and v.event_type = 'check_in'::public.visit_event_type
  order by v.visit_date desc, v.created_at desc
  limit 1;

  -- Phase 1 stub: consecutive HQ-local calendar days continue the streak.
  if v_last is null then
    return greatest(v_current, 0) + 1;
  elsif v_last = p_visit_date then
    return v_current;
  elsif p_visit_date = v_last + 1 then
    return v_current + 1;
  elsif p_visit_date > v_last + 1 then
    return 1;
  else
    -- backdated visit: keep engine deterministic without rewiring history (v1)
    return v_current;
  end if;
end;
$$;

revoke all on function public.streakup_compute_streak_after_stub(uuid, uuid, date) from public;
grant execute on function public.streakup_compute_streak_after_stub(uuid, uuid, date)
  to service_role;

-- -----------------------------------------------------------------------------
-- Idempotent visit ingestion (RPC)
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

  v_streak_after := public.streakup_compute_streak_after_stub(
    v_cafe_id,
    p_customer_id,
    v_visit_date
  );

  insert into public.visits (
    customer_id,
    cafe_id,
    branch_id,
    visit_date,
    streak_after,
    event_type
  )
  values (
    p_customer_id,
    v_cafe_id,
    p_branch_id,
    v_visit_date,
    v_streak_after,
    p_event_type
  )
  returning id into v_visit_id;

  update public.customers
  set current_streak = v_streak_after,
      longest_streak = greatest(longest_streak, v_streak_after),
      updated_at = now()
  where id = p_customer_id
    and cafe_id = v_cafe_id;

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
      'streak_after', v_streak_after
    )
  );

  return jsonb_build_object(
    'status', 'created',
    'visit_id', v_visit_id,
    'visit_date', v_visit_date,
    'streak_after', v_streak_after
  );
end;
$$;

revoke all on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date)
  from public;
grant execute on function public.record_visit_idempotent(uuid, uuid, text, text, public.visit_event_type, date)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.cafes enable row level security;
alter table public.branches enable row level security;
alter table public.api_keys enable row level security;
alter table public.customers enable row level security;
alter table public.visits enable row level security;
alter table public.reward_milestones enable row level security;
alter table public.rewards enable row level security;
alter table public.audit_log enable row level security;
alter table public.profiles enable row level security;
alter table public.visit_idempotency_keys enable row level security;
alter table public.subscriptions enable row level security;

-- profiles
drop policy if exists profiles_select_self_or_super on public.profiles;
create policy profiles_select_self_or_super
on public.profiles
for select
to authenticated
using (
  user_id = auth.uid()
  or public.streakup_is_super_admin()
);

drop policy if exists profiles_insert_super on public.profiles;
create policy profiles_insert_super
on public.profiles
for insert
to authenticated
with check (public.streakup_is_super_admin());

drop policy if exists profiles_update_super_or_self on public.profiles;
create policy profiles_update_super_or_self
on public.profiles
for update
to authenticated
using (user_id = auth.uid() or public.streakup_is_super_admin())
with check (user_id = auth.uid() or public.streakup_is_super_admin());

-- cafes
drop policy if exists cafes_select_scoped on public.cafes;
create policy cafes_select_scoped
on public.cafes
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
);

drop policy if exists cafes_write_super_or_hq on public.cafes;
create policy cafes_write_super_or_hq
on public.cafes
for insert
to authenticated
with check (public.streakup_is_super_admin());

drop policy if exists cafes_update_super_or_hq on public.cafes;
create policy cafes_update_super_or_hq
on public.cafes
for update
to authenticated
using (
  public.streakup_is_super_admin()
  or id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
)
with check (
  public.streakup_is_super_admin()
  or id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
);

drop policy if exists cafes_delete_super on public.cafes;
create policy cafes_delete_super
on public.cafes
for delete
to authenticated
using (public.streakup_is_super_admin());

-- branches
drop policy if exists branches_select_scoped on public.branches;
create policy branches_select_scoped
on public.branches
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
);

drop policy if exists branches_insert_super_or_hq on public.branches;
create policy branches_insert_super_or_hq
on public.branches
for insert
to authenticated
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists branches_update_super_or_hq_or_manager on public.branches;
create policy branches_update_super_or_hq_or_manager
on public.branches
for update
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (
      (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
      or (
        (select p.role from public.profiles p where p.user_id = auth.uid()) = 'branch_manager'::public.streakup_role
        and id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
      )
    )
  )
)
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (
      (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
      or (
        (select p.role from public.profiles p where p.user_id = auth.uid()) = 'branch_manager'::public.streakup_role
        and id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
      )
    )
  )
);

drop policy if exists branches_delete_super_or_hq on public.branches;
create policy branches_delete_super_or_hq
on public.branches
for delete
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

-- api_keys
drop policy if exists api_keys_select_super_or_hq on public.api_keys;
create policy api_keys_select_super_or_hq
on public.api_keys
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists api_keys_write_super_or_hq on public.api_keys;
create policy api_keys_write_super_or_hq
on public.api_keys
for insert
to authenticated
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists api_keys_update_super_or_hq on public.api_keys;
create policy api_keys_update_super_or_hq
on public.api_keys
for update
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
)
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists api_keys_delete_super_or_hq on public.api_keys;
create policy api_keys_delete_super_or_hq
on public.api_keys
for delete
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

-- customers
drop policy if exists customers_select_scoped on public.customers;
create policy customers_select_scoped
on public.customers
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or auth_user_id = auth.uid()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
  or (
    (select p.role from public.profiles p where p.user_id = auth.uid()) = 'branch_manager'::public.streakup_role
    and exists (
      select 1
      from public.visits v
      where v.customer_id = customers.id
        and v.branch_id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
    )
  )
);

drop policy if exists customers_insert_super_or_hq on public.customers;
create policy customers_insert_super_or_hq
on public.customers
for insert
to authenticated
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists customers_update_super_or_hq on public.customers;
create policy customers_update_super_or_hq
on public.customers
for update
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
)
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists customers_delete_super on public.customers;
create policy customers_delete_super
on public.customers
for delete
to authenticated
using (public.streakup_is_super_admin());

-- visits
drop policy if exists visits_select_scoped on public.visits;
create policy visits_select_scoped
on public.visits
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
  or (
    (select p.role from public.profiles p where p.user_id = auth.uid()) in ('branch_manager', 'cashier')
    and branch_id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
  )
  or exists (
    select 1
    from public.customers c
    where c.id = visits.customer_id
      and c.auth_user_id = auth.uid()
  )
);

drop policy if exists visits_insert_scoped on public.visits;
create policy visits_insert_scoped
on public.visits
for insert
to authenticated
with check (
  public.streakup_is_super_admin()
  or (
    exists (
      select 1
      from public.profiles p
      join public.branches b on b.id = visits.branch_id
      where p.user_id = auth.uid()
        and p.cafe_id = visits.cafe_id
        and b.cafe_id = visits.cafe_id
        and (
          p.role = 'hq_owner'::public.streakup_role
          or (
            p.role in ('branch_manager', 'cashier')
            and p.branch_id = visits.branch_id
          )
        )
    )
    and exists (
      select 1
      from public.customers c
      where c.id = visits.customer_id
        and c.cafe_id = visits.cafe_id
    )
  )
);

drop policy if exists visits_update_super on public.visits;
create policy visits_update_super
on public.visits
for update
to authenticated
using (public.streakup_is_super_admin())
with check (public.streakup_is_super_admin());

drop policy if exists visits_delete_super on public.visits;
create policy visits_delete_super
on public.visits
for delete
to authenticated
using (public.streakup_is_super_admin());

-- reward_milestones
drop policy if exists reward_milestones_select_scoped on public.reward_milestones;
create policy reward_milestones_select_scoped
on public.reward_milestones
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
);

drop policy if exists reward_milestones_write_super_or_hq on public.reward_milestones;
create policy reward_milestones_write_super_or_hq
on public.reward_milestones
for all
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
)
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

-- rewards
drop policy if exists rewards_select_scoped on public.rewards;
create policy rewards_select_scoped
on public.rewards
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
  or exists (
    select 1
    from public.customers c
    where c.id = rewards.customer_id
      and c.auth_user_id = auth.uid()
  )
);

drop policy if exists rewards_write_super_or_hq on public.rewards;
create policy rewards_write_super_or_hq
on public.rewards
for insert
to authenticated
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists rewards_update_super_or_hq on public.rewards;
create policy rewards_update_super_or_hq
on public.rewards
for update
to authenticated
using (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
)
with check (
  public.streakup_is_super_admin()
  or (
    cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid())
    and (select p.role from public.profiles p where p.user_id = auth.uid()) = 'hq_owner'::public.streakup_role
  )
);

drop policy if exists rewards_delete_super on public.rewards;
create policy rewards_delete_super
on public.rewards
for delete
to authenticated
using (public.streakup_is_super_admin());

-- audit_log (read scoped; writes happen via SECURITY DEFINER RPC / service role)
drop policy if exists audit_log_select_scoped on public.audit_log;
create policy audit_log_select_scoped
on public.audit_log
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
  or (
    (select p.role from public.profiles p where p.user_id = auth.uid()) = 'branch_manager'::public.streakup_role
    and branch_id = (select p.branch_id from public.profiles p where p.user_id = auth.uid())
  )
);

-- visit_idempotency_keys: no policies => PostgREST users cannot read/write directly.
-- service_role bypasses RLS for automation jobs.

-- subscriptions
drop policy if exists subscriptions_select_super_or_hq on public.subscriptions;
create policy subscriptions_select_super_or_hq
on public.subscriptions
for select
to authenticated
using (
  public.streakup_is_super_admin()
  or cafe_id = (select p.cafe_id from public.profiles p where p.user_id = auth.uid() and p.role = 'hq_owner'::public.streakup_role)
);

drop policy if exists subscriptions_write_super on public.subscriptions;
create policy subscriptions_write_super
on public.subscriptions
for insert
to authenticated
with check (public.streakup_is_super_admin());

drop policy if exists subscriptions_update_super on public.subscriptions;
create policy subscriptions_update_super
on public.subscriptions
for update
to authenticated
using (public.streakup_is_super_admin())
with check (public.streakup_is_super_admin());

drop policy if exists subscriptions_delete_super on public.subscriptions;
create policy subscriptions_delete_super
on public.subscriptions
for delete
to authenticated
using (public.streakup_is_super_admin());

-- -----------------------------------------------------------------------------
-- Grants (Supabase roles)
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant select on tables to anon;

commit;
