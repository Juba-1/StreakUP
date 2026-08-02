import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { CashierHomePage } from '@/routes/cashier/CashierHomePage'
import { CashierLockScreen } from '@/routes/cashier/CashierLockScreen'
import {
  readCashierDeviceSession,
  writeCashierDeviceSession,
  type CashierDeviceSession,
} from '@/lib/cashierDeviceUnlock'

export function CashierPage() {
  const { cafeSlug, branchCode } = useParams()
  const slug = (cafeSlug ?? '').toLowerCase()
  const code = (branchCode ?? '').toLowerCase()

  const [session, setSession] = useState<CashierDeviceSession | null>(() =>
    slug && code ? readCashierDeviceSession(slug, code) : null,
  )

  useEffect(() => {
    if (!slug || !code) return
    const next = readCashierDeviceSession(slug, code)
    if (
      next &&
      (next.cafeSlug.toLowerCase() !== slug || next.branchCode.toLowerCase() !== code)
    ) {
      setSession(null)
      return
    }
    setSession(next)
  }, [slug, code])

  const handleUnlocked = useCallback(
    (next: CashierDeviceSession) => {
      writeCashierDeviceSession(slug, code, next)
      setSession(next)
    },
    [slug, code],
  )

  if (!slug || !code) {
    return null
  }

  if (!session?.token) {
    return <CashierLockScreen cafeSlug={slug} branchCode={code} onUnlocked={handleUnlocked} />
  }

  return <CashierHomePage deviceSession={session} cafeSlug={slug} branchCode={code} />
}
