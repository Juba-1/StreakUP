import { Lock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

import { StreakUpBrandingFooter } from './StreakUpBrandingFooter'

/** Spacer when lock button is hidden (branding only). */
const BAR_HEIGHT_COMPACT_REM = '4.25rem'
const BAR_HEIGHT_FULL_REM = '7.5rem'

type Props = {
  showLockSession?: boolean
  onLockSession?: () => void
  className?: string
}

/** Fixed iOS-style bottom bar: lock session + StreakUp branding. */
export function CustomerPortalBottomBar({ showLockSession, onLockSession, className }: Props) {
  const { t } = useI18n()
  const barHeight = showLockSession && onLockSession ? BAR_HEIGHT_FULL_REM : BAR_HEIGHT_COMPACT_REM

  return (
    <>
      <div
        className="pointer-events-none shrink-0"
        style={{ height: `calc(${barHeight} + env(safe-area-inset-bottom, 0px))` }}
        aria-hidden
      />
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 border-t border-[color-mix(in_oklab,var(--brand-primary)_18%,white)]',
          'bg-[color-mix(in_oklab,white_82%,var(--brand-primary)_6%)]/90 backdrop-blur-xl',
          'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
          className,
        )}
      >
        <div className="mx-auto w-full max-w-6xl px-4 pt-2.5">
          {showLockSession && onLockSession ? (
            <Button
              type="button"
              variant="secondary"
              className={cn(
                'mb-2 h-11 w-full rounded-2xl border border-[color-mix(in_oklab,var(--brand-primary)_25%,white)]',
                'bg-[color-mix(in_oklab,var(--brand-primary)_12%,white)] text-[color-mix(in_oklab,var(--brand-primary)_90%,#111)]',
                'shadow-[0_8px_28px_-16px_var(--brand-glow)] hover:bg-[color-mix(in_oklab,var(--brand-primary)_18%,white)]',
              )}
              onClick={onLockSession}
            >
              <Lock className="size-4" aria-hidden />
              <span className="ms-2 font-semibold">{t('myStreak.lock')}</span>
            </Button>
          ) : null}
          <StreakUpBrandingFooter compact />
        </div>
      </div>
    </>
  )
}

export const CUSTOMER_PORTAL_BOTTOM_PAD_COMPACT = BAR_HEIGHT_COMPACT_REM
export const CUSTOMER_PORTAL_BOTTOM_PAD_FULL = BAR_HEIGHT_FULL_REM
