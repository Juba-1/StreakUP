import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { CustomerPortalBottomBar } from './CustomerPortalBottomBar'

type Props = {
  children: ReactNode
  showSessionBar?: boolean
  onLockSession?: () => void
  className?: string
}

/**
 * Customer portal: full-viewport scroll body + fixed bottom bar (branding / lock session).
 */
export function CustomerPortalShell({ children, showSessionBar, onLockSession, className }: Props) {
  return (
    <div className={cn('relative flex min-h-dvh w-full flex-1 flex-col', className)}>
      <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {children}
      </div>
      <CustomerPortalBottomBar showLockSession={showSessionBar} onLockSession={onLockSession} />
    </div>
  )
}
