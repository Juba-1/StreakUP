import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export type VerifiedJwt = {
  kind: 'jwt'
  jwt: string
  userId: string
  supabaseForUser: SupabaseClient
}

export type VerifiedApiKey = {
  kind: 'api_key'
  cafeId: string
  apiKeyId: string
  scopes: string[]
}

export type VerifiedCaller = VerifiedJwt | VerifiedApiKey

function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!h) return null
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() ?? null
}

function parseStreakupApiKey(raw: string): { prefix: string; secret: string } | null {
  const trimmed = raw.trim()
  // Preferred: "streakup_<prefix>_<secret>"
  if (!trimmed.startsWith('streakup_')) return null
  const rest = trimmed.slice('streakup_'.length)
  const idx = rest.indexOf('_')
  if (idx <= 0) return null
  const prefix = rest.slice(0, idx)
  const secret = rest.slice(idx + 1)
  if (prefix.length < 4 || secret.length < 16) return null
  return { prefix, secret }
}

export async function verifyCaller(
  req: Request,
  deps: { supabaseUrl: string; anonKey: string; serviceRoleKey: string },
): Promise<{ ok: true; caller: VerifiedCaller } | { ok: false; response: Response }> {
  const apiKeyHeader =
    req.headers.get('x-streakup-api-key') ??
    req.headers.get('X-Streakup-Api-Key') ??
    ''

  const bearer = bearerToken(req)

  // 1) Enterprise API key (Edge verifies using service role RPC)
  if (apiKeyHeader || (bearer && bearer.startsWith('streakup_'))) {
    const token = (apiKeyHeader || bearer) as string
    const parsed = parseStreakupApiKey(token)
    if (!parsed) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ ok: false, error: 'invalid_api_key_shape' }), {
          status: 401,
        }),
      }
    }

    const admin = createClient(deps.supabaseUrl, deps.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await admin.rpc('verify_enterprise_api_key', {
      p_public_prefix: parsed.prefix,
      p_secret: parsed.secret,
    })

    if (error || !data || (data as { valid?: boolean }).valid !== true) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ ok: false, error: 'invalid_api_key' }), {
          status: 401,
        }),
      }
    }

    const typed = data as { cafe_id: string; api_key_id: string; scopes: unknown }
    return {
      ok: true,
      caller: {
        kind: 'api_key',
        cafeId: typed.cafe_id,
        apiKeyId: typed.api_key_id,
        scopes: Array.isArray(typed.scopes) ? (typed.scopes as string[]) : [],
      },
    }
  }

  // 2) Supabase user JWT
  if (!bearer) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ ok: false, error: 'missing_authorization' }), {
        status: 401,
      }),
    }
  }

  const admin = createClient(deps.supabaseUrl, deps.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await admin.auth.getUser(bearer)
  if (error || !data?.user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ ok: false, error: 'invalid_jwt' }), { status: 401 }),
    }
  }

  const supabaseForUser = createClient(deps.supabaseUrl, deps.anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  return {
    ok: true,
    caller: { kind: 'jwt', jwt: bearer, userId: data.user.id, supabaseForUser },
  }
}

export async function assertBranchBelongsToCafe(
  admin: SupabaseClient,
  branchId: string,
  cafeId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('cafe_id', cafeId)
    .maybeSingle()

  if (error) return false
  return Boolean(data?.id)
}

export async function assertCustomerBelongsToCafe(
  admin: SupabaseClient,
  customerId: string,
  cafeId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('cafe_id', cafeId)
    .maybeSingle()

  if (error) return false
  return Boolean(data?.id)
}
