import { motion, useReducedMotion } from 'framer-motion'

import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { RankedBranch } from '@/routes/hq/reports/types'
import { cn } from '@/lib/utils'

type Props = {
  loading?: boolean
  visible: boolean
  branches: RankedBranch[]
  onOpen: (b: RankedBranch) => void
}

export function BranchPerformance({ loading, visible, branches, onOpen }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  if (!visible) return null

  if (loading) {
    return <Skeleton className="h-[280px] w-full rounded-2xl bg-white/10" />
  }

  return (
    <section
      id="reports-branches"
      aria-label={t('hq.reports.branchesAria')}
      className="rounded-2xl border border-white/10 bg-zinc-950/55 p-5 backdrop-blur-xl"
    >
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-white">{t('hq.reports.branchesTitle')}</h2>
        <p className="mt-0.5 text-xs text-white/40">{t('hq.reports.branchesBody')}</p>
      </div>

      {branches.length === 0 ? (
        <p className="py-8 text-center text-xs text-white/40">{t('hq.reports.branchesEmpty')}</p>
      ) : (
        <ol className="space-y-2.5">
          {branches.map((b, i) => (
            <motion.li
              key={b.branch_id}
              initial={reduce ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.12) }}
            >
              <button
                type="button"
                onClick={() => onOpen(b)}
                className="group w-full rounded-xl px-1 py-1.5 text-start transition hover:bg-white/3"
              >
                <div className="mb-1.5 flex items-center gap-3">
                  <span className="w-6 text-[11px] font-semibold tabular-nums text-white/35">
                    #{b.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                    {b.name || b.branch_code}
                  </span>
                  <span className="text-[11px] tabular-nums text-white/45">
                    {b.visits} {t('hq.reports.branchVisits')}
                  </span>
                  <span
                    className={cn(
                      'text-[11px] font-semibold tabular-nums',
                      i === 0 ? 'text-emerald-300' : 'text-white/45',
                    )}
                  >
                    {b.share}%
                  </span>
                </div>
                <div className="ms-9 h-1.5 overflow-hidden rounded-full bg-white/6">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-[width] duration-300"
                    style={{ width: `${Math.max(b.share, 2)}%` }}
                  />
                </div>
                <p className="ms-9 mt-1 text-[10px] text-white/30">
                  {b.unique_customers} {t('hq.reports.branchPeople')}
                </p>
              </button>
            </motion.li>
          ))}
        </ol>
      )}
    </section>
  )
}
