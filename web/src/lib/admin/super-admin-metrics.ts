export type SuperAdminHeadline = {
  active_cafes: number
  total_end_users: number
  global_shield_saves: number
  avg_commitment_rate_pct: number
  active_streaks_now: number
  check_ins_today: number
  visits_total: number
  branches_total: number
  webhooks_pending: number
  webhooks_live: number
}

export type DailyCheckInRow = { date: string; check_ins: number }

export type SurvivalRow = { day: number; reached: number; eligible: number; rate_pct: number }

export type SuperAdminGlobalMetrics = {
  ok: boolean
  generated_at?: string
  headline?: SuperAdminHeadline
  daily_check_ins?: DailyCheckInRow[]
  streak_survival?: SurvivalRow[]
  shield_salvage?: {
    check_in_saves: number
    midnight_saves: number
    total_saves: number
    gap_opportunities: number
    salvage_rate_pct: number
  }
}

export type TenantPulse = 'hot' | 'warm' | 'cool' | 'inactive'

export type TenantPulseRow = {
  id: string
  name: string
  slug: string
  status: string
  timezone: string
  currency_code: string
  created_at: string
  subscription_status: string | null
  plan_tier: string | null
  customer_count: number
  check_ins_today: number
  last_active_at: string | null
  pulse: TenantPulse
}

export type SuperAdminTenantPulseList = {
  ok: boolean
  total: number
  limit: number
  offset: number
  tenants: TenantPulseRow[]
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function parseSuperAdminGlobalMetrics(raw: unknown): SuperAdminGlobalMetrics {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false }
  const o = raw as Record<string, unknown>
  const h = (o.headline ?? {}) as Record<string, unknown>
  return {
    ok: Boolean(o.ok),
    generated_at: typeof o.generated_at === 'string' ? o.generated_at : undefined,
    headline: {
      active_cafes: num(h.active_cafes),
      total_end_users: num(h.total_end_users),
      global_shield_saves: num(h.global_shield_saves),
      avg_commitment_rate_pct: num(h.avg_commitment_rate_pct),
      active_streaks_now: num(h.active_streaks_now),
      check_ins_today: num(h.check_ins_today),
      visits_total: num(h.visits_total),
      branches_total: num(h.branches_total),
      webhooks_pending: num(h.webhooks_pending),
      webhooks_live: num(h.webhooks_live),
    },
    daily_check_ins: Array.isArray(o.daily_check_ins)
      ? (o.daily_check_ins as Record<string, unknown>[]).map((r) => ({
          date: String(r.date ?? ''),
          check_ins: num(r.check_ins),
        }))
      : [],
    streak_survival: Array.isArray(o.streak_survival)
      ? (o.streak_survival as Record<string, unknown>[]).map((r) => ({
          day: num(r.day),
          reached: num(r.reached),
          eligible: num(r.eligible),
          rate_pct: num(r.rate_pct),
        }))
      : [],
    shield_salvage: o.shield_salvage as SuperAdminGlobalMetrics['shield_salvage'],
  }
}

export function parseSuperAdminTenantPulseList(raw: unknown): SuperAdminTenantPulseList {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, total: 0, limit: 25, offset: 0, tenants: [] }
  }
  const o = raw as Record<string, unknown>
  const tenants = Array.isArray(o.tenants)
    ? (o.tenants as Record<string, unknown>[]).map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        slug: String(r.slug ?? ''),
        status: String(r.status ?? ''),
        timezone: String(r.timezone ?? ''),
        currency_code: String(r.currency_code ?? ''),
        created_at: String(r.created_at ?? ''),
        subscription_status:
          r.subscription_status == null ? null : String(r.subscription_status),
        plan_tier: r.plan_tier == null ? null : String(r.plan_tier),
        customer_count: num(r.customer_count),
        check_ins_today: num(r.check_ins_today),
        last_active_at: r.last_active_at == null ? null : String(r.last_active_at),
        pulse: (['hot', 'warm', 'cool', 'inactive'].includes(String(r.pulse))
          ? String(r.pulse)
          : 'inactive') as TenantPulse,
      }))
    : []
  return {
    ok: Boolean(o.ok),
    total: num(o.total),
    limit: num(o.limit, 25),
    offset: num(o.offset),
    tenants,
  }
}
