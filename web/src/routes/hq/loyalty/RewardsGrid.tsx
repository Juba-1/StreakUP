import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { MilestoneIconGlyph, normalizeIconType } from '@/lib/milestone-icons'
import type { MilestoneRow } from '@/routes/hq/loyalty/types'
import { cn } from '@/lib/utils'

type Props = {
  milestones: MilestoneRow[]
  redemptions: Map<string, number>
  highlightId?: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  onView: (m: MilestoneRow) => void
  onEdit: (m: MilestoneRow) => void
  onDuplicate: (m: MilestoneRow) => void
  onToggle: (m: MilestoneRow) => void
  onDelete: (m: MilestoneRow) => void
}

function Menu({
  m,
  onEdit,
  onDuplicate,
  onToggle,
  onDelete,
}: {
  m: MilestoneRow
  onEdit: () => void
  onDuplicate: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="size-8 text-white/45"
        aria-label={t('hq.loyalty.menuAria')}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open ? (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute end-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-white/12 bg-zinc-950 py-1 shadow-xl"
        >
          <button
            type="button"
            className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/[0.06]"
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
          >
            {t('hq.rewards.row.edit')}
          </button>
          <button
            type="button"
            className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/[0.06]"
            onClick={() => {
              setOpen(false)
              onDuplicate()
            }}
          >
            {t('hq.loyalty.duplicate')}
          </button>
          <button
            type="button"
            className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/[0.06]"
            onClick={() => {
              setOpen(false)
              onToggle()
            }}
          >
            {m.active ? t('hq.loyalty.disable') : t('hq.loyalty.enable')}
          </button>
          <button
            type="button"
            className="flex w-full px-3 py-2 text-start text-xs text-rose-300 hover:bg-rose-500/10"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          >
            {t('hq.rewards.row.delete')}
          </button>
        </motion.div>
      ) : null}
    </div>
  )
}

export function RewardsGrid({
  milestones,
  redemptions,
  highlightId,
  collapsed,
  onToggleCollapse,
  onView,
  onEdit,
  onDuplicate,
  onToggle,
  onDelete,
}: Props) {
  const { t } = useI18n()
  const withReward = milestones.filter((m) => Boolean(m.reward_label?.trim()))

  return (
    <section
      id="loyalty-rewards"
      aria-label={t('hq.loyalty.rewardsAria')}
      className="rounded-2xl border border-white/10 bg-zinc-950/60 backdrop-blur-xl"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 border-b border-white/8 px-4 py-3 text-start"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
      >
        <div>
          <h2 className="text-sm font-semibold text-white">{t('hq.loyalty.rewardsTitle')}</h2>
          <p className="text-xs text-white/45">{t('hq.loyalty.rewardsBody')}</p>
        </div>
        <span className="text-[11px] text-white/40">{collapsed ? t('hq.loyalty.expand') : t('hq.loyalty.collapse')}</span>
      </button>

      {!collapsed ? (
        <div className="p-3">
          {withReward.length === 0 ? (
            <p className="py-8 text-center text-xs text-white/45">{t('hq.loyalty.rewardsEmpty')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {withReward.map((m) => (
                <article
                  key={m.id}
                  id={`reward-${m.id}`}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                    highlightId === m.id
                      ? 'border-[color-mix(in_oklab,var(--brand-primary)_45%,transparent)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,transparent)]'
                      : 'border-white/8 bg-black/25',
                    !m.active && 'opacity-55',
                  )}
                >
                  <div className="grid size-9 place-items-center rounded-lg border border-white/10 bg-zinc-950">
                    <MilestoneIconGlyph
                      iconType={normalizeIconType(m.icon_type)}
                      discountPercentage={m.discount_percentage}
                      className="text-[var(--brand-primary)]"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{m.reward_label}</p>
                    <p className="text-[11px] text-white/40">
                      {m.name} · {m.days_required}d
                      {redemptions.has(m.id)
                        ? ` · ${redemptions.get(m.id)} ${t('hq.loyalty.redemptions')}`
                        : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 text-xs"
                    onClick={() => onView(m)}
                  >
                    {t('hq.customers.view')}
                  </Button>
                  <Menu
                    m={m}
                    onEdit={() => onEdit(m)}
                    onDuplicate={() => onDuplicate(m)}
                    onToggle={() => onToggle(m)}
                    onDelete={() => onDelete(m)}
                  />
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}