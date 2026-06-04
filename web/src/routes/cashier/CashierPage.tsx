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
  const { branchCode } = useParams()
  const code = (branchCode ?? '').toLowerCase()

  const [session, setSession] = useState<CashierDeviceSession | null>(() =>
    code ? readCashierDeviceSession(code) : null,
  )

  useEffect(() => {
    if (!code) return
    setSession(readCashierDeviceSession(code))
  }, [code])

  const handleUnlocked = useCallback(
    (next: CashierDeviceSession) => {
      writeCashierDeviceSession(code, next)
      setSession(next)
    },
    [code],
  )

  if (!code) {
    return null
  }

  if (!session?.token) {
    return <CashierLockScreen branchCode={code} onUnlocked={handleUnlocked} />
  }

  return <CashierHomePage deviceSession={session} branchCode={code} />
}
