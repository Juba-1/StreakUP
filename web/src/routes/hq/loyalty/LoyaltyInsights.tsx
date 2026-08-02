import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Flame, Gift, Shield, Sparkles } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

export type LoyaltyInsight = {
  id: string
  tone: 'success' | 'warning' | 'info'
  titleKey: string
  bodyKey: string
  action: 'journey' | 'milestone' | 'reward' | 'recovery'
  milestoneId?: string
  count?: number
}

type Props = {
  cards: LoyaltyInsight[]
  onAction: (card: LoyaltyInsight) => void
}

const toneClass = {
  success: 'border-emerald-500/20 bg-emerald-500/10',
  warning: 'border-amber-500/20 bg-amber-500/10',
  info: 'border-white/10 bg-white/[0.04]',
} as const

const icons = {
  journey: Sparkles,
  milestone: Flame,
  reward: Gift,
  recovery: Shield,
} as const

export function LoyaltyInsights({ cards, onAction }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center">
        <Sparkles className="mx-auto size-6 text-white/30" aria-hidden />
        <p className="mt-2 text-sm font-medium text-white">{t('hq.loyalty.insightEmptyTitle')}</p>
        <p className="mt-1 text-xs text-white/45">{t('hq.loyalty.insightEmptyBody')}</p>
      </div>
    )
  }

  return (
    <section aria-label={t('hq.loyalty.insightsAria')} className="space-y-2">
      <h2 className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">
        {t('hq.loyalty.insightsHeading')}
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {cards.map((card, i) => {
          const Icon = icons[card.action]
          return (
            <motion.button
              key={card.id}
              type="button"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.16), duration: 0.18 }}
              onClick={() => onAction(card)}
              className={cn(
                'min-w-[220px] max-w-[260px] shrink-0 rounded-2xl border p-4 text-start transition hover:border-white/20',
                toneClass[card.tone],
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <Icon className="size-4 text-[var(--brand-secondary)]" aria-hidden />
                {card.count != null ? (
                  <span className="text-lg font-semibold tabular-nums text-white">{card.count}</span>
                ) : null}
              </div>
              <p className="mt-3 text-sm font-semibold text-white">{t(card.titleKey)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                {t(card.bodyKey).replace('{n}', String(card.count ?? ''))}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-white/70">
                {t(`hq.loyalty.insightCta.${card.action}`)}
                <ArrowRight className="size-3 rtl:rotate-180" aria-hidden />
              </span>
            </motion.button>
          )
        })}
      </div>
    </section>
  )
}
