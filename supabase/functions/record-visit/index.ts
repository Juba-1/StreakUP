import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

import {
  assertBranchBelongsToCafe,
  assertCustomerBelongsToCafe,
  verifyCaller,
} from '../_shared/auth.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { callerKey, rateLimitResponseOrNull } from '../_shared/rate-limit.ts'
import {
  jsonError,
  jsonOk,
  readValidatedJson,
  z,
  zIdempotencyKey,
  zSha256,
  zUuid,
} from '../_shared/validation.ts'

const bodySchema = z
  .object({
    branchId: zUuid,
    customerId: zUuid,
    idempotencyKey: zIdempotencyKey,
    payloadSha256: zSha256,
    eventType: z.enum(['check_in', 'reward_redeem', 'adjustment', 'system']).default('check_in'),
    clientVisitDate: z.string().max(32).nullable().optional(),
  })
  .strict()

/**
 * Best-effort realtime signal for the Customer Portal UI.
 *
 * Why this exists:
 * - The Customer Portal runs with an anonymous Supabase client.
 * - We intentionally do NOT grant anon access to `public.visits` (RLS protection).
 * - Therefore, the portal cannot rely on `postgres_changes` for visit inserts.
 * - Instead, after ingesting a visit we send a broadcast "poke" that tells the
 *   portal to refetch its session via `customer_portal_begin`.
 *
 * Security properties:
 * - Payload contains no PII and no streak values — only a harmless "something changed" hint.
 * - The portal still derives all state from server-authoritative RPC output.
 */
async function broadcastPortalVisit(admin: ReturnType<typeof createClient>, customerId: string) {
  const channel = admin.channel(`portal-visits-${customerId}`)

  const subscribed = new Promise<boolean>((resolve) => {
    let settled = false
    channel.subscribe((status) => {
      if (settled) return
      if (status === 'SUBSCRIBED') {
        settled = true
        resolve(true)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        settled = true
        resolve(false)
      }
    })
    setTimeout(() => {
      if (!settled) resolve(false)
    }, 750)
  })

  try {
    const ok = await subscribed
    if (!ok) return
    await channel.send({
      type: 'broadcast',
      event: 'visit',
      payload: { customerId },
    })
  } finally {
    await admin.removeChannel(channel)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonError('method_not_allowed', 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonError('missing_env', 500)
  }

  // Pre-auth IP throttle to deter credential stuffing / API-key brute force.
  const ipBlock = rateLimitResponseOrNull(req, {
    lane: 'record-visit:pre-auth',
    max: 60,
    windowMs: 60_000,
  })
  if (ipBlock) return ipBlock

  const verified = await verifyCaller(req, { supabaseUrl, anonKey, serviceRoleKey })
  if (!verified.ok) {
    const bodyText = await verified.response.text()
    return new Response(bodyText, {
      status: verified.response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Post-auth principal throttle — a compromised session can't flood the ingestion path.
  const principalId =
    verified.caller.kind === 'jwt' ? verified.caller.userId : verified.caller.apiKeyId
  const principalBlock = rateLimitResponseOrNull(
    req,
    { lane: 'record-visit:principal', max: 240, windowMs: 60_000 },
    principalId,
  )
  if (principalBlock) return principalBlock

  const parsed = await readValidatedJson(req, bodySchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const idempotencyKey = req.headers.get('x-idempotency-key')?.trim() || body.idempotencyKey
  if (!/^[A-Za-z0-9._~:\-]{8,128}$/.test(idempotencyKey)) {
    return jsonError('invalid_idempotency_key', 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (verified.caller.kind === 'api_key') {
    if (!verified.caller.scopes.includes('visits:write')) {
      return jsonError('missing_scope', 403)
    }

    const [okBranch, okCustomer] = await Promise.all([
      assertBranchBelongsToCafe(admin, body.branchId, verified.caller.cafeId),
      assertCustomerBelongsToCafe(admin, body.customerId, verified.caller.cafeId),
    ])

    if (!okBranch || !okCustomer) return jsonError('forbidden', 403)

    const { data, error } = await admin.rpc('record_visit_idempotent', {
      p_branch_id: body.branchId,
      p_customer_id: body.customerId,
      p_idempotency_key: idempotencyKey,
      p_payload_sha256: body.payloadSha256,
      p_event_type: body.eventType,
      p_client_visit_date: body.clientVisitDate ?? null,
    })

    if (error) return jsonError(error.message ?? 'rpc_failed', 400)
    // Notify the portal in real-time that a visit happened.
    // For "already_checked_in" we still broadcast: it triggers an immediate refetch
    // so the portal can render the "visited today" badge without a refresh.
    void broadcastPortalVisit(admin, body.customerId)
    return jsonOk({ data })
  }

  const { data, error } = await verified.caller.supabaseForUser.rpc('record_visit_idempotent', {
    p_branch_id: body.branchId,
    p_customer_id: body.customerId,
    p_idempotency_key: idempotencyKey,
    p_payload_sha256: body.payloadSha256,
    p_event_type: body.eventType,
    p_client_visit_date: body.clientVisitDate ?? null,
  })

  if (error) return jsonError(error.message ?? 'rpc_failed', 400)

  // Echo the caller key suffix so downstream observability can correlate throttling.
  const _key = callerKey(req, principalId)
  void broadcastPortalVisit(admin, body.customerId)
  return jsonOk({ data })
})
