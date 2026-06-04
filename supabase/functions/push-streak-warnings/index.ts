/**
 * Hourly streak-warning Web Push dispatcher.
 * Targets customers with active streaks, no visit today (café-local), ≤3h to local midnight.
 *
 * Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_DISPATCH_SECRET,
 *          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import webpush from 'npm:web-push@3.6.7'

import { corsHeadersFor, preflightResponse, withCorsHeaders } from '../_shared/cors.ts'

type Candidate = {
  subscription_id: string
  customer_id: string
  cafe_id: string
  cafe_name: string
  cafe_slug: string
  endpoint: string
  p256dh: string
  auth: string
  current_streak: number
  hours_to_midnight: number
  local_today: string
}

function json(body: unknown, status = 200, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)

  if (req.method === 'OPTIONS') return preflightResponse(req)

  if (req.method !== 'POST') {
    return withCorsHeaders(json({ ok: false, reason: 'method_not_allowed' }, 405, cors), cors)
  }

  const secret = Deno.env.get('PUSH_DISPATCH_SECRET') ?? ''
  const incoming = req.headers.get('x-push-dispatch-secret') ?? ''
  if (!secret || incoming !== secret) {
    return withCorsHeaders(json({ ok: false, reason: 'unauthorized' }, 401, cors), cors)
  }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@streakup.app'

  if (!vapidPublic || !vapidPrivate) {
    return withCorsHeaders(json({ ok: false, reason: 'vapid_not_configured' }, 503, cors), cors)
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return withCorsHeaders(json({ ok: false, reason: 'misconfigured' }, 500, cors), cors)
  }

  let body: { hours_remaining?: number; limit?: number } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const hoursRemaining = typeof body.hours_remaining === 'number' ? body.hours_remaining : 3
  const limit = Math.min(500, Math.max(1, Number(body.limit ?? 250)))

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: rows, error } = await admin.rpc('push_streak_warning_candidates', {
    p_hours_remaining: hoursRemaining,
  })

  if (error) {
    return withCorsHeaders(json({ ok: false, reason: 'candidate_query_failed', detail: error.message }, 500, cors), cors)
  }

  const candidates = ((rows ?? []) as Candidate[]).slice(0, limit)
  let sent = 0
  let failed = 0
  const errors: string[] = []

  for (const row of candidates) {
    const hours = Math.max(1, Math.ceil(row.hours_to_midnight))
    const title = 'Your streak is in jeopardy! 🔥'
    const pushBody = `Only ${hours} hour${hours === 1 ? '' : 's'} left to save your ${row.current_streak}-day streak at ${row.cafe_name}. Grab your coffee now!`
    const payload = JSON.stringify({
      title,
      body: pushBody,
      url: `/my-streak/${row.cafe_slug}`,
      tag: `streak-warning-${row.local_today}`,
    })

    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        payload,
        { TTL: 60 * 60 * 4 },
      )

      const { error: logErr } = await admin.from('push_warning_log').insert({
        customer_id: row.customer_id,
        cafe_id: row.cafe_id,
        warning_date: row.local_today,
      })

      if (logErr && !String(logErr.message).includes('duplicate')) {
        errors.push(`${row.customer_id}:log`)
      } else {
        sent += 1
      }
    } catch (e) {
      failed += 1
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('410') || msg.includes('404') || msg.includes('expired')) {
        await admin.from('push_subscriptions').delete().eq('id', row.subscription_id)
      }
      if (errors.length < 8) errors.push(`${row.customer_id}:${msg.slice(0, 48)}`)
    }
  }

  return withCorsHeaders(
    json(
      {
        ok: true,
        candidates: candidates.length,
        sent,
        failed,
        errors,
      },
      200,
      cors,
    ),
    cors,
  )
})
