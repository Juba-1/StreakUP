import { motion, useReducedMotion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'

export function OpsSecurityTip() {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  const tips = [
    t('hq.opsPage.securityTip1'),
    t('hq.opsPage.securityTip2'),
    t('hq.opsPage.securityTip3'),
  ]

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: 0.05 }}
      className="rounded-2xl border border-white/10 bg-zinc-950/55 p-4 backdrop-blur-xl"
      aria-label={t('hq.opsPage.securityTipHeading')}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
          <ShieldCheck className="size-4" aria-hidden />
        </span>
        <h2 className="text-sm font-semibold text-white">{t('hq.opsPage.securityTipHeading')}</h2>
      </div>

      <ul className="mt-4 space-y-3">
        {tips.map((tip) => (
          <li key={tip} className="flex items-start gap-2.5 text-xs leading-relaxed text-white/55">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-white/25" aria-hidden />
            {tip}
          </li>
        ))}
      </ul>
    </motion.section>
  )
}
