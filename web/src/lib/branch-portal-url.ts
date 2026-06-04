/** Canonical branch manager portal URL — never HQ routes. */
export function branchManagerPortalUrl(branchCode: string, origin = window.location.origin): string {
  const code = branchCode.trim().toLowerCase().replace(/^\/+/, '')
  if (!code) return `${origin}/login`
  return `${origin}/branch/${code}`
}
