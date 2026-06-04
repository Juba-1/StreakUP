const STORAGE_PREFIX = 'streakup:cashier-device:'

export type CashierDeviceSession = {
  token: string
  branchId: string
  branchCode: string
  branchName?: string
  cafeId?: string
  expiresAt: string
}

function storageKey(branchCode: string) {
  return `${STORAGE_PREFIX}${branchCode.toLowerCase()}`
}

export function readCashierDeviceSession(branchCode: string): CashierDeviceSession | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(storageKey(branchCode))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CashierDeviceSession
    if (!parsed?.token || !parsed?.branchId) return null
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) {
      sessionStorage.removeItem(storageKey(branchCode))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeCashierDeviceSession(branchCode: string, session: CashierDeviceSession) {
  sessionStorage.setItem(storageKey(branchCode), JSON.stringify(session))
}

export function clearCashierDeviceSession(branchCode: string) {
  sessionStorage.removeItem(storageKey(branchCode))
}
