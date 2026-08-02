import { ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { InsightAction, ReportsInsight } from '@/routes/hq/reports/types'
import { cn } from '@/lib/utils'

type Props = {
  loading?: boolean
  insights: ReportsInsight[]
  onAction: (action: InsightAction, insight: ReportsInsight) => void
}

const toneClass = {
  success: 'border-emerald-500/15 bg-emerald-500/[0.07]',
  warning: 'border-amber-500/15 bg-amber-500/[0.07]',
  info: 'border-white/8 bg-white/[0.03]',
} as const

/** Max 3 actionable cards — decisions, not decoration. */
export function ActionableInsights({ loading, insights, onAction }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-24 rounded-2xl bg-white/10" />
        <Skeleton className="h-24 rounded-2xl bg-white/10" />
        <Skeleton className="h-24 rounded-2xl bg-white/10" />
      </div>
    )
  }

  if (insights.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/8 px-5 py-8 text-center">
        <p className="text-sm text-white/50">{t('hq.reports.insightsEmptyTitle')}</p>
      </div>
    )
  }

  return (
    <section aria-label={t('hq.reports.insightsAria')} className="space-y-3">
      <h2 className="text-[11px] font-semibold tracking-[0.2em] text-white/35 uppercase">
        {t('hq.reports.actionsHeading')}
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        {insights.slice(0, 3).map((card, i) => (
          <motion.button
            key={card.id}
            type="button"
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.1) }}
            onClick={() => onAction(card.action, card)}
            className={cn(
              'rounded-2xl border p-4 text-start transition hover:border-white/18',
              toneClass[card.tone],
            )}
          >
            <p className="text-sm font-semibold text-white">
              {t(card.titleKey)
                .replace('{n}', String(card.count ?? ''))
                .replace('{name}', card.name ?? '')}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/45">
              {t(card.bodyKey)
                .replace('{n}', String(card.count ?? ''))
                .replace('{name}', card.name ?? '')}
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-white/70">
              {t('hq.reports.actionOpen')}
              <ArrowRight className="size-3 rtl:rotate-180" />
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  )
}
