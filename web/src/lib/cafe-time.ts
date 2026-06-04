/** Format a Date's calendar day in an IANA timezone as YYYY-MM-DD. */
export function cafeLocalDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00'

  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Add whole calendar days to a YYYY-MM-DD key (timezone-agnostic date math). */
export function addDaysToDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/**
 * First instant (UTC) when the cafe's local calendar date reaches `targetDateKey`
 * at 00:00:00, searching forward from `from`.
 */
export function cafeMidnightUtc(from: Date, timeZone: string, targetDateKey: string): Date {
  let lo = from.getTime()
  let hi = lo + 4 * 86_400_000

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const key = cafeLocalDateKey(new Date(mid), timeZone)
    if (key < targetDateKey) lo = mid + 1
    else hi = mid
  }

  return new Date(lo)
}

export function formatCountdown(totalMs: number): string {
  const clamped = Math.max(0, totalMs)
  const totalSec = Math.floor(clamped / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

export type StreakTimerAnchors = {
  nextVisitOpensAt: Date | null
  streakExpiresAt: Date | null
  nextVisitOpenNow: boolean
}

/**
 * Derive dual-timer targets for the customer portal.
 * - Next visit opens: upcoming cafe midnight if already visited today, else now.
 * - Streak expires: next-next cafe midnight if visited today, else next midnight (when streak > 0).
 */
export function getStreakTimerAnchors(input: {
  now?: Date
  timeZone: string
  visitedToday: boolean
  currentStreak: number
  serverNextVisitOpensAt?: string | null
  serverStreakExpiresAt?: string | null
}): StreakTimerAnchors {
  const now = input.now ?? new Date()
  const tz = input.timeZone || 'UTC'

  if (input.serverNextVisitOpensAt) {
    return {
      nextVisitOpensAt: input.visitedToday
        ? new Date(input.serverNextVisitOpensAt)
        : now,
      streakExpiresAt:
        input.serverStreakExpiresAt && input.currentStreak > 0
          ? new Date(input.serverStreakExpiresAt)
          : null,
      nextVisitOpenNow: !input.visitedToday,
    }
  }

  const todayKey = cafeLocalDateKey(now, tz)

  if (input.visitedToday) {
    const nextKey = addDaysToDateKey(todayKey, 1)
    const expireKey = addDaysToDateKey(todayKey, 2)
    return {
      nextVisitOpensAt: cafeMidnightUtc(now, tz, nextKey),
      streakExpiresAt:
        input.currentStreak > 0 ? cafeMidnightUtc(now, tz, expireKey) : null,
      nextVisitOpenNow: false,
    }
  }

  const expireKey = addDaysToDateKey(todayKey, 1)
  return {
    nextVisitOpensAt: now,
    streakExpiresAt:
      input.currentStreak > 0 ? cafeMidnightUtc(now, tz, expireKey) : null,
    nextVisitOpenNow: true,
  }
}
