export type CustomerRow = {
  id: string
  full_name: string
  pin_code: string
  current_streak: number
  longest_streak: number
  shields: number
  created_at: string
  updated_at: string
  last_visit_date: string | null
  phone?: string | null
}

export type CustomerFilter =
  | 'all'
  | 'active'
  | 'near_reward'
  | 'lost_streak'
  | 'has_shield'
  | 'ready_reward'
  | 'high_streak'
  | 'inactive'
  | 'visited_today'
  | 'returning'
  | 'new'

export type MilestoneMeta = {
  days: number
  name: string
  rewardLabel: string | null
}

export type CustomerSort = 'newest' | 'streak_desc' | 'streak_asc' | 'last_visit'

export type CustomerStatusKind =
  | 'high_streak'
  | 'near_reward'
  | 'lost_streak'
  | 'new'
  | 'inactive'
  | 'active'

export type ListResult = {
  ok: boolean
  total: number
  limit: number
  offset: number
  rows: CustomerRow[]
  reason?: string
}

export const PAGE_SIZE = 40

export const HIGH_STREAK_THRESHOLD = 7
export const INACTIVE_DAYS = 30
export const NEW_CUSTOMER_DAYS = 7

export function normalizeCustomerRow(raw: unknown): CustomerRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  return {
    id: r.id,
    full_name: typeof r.full_name === 'string' ? r.full_name : '',
    pin_code: String(r.pin_code ?? ''),
    current_streak: Number(r.current_streak ?? 0),
    longest_streak: Number(r.longest_streak ?? 0),
    shields: Number(r.shields ?? 0),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
    last_visit_date:
      r.last_visit_date == null || r.last_visit_date === ''
        ? null
        : String(r.last_visit_date),
    phone: r.phone == null ? null : String(r.phone),
  }
}

export function parseListResult(data: unknown, pageSize = PAGE_SIZE): ListResult {
  if (!data || typeof data !== 'object') {
    return { ok: false, total: 0, limit: pageSize, offset: 0, rows: [], reason: 'invalid_response' }
  }

  const o = data as Record<string, unknown>
  let rows = o.rows
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows) as unknown
    } catch {
      rows = []
    }
  }

  const flat: unknown[] = []
  if (Array.isArray(rows)) {
    for (const item of rows) {
      if (Array.isArray(item)) flat.push(...item)
      else flat.push(item)
    }
  }

  const parsedRows = flat
    .map(normalizeCustomerRow)
    .filter((row): row is CustomerRow => row !== null)

  return {
    ok: o.ok === true,
    total: Number(o.total ?? parsedRows.length),
    limit: Number(o.limit ?? pageSize),
    offset: Number(o.offset ?? 0),
    rows: parsedRows,
    reason: typeof o.reason === 'string' ? o.reason : undefined,
  }
}

export function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T12:00:00Z`).getTime()
  const b = new Date(`${bIso}T12:00:00Z`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY
  return Math.floor(Math.abs(b - a) / 86_400_000)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}
