/**
 * GDPR / PDPL-friendly phone masking for staff dashboards.
 * Saudi-style example: +966 5X XXX X123 (last 4 digits visible).
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone?.trim()) return '—'
  const raw = phone.trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 4) return '••••'
  const last4 = digits.slice(-4)

  // KSA mobile numbers commonly stored as 9665XXXXXXXXX
  if (digits.startsWith('966') && digits.length >= 12) {
    return `+966 5X XXX ${last4}`
  }

  if (raw.startsWith('+')) {
    const m = raw.match(/^(\+\d{1,4})/)
    const prefix = m?.[1] ?? '+'
    return `${prefix} … XXX ${last4}`
  }

  if (digits.length <= 7) {
    return `…XXX ${last4}`
  }

  return `${digits.slice(0, 2)}…XXX ${last4}`
}

export function maskCustomerId(id: string | null | undefined): string {
  if (!id) return '—'
  if (id.length <= 10) return '••••'
  return `${id.slice(0, 6)}…${id.slice(-4)}`
}
