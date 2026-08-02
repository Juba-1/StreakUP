import { motion, useReducedMotion } from 'framer-motion'
import { Gift, Percent, RotateCcw } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'
import { MiniSparkline } from '@/routes/hq/home/MiniSparkline'
import type { HomeKpis } from '@/routes/hq/home/useHqHomeDashboard'
import { cn } from '@/lib/utils'

type Props = {
  kpis: HomeKpis
}

export function HomeKpiGrid({ kpis }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  // Visits-today lives in the hero; repeating it here would show the same KPI twice.
  const cards = [
    {
      id: 'returning',
      label: t('hq.home.kpiReturning'),
      value: String(kpis.returningToday),
      trend: t('hq.home.kpiReturningHint'),
      up: true,
      spark: kpis.sparkReturning,
      Icon: RotateCcw,
    },
    {
      id: 'rewards',
      label: t('hq.home.kpiRewards'),
      value: String(kpis.rewardsRedeemedToday),
      trend: t('hq.home.kpiRewardsHint'),
      up: true,
      spark: kpis.sparkRewards,
      Icon: Gift,
    },
    {
      id: 'retention',
      label: t('hq.home.kpiRetention'),
      value: kpis.retentionRate == null ? '—' : `${kpis.retentionRate}%`,
      trend: t('hq.home.kpiRetentionHint'),
      up: true,
      spark: kpis.sparkRetention,
      Icon: Percent,
    },
  ]

  return (
    <section className="space-y-3" aria-label={t('hq.home.kpiAria')}>
      <h3 className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">
        {t('hq.home.kpiHeading')}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((card, i) => (
          <motion.article
            key={card.id}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.03 }}
            className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4 backdrop-blur-sm last:col-span-2 sm:last:col-span-1"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-[var(--brand-secondary)]">
                <card.Icon className="size-3.5" aria-hidden />
              </div>
              <MiniSparkline
                values={card.spark}
                stroke="color-mix(in oklab, var(--brand-primary) 85%, white)"
                aria-hidden
              />
            </div>
            <p className="mt-3 text-2xl font-bold tabular-nums tracking-tight text-white">
              {card.value}
            </p>
            <p className="mt-0.5 text-xs font-medium text-white/55">{card.label}</p>
            <p
              className={cn(
                'mt-1.5 text-[11px] font-semibold',
                card.up ? 'text-emerald-400/90' : 'text-orange-400/90',
              )}
            >
              {card.trend}
            </p>
          </motion.article>
        ))}
      </div>
    </section>
  )
}
