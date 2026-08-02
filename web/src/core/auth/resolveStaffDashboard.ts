import type { SupabaseClient } from '@supabase/supabase-js'

import type { ProfileRow } from '@/hooks/useProfile'

export type StaffBootstrapPayload = {
  ok?: boolean
  path?: string
  role?: string | null
  reason?: string | null
  cafe_status?: string | null
}

export type StaffBootstrapResult = {
  ok: boolean
  path: string
  role?: string | null
  reason?: string | null
  cafe_status?: string | null
}

function parseBootstrapRpcPayload(data: unknown): StaffBootstrapPayload | null {
  if (data == null) return null
  try {
    const o = (typeof data === 'string' ? JSON.parse(data) : data) as StaffBootstrapPayload
    return o && typeof o === 'object' ? o : null
  } catch {
    return null
  }
}

function bootstrapFromPayload(parsed: StaffBootstrapPayload | null): StaffBootstrapResult | null {
  if (!parsed || typeof parsed.path !== 'string' || parsed.path.length === 0) return null
  const ok = parsed.ok !== false
  return {
    ok,
    path: parsed.path,
    role: parsed.role ?? null,
    reason: typeof parsed.reason === 'string' ? parsed.reason : null,
    cafe_status: typeof parsed.cafe_status === 'string' ? parsed.cafe_status : null,
  }
}

/**
 * Full post-login bootstrap payload (RPC preferred; REST shape-matched fallback).
 */
export async function fetchStaffBootstrap(client: SupabaseClient): Promise<StaffBootstrapResult> {
  const { data, error } = await client.rpc('staff_bootstrap_path')
  const fromRpc = bootstrapFromPayload(parseBootstrapRpcPayload(data))

  if (!error && fromRpc) {
    return fromRpc
  }

  if (import.meta.env.DEV && error) {
    console.warn('[streakup] staff_bootstrap_path unavailable, using REST fallback:', error.message)
  }

  const user = (await client.auth.getUser()).data.user
  if (!user) {
    return { ok: false, path: '/login', role: null, reason: 'not_authenticated' }
  }

  const path = await resolveStaffDashboardPath(client, user.id)
  const { data: profile } = await client
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  const role = (profile as { role?: string } | null)?.role ?? null
  return { ok: path !== '/login', path, role, reason: path === '/login' ? 'no_workspace' : null }
}

/**
 * Single RPC round-trip for post-login navigation (falls back to REST if RPC missing).
 */
export async function fetchStaffBootstrapPath(client: SupabaseClient): Promise<string> {
  const r = await fetchStaffBootstrap(client)
  return r.ok ? r.path : '/login'
}

/**
 * Resolves the canonical post-login URL for staff (and linked customers).
 * Customers and cashiers normally enter via deep links; this still handles
 * mis-routed sessions gracefully.
 */
export async function resolveStaffDashboardPath(
  client: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: profile, error } = await client
    .from('profiles')
    .select('user_id, role, cafe_id, branch_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !profile) {
    return '/login'
  }

  const row = profile as ProfileRow

  switch (row.role) {
    case 'super_admin':
      return '/admin/overview'
    case 'hq_owner': {
      if (!row.cafe_id) return '/login'
      const { data: cafe } = await client
        .from('cafes')
        .select('slug, status')
        .eq('id', row.cafe_id)
        .maybeSingle()
      if (!cafe?.slug || cafe.status !== 'active') return '/login'
      return `/hq/${cafe.slug}`
    }
    case 'branch_manager': {
      if (!row.branch_id) return '/login'
      const { data: br } = await client
        .from('branches')
        .select('branch_code, cafe_id')
        .eq('id', row.branch_id)
        .maybeSingle()
      if (!br?.branch_code || !br.cafe_id) return '/login'
      const { data: cafe } = await client.from('cafes').select('status').eq('id', br.cafe_id).maybeSingle()
      if (cafe?.status !== 'active') return '/login'
      return `/branch/${br.branch_code}`
    }
    case 'cashier': {
      if (!row.branch_id) return '/login'
      const { data: br } = await client
        .from('branches')
        .select('branch_code, cafe_id')
        .eq('id', row.branch_id)
        .maybeSingle()
      if (!br?.branch_code || !br.cafe_id) return '/login'
      const { data: cafe } = await client
        .from('cafes')
        .select('slug, status')
        .eq('id', br.cafe_id)
        .maybeSingle()
      if (!cafe?.slug || cafe.status !== 'active') return '/login'
      return `/cashier/${cafe.slug}/${br.branch_code}`
    }
    case 'customer': {
      const { data: cust } = await client.from('customers').select('cafe_id').eq('auth_user_id', userId).maybeSingle()
      if (!cust?.cafe_id) return '/login'
      const { data: cafe } = await client
        .from('cafes')
        .select('slug, status')
        .eq('id', cust.cafe_id)
        .maybeSingle()
      if (!cafe?.slug || cafe.status !== 'active') return '/login'
      return `/my-streak/${cafe.slug}`
    }
    default:
      return '/login'
  }
}
