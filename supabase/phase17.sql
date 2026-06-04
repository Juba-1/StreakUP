-- =============================================================================
-- StreakUp — Phase 17: Zero-friction onboarding — auto-provision "Main" branch
--
-- WHY THIS EXISTS
--   The product mandate is that a brand-new HQ Owner should see a working
--   cashier link the very first time they open their dashboard. Forcing a
--   single-location café to fill in a 4-field branch form just to get a
--   cashier PIN is unacceptable friction.
--
--   This migration:
--     1. Adds `public.seed_default_main_branch(p_cafe_id uuid)` — idempotent
--        helper that inserts a "Main" branch if and only if the café has
--        zero branches. Generates a cryptographically random 4-digit
--        cashier PIN and a 6-character manager password.
--     2. Hooks an AFTER INSERT trigger on `public.cafes` so every newly
--        provisioned tenant ships with its first branch on day zero.
--     3. Backfills the same row for every existing café that currently has
--        zero branches — so the live demo tenants light up immediately
--        after this script runs.
--
--   Safe to re-run. The helper short-circuits when any branch already
--   exists for the café, and the trigger uses `create or replace`.
--
-- HOW IT INTERACTS WITH PLAN LIMITS
--   The BEFORE INSERT trigger `branches_plan_guard_bi` from phase 10
--   enforces `max_branches` from the tenant's plan tier. When this seed
--   runs from inside an AFTER INSERT trigger on `cafes`, the café has no
--   subscription row yet (the provision Edge Function inserts that
--   separately) — `streakup_plan_limits_for_cafe` falls back to the
--   `starter` tier (max_branches = 10), so the first branch always
--   passes. Free-tier downgrades happen *after* the Main branch already
--   exists, which is the desired behaviour.
-- =============================================================================

begin;

create or replace function public._secure_branch_pin_4()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  b bytea;
  n int;
begin
  b := gen_random_bytes(2);
  n := (get_byte(b, 0)::int * 256 + get_byte(b, 1)::int) % 9000 + 1000;
  return lpad(n::text, 4, '0');
end;
$$;

create or replace function public._secure_manager_password()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- omit ambiguous 0,O,1,I
  out text := '';
  i int;
  idx int;
  b bytea;
begin
  b := gen_random_bytes(8);
  for i in 0..7 loop
    idx := (get_byte(b, i)::int % length(alphabet)) + 1;
    out := out || substr(alphabet, idx, 1);
  end loop;
  return out;
end;
$$;

create or replace function public.seed_default_main_branch(p_cafe_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_count bigint;
begin
  if p_cafe_id is null then
    return;
  end if;

  -- Idempotent guard: do nothing if the café already has any branch.
  select count(*) into v_existing_count
  from public.branches
  where cafe_id = p_cafe_id;

  if v_existing_count > 0 then
    return;
  end if;

  insert into public.branches (
    cafe_id, name, branch_code, manager_password, cashier_pin
  )
  values (
    p_cafe_id,
    'Main',
    'main',
    public._secure_manager_password(),
    public._secure_branch_pin_4()
  )
  on conflict (cafe_id, branch_code) do nothing;
end;
$$;

revoke all on function public.seed_default_main_branch(uuid) from public;
revoke all on function public._secure_branch_pin_4() from public;
revoke all on function public._secure_manager_password() from public;

-- ---------------------------------------------------------------------------
-- AFTER INSERT trigger on public.cafes
-- ---------------------------------------------------------------------------
create or replace function public._cafes_seed_main_branch_ai()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_main_branch(new.id);
  return new;
end;
$$;

drop trigger if exists cafes_seed_default_main_branch_ai on public.cafes;
create trigger cafes_seed_default_main_branch_ai
after insert on public.cafes
for each row
execute function public._cafes_seed_main_branch_ai();

-- ---------------------------------------------------------------------------
-- Backfill: every existing café that has no branches gets a "Main" branch.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  for v_id in
    select c.id
    from public.cafes c
    left join (
      select cafe_id, count(*)::int as n
      from public.branches
      group by cafe_id
    ) br on br.cafe_id = c.id
    where coalesce(br.n, 0) = 0
  loop
    perform public.seed_default_main_branch(v_id);
  end loop;
end
$$;

commit;
