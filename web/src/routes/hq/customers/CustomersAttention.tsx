import { motion, useReducedMotion } from 'framer-motion'
import { Flame, Gift, Moon, Sparkles, UserPlus, AlertTriangle } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'
import type { CustomerFilter } from '@/routes/hq/customers/types'
import { cn } from '@/lib/utils'

type InsightCard = {
  id: string
  filter?: CustomerFilter
  openCustomerId?: string | null
  disabled?: boolean
  todo?: boolean
  count: number
  titleKey: string
  bodyKey: string
  Icon: typeof Gift
  tone: 'success' | 'warning' | 'info' | 'muted'
}

type Props = {
  cards: InsightCard[]
  activeFilter: CustomerFilter
  onActivateFilter: (f: CustomerFilter) => void
  onOpenCustomer: (id: string) => void
}

const toneClass = {
  success: 'border-emerald-500/20 bg-emerald-500/10',
  warning: 'border-amber-500/20 bg-amber-500/10',
  info: 'border-white/10 bg-white/[0.04]',
  muted: 'border-white/8 bg-white/[0.02] opacity-60',
} as const

export function CustomersAttention({
  cards,
  activeFilter,
  onActivateFilter,
  onOpenCustomer,
}: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center">
        <Sparkles className="mx-auto size-6 text-white/30" aria-hidden />
        <p className="mt-2 text-sm font-medium text-white">{t('hq.customers.attentionEmptyTitle')}</p>
        <p className="mt-1 text-xs text-white/45">{t('hq.customers.attentionEmptyBody')}</p>
      </div>
    )
  }

  return (
    <section aria-label={t('hq.customers.attentionAria')} className="space-y-2">
      <h2 className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">
        {t('hq.customers.attentionHeading')}
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {cards.map((card, i) => {
          const active = card.filter != null && activeFilter === card.filter
          const clickable = !card.disabled
          return (
            <motion.button
              key={card.id}
              type="button"
              disabled={!clickable}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.04, 0.16), duration: 0.18 }}
              onClick={() => {
                if (card.openCustomerId) {
                  onOpenCustomer(card.openCustomerId)
                  return
                }
                if (card.filter) onActivateFilter(card.filter)
              }}
              className={cn(
                'min-w-[200px] max-w-[240px] shrink-0 rounded-2xl border p-4 text-start transition',
                toneClass[card.disabled ? 'muted' : card.tone],
                clickable && 'hover:border-white/20 hover:bg-white/[0.06]',
                active && 'ring-1 ring-[color-mix(in_oklab,var(--brand-primary)_45%,transparent)]',
                !clickable && 'cursor-not-allowed',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <card.Icon className="size-4 text-[var(--brand-secondary)]" aria-hidden />
                <span className="text-lg font-semibold tabular-nums text-white">{card.count}</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-white">{t(card.titleKey)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/45">{t(card.bodyKey)}</p>
              {card.todo ? (
                <p className="mt-2 text-[10px] text-white/30">
                  {/* TODO: Requires backend support. */}
                  {t('hq.customers.requiresBackend')}
                </p>
              ) : null}
            </motion.button>
          )
        })}
      </div>
    </section>
  )
}

export const insightIcons = {
  Gift,
  AlertTriangle,
  Flame,
  Moon,
  UserPlus,
  Sparkles,
}
