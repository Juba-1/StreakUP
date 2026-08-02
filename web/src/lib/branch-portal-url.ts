/** Canonical cashier kiosk URL — always café-scoped to prevent cross-tenant branch_code collisions. */
export function cashierPortalPath(cafeSlug: string, branchCode: string): string {
  const slug = cafeSlug.trim().toLowerCase().replace(/^\/+/, '')
  const code = branchCode.trim().toLowerCase().replace(/^\/+/, '')
  if (!slug || !code) return '/login'
  return `/cashier/${slug}/${code}`
}

export function cashierPortalUrl(
  cafeSlug: string,
  branchCode: string,
  origin = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const path = cashierPortalPath(cafeSlug, branchCode)
  if (!origin || path === '/login') return path
  return `${origin}${path}`
}

/** Canonical branch manager portal URL — never HQ routes. */
export function branchManagerPortalUrl(branchCode: string, origin = window.location.origin): string {
  const code = branchCode.trim().toLowerCase().replace(/^\/+/, '')
  if (!code) return `${origin}/login`
  return `${origin}/branch/${code}`
}
