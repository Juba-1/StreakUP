/**
 * Client-side rolling-window attempt tracker. Used to temporarily lock out a
 * form (login, cashier PIN, customer portal) after repeated failures so the
 * browser stops hammering the backend and triggering global throttles.
 *
 * Server-side enforcement still exists in Postgres/Edge Functions — this is a
 * defensive UX layer, not the only control.
 */

type Attempt = { at: number }

export type RateWindow = {
  /** Human-readable lane identifier; e.g. 'login', 'cashier:pin'. */
  lane: string
  /** Maximum allowed failures within the window before lockout engages. */
  max: number
  /** Rolling window length in milliseconds. */
  windowMs: number
  /** How long the lockout persists after the threshold is crossed. */
  cooldownMs: number
}

type LaneState = {
  attempts: Attempt[]
  lockedUntil: number
}

const memory = new Map<string, LaneState>()

function keyFor(cfg: RateWindow, subject: string) {
  return `${cfg.lane}::${subject}`
}

export function getLockoutMsRemaining(cfg: RateWindow, subject: string): number {
  const key = keyFor(cfg, subject)
  const st = memory.get(key)
  if (!st) return 0
  const now = Date.now()
  return Math.max(0, st.lockedUntil - now)
}

export function registerFailure(cfg: RateWindow, subject: string): { lockedMs: number } {
  const key = keyFor(cfg, subject)
  const now = Date.now()
  const st = memory.get(key) ?? { attempts: [], lockedUntil: 0 }
  st.attempts = st.attempts.filter((a) => now - a.at < cfg.windowMs)
  st.attempts.push({ at: now })
  if (st.attempts.length >= cfg.max) {
    st.lockedUntil = now + cfg.cooldownMs
    st.attempts = []
  }
  memory.set(key, st)
  return { lockedMs: Math.max(0, st.lockedUntil - now) }
}

export function registerSuccess(cfg: RateWindow, subject: string): void {
  memory.delete(keyFor(cfg, subject))
}

export const LOGIN_WINDOW: RateWindow = {
  lane: 'login',
  max: 5,
  windowMs: 60_000,
  cooldownMs: 30_000,
}

export const CASHIER_PIN_WINDOW: RateWindow = {
  lane: 'cashier:pin',
  max: 5,
  windowMs: 60_000,
  cooldownMs: 45_000,
}

export const CUSTOMER_PORTAL_WINDOW: RateWindow = {
  lane: 'customer-portal',
  max: 6,
  windowMs: 90_000,
  cooldownMs: 60_000,
}
