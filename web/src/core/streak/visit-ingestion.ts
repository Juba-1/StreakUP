import { sha256Hex } from '@/core/crypto/sha256'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

/**
 * Visit writes are idempotent per (cafe_id, idempotency_key) in Postgres: concurrent callers
 * with the same key either insert once or receive a replay of the original visit_id; a key
 * reused with a different payload hash raises idempotency_key_conflict (no double engine run).
 */

export type RecordVisitIdempotentInput = {
  branchId: string
  customerId: string
  idempotencyKey: string
  eventType?: 'check_in' | 'reward_redeem' | 'adjustment' | 'system'
  clientVisitDate?: string | null
}

export function canonicalRecordVisitPayload(input: RecordVisitIdempotentInput) {
  return JSON.stringify({
    branchId: input.branchId,
    customerId: input.customerId,
    eventType: input.eventType ?? 'check_in',
    clientVisitDate: input.clientVisitDate ?? null,
  })
}

export async function hashRecordVisitPayload(input: RecordVisitIdempotentInput) {
  return sha256Hex(canonicalRecordVisitPayload(input))
}

/**
 * Calls the hardened database RPC (`public.record_visit_idempotent`) directly.
 * Prefer `recordVisitViaEdge` for POS/BFF integrations that must not hold DB credentials.
 */
export async function recordVisitIdempotent(input: RecordVisitIdempotentInput) {
  if (!supabaseBrowserClient) {
    throw new Error('Supabase is not configured (missing VITE_SUPABASE_URL / KEY).')
  }

  const payloadSha256 = await hashRecordVisitPayload(input)

  const { data, error } = await supabaseBrowserClient.rpc('record_visit_idempotent', {
    p_branch_id: input.branchId,
    p_customer_id: input.customerId,
    p_idempotency_key: input.idempotencyKey,
    p_payload_sha256: payloadSha256,
    p_event_type: input.eventType ?? 'check_in',
    p_client_visit_date: input.clientVisitDate,
  })

  if (error) throw error
  return parseRecordVisitResponse(data)
}

/**
 * Calls the locked-down Edge Function, which accepts either a user JWT or an enterprise key.
 */
export type RecordVisitResult = {
  status?: string
  visit_id?: string
  visit_date?: string
  streak_after?: number
  already_visited_today?: boolean
  engine?: {
    already_visited_today?: boolean
    streak_after?: number
    shields_after?: number
  }
}

function truthyFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

/** Peel Edge `{ ok, data }` wrappers until we reach the RPC payload. */
function unwrapVisitPayload(raw: unknown, depth = 0): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || depth > 4) return {}
  const o = raw as Record<string, unknown>
  if (o.data && typeof o.data === 'object') {
    return unwrapVisitPayload(o.data, depth + 1)
  }
  return o
}

/** Normalize RPC + Edge Function envelopes into a flat visit payload. */
export function parseRecordVisitResponse(raw: unknown): RecordVisitResult {
  const nested = unwrapVisitPayload(raw)

  const engine =
    nested.engine && typeof nested.engine === 'object'
      ? (nested.engine as Record<string, unknown>)
      : undefined

  const metadata =
    nested.metadata && typeof nested.metadata === 'object'
      ? (nested.metadata as Record<string, unknown>)
      : undefined

  const status = typeof nested.status === 'string' ? nested.status : undefined

  const already =
    truthyFlag(nested.already_visited_today) ||
    truthyFlag(engine?.already_visited_today) ||
    truthyFlag(metadata?.already_visited_today) ||
    // Phase 37: explicit duplicate-day outcome. Treat as "already visited today"
    // so all existing UI paths remain graceful even if the boolean flag is absent.
    status === 'already_checked_in'

  return {
    status,
    visit_id: typeof nested.visit_id === 'string' ? nested.visit_id : undefined,
    visit_date: typeof nested.visit_date === 'string' ? nested.visit_date : undefined,
    streak_after:
      typeof nested.streak_after === 'number'
        ? nested.streak_after
        : typeof engine?.streak_after === 'number'
          ? engine.streak_after
          : undefined,
    already_visited_today: already,
    engine: engine as RecordVisitResult['engine'],
  }
}

export async function recordVisitViaEdge(input: RecordVisitIdempotentInput) {
  if (!supabaseBrowserClient) {
    throw new Error('Supabase is not configured (missing VITE_SUPABASE_URL / KEY).')
  }

  const payloadSha256 = await hashRecordVisitPayload(input)

  const { data, error } = await supabaseBrowserClient.functions.invoke('record-visit', {
    body: {
      branchId: input.branchId,
      customerId: input.customerId,
      idempotencyKey: input.idempotencyKey,
      payloadSha256,
      eventType: input.eventType ?? 'check_in',
      clientVisitDate: input.clientVisitDate ?? null,
    },
    headers: {
      'x-idempotency-key': input.idempotencyKey,
    },
  })

  if (error) throw error
  return parseRecordVisitResponse(data)
}
