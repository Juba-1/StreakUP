import { verifyCaller } from '../_shared/auth.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { rateLimitResponseOrNull } from '../_shared/rate-limit.ts'
import { jsonError, jsonOk, readValidatedJson, z } from '../_shared/validation.ts'

const bodySchema = z.discriminatedUnion('intent', [
  z
    .object({
      intent: z.literal('parse_branches_csv'),
      csvText: z.string().min(5).max(120_000),
      locale: z.enum(['en', 'ar']).optional(),
    })
    .strict(),
  z
    .object({
      intent: z.literal('hq_dashboard_insights'),
      locale: z.enum(['en', 'ar']).optional(),
    })
    .strict(),
  z
    .object({
      intent: z.literal('hq_live_pulse'),
      locale: z.enum(['en', 'ar']).optional(),
    })
    .strict(),
  z
    .object({
      intent: z.literal('hq_owner_chat'),
      prompt: z.string().trim().min(2).max(800),
      locale: z.enum(['en', 'ar']).optional(),
    })
    .strict(),
  z
    .object({
      intent: z.literal('hq_roi_copilot'),
      prompt: z.string().trim().min(2).max(800),
      locale: z.enum(['en', 'ar']).optional(),
    })
    .strict(),
])

async function groqChat(params: {
  system: string
  user: string
  jsonObject: boolean
}): Promise<unknown> {
  const key = Deno.env.get('GROQ_API_KEY')
  if (!key) throw new Error('missing_groq_api_key')

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.2,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      ...(params.jsonObject ? { response_format: { type: 'json_object' as const } } : {}),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`groq_http_${res.status}:${text.slice(0, 256)}`)
  }

  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('groq_empty_content')

  return params.jsonObject ? (JSON.parse(content) as unknown) : content
}

function slugifyBranchName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
  return base || 'branch'
}

function randomHex(bytes: number) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

function normalizeWizardBranches(parsed: unknown): Array<{ name: string; branch_code: string }> {
  const root = parsed as { branches?: unknown[] }
  const raw = Array.isArray(root?.branches) ? root.branches : []
  const used = new Set<string>()
  const out: Array<{ name: string; branch_code: string }> = []

  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const name = String(r.name ?? r.location_name ?? r.store ?? r.branch ?? '').trim().slice(0, 120)
    if (!name) continue

    let code = String(r.branch_code ?? r.code ?? r.slug ?? '').trim().toLowerCase()
    if (!code || !/^[a-z0-9-]+$/.test(code)) {
      code = `${slugifyBranchName(name)}-${randomHex(2)}`
    } else {
      code = code.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    }

    let candidate = code
    let guard = 0
    while (used.has(candidate) && guard < 20) {
      candidate = `${slugifyBranchName(name)}-${randomHex(3)}`
      guard += 1
    }
    used.add(candidate)
    out.push({ name, branch_code: candidate })
  }

  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonError('missing_env', 500)

  const ipBlock = rateLimitResponseOrNull(req, {
    lane: 'ai-router:pre-auth',
    max: 30,
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

  if (verified.caller.kind !== 'jwt') return jsonError('jwt_required', 403)

  // LLM spend brake. Trims bursts at ~30 calls/min per principal.
  const principalBlock = rateLimitResponseOrNull(
    req,
    { lane: 'ai-router:principal', max: 30, windowMs: 60_000 },
    verified.caller.userId,
  )
  if (principalBlock) return principalBlock

  const parsed = await readValidatedJson(req, bodySchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    if (body.intent === 'parse_branches_csv') {
      const out = await groqChat({
        jsonObject: true,
        system:
          'You are a strict data extraction engine for cafe branch imports. ' +
          'Return JSON ONLY with shape: {"branches":[{"name":string,"branch_code":string,"manager_password_hint":string|null,"cashier_pin_hint":string|null}]} ' +
          'Rules: branch_code must be lowercase a-z0-9 with optional hyphens when present; ' +
          'if a row has no reliable code, set branch_code to an empty string and the server will mint a collision-resistant code. ' +
          'Never invent real secrets—use null hints if unknown.',
        user:
          'Parse this messy CSV/TSV into branches. If columns are unclear, infer best-effort names; codes may be empty.\n\n' +
          body.csvText,
      })
      const branches = normalizeWizardBranches(out)
      return jsonOk({ intent: body.intent, parsed: { branches } })
    }

    if (body.intent === 'hq_dashboard_insights') {
      const { data: ctx, error: ctxError } =
        await verified.caller.supabaseForUser.rpc('hq_dashboard_ai_context')
      if (ctxError || !ctx) return jsonError(ctxError?.message ?? 'no_context', 400)

      const narrative = await groqChat({
        jsonObject: false,
        system:
          'You are a senior revenue analyst for a multi-branch cafe loyalty product. ' +
          'Be precise, cite branch_code identifiers, and call out risks/opportunities. ' +
          'Do not claim facts not supported by the JSON. Keep it under 900 words.',
        user: 'Here is aggregated JSON for the last 30 days:\n' + JSON.stringify(ctx),
      })

      return jsonOk({ intent: body.intent, context: ctx, narrative })
    }

    if (body.intent === 'hq_owner_chat') {
      const locale = body.locale === 'ar' ? 'ar' : 'en'
      const { data: ctx } =
        await verified.caller.supabaseForUser.rpc('hq_dashboard_ai_context')
      const langLine =
        locale === 'ar'
          ? 'Answer in modern Arabic with concise practical guidance.'
          : 'Answer in concise business English.'

      const answer = await groqChat({
        jsonObject: false,
        system:
          'You are the HQ operations copilot for a multi-branch cafe SaaS. ' +
          'Stay practical, short, and decision-oriented. Use the provided context when present. ' +
          'Never expose secrets. If data is missing, state assumptions explicitly. ' +
          langLine,
        user: `Context JSON: ${JSON.stringify(ctx ?? {})}\n\nUser question: ${body.prompt}`,
      })

      return jsonOk({ intent: body.intent, answer })
    }

    if (body.intent === 'hq_roi_copilot') {
      const locale = body.locale === 'ar' ? 'ar' : 'en'
      const { data: ctx, error: ctxError } =
        await verified.caller.supabaseForUser.rpc('hq_roi_ai_context', { p_days: 30 })
      if (ctxError || !ctx) return jsonError(ctxError?.message ?? 'no_roi_context', 400)

      const langLine =
        locale === 'ar'
          ? 'Answer in Modern Standard Arabic. Use markdown, strategic emojis for alerts, and bullet action items.'
          : 'Answer in concise business English. Use markdown, strategic emojis for alerts, and bullet action items.'

      const answer = await groqChat({
        jsonObject: false,
        system:
          'You are a friendly cafe owner coach embedded in a simple streak loyalty dashboard. ' +
          'Analyze ONLY the JSON: active streaks, shield saves, champions (day 7+), broken streaks, claimed reward counts and item breakdown. ' +
          'Help the owner understand inventory cost from claimed rewards and how to reduce broken streaks. ' +
          'Give 3–5 plain-language recommendations. Use ## headings and bullet lists. **Bold** key numbers. ' +
          'Never use data-science jargon (cohorts, velocity, stickiness). ' +
          'Never invent customer names or PII. If data is sparse, label suggestions as hypotheses. ' +
          langLine,
        user: `Behavioral metrics JSON:\n${JSON.stringify(ctx)}\n\nOwner question: ${body.prompt}`,
      })

      return jsonOk({ intent: body.intent, answer })
    }

    // hq_live_pulse
    const locale = body.locale === 'ar' ? 'ar' : 'en'
    const { data: ctx, error: ctxError } =
      await verified.caller.supabaseForUser.rpc('hq_pulse_context')
    if (ctxError || ctx == null) {
      return jsonError(ctxError?.message ?? 'no_pulse_context', 400)
    }

    const langLine =
      locale === 'ar'
        ? 'Write the insight in Modern Standard Arabic (MSA), natural for Gulf cafe owners.'
        : 'Write the insight in concise business English.'

    const parsedAi = (await groqChat({
      jsonObject: true,
      system:
        'You are a sharp cafe operations copilot. Return JSON ONLY: {"insight": string}. ' +
        'Rules: exactly one sentence; max 200 characters; punchy and actionable; ' +
        'tie to peaks, quiet days, shields, or branch hotspots using ONLY fields present in the JSON. ' +
        'If data is sparse, suggest a simple experiment (happy hour, promo) without inventing numbers. ' +
        langLine,
      user: JSON.stringify(ctx),
    })) as { insight?: unknown }

    const raw = typeof parsedAi.insight === 'string' ? parsedAi.insight.trim() : ''
    const insight = raw.length > 240 ? `${raw.slice(0, 237)}…` : raw
    return jsonOk({ intent: body.intent, insight })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'ai_failed', 500)
  }
})
