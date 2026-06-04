-- =============================================================================
-- StreakUp — Phase 16: Default loyalty milestones (auto-seed + backfill)
--
-- WHY THIS EXISTS
--   The customer "My Streak" page renders the loyalty roadmap from
--   public.reward_milestones, but no rows are seeded when a cafe is
--   provisioned. New tenants therefore see a beautifully animated dashboard
--   with zero gamification — defeating the entire product premise.
--
--   This migration:
--     1. Defines a canonical default journey (3 → 5 → 10 → 21 → 50 days).
--     2. Adds `seed_default_reward_milestones(p_cafe_id)` — idempotent.
--     3. Hooks a deferred AFTER INSERT trigger on `public.cafes` so every
--        new tenant ships with that journey on day zero.
--     4. Backfills the same rows for every existing cafe that has fewer
--        than three milestones (so the live tenants light up immediately
--        after this script runs).
--
--   Safe to re-run. The seed function uses ON CONFLICT DO NOTHING against
--   the `(cafe_id, name)` unique index that already exists.
-- =============================================================================

begin;

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
    (cafe_id, name, days_required, reward_label, sort_order, active)
  values
    (p_cafe_id, 'Warm-Up',     3,  'Complimentary upgrade',    10, true),
    (p_cafe_id, 'Regular',     5,  'Free pastry of the day',   20, true),
    (p_cafe_id, 'Loyalist',    10, 'Free beverage',            30, true),
    (p_cafe_id, 'Streak Pro',  21, 'Signature combo on us',    40, true),
    (p_cafe_id, 'Legend',      50, 'VIP loyalty perk',         50, true)
  on conflict (cafe_id, name) do nothing;
end;
$$;

revoke all on function public.seed_default_reward_milestones(uuid) from public;

-- ---------------------------------------------------------------------------
-- AFTER INSERT trigger on public.cafes
-- ---------------------------------------------------------------------------
create or replace function public._cafes_seed_milestones_ai()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.seed_default_reward_milestones(new.id);
  return new;
end;
$$;

drop trigger if exists cafes_seed_default_milestones_ai on public.cafes;
create trigger cafes_seed_default_milestones_ai
after insert on public.cafes
for each row
execute function public._cafes_seed_milestones_ai();

-- ---------------------------------------------------------------------------
-- Backfill: every existing cafe with fewer than 3 milestones gets seeded.
-- This is intentionally conservative — if a tenant has already curated their
-- journey, we don't touch it.
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
      from public.reward_milestones
      group by cafe_id
    ) rm on rm.cafe_id = c.id
    where coalesce(rm.n, 0) < 3
  loop
    perform public.seed_default_reward_milestones(v_id);
  end loop;
end
$$;

commit;
