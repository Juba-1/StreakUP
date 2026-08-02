import { motion, useReducedMotion } from 'framer-motion'
import { Flame, Gift, HeartCrack, Target, Users } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'
import type { CustomerFilter } from '@/routes/hq/customers/types'
import { cn } from '@/lib/utils'

type KpiId = 'total' | 'near' | 'ready' | 'today' | 'lost'

type Props = {
  total: number
  nearReward: number
  readyRewards: number
  visitedToday: number
  lostStreak: number
  activeFilter: CustomerFilter
  onFilter: (f: CustomerFilter) => void
}

const tone = {
  violet: {
    card: 'border-violet-500/25 bg-violet-500/[0.08] hover:border-violet-400/40',
    chip: 'bg-violet-500/20 text-violet-300',
    active: 'ring-1 ring-violet-400/50',
  },
  emerald: {
    card: 'border-emerald-500/25 bg-emerald-500/[0.08] hover:border-emerald-400/40',
    chip: 'bg-emerald-500/20 text-emerald-300',
    active: 'ring-1 ring-emerald-400/50',
  },
  amber: {
    card: 'border-amber-500/25 bg-amber-500/[0.08] hover:border-amber-400/40',
    chip: 'bg-amber-500/20 text-amber-300',
    active: 'ring-1 ring-amber-400/50',
  },
  sky: {
    card: 'border-sky-500/25 bg-sky-500/[0.08] hover:border-sky-400/40',
    chip: 'bg-sky-500/20 text-sky-300',
    active: 'ring-1 ring-sky-400/50',
  },
  rose: {
    card: 'border-rose-500/25 bg-rose-500/[0.08] hover:border-rose-400/40',
    chip: 'bg-rose-500/20 text-rose-300',
    active: 'ring-1 ring-rose-400/50',
  },
} as const

export function CustomersSummary({
  total,
  nearReward,
  readyRewards,
  visitedToday,
  lostStreak,
  activeFilter,
  onFilter,
}: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  const items: {
    id: KpiId
    label: string
    hint: string
    value: number
    Icon: typeof Users
    tone: keyof typeof tone
    filter: CustomerFilter
  }[] = [
    {
      id: 'total',
      label: t('hq.customers.kpiTotal'),
      hint: t('hq.customers.kpiTotalHint'),
      value: total,
      Icon: Users,
      tone: 'violet',
      filter: 'all',
    },
    {
      id: 'near',
      label: t('hq.customers.kpiNear'),
      hint: t('hq.customers.kpiNearHint'),
      value: nearReward,
      Icon: Target,
      tone: 'emerald',
      filter: 'near_reward',
    },
    {
      id: 'ready',
      label: t('hq.customers.kpiReady'),
      hint: t('hq.customers.kpiReadyHint'),
      value: readyRewards,
      Icon: Gift,
      tone: 'amber',
      filter: 'ready_reward',
    },
    {
      id: 'today',
      label: t('hq.customers.kpiToday'),
      hint: t('hq.customers.kpiTodayHint'),
      value: visitedToday,
      Icon: Flame,
      tone: 'sky',
      filter: 'visited_today',
    },
    {
      id: 'lost',
      label: t('hq.customers.kpiLost'),
      hint: t('hq.customers.kpiLostHint'),
      value: lostStreak,
      Icon: HeartCrack,
      tone: 'rose',
      filter: 'lost_streak',
    },
  ]

  return (
    <section
      aria-label={t('hq.customers.summaryAria')}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
    >
      {items.map((item, i) => {
        const active = activeFilter === item.filter
        const tTone = tone[item.tone]
        return (
          <motion.button
            key={item.id}
            type="button"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * i, duration: 0.18 }}
            onClick={() => onFilter(active && item.filter !== 'all' ? 'all' : item.filter)}
            className={cn(
              'rounded-2xl border px-4 py-3.5 text-start backdrop-blur-xl transition',
              tTone.card,
              active && tTone.active,
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={cn('grid size-8 place-items-center rounded-xl', tTone.chip)}>
                <item.Icon className="size-3.5" aria-hidden />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-white">
              {item.value}
            </p>
            <p className="mt-1 text-xs font-medium text-white/80">{item.label}</p>
            <p className="mt-0.5 text-[11px] text-white/40">{item.hint}</p>
          </motion.button>
        )
      })}
    </section>
  )
}
