import { Flame, MoreHorizontal, Shield } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { nextMilestone, primaryStatus } from '@/routes/hq/customers/customerStatus'
import { initials, type CustomerRow, type MilestoneMeta } from '@/routes/hq/customers/types'
import { cn } from '@/lib/utils'

type Props = {
  rows: CustomerRow[]
  today: string
  milestones: MilestoneMeta[]
  selectedId: string | null
  onSelect: (row: CustomerRow) => void
  onView: (row: CustomerRow) => void
  onEdit: (row: CustomerRow) => void
  onResetStreak: (row: CustomerRow) => void
  onGrantShield: (row: CustomerRow) => void
}

function StatusBadge({
  kind,
  t,
}: {
  kind: ReturnType<typeof primaryStatus>
  t: (k: string) => string
}) {
  const map = {
    high_streak: {
      label: t('hq.customers.badgeHigh'),
      className: 'border-orange-500/30 bg-orange-500/15 text-orange-100',
    },
    near_reward: {
      label: t('hq.customers.badgeNear'),
      className: 'border-amber-500/30 bg-amber-500/15 text-amber-100',
    },
    lost_streak: {
      label: t('hq.customers.badgeLost'),
      className: 'border-rose-500/30 bg-rose-500/15 text-rose-100',
    },
    new: {
      label: t('hq.customers.badgeNew'),
      className: 'border-sky-500/30 bg-sky-500/15 text-sky-100',
    },
    inactive: {
      label: t('hq.customers.badgeInactive'),
      className: 'border-white/12 bg-white/5 text-white/55',
    },
    active: {
      label: t('hq.customers.badgeActive'),
      className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100',
    },
  } as const
  const m = map[kind]
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold', m.className)}>
      {m.label}
    </span>
  )
}

function formatLastVisit(date: string | null, today: string, t: (k: string) => string): string {
  if (!date) return t('hq.customers.placeholderDash')
  if (date === today) return t('hq.customers.lastVisitToday')
  const y = new Date(`${today}T12:00:00Z`)
  y.setUTCDate(y.getUTCDate() - 1)
  const yesterday = y.toISOString().slice(0, 10)
  if (date === yesterday) return t('hq.customers.lastVisitYesterday')
  return new Date(`${date}T12:00:00`).toLocaleDateString()
}

function RowMenu({
  onEdit,
  onResetStreak,
  onGrantShield,
  onView,
}: {
  onEdit: () => void
  onResetStreak: () => void
  onGrantShield: () => void
  onView: () => void
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="size-8 text-white/45 hover:text-white"
        aria-label={t('hq.customers.rowMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {open ? (
        <motion.div
          role="menu"
          initial={reduce ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute end-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-white/12 bg-zinc-950 py-1 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/6"
            onClick={() => {
              setOpen(false)
              onView()
            }}
          >
            {t('hq.customers.view')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/6"
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
          >
            {t('hq.customers.actionEdit')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/6"
            onClick={() => {
              setOpen(false)
              onGrantShield()
            }}
          >
            {t('hq.customers.actionGrantShield')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/6"
            onClick={() => {
              setOpen(false)
              onResetStreak()
            }}
          >
            {t('hq.customers.actionResetStreak')}
          </button>
        </motion.div>
      ) : null}
    </div>
  )
}

export function CustomersTable({
  rows,
  today,
  milestones,
  selectedId,
  onSelect,
  onView,
  onEdit,
  onResetStreak,
  onGrantShield,
}: Props) {
  const { t } = useI18n()

  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/55 backdrop-blur-xl lg:block">
        <div className="grid grid-cols-[minmax(0,1.5fr)_0.9fr_0.7fr_0.9fr_0.85fr_0.55fr_1.1fr_auto] gap-3 border-b border-white/8 px-4 py-2.5 text-[10px] font-semibold tracking-[0.16em] text-white/45 uppercase">
          <span>{t('hq.customers.col.customer')}</span>
          <span>{t('hq.customers.col.phone')}</span>
          <span>{t('hq.customers.col.streak')}</span>
          <span>{t('hq.customers.col.lastVisit')}</span>
          <span>{t('hq.customers.col.status')}</span>
          <span>{t('hq.customers.col.shield')}</span>
          <span>{t('hq.customers.col.nextReward')}</span>
          <span className="sr-only">{t('hq.customers.col.actions')}</span>
        </div>
        <ul className="divide-y divide-white/5">
          {rows.map((row) => {
            const status = primaryStatus(row, today, milestones)
            const next = nextMilestone(row.current_streak, milestones)
            return (
              <li
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(row)
                  }
                }}
                className={cn(
                  'grid cursor-pointer grid-cols-[minmax(0,1.5fr)_0.9fr_0.7fr_0.9fr_0.85fr_0.55fr_1.1fr_auto] items-center gap-3 px-4 py-3 transition hover:bg-white/3',
                  selectedId === row.id && 'bg-violet-500/8 ring-1 ring-inset ring-violet-400/25',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-[11px] font-semibold text-white/80">
                    {initials(row.full_name || '?')}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {row.full_name || t('hq.customers.unnamed')}
                    </p>
                    <p className="font-mono text-[11px] tabular-nums text-violet-300/90" dir="ltr">
                      {row.pin_code || t('hq.customers.placeholderDash')}
                    </p>
                  </div>
                </div>
                <p className="truncate font-mono text-xs text-white/55" dir="ltr">
                  {row.phone || t('hq.customers.placeholderDash')}
                </p>
                <p className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-white">
                  <Flame className="size-3.5 text-orange-400" aria-hidden />
                  {row.current_streak}
                  <span className="text-[10px] font-normal text-white/35">
                    {t('hq.customers.daysUnit')}
                  </span>
                </p>
                <p className="text-xs text-white/55">{formatLastVisit(row.last_visit_date, today, t)}</p>
                <StatusBadge kind={status} t={t} />
                <p className="inline-flex items-center gap-1 text-sm tabular-nums text-white/80">
                  <Shield className="size-3.5 text-sky-400/80" aria-hidden />
                  {row.shields}
                </p>
                <div className="min-w-0">
                  {next ? (
                    <>
                      <p className="truncate text-xs font-medium text-white/85">
                        {next.rewardLabel || next.name || t('hq.customers.placeholderDash')}
                      </p>
                      <p className="text-[10px] tabular-nums text-white/35">
                        {t('hq.customers.nextVisitAt').replace('{n}', String(next.days))}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-white/35">{t('hq.customers.progressMax')}</p>
                  )}
                </div>
                <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                  <RowMenu
                    onView={() => onView(row)}
                    onEdit={() => onEdit(row)}
                    onResetStreak={() => onResetStreak(row)}
                    onGrantShield={() => onGrantShield(row)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <ul className="space-y-2 lg:hidden">
        {rows.map((row) => {
          const status = primaryStatus(row, today, milestones)
          const next = nextMilestone(row.current_streak, milestones)
          return (
            <li
              key={row.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(row)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(row)
                }
              }}
              className={cn(
                'rounded-2xl border border-white/10 bg-zinc-950/60 p-3',
                selectedId === row.id && 'border-violet-400/30 bg-violet-500/8',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-white/80">
                  {initials(row.full_name || '?')}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {row.full_name || t('hq.customers.unnamed')}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-violet-300/90" dir="ltr">
                    PIN · {row.pin_code || t('hq.customers.placeholderDash')}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge kind={status} t={t} />
                    <span className="inline-flex items-center gap-1 text-[11px] text-white/55 tabular-nums">
                      <Flame className="size-3 text-orange-400" aria-hidden />
                      {row.current_streak} {t('hq.customers.daysUnit')}
                    </span>
                  </div>
                  {next ? (
                    <p className="mt-1.5 truncate text-[11px] text-white/40">
                      {next.rewardLabel || next.name}
                    </p>
                  ) : null}
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <RowMenu
                    onView={() => onView(row)}
                    onEdit={() => onEdit(row)}
                    onResetStreak={() => onResetStreak(row)}
                    onGrantShield={() => onGrantShield(row)}
                  />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
