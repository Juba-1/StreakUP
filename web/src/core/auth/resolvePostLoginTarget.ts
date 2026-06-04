/**
 * Picks the post-login destination without sending branch/cashier staff to HQ via stale `from` state.
 */
export function resolvePostLoginTarget(
  workspacePath: string,
  from: string | null | undefined,
  role?: string | null,
): string {
  const branchStaff = role === 'branch_manager' || role === 'cashier'

  if (branchStaff) {
    if (from?.startsWith('/hq')) {
      return workspacePath
    }
    if (role === 'branch_manager' && from?.startsWith('/branch/')) {
      return from
    }
    if (role === 'cashier' && from?.startsWith('/cashier/')) {
      return from
    }
    return workspacePath
  }

  if (from?.startsWith('/branch/')) {
    return workspacePath
  }

  if (workspacePath.startsWith('/branch/') || workspacePath.startsWith('/cashier/')) {
    return workspacePath
  }

  if (from && from !== '/login' && from !== '/') {
    return from
  }

  return workspacePath
}
