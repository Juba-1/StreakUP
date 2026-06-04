import { motion, useReducedMotion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'
import { portalTextMuted } from '@/lib/portal-surfaces'
import { cn } from '@/lib/utils'

const SUPPORT_TEL = '0557217757'

export function StreakUpBrandingFooter({
  className,
  compact,
}: {
  className?: string
  /** Inside fixed bottom bar — no extra vertical padding. */
  compact?: boolean
}) {
  const { locale } = useI18n()
  const reduceMotion = useReducedMotion()

  const label =
    locale === 'ar'
      ? `مشغّل بواسطة ستريك أب · ${SUPPORT_TEL}`
      : `Powered by StreakUp · ${SUPPORT_TEL}`

  return (
    <motion.footer
      initial={reduceMotion && !compact ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: compact ? 0 : 0.35, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn(compact ? 'w-full pb-1' : 'mt-auto w-full pt-10 pb-6', className)}
    >
      <div className="mx-auto flex max-w-md flex-col items-center gap-2 text-center">
        <div
          className="h-px w-16 bg-gradient-to-r from-transparent via-[color-mix(in_oklab,var(--brand-primary)_35%,transparent)] to-transparent"
          aria-hidden
        />
        <a
          href={`tel:${SUPPORT_TEL}`}
          dir="ltr"
          className={cn(
            'group inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--brand-primary)_12%,white)]',
            'bg-[color-mix(in_oklab,white_88%,var(--brand-primary)_4%)] px-4 py-2 text-[11px] font-medium tracking-wide shadow-[0_8px_32px_-20px_var(--brand-glow)]',
            'transition hover:border-[color-mix(in_oklab,var(--brand-primary)_28%,white)] hover:bg-[color-mix(in_oklab,white_82%,var(--brand-primary)_8%)]',
            portalTextMuted,
          )}
        >
          <Sparkles
            className="size-3.5 text-[color-mix(in_oklab,var(--brand-primary)_70%,transparent)] transition group-hover:scale-110"
            aria-hidden
          />
          <span className="bg-gradient-to-r from-[color-mix(in_oklab,var(--brand-primary)_85%,#1a1a1a)] to-[color-mix(in_oklab,var(--brand-secondary)_75%,#1a1a1a)] bg-clip-text text-transparent">
            {label}
          </span>
        </a>
      </div>
    </motion.footer>
  )
}
