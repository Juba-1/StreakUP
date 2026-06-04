import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

import { verifyCaller } from '../_shared/auth.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { rateLimitResponseOrNull } from '../_shared/rate-limit.ts'
import { humanStaffPassword, isDuplicateAuthEmailError } from '../_shared/staff-password.ts'
import {
  jsonError,
  jsonOk,
  readValidatedJson,
  z,
  zEmail,
  zPhone,
  zStrongPassword,
  zUuid,
} from '../_shared/validation.ts'

const base = {
  email: zEmail,
  password: zStrongPassword.optional(),
  cafeId: zUuid,
}

const branchManagerSchema = z
  .object({
    ...base,
    role: z.literal('branch_manager'),
    branchId: zUuid,
    intent: z.enum(['create', 'reset_password']).optional(),
    managerUserId: zUuid.optional(),
  })
  .strict()

const bodySchema = z.discriminatedUnion('role', [
  z.object({ ...base, role: z.literal('hq_owner') }).strict(),
  branchManagerSchema,
  z
    .object({
      ...base,
      role: z.literal('cashier'),
      branchId: zUuid,
    })
    .strict(),
  z
    .object({
      ...base,
      role: z.literal('customer'),
      branchId: zUuid.nullable().optional(),
      customerPhone: zPhone.nullable().optional(),
    })
    .strict(),
])

function passwordPrefixForRole(role: string): string {
  if (role === 'branch_manager') return 'Branch'
  if (role === 'cashier') return 'Cashier'
  if (role === 'hq_owner') return 'HQ'
  return 'Staff'
}

function streakupMeta(body: {
  role: string
  cafeId: string
  branchId?: string
  customerPhone?: string | null
}): Record<string, unknown> {
  const streakup: Record<string, unknown> = {
    role: body.role,
    cafe_id: body.cafeId,
  }
  if (body.branchId) streakup.branch_id = body.branchId
  if (body.customerPhone) streakup.phone = body.customerPhone
  return streakup
}

async function findUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  let page = 1
  const perPage = 200
  while (page <= 5) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data?.users ?? []
    const hit = users.find((u) => u.email?.trim().toLowerCase() === normalized)
    if (hit?.id) return hit.id
    if (users.length < perPage) break
    page += 1
  }
  return null
}

async function resolveBranchManagerUserId(
  admin: SupabaseClient,
  cafeId: string,
  branchId: string,
  managerUserId?: string,
): Promise<string | null> {
  if (managerUserId) return managerUserId

  const { data, error } = await admin
    .from('profiles')
    .select('user_id')
    .eq('cafe_id', cafeId)
    .eq('branch_id', branchId)
    .eq('role', 'branch_manager')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data?.user_id ?? null
}

async function resetExistingStaffUser(
  admin: SupabaseClient,
  opts: {
    userId: string
    email: string
    password: string
    cafeId: string
    branchId?: string
    role: string
  },
): Promise<Response> {
  const { data: existingProfile, error: profErr } = await admin
    .from('profiles')
    .select('role, cafe_id, branch_id')
    .eq('user_id', opts.userId)
    .maybeSingle()

  if (profErr) return jsonError(profErr.message, 500)
  if (!existingProfile) return jsonError('existing_user_no_profile', 404)

  if (existingProfile.cafe_id !== opts.cafeId) {
    return jsonError('email_in_other_cafe', 403)
  }

  if (String(existingProfile.role) !== opts.role) {
    return jsonError('email_role_mismatch', 403)
  }

  if (opts.branchId && existingProfile.branch_id && existingProfile.branch_id !== opts.branchId) {
    return jsonError('email_other_branch', 403)
  }

  const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(opts.userId)
  if (getErr) return jsonError(getErr.message ?? 'user_lookup_failed', 500)
  if (!authUser?.user) return jsonError('user_not_found', 404)

  const authEmail = authUser.user.email?.trim().toLowerCase() ?? ''
  if (authEmail !== opts.email.trim().toLowerCase()) {
    return jsonError('email_mismatch', 400)
  }

  const priorMeta =
    authUser.user.app_metadata && typeof authUser.user.app_metadata === 'object'
      ? (authUser.user.app_metadata as Record<string, unknown>)
      : {}

  const meta = streakupMeta({
    role: opts.role,
    cafeId: opts.cafeId,
    branchId: opts.branchId,
  })

  const { error: updateErr } = await admin.auth.admin.updateUserById(opts.userId, {
    password: opts.password,
    app_metadata: { ...priorMeta, streakup: meta },
  })

  if (updateErr) return jsonError(updateErr.message ?? 'update_failed', 400)

  return jsonOk({
    userId: opts.userId,
    bootstrapPassword: null,
    action: 'updated',
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError('method_not_allowed', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonError('missing_env', 500)

  const ipBlock = rateLimitResponseOrNull(req, {
    lane: 'invite-staff:pre-auth',
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

  if (verified.caller.kind !== 'jwt') return jsonError('jwt_required', 403)

  const principalBlock = rateLimitResponseOrNull(
    req,
    { lane: 'invite-staff:principal', max: 120, windowMs: 60_000 },
    verified.caller.userId,
  )
  if (principalBlock) return principalBlock

  const parsed = await readValidatedJson(req, bodySchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const { data: actorProfile, error: actorErr } = await admin
      .from('profiles')
      .select('role, cafe_id')
      .eq('user_id', verified.caller.userId)
      .maybeSingle()

    if (actorErr) return jsonError(actorErr.message, 500)
    if (!actorProfile) return jsonError('profile_not_found', 403)

    const isSuper = actorProfile.role === 'super_admin'
    const isHqOwnerSameCafe =
      actorProfile.role === 'hq_owner' && actorProfile.cafe_id === body.cafeId

    if (!isSuper && !isHqOwnerSameCafe) return jsonError('forbidden', 403)
    if (!isSuper && body.role === 'hq_owner') return jsonError('forbidden_role', 403)

    if ('branchId' in body && body.branchId) {
      const { data: branchRow, error: branchErr } = await admin
        .from('branches')
        .select('id, cafe_id')
        .eq('id', body.branchId)
        .maybeSingle()
      if (branchErr) return jsonError(branchErr.message, 500)
      if (!branchRow || branchRow.cafe_id !== body.cafeId) {
        return jsonError('invalid_branch', 400)
      }
    }

    const password =
      body.password?.trim() ||
      humanStaffPassword(passwordPrefixForRole(body.role))

    if (body.role === 'branch_manager' && body.intent === 'reset_password') {
      if (!body.password?.trim()) {
        return jsonError('password_required', 400)
      }

      const userId = await resolveBranchManagerUserId(
        admin,
        body.cafeId,
        body.branchId,
        body.managerUserId,
      )
      if (!userId) return jsonError('manager_not_found', 404)

      return await resetExistingStaffUser(admin, {
        userId,
        email: body.email,
        password: body.password.trim(),
        cafeId: body.cafeId,
        branchId: body.branchId,
        role: 'branch_manager',
      })
    }

    const meta = streakupMeta({
      role: body.role,
      cafeId: body.cafeId,
      branchId: 'branchId' in body ? body.branchId : undefined,
      customerPhone: 'customerPhone' in body ? body.customerPhone : undefined,
    })

    const { data, error } = await admin.auth.admin.createUser({
      email: body.email,
      password,
      email_confirm: true,
      app_metadata: { streakup: meta },
    })

    if (!error && data.user?.id) {
      return jsonOk({
        userId: data.user.id,
        bootstrapPassword: body.password ? null : password,
        action: 'created',
      })
    }

    if (!error || !isDuplicateAuthEmailError(error.message)) {
      return jsonError(error?.message ?? 'create_failed', 400)
    }

    let existingId: string | null = null
    if (body.role === 'branch_manager' && 'branchId' in body && body.branchId) {
      existingId = await resolveBranchManagerUserId(
        admin,
        body.cafeId,
        body.branchId,
        'managerUserId' in body ? body.managerUserId : undefined,
      )
    } else {
      try {
        existingId = await findUserIdByEmail(admin, body.email)
      } catch (listErr) {
        const msg = listErr instanceof Error ? listErr.message : 'user_lookup_failed'
        return jsonError(msg, 500)
      }
    }

    if (!existingId) {
      return jsonError('existing_user_not_found', 404)
    }

    return await resetExistingStaffUser(admin, {
      userId: existingId,
      email: body.email,
      password,
      cafeId: body.cafeId,
      branchId: 'branchId' in body ? body.branchId : undefined,
      role: body.role,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'invite_failed'
    console.error('[invite-staff]', msg)
    return jsonError(msg, 500)
  }
})
