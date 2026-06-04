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
  zSlug,
  zTimezone,
  zUuid,
} from '../_shared/validation.ts'

const updateTenantSchema = z
  .object({
    action: z.literal('update_tenant'),
    cafeId: zUuid,
    name: z.string().trim().min(2).max(120),
    slug: zSlug,
    timezone: zTimezone,
    currencyCode: zCurrency,
    status: z.enum(['active', 'suspended', 'archived']).optional(),
  })
  .strict()

// NB: keep this a pure `ZodObject` (no `.refine(...)`). z.discriminatedUnion
// reaches into each member's `.shape` to read the discriminator — wrapping
// this in a `ZodEffects` (which `.refine` produces) makes `.shape` undefined
// and crashes the function at module load with:
//   TypeError: Cannot read properties of undefined (reading 'action')
// The "ownerEmail OR ownerPassword must be set" rule is enforced at runtime
// in the handler below so we keep the discriminator intact.
const updateOwnerSchema = z
  .object({
    action: z.literal('update_owner'),
    cafeId: zUuid,
    ownerEmail: zEmail.optional(),
    ownerPassword: z.string().trim().min(4).max(128).optional(),
  })
  .strict()

const deleteTenantSchema = z
  .object({
    action: z.literal('delete_tenant'),
    cafeId: zUuid,
    confirmSlug: zSlug,
  })
  .strict()

const bodySchema = z.discriminatedUnion('action', [
  updateTenantSchema,
  updateOwnerSchema,
  deleteTenantSchema,
])

type Body = z.infer<typeof bodySchema>

/**
 * Super Admin comprehensive control for tenant administration:
 *   - update_tenant : edit cafe identity, status, currency, timezone.
 *   - update_owner  : rotate HQ owner email/password via Auth admin API.
 *   - delete_tenant : cascade-delete a cafe and its HQ owner.
 *
 * Every response (including hard failures) carries CORS headers tailored to
 * the request so the browser never silently swallows error JSON.
 */
Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)
  const wrap = (res: Response): Response => withCorsHeaders(res, cors)

  // 1. CORS preflight — short-circuit with 204 + max-age.
  if (req.method === 'OPTIONS') return preflightResponse(req)
  if (req.method !== 'POST') return wrap(jsonError('method_not_allowed', 405))

  // 2. Required environment.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return wrap(jsonError('missing_env', 500))
  }

  // 3. Pre-auth IP rate limit (defence against credential stuffing).
  const ipBlock = rateLimitResponseOrNull(req, {
    lane: 'admin-manage-tenant:pre-auth',
    max: 30,
    windowMs: 60_000,
  })
  if (ipBlock) return wrap(ipBlock)

  // 4. JWT verification.
  const verified = await verifyCaller(req, { supabaseUrl, anonKey, serviceRoleKey })
  if (!verified.ok) return wrap(verified.response)
  if (verified.caller.kind !== 'jwt') return wrap(jsonError('jwt_required', 403))

  // 5. Per-principal rate limit (slower lane, sticks to user id).
  const principalBlock = rateLimitResponseOrNull(
    req,
    { lane: 'admin-manage-tenant:principal', max: 60, windowMs: 5 * 60_000 },
    verified.caller.userId,
  )
  if (principalBlock) return wrap(principalBlock)

  // 6. Body validation.
  const parsed = await readValidatedJson(req, bodySchema)
  if (!parsed.ok) return wrap(parsed.response)
  const body = parsed.data as Body

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // 7. Super-admin role gate.
    const { data: actorProfile, error: actorErr } = await admin
      .from('profiles')
      .select('role')
      .eq('user_id', verified.caller.userId)
      .maybeSingle()

    if (actorErr || !actorProfile || actorProfile.role !== 'super_admin') {
      return wrap(jsonError('forbidden', 403))
    }

    // 8. Resolve target cafe (used by all branches).
    const { data: cafeRow, error: cafeErr } = await admin
      .from('cafes')
      .select('id, slug, name, status')
      .eq('id', body.cafeId)
      .maybeSingle()

    if (cafeErr || !cafeRow) return wrap(jsonError('cafe_not_found', 404))

    // ---- update_tenant -----------------------------------------------------
    if (body.action === 'update_tenant') {
      const { error } = await admin
        .from('cafes')
        .update({
          name: body.name,
          slug: body.slug,
          timezone: body.timezone,
          currency_code: body.currencyCode,
          status: body.status ?? cafeRow.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.cafeId)

      if (error) return wrap(jsonError(error.message ?? 'tenant_update_failed', 400))

      await admin.from('audit_log').insert({
        cafe_id: body.cafeId,
        branch_id: null,
        actor_user_id: verified.caller.userId,
        actor_type: 'user',
        action: 'tenant.updated',
        entity_type: 'cafe',
        entity_id: body.cafeId,
        payload: {
          name: body.name,
          slug: body.slug,
          timezone: body.timezone,
          currency_code: body.currencyCode,
          status: body.status,
          previous_status: cafeRow.status,
        },
      })

      return wrap(
        jsonOk({
          cafe: { id: body.cafeId, slug: body.slug, name: body.name },
        }),
      )
    }

    // ---- update_owner ------------------------------------------------------
    if (body.action === 'update_owner') {
      // Equivalent of the previous schema-level .refine() — kept out of the
      // discriminated-union member so its .shape stays readable by Zod.
      if (!body.ownerEmail && !body.ownerPassword) {
        return wrap(jsonError('owner_update_required', 400))
      }

      const { data: ownerRows, error: ownerErr } = await admin
        .from('profiles')
        .select('user_id')
        .eq('cafe_id', body.cafeId)
        .eq('role', 'hq_owner')
        .limit(1)

      const ownerUserId = ownerRows?.[0]?.user_id
      if (ownerErr || !ownerUserId) return wrap(jsonError('owner_not_found', 404))

      const attrs: { email?: string; password?: string } = {}
      if (body.ownerEmail) attrs.email = body.ownerEmail
      if (body.ownerPassword) attrs.password = body.ownerPassword

      const { error: updateErr } = await admin.auth.admin.updateUserById(ownerUserId, attrs)
      if (updateErr) {
        const code = (updateErr as { code?: string }).code
        return wrap(
          jsonError(
            code
              ? `${code}:${updateErr.message ?? 'owner_update_failed'}`
              : updateErr.message ?? 'owner_update_failed',
            400,
          ),
        )
      }

      await admin.from('audit_log').insert({
        cafe_id: body.cafeId,
        branch_id: null,
        actor_user_id: verified.caller.userId,
        actor_type: 'user',
        action: 'tenant.owner.updated',
        entity_type: 'profile',
        entity_id: ownerUserId,
        payload: {
          owner_email_updated: Boolean(body.ownerEmail),
          owner_password_rotated: Boolean(body.ownerPassword),
        },
      })

      return wrap(jsonOk({ ownerUserId }))
    }

    // ---- delete_tenant -----------------------------------------------------
    if (body.action === 'delete_tenant') {
      if (body.confirmSlug !== cafeRow.slug) {
        return wrap(jsonError('confirm_slug_mismatch', 400))
      }

      const { data: ownerProfile } = await admin
        .from('profiles')
        .select('user_id')
        .eq('cafe_id', body.cafeId)
        .eq('role', 'hq_owner')
        .maybeSingle()

      // Remove profiles first to avoid role scope CHECK constraints firing
      // during the cafes cascade.
      await admin.from('profiles').delete().eq('cafe_id', body.cafeId)

      if (ownerProfile?.user_id) {
        // Best-effort: if Auth delete fails the tenant delete still proceeds.
        await admin.auth.admin.deleteUser(ownerProfile.user_id)
      }

      const { error: delErr } = await admin.from('cafes').delete().eq('id', body.cafeId)
      if (delErr) return wrap(jsonError(delErr.message ?? 'tenant_delete_failed', 400))

      await admin.from('audit_log').insert({
        cafe_id: null,
        branch_id: null,
        actor_user_id: verified.caller.userId,
        actor_type: 'user',
        action: 'tenant.deleted',
        entity_type: 'cafe',
        entity_id: body.cafeId,
        payload: {
          previous_slug: cafeRow.slug,
          previous_name: cafeRow.name,
        },
      })

      return wrap(jsonOk({ deleted: true }))
    }

    return wrap(jsonError('unsupported_action', 400))
  } catch (e) {
    // Last-resort guardrail — anything thrown here would otherwise emit a
    // bare 500 with no CORS headers and crash the browser console.
    return wrap(jsonError(e instanceof Error ? e.message : 'tenant_manage_failed', 500))
  }
})
