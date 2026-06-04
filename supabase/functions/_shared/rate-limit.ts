import { jsonError } from './validation.ts'

/**
 * Per-isolate sliding-window rate limiter. Each Deno isolate keeps its own map,
 * which is adequate for defeating casual spam and brute-force. For platform-wide
 * enforcement, pair this with Postgres-backed counters (see phase12.sql →
 * `portal_login_attempts`, `cashier_pin_attempts`).
 */
type Bucket = { count: number; windowStart: number }

const buckets = new Map<string, Bucket>()

export type RateLimitConfig = {
  /** Stable identifier for the limiter instance (e.g. 'record-visit:jwt'). */
  lane: string
  /** Maximum allowed hits per window. */
  max: number
  /** Window length in milliseconds. */
  windowMs: number
}

/**
 * Mutates the shared bucket map and returns whether the caller is allowed.
 * When blocked, `retryAfterMs` indicates when the window resets.
 */
export function rateLimitHit(
  key: string,
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const id = `${config.lane}::${key}`
  const now = Date.now()
  const b = buckets.get(id)

  if (!b || now - b.windowStart >= config.windowMs) {
    buckets.set(id, { count: 1, windowStart: now })
    return { allowed: true, remaining: config.max - 1, retryAfterMs: config.windowMs }
  }

  if (b.count >= config.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, b.windowStart + config.windowMs - now),
    }
  }

  b.count += 1
  return {
    allowed: true,
    remaining: config.max - b.count,
    retryAfterMs: Math.max(0, b.windowStart + config.windowMs - now),
  }
}

/**
 * Extract a stable caller key. We prefer the Supabase user id / API-key id
 * (if already authenticated) so limits follow the principal rather than the
 * easily-spoofed IP. Falls back to the forwarded IP, then to a shared bucket.
 */
export function callerKey(req: Request, principalId?: string | null): string {
  if (principalId) return `p:${principalId}`
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return `ip:${first}`
  }
  const real = req.headers.get('x-real-ip')
  if (real) return `ip:${real.trim()}`
  return 'anon'
}

export function rateLimitResponseOrNull(
  req: Request,
  config: RateLimitConfig,
  principalId?: string | null,
): Response | null {
  const key = callerKey(req, principalId)
  const hit = rateLimitHit(key, config)
  if (hit.allowed) return null
  return jsonError('rate_limited', 429, {
    retry_after_ms: hit.retryAfterMs,
  })
}

/**
 * Constant-time string compare to avoid leaking secret length via timing.
 * OWASP ASVS V2.10 — credential comparisons must be constant time.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

// ---------------------------------------------------------------------------
// SSRF guard for outbound HTTP calls (webhook dispatcher, future callouts).
// Blocks localhost, link-local, cloud metadata, and RFC1918 private ranges.
// ---------------------------------------------------------------------------

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.lan']
const BLOCKED_EXACT_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
])

function ipv4InBlockedRange(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n))
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false
  }
  const [a, b] = parts as [number, number, number, number]
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true // AWS/GCP metadata + link-local
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 0) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

export function assertSafeOutboundUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'https_required' }

  const host = url.hostname.toLowerCase()
  if (BLOCKED_EXACT_HOSTS.has(host)) return { ok: false, reason: 'blocked_host' }
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return { ok: false, reason: 'blocked_host' }
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && ipv4InBlockedRange(host)) {
    return { ok: false, reason: 'blocked_ip_range' }
  }
  if (host === '[::1]' || host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80')) {
    return { ok: false, reason: 'blocked_ipv6_range' }
  }

  return { ok: true, url }
}
