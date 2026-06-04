/** Client-side fallback when admin_list_audit_secure is not deployed yet. */

export function formatAuditSummary(action: string, payload: Record<string, unknown>): string {
  const before = (payload.before as Record<string, unknown> | undefined) ?? {}
  const after = (payload.after as Record<string, unknown> | undefined) ?? {}

  if (action === 'customer.override') {
    return `Changed streak from ${String(before.current_streak ?? '?')} to ${String(after.current_streak ?? '?')}`
  }
  if (action === 'cafe.provisioned') {
    return `Provisioned café ${String(payload.name ?? payload.slug ?? '')}`
  }
  if (action === 'cafe.status_changed') {
    return `Café status → ${String(payload.status ?? payload.new_status ?? '—')}`
  }
  if (action === 'subscription.updated') {
    return `Subscription → ${String(payload.plan_tier ?? payload.plan_name ?? '—')}`
  }
  return action.replaceAll('.', ' · ').replaceAll('_', ' ')
}

export function resolveAuditIp(payload: Record<string, unknown>, column?: string | null): string {
  if (column && column.trim()) return column.trim()
  const fromPayload = payload.ip_address ?? payload.client_ip
  if (typeof fromPayload === 'string' && fromPayload.trim()) return fromPayload.trim()
  return '—'
}
