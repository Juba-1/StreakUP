import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowUp, MoreHorizontal, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/core/i18n/I18nProvider'
import { MilestoneIconGlyph, normalizeIconType } from '@/lib/milestone-icons'
import type { MilestoneRow } from '@/routes/hq/loyalty/types'
import { cn } from '@/lib/utils'

type Props = {
  milestones: MilestoneRow[]
  highlightId?: string | null
  search: string
  onSearch: (v: string) => void
  onAdd: () => void
  onEdit: (m: MilestoneRow) => void
  onToggle: (m: MilestoneRow) => void
  onDelete: (m: MilestoneRow) => void
  onMoveUp: (m: MilestoneRow, prev: MilestoneRow) => void
  onMoveDown: (m: MilestoneRow, next: MilestoneRow) => void
  swapPending?: boolean
  seedPending?: boolean
  onSeed: () => void
}

function RowMenu({
  onEdit,
  onToggle,
  onDelete,
  active,
}: {
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  active: boolean
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
        className="size-8 text-white/45 hover:text-white"
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
              onToggle()
            }}
          >
            {active ? t('hq.loyalty.disable') : t('hq.loyalty.enable')}
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

export function JourneyBuilder({
  milestones,
  highlightId,
  search,
  onSearch,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  onMoveUp,
  onMoveDown,
  swapPending,
  seedPending,
  onSeed,
}: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const showSearch = milestones.length > 6
  const q = search.trim().toLowerCase()
  const filtered = q
    ? milestones.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.reward_label ?? '').toLowerCase().includes(q),
      )
    : milestones

  return (
    <section
      id="loyalty-journey"
      aria-label={t('hq.loyalty.journeyAria')}
      className="rounded-2xl border border-white/10 bg-zinc-950/60 backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{t('hq.loyalty.journeyTitle')}</h2>
          <p className="text-xs text-white/45">{t('hq.loyalty.journeyBody')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onAdd}
          className="gap-1.5 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] font-semibold text-black"
        >
          <Plus className="size-3.5" />
          {t('hq.loyalty.addMilestone')}
        </Button>
      </div>

      {showSearch ? (
        <div className="border-b border-white/8 px-4 py-2">
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('hq.loyalty.searchPlaceholder')}
            className="h-9 border-white/10 bg-black/35 text-sm text-white"
          />
        </div>
      ) : null}

      <div className="max-h-[420px] overflow-y-auto p-2">
        {milestones.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-white">{t('hq.rewards.builder.emptyTitle')}</p>
            <p className="mt-1 text-xs text-white/45">{t('hq.rewards.builder.emptyBody')}</p>
            <Button type="button" size="sm" className="mt-4" disabled={seedPending} onClick={onSeed}>
              {t('hq.rewards.builder.emptyCta')}
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-white/45">{t('hq.loyalty.searchEmpty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((m) => {
              const fullIdx = milestones.findIndex((x) => x.id === m.id)
              return (
                <motion.li
                  key={m.id}
                  id={`milestone-${m.id}`}
                  layout
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border px-3 py-2.5 transition',
                    highlightId === m.id
                      ? 'border-[color-mix(in_oklab,var(--brand-primary)_45%,transparent)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,transparent)]'
                      : 'border-white/8 bg-black/25 hover:border-white/14',
                    !m.active && 'opacity-60',
                  )}
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={fullIdx <= 0 || swapPending}
                      className="rounded p-0.5 text-white/40 hover:text-white disabled:opacity-25"
                      aria-label={t('hq.rewards.row.up')}
                      onClick={() => onMoveUp(m, milestones[fullIdx - 1]!)}
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      disabled={fullIdx < 0 || fullIdx >= milestones.length - 1 || swapPending}
                      className="rounded p-0.5 text-white/40 hover:text-white disabled:opacity-25"
                      aria-label={t('hq.rewards.row.down')}
                      onClick={() => onMoveDown(m, milestones[fullIdx + 1]!)}
                    >
                      <ArrowDown className="size-3" />
                    </button>
                  </div>

                  <div className="grid size-10 place-items-center rounded-xl border border-white/10 bg-zinc-950">
                    <MilestoneIconGlyph
                      iconType={normalizeIconType(m.icon_type)}
                      discountPercentage={m.discount_percentage}
                      className="text-[var(--brand-primary)]"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{m.name}</p>
                    <p className="truncate text-[11px] text-white/45">
                      {m.days_required}d · {m.reward_label || t('hq.rewards.noReward')}
                    </p>
                  </div>

                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                      m.active
                        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
                        : 'border-white/10 bg-white/5 text-white/45',
                    )}
                  >
                    {m.active ? t('hq.rewards.row.on') : t('hq.rewards.row.off')}
                  </span>

                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 border border-white/10 bg-white/[0.04] text-xs"
                    onClick={() => onEdit(m)}
                  >
                    {t('hq.loyalty.quickEdit')}
                  </Button>
                  <RowMenu
                    active={m.active}
                    onEdit={() => onEdit(m)}
                    onToggle={() => onToggle(m)}
                    onDelete={() => onDelete(m)}
                  />
                </motion.li>
              )
            })}
          </ul>
        )}
      </div>
      {/* TODO: Connect backend drag-and-drop ordering if/when a dedicated RPC exists. Arrow swap uses existing sort_order updates. */}
    </section>
  )
}
