import { motion } from 'framer-motion'

import { useI18n } from '@/core/i18n/I18nProvider'

export function RouteFallback() {
  const { t } = useI18n()

  return (
    <div
      className="flex min-h-[40vh] flex-col items-center justify-center gap-6 px-4 py-16"
      role="status"
      aria-live="polite"
    >
      <motion.div
        className="relative size-16 rounded-2xl border border-white/10 bg-zinc-950/80 shadow-[0_0_60px_-12px_var(--brand-glow,theme(colors.violet.500/0.45))]"
        animate={{ rotate: [0, 2, -2, 0], scale: [1, 1.03, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="space-y-2 text-center">
        <p className="text-xs font-semibold tracking-[0.35em] text-white/50">STREAKUP</p>
        <p className="text-sm text-white/70">{t('common.loading')}</p>
      </div>
    </div>
  )
}
