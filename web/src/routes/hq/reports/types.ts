export type DatePreset = 'today' | '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom'

export type BreakdownRow = { label: string; icon_type: string; count: number }

export type OwnerMetrics = {
  active_streaks_now: number
  shield_saves: number
  streak_champions: number
  broken_streaks_this_week: number
  rewards_claimed_total: number
  rewards_ready_to_claim: number
}

export type OwnerPayload = {
  ok: boolean
  window_days?: number
  timezone?: string
  owner?: OwnerMetrics
  claimed_breakdown?: BreakdownRow[]
  ready_breakdown?: BreakdownRow[]
  totals?: { customers: number; check_ins_window: number }
  reason?: string
}

export type DailyVisit = { d: string; c: number; u?: number }

export type BranchTotal = {
  branch_id: string
  branch_code: string
  name: string
  visits: number
  unique_customers: number
}

/** Hour × weekday intensity cell — built from cafe-scoped visit timestamps only. */
export type HeatCell = {
  /** 0 = Sunday … 6 = Saturday (JS getDay) */
  dow: number
  /** 0–23 local hour */
  hour: number
  count: number
}

export type SeriesPayload = {
  daily_visits: DailyVisit[]
  branch_totals: BranchTotal[]
  retention: { active_customers_window: number; total_customers: number }
}

/** Shared page lens — presentation only; never refetches. */
export type ActiveTab = 'visits' | 'retention' | 'rewards' | 'roi'

export type DrawerKind = 'retention' | 'returning' | 'rewards' | 'branch' | 'roi' | 'visits' | null

export type InsightAction =
  | { type: 'drawer'; kind: Exclude<DrawerKind, null> }
  | { type: 'tab'; tab: ActiveTab }
  | { type: 'scroll'; id: string }
  | { type: 'route'; path: 'customers' | 'rewards' }

export type ReportsInsight = {
  id: string
  tone: 'success' | 'warning' | 'info'
  titleKey: string
  bodyKey: string
  action: InsightAction
  count?: number
  name?: string
  branchId?: string
  /** Tabs this insight is most relevant to; empty = always show. */
  tabs?: ActiveTab[]
}

export type StoryBullet = {
  id: string
  textKey: string
  name?: string
  n?: number
  tabs?: ActiveTab[]
}

export type ExecutiveBrief = {
  bullets: StoryBullet[]
  recommendationKey: string | null
  cta: InsightAction | null
}

export type RankedBranch = BranchTotal & {
  rank: number
  share: number
  /** Share of visits vs café total in window — real ratio, not a period delta. */
}

/** Maps UI presets to RPC `p_days` (both owner + series RPCs accept int days). */
export function presetToDays(preset: DatePreset, now = new Date()): number | null {
  switch (preset) {
    case 'today':
      return 1
    case '7d':
      return 7
    case '30d':
      return 30
    case '90d':
      return 90
    case 'ytd': {
      const start = new Date(now.getFullYear(), 0, 1)
      const diff = Math.ceil((now.getTime() - start.getTime()) / 86_400_000) + 1
      return Math.min(365, Math.max(1, diff))
    }
    case 'all':
      return 365
    case 'custom':
      return null // TODO: Connect backend date parameters for custom from/to.
  }
}

export function parseOwner(data: unknown): OwnerPayload {
  if (!data || typeof data !== 'object') return { ok: false }
  return data as OwnerPayload
}

export function parseSeries(data: unknown): SeriesPayload {
  const raw =
    typeof data === 'string'
      ? (JSON.parse(data) as SeriesPayload)
      : (data as SeriesPayload | null)
  return {
    daily_visits: raw?.daily_visits ?? [],
    branch_totals: raw?.branch_totals ?? [],
    retention: raw?.retention ?? { active_customers_window: 0, total_customers: 0 },
  }
}

export function retentionPct(active: number, total: number): number | null {
  if (!total || total <= 0) return null
  return Math.round((100 * active) / total)
}

/** Compare first vs second half of the already-loaded daily series. */
export function visitMomentumPct(daily: DailyVisit[]): number | null {
  if (daily.length < 4) return null
  const vals = daily.map((d) => Number(d.c) || 0)
  const mid = Math.floor(vals.length / 2)
  const a = vals.slice(0, mid).reduce((s, v) => s + v, 0)
  const b = vals.slice(mid).reduce((s, v) => s + v, 0)
  if (a === 0) return b > 0 ? 100 : null
  return Math.round(((b - a) / a) * 100)
}

export function peakVisitDay(daily: DailyVisit[]): DailyVisit | null {
  if (daily.length === 0) return null
  let best = daily[0]!
  for (const row of daily) {
    if (Number(row.c) > Number(best.c)) best = row
  }
  if (Number(best.c) <= 0) return null
  return best
}

export function rankBranches(branches: BranchTotal[]): RankedBranch[] {
  const total = branches.reduce((s, b) => s + (b.visits || 0), 0)
  return [...branches]
    .sort((a, b) => b.visits - a.visits)
    .map((b, i) => ({
      ...b,
      rank: i + 1,
      share: total > 0 ? Math.round((100 * b.visits) / total) : 0,
    }))
}
