/**
 * Bulletproof CORS for StreakUp Edge Functions.
 *
 * Production hardening
 * --------------------
 * Set `CORS_ALLOWED_ORIGINS` to a comma-separated list of fully-qualified
 * origins (e.g. `https://app.streakup.io,https://admin.streakup.io`). Each
 * incoming request's `Origin` header is echoed only when it matches one of
 * the configured entries (exact match, or `host` match when the entry has
 * no explicit port — useful for ephemeral preview URLs).
 *
 * Local development
 * -----------------
 * Loopback origins (`http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`)
 * are **always** allowed, regardless of the configured list. Localhost is
 * only reachable from the developer machine, so this avoids the trap where
 * the production allow-list silently locks out the Vite dev server while
 * keeping prod origins strict.
 *
 * Cross-cutting concerns
 * ----------------------
 *   * Preflight: returns 204 with `Access-Control-Max-Age` to cut RTT.
 *   * `Vary: Origin` is always emitted so caches don't pin the wrong origin.
 *   * `Access-Control-Allow-Headers` is the union of our internal headers and
 *     whatever the browser actually requested (`Access-Control-Request-Headers`).
 *   * Methods include `GET, POST, OPTIONS` — easy to extend per-route.
 */

const ALLOW_LIST: string[] = (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const HAS_WILDCARD = ALLOW_LIST.includes('*')

const INTERNAL_REQUEST_HEADERS = [
  'authorization',
  'x-client-info',
  'apikey',
  'content-type',
  'x-idempotency-key',
  'x-streakup-api-key',
  'x-supabase-api-version',
]

const PREFLIGHT_MAX_AGE_SECONDS = 600 // 10 minutes — long enough to cut RTT, short enough to roll out fixes.

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

function originMatchesEntry(entry: string, origin: string): boolean {
  if (!entry || !origin) return false
  if (entry === '*') return true
  if (entry === origin) return true
  try {
    const allowed = new URL(entry)
    const req = new URL(origin)
    if (allowed.protocol !== req.protocol) return false
    if (allowed.hostname.toLowerCase() !== req.hostname.toLowerCase()) return false
    // No port on the allow-list entry → accept any port for that host (preview deployments / vite-style ephemeral ports).
    return allowed.port ? allowed.port === req.port : true
  } catch {
    return false
  }
}

/**
 * Returns the value to echo as `Access-Control-Allow-Origin`, or `null` if
 * the origin is not permitted. `null` callers should return CORS headers
 * with no origin so the browser blocks the response (and the function still
 * responds with a useful JSON body for non-browser debuggers).
 */
export function resolveAllowedOrigin(requestOrigin: string | null): string | null {
  const origin = (requestOrigin ?? '').trim()
  if (!origin) {
    // Non-browser caller (curl, server-to-server). Mirror permissive behaviour:
    //   * wildcard list → `*`
    //   * empty list → `*` (dev fallback)
    //   * specific list → first entry (so headers parse, even if browsers will block).
    if (HAS_WILDCARD || ALLOW_LIST.length === 0) return '*'
    return ALLOW_LIST[0] ?? '*'
  }
  if (HAS_WILDCARD) return origin
  if (isLoopbackOrigin(origin)) return origin
  if (ALLOW_LIST.length === 0) return origin // dev fallback when env unset
  for (const entry of ALLOW_LIST) {
    if (originMatchesEntry(entry, origin)) return origin
  }
  return null
}

type CorsOptions = {
  /** Override the methods string (default: `GET, POST, OPTIONS`). */
  methods?: string
  /** Extra headers to echo in `Access-Control-Allow-Headers`. */
  extraAllowHeaders?: string[]
  /** Allow credentials. We default to false — Supabase JWTs are sent as bearer tokens, not cookies. */
  credentials?: boolean
}

/**
 * Compute CORS response headers for a given request. Always safe to merge
 * into any Response — never throws.
 */
export function corsHeadersFor(req: Request, options: CorsOptions = {}): Record<string, string> {
  const origin = req.headers.get('origin')
  const allowed = resolveAllowedOrigin(origin)

  const requested = (req.headers.get('access-control-request-headers') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)

  const headerSet = new Set<string>([
    ...INTERNAL_REQUEST_HEADERS,
    ...(options.extraAllowHeaders ?? []).map((h) => h.toLowerCase()),
    ...requested,
  ])

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowed ?? 'null',
    'Access-Control-Allow-Headers': Array.from(headerSet).join(', '),
    'Access-Control-Allow-Methods': options.methods ?? 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_SECONDS),
    'Access-Control-Expose-Headers': 'content-type, content-length',
    'Vary': 'Origin, Access-Control-Request-Headers, Access-Control-Request-Method',
  }

  if (options.credentials && allowed && allowed !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true'
  }

  return headers
}

/**
 * Build a 204 No Content preflight response. Use this from every Edge
 * Function's `OPTIONS` branch — `Deno.serve` will short-circuit cleanly.
 */
export function preflightResponse(req: Request, options: CorsOptions = {}): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeadersFor(req, options),
  })
}

/**
 * Merge CORS headers into any Response. Idempotent — calling it twice will
 * just refresh the headers with the latest request-aware values.
 */
export function withCorsHeaders(
  res: Response,
  cors: Record<string, string>,
): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(cors)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

/**
 * Legacy export — kept so older Edge Functions that import `corsHeaders`
 * (a static fallback computed at module load) keep compiling. New code
 * should call `corsHeadersFor(req)` so we get loopback handling and the
 * browser's actual requested headers echoed back.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': HAS_WILDCARD || ALLOW_LIST.length === 0 ? '*' : (ALLOW_LIST[0] ?? '*'),
  'Access-Control-Allow-Headers': INTERNAL_REQUEST_HEADERS.join(', '),
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_SECONDS),
  'Vary': 'Origin, Access-Control-Request-Headers, Access-Control-Request-Method',
}
