import { motion, useReducedMotion } from 'framer-motion'
import { KeyRound, MoreHorizontal, Monitor } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cashierPortalPath, cashierPortalUrl } from '@/lib/branch-portal-url'
import type { OpsBranch, OpsBranchStatus } from '@/routes/hq/operations/useHqOperations'
import { cn } from '@/lib/utils'

type Props = {
  slug: string
  branch: OpsBranch
  index: number
  onChangePin: () => void
  onEdit: () => void
  onDelete: () => void
}

function statusMeta(
  status: OpsBranchStatus,
  t: (k: string) => string,
): { label: string; dot: string; wrap: string } {
  switch (status) {
    case 'running':
      return {
        label: t('hq.opsPage.badgeRunning'),
        dot: 'bg-emerald-400',
        wrap: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
      }
    case 'no_visits':
      return {
        label: t('hq.opsPage.badgeNoVisits'),
        dot: 'bg-amber-400',
        wrap: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
      }
    default:
      return {
        label: t('hq.opsPage.badgeAttention'),
        dot: 'bg-rose-400',
        wrap: 'border-rose-500/20 bg-rose-500/10 text-rose-100',
      }
  }
}

function formatActivity(iso: string | null, empty: string): string {
  if (!iso) return empty
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return empty
  }
}

export function OpsBranchRow({ slug, branch, index, onChangePin, onEdit, onDelete }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const meta = statusMeta(branch.status, t)
  const empty = t('hq.opsPage.placeholderDash')
  const cashierUrl = cashierPortalPath(slug, branch.branch_code)
  const cashierAbs = cashierPortalUrl(slug, branch.branch_code)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.15), duration: 0.18 }}
      className="group relative flex flex-wrap items-center gap-3 px-3 py-3 transition-colors hover:bg-white/[0.03] sm:flex-nowrap sm:gap-4 sm:px-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-white">{branch.name}</p>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
              meta.wrap,
            )}
          >
            <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
            {meta.label}
          </span>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-white/50">
          <KeyRound className="size-3 text-white/35" aria-hidden />
          <span>{t('hq.ops.cashierPin')}:</span>
          <span dir="ltr" className="font-mono font-medium tracking-wider text-white/75 tabular-nums">
            {branch.cashier_pin || empty}
          </span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/40">
          <span dir="ltr" className="font-mono">
            {branch.branch_code}
          </span>
          <span>
            {t('hq.opsPage.lastActivity')}: {formatActivity(branch.lastActivityAt, empty)}
          </span>
          {branch.visitsToday > 0 ? (
            <span className="tabular-nums">
              {t('hq.opsPage.visitsToday').replace('{n}', String(branch.visitsToday))}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <a
          href={cashierUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-xs font-medium text-white transition hover:border-white/18 hover:bg-white/[0.08]"
        >
          <Monitor className="size-3.5 opacity-70" aria-hidden />
          {t('hq.ops.openCashier')}
        </a>

        <div className="relative" ref={menuRef}>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-8 text-white/50 hover:bg-white/8 hover:text-white"
            aria-label={t('hq.opsPage.branchMenu')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>

          {menuOpen ? (
            <motion.div
              role="menu"
              initial={reduce ? false : { opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.12 }}
              className="absolute end-0 z-30 mt-1 w-48 overflow-hidden rounded-xl border border-white/12 bg-zinc-950 py-1 shadow-[0_20px_50px_-24px_black]"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/[0.06]"
                onClick={() => {
                  void navigator.clipboard.writeText(cashierAbs).then(
                    () => toast.success(t('hq.links.copied')),
                    () => toast.error(t('hq.api.copyFail')),
                  )
                  setMenuOpen(false)
                }}
              >
                {t('hq.ops.copyLink')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/[0.06]"
                onClick={() => {
                  setMenuOpen(false)
                  onChangePin()
                }}
              >
                {t('hq.opsPage.menuChangePin')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-2 text-start text-xs text-white/80 hover:bg-white/[0.06]"
                onClick={() => {
                  setMenuOpen(false)
                  onEdit()
                }}
              >
                {t('hq.opsPage.menuEdit')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-2 text-start text-xs text-rose-300 hover:bg-rose-500/10"
                onClick={() => {
                  setMenuOpen(false)
                  onDelete()
                }}
              >
                {t('hq.branchCrud.delete')}
              </button>
            </motion.div>
          ) : null}
        </div>
      </div>
    </motion.li>
  )
}
