/** Cryptographically fair 4-digit PIN for branch/cashier defaults. */
export function secureDigits4(): string {
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return String(1000 + (arr[0]! % 9000))
}

export function normalizeCashierPin(raw: string): string | null {
  const clean = raw.replace(/\D/g, '').slice(0, 8)
  if (!/^[0-9]{4,8}$/.test(clean)) return null
  return clean
}
