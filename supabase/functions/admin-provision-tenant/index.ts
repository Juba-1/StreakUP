import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

import { verifyCaller } from '../_shared/auth.ts'
import { corsHeadersFor, preflightResponse, withCorsHeaders } from '../_shared/cors.ts'
import { rateLimitResponseOrNull } from '../_shared/rate-limit.ts'
import {
  jsonError,
  jsonOk,
  readValidatedJson,
  z,
  zCurrency,
  zEmail,
  zHexColor,
  zLogoUrl,
  zSlug,
  zStrongPassword,
  zTimezone,
} from '../_shared/validation.ts'

const bodySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: zSlug,
    ownerEmail: zEmail,
    ownerPassword: zStrongPassword,
    lifecycle: z.enum(['trial', 'active', 'suspended']).default('trial'),
    timezone: zTimezone.default('UTC'),
    currencyCode: zCurrency.default('USD'),
    primaryColor: zHexColor.nullable().optional(),
    secondaryColor: zHexColor.nullable().optional(),
    accentColor: zHexColor.nullable().optional(),
    backgroundColor: zHexColor.nullable().optional(),
    logoUrl: zLogoUrl.nullable().optional(),
  })
  .strict()

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)
  const withCors = (res: Response): Response => withCorsHeaders(res, cors)

  if (req.method === 'OPTIONS') return preflightResponse(req)
  if (req.method !== 'POST') return withCors(jsonError('method_not_allowed', 405))

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return withCors(jsonError('missing_env', 500))

  const ipBlock = rateLimitResponseOrNull(req, {
    lane: 'provision:pre-auth',
    max: 20,
    windowMs: 60_000,
  })
  if (ipBlock) return withCors(ipBlock)

  const verified = await verifyCaller(req, { supabaseUrl, anonKey, serviceRoleKey })
  if (!verified.ok) return withCors(verified.response)
  if (verified.caller.kind !== 'jwt') return withCors(jsonError('jwt_required', 403))

  const principalBlock = rateLimitResponseOrNull(
    req,
    { lane: 'provision:principal', max: 30, windowMs: 5 * 60_000 },
    verified.caller.userId,
  )
  if (principalBlock) return withCors(principalBlock)

  const parsed = await readValidatedJson(req, bodySchema)
  if (!parsed.ok) return withCors(parsed.response)
  const body = parsed.data
  const cafeStatus = body.lifecycle === 'suspended' ? 'suspended' : 'active'
  const subscriptionStatus =
    body.lifecycle === 'trial' ? 'trialing' : body.lifecycle === 'suspended' ? 'past_due' : 'active'

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const { data: actorProfile, error: actorErr } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', verified.caller.userId)
      .maybeSingle()

    if (actorErr || !actorProfile || actorProfile.role !== 'super_admin') {
      return withCors(jsonError('forbidden', 403))
    }

    const { data: cafeRow, error: cafeErr } = await admin
      .from('cafes')
      .insert({
        name: body.name.trim(),
        slug: body.slug,
        owner_password: body.ownerPassword,
        timezone: body.timezone,
        currency_code: body.currencyCode,
        primary_color: body.primaryColor ?? null,
        secondary_color: body.secondaryColor ?? null,
        accent_color: body.accentColor ?? null,
        background_color: body.backgroundColor ?? null,
        logo_url: body.logoUrl ?? null,
        status: cafeStatus,
      })
      .select('id, slug, name')
      .single()

    if (cafeErr || !cafeRow?.id) {
      return withCors(jsonError(cafeErr?.message ?? 'cafe_insert_failed', 400))
    }

    const cafeId = cafeRow.id as string

    const { error: subErr } = await admin.from('subscriptions').insert({
      cafe_id: cafeId,
      plan_name: 'starter',
      plan_tier: 'starter',
      status: subscriptionStatus,
      provider: 'internal',
    })
    if (subErr) {
      await admin.from('cafes').delete().eq('id', cafeId)
      return withCors(jsonError(subErr.message ?? 'subscription_insert_failed', 400))
    }

    const streakup = { role: 'hq_owner' as const, cafe_id: cafeId }

    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: body.ownerEmail,
      password: body.ownerPassword,
      email_confirm: true,
      app_metadata: { streakup },
    })

    if (userErr || !userData.user?.id) {
      await admin.from('cafes').delete().eq('id', cafeId)
      return withCors(jsonError(userErr?.message ?? 'user_create_failed', 400))
    }

    await admin.from('audit_log').insert({
      cafe_id: cafeId,
      branch_id: null,
      actor_user_id: verified.caller.userId,
      actor_type: 'user',
      action: 'tenant.provisioned',
      entity_type: 'cafe',
      entity_id: cafeId,
      payload: {
        slug: cafeRow.slug,
        name: cafeRow.name,
        owner_email: body.ownerEmail,
        lifecycle: body.lifecycle,
        cafe_status: cafeStatus,
        subscription_status: subscriptionStatus,
      },
    })

    return withCors(
      jsonOk({
      cafe: { id: cafeId, slug: cafeRow.slug, name: cafeRow.name },
      ownerUserId: userData.user.id,
      }),
    )
  } catch (e) {
    return withCors(jsonError(e instanceof Error ? e.message : 'provision_failed', 500))
  }
})
