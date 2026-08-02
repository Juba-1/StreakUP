import {
  daysBetween,
  HIGH_STREAK_THRESHOLD,
  INACTIVE_DAYS,
  NEW_CUSTOMER_DAYS,
  type CustomerFilter,
  type CustomerRow,
  type CustomerStatusKind,
  type MilestoneMeta,
} from '@/routes/hq/customers/types'

export function nextMilestone(
  streak: number,
  milestones: MilestoneMeta[],
): MilestoneMeta | null {
  const sorted = [...milestones].filter((m) => m.days > 0).sort((a, b) => a.days - b.days)
  return sorted.find((m) => m.days > streak) ?? null
}

export function nextMilestoneDays(
  streak: number,
  milestones: number[] | MilestoneMeta[],
): number | null {
  const days = milestones.map((m) => (typeof m === 'number' ? m : m.days))
  const next = days.filter((d) => d > 0).sort((a, b) => a - b).find((d) => d > streak)
  return next ?? null
}

export function isNearReward(
  streak: number,
  milestones: number[] | MilestoneMeta[],
): boolean {
  const next = nextMilestoneDays(streak, milestones)
  return next != null && next - streak === 1
}

export function rewardProgress(
  streak: number,
  milestones: number[] | MilestoneMeta[],
): {
  current: number
  target: number | null
  pct: number
} {
  const sorted = milestones
    .map((m) => (typeof m === 'number' ? m : m.days))
    .filter((d) => d > 0)
    .sort((a, b) => a - b)
  const next = sorted.find((d) => d > streak) ?? null
  const prev = [...sorted].reverse().find((d) => d <= streak) ?? 0
  if (next == null) {
    return { current: streak, target: null, pct: 100 }
  }
  const span = Math.max(1, next - prev)
  const pct = Math.min(100, Math.round(((streak - prev) / span) * 100))
  return { current: streak, target: next, pct }
}

export function isInactive(row: CustomerRow, today: string): boolean {
  if (!row.last_visit_date) {
    const created = row.created_at.slice(0, 10)
    return daysBetween(created, today) >= INACTIVE_DAYS
  }
  return daysBetween(row.last_visit_date, today) >= INACTIVE_DAYS
}

export function isNewCustomer(row: CustomerRow, today: string): boolean {
  const created = row.created_at.slice(0, 10)
  return daysBetween(created, today) <= NEW_CUSTOMER_DAYS
}

export function isLostStreak(row: CustomerRow): boolean {
  return row.current_streak === 0 && row.longest_streak > 0
}

export function isActiveCustomer(
  row: CustomerRow,
  today: string,
  milestones: number[] | MilestoneMeta[],
): boolean {
  if (isInactive(row, today)) return false
  if (isLostStreak(row)) return false
  return (
    row.current_streak > 0 ||
    row.last_visit_date === today ||
    isNearReward(row.current_streak, milestones)
  )
}

export function matchesFilter(
  row: CustomerRow,
  filter: CustomerFilter,
  today: string,
  milestones: number[] | MilestoneMeta[],
  readyCustomerIds?: Set<string>,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'active':
      return isActiveCustomer(row, today, milestones)
    case 'near_reward':
      return isNearReward(row.current_streak, milestones)
    case 'high_streak':
      return row.current_streak >= HIGH_STREAK_THRESHOLD
    case 'inactive':
      return isInactive(row, today)
    case 'visited_today':
      return row.last_visit_date === today
    case 'returning':
      return row.last_visit_date === today && row.longest_streak > 1
    case 'new':
      return isNewCustomer(row, today)
    case 'lost_streak':
      return isLostStreak(row)
    case 'has_shield':
      return row.shields > 0
    case 'ready_reward':
      return readyCustomerIds?.has(row.id) ?? false
    default:
      return true
  }
}

export function primaryStatus(
  row: CustomerRow,
  today: string,
  milestones: number[] | MilestoneMeta[],
): CustomerStatusKind {
  if (isNearReward(row.current_streak, milestones)) return 'near_reward'
  if (isLostStreak(row)) return 'lost_streak'
  if (row.current_streak >= HIGH_STREAK_THRESHOLD) return 'high_streak'
  if (isNewCustomer(row, today)) return 'new'
  if (isInactive(row, today)) return 'inactive'
  return 'active'
}

/** Filters backed by cafe-scoped snapshot / reward rows — no new RPCs. */
export const ENABLED_FILTERS: CustomerFilter[] = [
  'all',
  'active',
  'near_reward',
  'lost_streak',
  'has_shield',
  'ready_reward',
  'high_streak',
  'inactive',
  'visited_today',
  'returning',
  'new',
]

export const DISABLED_FILTERS: CustomerFilter[] = []

/** Primary chips shown in the toolbar (mockup order). */
export const PRIMARY_FILTERS: CustomerFilter[] = [
  'all',
  'active',
  'near_reward',
  'lost_streak',
  'has_shield',
  'ready_reward',
]
