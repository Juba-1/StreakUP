import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

import { corsHeaders } from '../_shared/cors.ts'
import { assertSafeOutboundUrl, rateLimitResponseOrNull, timingSafeEqual } from '../_shared/rate-limit.ts'
import { jsonError, jsonOk, readValidatedJson, z } from '../_shared/validation.ts'

type OutboxRow = {
  id: string
  outbound_webhook_id: string
  cafe_id: string
  payload: Record<string, unknown>
  attempts: number
}

const bodySchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()

const DELIVERY_TIMEOUT_MS = 8_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405)

  // Brute-force shield against guessing the dispatch secret.
  const ipBlock = rateLimitResponseOrNull(req, {
    lane: 'dispatch-webhooks:pre-auth',
    max: 20,
    windowMs: 60_000,
  })
  if (ipBlock) return ipBlock

  const expected = Deno.env.get('WEBHOOK_DISPATCH_SECRET') ?? ''
  const provided = req.headers.get('x-webhook-dispatch-secret') ?? ''
  if (!expected || !provided || !timingSafeEqual(expected, provided)) {
    return jsonError('unauthorized', 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonError('missing_env', 500)

  const parsed = await readValidatedJson(req, bodySchema)
  if (!parsed.ok) return parsed.response
  const limit = parsed.data.limit ?? 40

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: pending, error: qErr } = await admin
    .from('webhook_outbox')
    .select('id, outbound_webhook_id, cafe_id, payload, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (qErr) return jsonError(qErr.message, 500)

  let delivered = 0
  let failed = 0
  const errors: string[] = []

  for (const row of (pending ?? []) as OutboxRow[]) {
    const { data: hook, error: hErr } = await admin
      .from('outbound_webhooks')
      .select('url, is_enabled')
      .eq('id', row.outbound_webhook_id)
      .maybeSingle()

    if (hErr || !hook?.url || !hook.is_enabled) {
      await admin
        .from('webhook_outbox')
        .update({
          status: 'failed',
          attempts: row.attempts + 1,
          last_error: hErr?.message ?? 'hook_missing_or_disabled',
        })
        .eq('id', row.id)
      failed += 1
      continue
    }

    const safe = assertSafeOutboundUrl(String(hook.url))
    if (!safe.ok) {
      await admin
        .from('webhook_outbox')
        .update({
          status: 'failed',
          attempts: row.attempts + 1,
          last_error: `ssrf_blocked:${safe.reason}`,
        })
        .eq('id', row.id)
      failed += 1
      errors.push(`${row.id}:ssrf_blocked:${safe.reason}`)
      continue
    }

    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)

    try {
      const res = await fetch(safe.url.toString(), {
        method: 'POST',
        redirect: 'manual', // Never follow redirects that could bypass SSRF checks.
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'StreakUp-Webhooks/1',
          'X-StreakUp-Event': String((row.payload as { event?: string }).event ?? 'unknown'),
          'X-StreakUp-Delivery': row.id,
        },
        body: JSON.stringify(row.payload),
        signal: controller.signal,
      })

      if (res.status >= 300 && res.status < 400) {
        const nextAttempts = row.attempts + 1
        await admin
          .from('webhook_outbox')
          .update({
            status: 'failed',
            attempts: nextAttempts,
            last_error: `redirect_blocked_${res.status}`,
          })
          .eq('id', row.id)
        failed += 1
        errors.push(`${row.id}:redirect_${res.status}`)
        continue
      }

      if (!res.ok) {
        const nextAttempts = row.attempts + 1
        const terminal = nextAttempts >= 5
        await admin
          .from('webhook_outbox')
          .update({
            status: terminal ? 'failed' : 'pending',
            attempts: nextAttempts,
            last_error: `http_${res.status}`,
          })
          .eq('id', row.id)
        if (terminal) failed += 1
        errors.push(`${row.id}:http_${res.status}`)
        continue
      }

      await admin
        .from('webhook_outbox')
        .update({
          status: 'delivered',
          attempts: row.attempts + 1,
          last_error: null,
          delivered_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      delivered += 1
    } catch (e) {
      const nextAttempts = row.attempts + 1
      const terminal = nextAttempts >= 5
      await admin
        .from('webhook_outbox')
        .update({
          status: terminal ? 'failed' : 'pending',
          attempts: nextAttempts,
          last_error: String(e).slice(0, 512),
        })
        .eq('id', row.id)
      if (terminal) failed += 1
      errors.push(`${row.id}:${String(e).slice(0, 64)}`)
    } finally {
      clearTimeout(abortTimer)
    }
  }

  return jsonOk({
    scanned: (pending ?? []).length,
    delivered,
    failed,
    errors: errors.slice(0, 8),
  })
})
