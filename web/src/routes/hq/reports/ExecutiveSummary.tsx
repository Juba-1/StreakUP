import { motion, useReducedMotion } from 'framer-motion'
import { Flame, Gift, Lock, Percent, RotateCcw, Shield, TrendingUp } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { MiniSparkline } from '@/routes/hq/home/MiniSparkline'
import type { ActiveTab } from '@/routes/hq/reports/types'
import { cn } from '@/lib/utils'

type KpiId = 'retention' | 'returning' | 'rewards' | 'streaks' | 'roi' | 'shields'

type Props = {
  loading?: boolean
  retentionPct: number | null
  returning: number | null
  rewards: number | null
  activeStreaks: number | null
  shieldSaves: number | null
  sparkVisits: number[]
  momentum: number | null
  showRoi: boolean
  activeTab: ActiveTab
  onOpen: (id: KpiId) => void
  onFocusTab: (tab: ActiveTab) => void
}

const tone = {
  violet: {
    card: 'border-violet-500/25 bg-violet-500/[0.08] hover:border-violet-400/40',
    chip: 'bg-violet-500/20 text-violet-300',
    spark: 'color-mix(in oklab, var(--brand-primary) 85%, white)',
  },
  emerald: {
    card: 'border-emerald-500/25 bg-emerald-500/[0.08] hover:border-emerald-400/40',
    chip: 'bg-emerald-500/20 text-emerald-300',
    spark: '#34d399',
  },
  amber: {
    card: 'border-amber-500/25 bg-amber-500/[0.08] hover:border-amber-400/40',
    chip: 'bg-amber-500/20 text-amber-300',
    spark: '#fbbf24',
  },
  sky: {
    card: 'border-sky-500/25 bg-sky-500/[0.08] hover:border-sky-400/40',
    chip: 'bg-sky-500/20 text-sky-300',
    spark: 'color-mix(in oklab, var(--brand-secondary) 85%, white)',
  },
  rose: {
    card: 'border-rose-500/25 bg-rose-500/[0.08] hover:border-rose-400/40',
    chip: 'bg-rose-500/20 text-rose-300',
    spark: '#fb7185',
  },
} as const

export function ExecutiveSummary({
  loading,
  retentionPct,
  returning,
  rewards,
  activeStreaks,
  shieldSaves,
  sparkVisits,
  momentum,
  showRoi,
  activeTab,
  onOpen,
  onFocusTab,
}: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl bg-white/10" />
        ))}
      </div>
    )
  }

  const momentumLabel =
    momentum == null ? t('hq.reports.trendNone') : momentum >= 0 ? `+${momentum}%` : `${momentum}%`

  const cards: Array<{
    id: KpiId
    tab: ActiveTab
    label: string
    value: string
    hint: string
    trend: string
    up: boolean
    Icon: typeof Percent
    tone: keyof typeof tone
    locked?: boolean
  }> = [
    {
      id: 'retention',
      tab: 'retention',
      label: t('hq.reports.kpiRetention'),
      value: retentionPct == null ? '—' : `${retentionPct}%`,
      hint: t('hq.reports.kpiRetentionHint'),
      trend: momentumLabel,
      up: (momentum ?? 0) >= 0,
      Icon: Percent,
      tone: 'violet',
    },
    {
      id: 'returning',
      tab: 'visits',
      label: t('hq.reports.kpiReturning'),
      value: returning == null ? '—' : String(returning),
      hint: t('hq.reports.kpiReturningHint'),
      trend: momentumLabel,
      up: (momentum ?? 0) >= 0,
      Icon: RotateCcw,
      tone: 'emerald',
    },
    {
      id: 'rewards',
      tab: 'rewards',
      label: t('hq.reports.kpiRewards'),
      value: rewards == null ? '—' : String(rewards),
      hint: t('hq.reports.kpiRewardsHint'),
      trend: t('hq.reports.kpiRewardsTrend'),
      up: (rewards ?? 0) > 0,
      Icon: Gift,
      tone: 'amber',
    },
    {
      id: 'streaks',
      tab: 'retention',
      label: t('hq.reports.kpiStreaks'),
      value: activeStreaks == null ? '—' : String(activeStreaks),
      hint: t('hq.reports.kpiStreaksHint'),
      trend:
        shieldSaves && shieldSaves > 0
          ? t('hq.reports.kpiShieldsTrend').replace('{n}', String(shieldSaves))
          : t('hq.reports.kpiRewardsTrend'),
      up: (activeStreaks ?? 0) > 0,
      Icon: Flame,
      tone: 'sky',
    },
  ]

  if (showRoi) {
    cards.push({
      id: 'roi',
      tab: 'roi',
      label: t('hq.reports.kpiRoi'),
      value: '—',
      hint: t('hq.reports.kpiRoiPos'),
      trend: t('hq.reports.kpiRoiTrend'),
      up: false,
      Icon: TrendingUp,
      tone: 'rose',
      locked: true,
    })
  } else {
    cards.push({
      id: 'shields',
      tab: 'retention',
      label: t('hq.reports.kpiShields'),
      value: shieldSaves == null ? '—' : String(shieldSaves),
      hint: t('hq.reports.kpiShieldsHint'),
      trend: t('hq.reports.kpiRewardsTrend'),
      up: (shieldSaves ?? 0) > 0,
      Icon: Shield,
      tone: 'rose',
    })
  }

  return (
    <section aria-label={t('hq.reports.summaryAria')} className="grid grid-cols-2 gap-3 xl:grid-cols-5">
      {cards.map((card, i) => {
        const tTone = tone[card.tone]
        const focused =
          activeTab === card.tab || (card.id === 'returning' && activeTab === 'visits')
        return (
          <motion.button
            key={card.id}
            type="button"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.12), duration: 0.2 }}
            onClick={() => {
              onFocusTab(card.tab)
              onOpen(card.id)
            }}
            className={cn(
              'rounded-2xl border p-4 text-start backdrop-blur-xl transition',
              tTone.card,
              focused && 'ring-1 ring-white/20',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={cn('grid size-8 place-items-center rounded-xl', tTone.chip)}>
                {card.locked ? (
                  <Lock className="size-3.5" aria-hidden />
                ) : (
                  <card.Icon className="size-3.5" aria-hidden />
                )}
              </span>
              {!card.locked && sparkVisits.length > 1 ? (
                <MiniSparkline values={sparkVisits} stroke={tTone.spark} aria-hidden />
              ) : null}
            </div>
            <p className="mt-3 text-[11px] text-white/45">{card.label}</p>
            <p className="mt-0.5 text-[1.65rem] font-semibold tracking-tight text-white tabular-nums">
              {card.value}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="truncate text-[11px] text-white/35">{card.hint}</p>
              <span
                className={cn(
                  'shrink-0 text-[11px] font-medium tabular-nums',
                  card.locked
                    ? 'text-white/30'
                    : card.up
                      ? 'text-emerald-300/90'
                      : 'text-amber-200/70',
                )}
              >
                {card.trend}
              </span>
            </div>
          </motion.button>
        )
      })}
    </section>
  )
}
