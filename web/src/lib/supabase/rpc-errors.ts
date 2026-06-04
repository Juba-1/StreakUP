/** Structured JSON payloads returned by StreakUp SECURITY DEFINER RPCs. */
export type RpcEnvelope = {
  ok?: boolean
  reason?: string
  message?: string
  error?: string
  cap?: number
}

export function isPostgrestLikeError(err: unknown): err is {
  message?: string
  details?: string
  hint?: string
  code?: string
} {
  return Boolean(err && typeof err === 'object' && 'message' in err)
}

/** Human-readable transport-layer failure (network / PostgREST / Postgres). */
export function describeSupabaseTransportError(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim()) return err.trim()
  if (!isPostgrestLikeError(err)) return fallback

  const message = err.message?.trim() ?? ''
  const details = err.details?.trim() ?? ''
  const hint = err.hint?.trim() ?? ''

  if (/could not find the function/i.test(message)) {
    return 'RPC not deployed — run supabase/phase21.sql on your project.'
  }

  const parts = [message, details, hint].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : fallback
}

export function parseRpcEnvelope(data: unknown): RpcEnvelope {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid_response' }
  return data as RpcEnvelope
}

export type OverrideFailure =
  | { kind: 'transport'; detail: string }
  | { kind: 'rpc'; reason: string; message?: string; cap?: number }

export function classifyOverrideFailure(
  error: unknown,
  data: unknown,
  fallback: string,
): OverrideFailure | null {
  if (error) {
    return {
      kind: 'transport',
      detail: describeSupabaseTransportError(error, fallback),
    }
  }

  const envelope = parseRpcEnvelope(data)
  if (envelope.ok === true) return null

  return {
    kind: 'rpc',
    reason: envelope.reason ?? envelope.error ?? 'unknown',
    message: envelope.message,
    cap: typeof envelope.cap === 'number' ? envelope.cap : undefined,
  }
}
