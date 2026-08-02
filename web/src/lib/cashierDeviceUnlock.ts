const STORAGE_PREFIX = 'streakup:cashier-device:'

export type CashierDeviceSession = {
  token: string
  branchId: string
  branchCode: string
  cafeSlug: string
  branchName?: string
  cafeId?: string
  expiresAt: string
}

function storageKey(cafeSlug: string, branchCode: string) {
  return `${STORAGE_PREFIX}${cafeSlug.toLowerCase()}:${branchCode.toLowerCase()}`
}

export function readCashierDeviceSession(
  cafeSlug: string,
  branchCode: string,
): CashierDeviceSession | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(storageKey(cafeSlug, branchCode))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CashierDeviceSession
    if (!parsed?.token || !parsed?.branchId || !parsed?.cafeSlug) return null
    if (parsed.cafeSlug.toLowerCase() !== cafeSlug.toLowerCase()) return null
    if (parsed.branchCode.toLowerCase() !== branchCode.toLowerCase()) return null
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) {
      sessionStorage.removeItem(storageKey(cafeSlug, branchCode))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeCashierDeviceSession(
  cafeSlug: string,
  branchCode: string,
  session: CashierDeviceSession,
) {
  sessionStorage.setItem(storageKey(cafeSlug, branchCode), JSON.stringify(session))
}

export function clearCashierDeviceSession(cafeSlug: string, branchCode: string) {
  sessionStorage.removeItem(storageKey(cafeSlug, branchCode))
}
