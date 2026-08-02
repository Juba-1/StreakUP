import { motion } from 'framer-motion'
import { useRef } from 'react'
import { Navigate, useParams } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { OpsBranchList } from '@/routes/hq/operations/OpsBranchList'
import { OpsQuickAccess } from '@/routes/hq/operations/OpsQuickAccess'
import { OpsSecurityTip } from '@/routes/hq/operations/OpsSecurityTip'
import { useHqOperations } from '@/routes/hq/operations/useHqOperations'

function OpsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-56 bg-white/10" />
      <div className="grid gap-4 md:grid-cols-12">
        <Skeleton className="h-64 rounded-2xl bg-white/10 md:col-span-4" />
        <Skeleton className="h-64 rounded-2xl bg-white/10 md:col-span-8" />
      </div>
    </div>
  )
}

/** Daily operational workspace — live monitoring, cashier PINs, QR & customer link. Route `/hq/:slug/operations`. */
export function HqOperationsPage() {
  const { slug } = useParams()
  const { t } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()
  const cafeId = profile?.cafe_id
  const enabled = profile?.role === 'hq_owner' && Boolean(cafeId)
  const ops = useHqOperations(cafeId, enabled)
  const branchesRef = useRef<HTMLDivElement>(null)

  if (pLoading || (enabled && ops.isLoading)) {
    return <OpsSkeleton />
  }

  if (!profile || profile.role !== 'hq_owner' || !cafeId) {
    return <Navigate to="/login" replace />
  }

  if (ops.isError || !ops.cafe) {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-6 text-center">
        <p className="text-sm font-medium text-white">{t('hq.opsPage.loadError')}</p>
        <button
          type="button"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-xl border border-white/12 bg-white/5 px-5 text-sm font-semibold text-white hover:bg-white/10"
          onClick={() => void ops.refetch()}
        >
          {t('hq.opsPage.retry')}
        </button>
      </div>
    )
  }

  if (ops.cafe.slug !== slug) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="space-y-6 pb-10">
      <div>
        <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('hq.opsPage.badge')}</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">{t('hq.opsPage.title')}</h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{t('hq.opsPage.subtitle')}</p>
      </div>

      <OpsQuickAccess
        slug={ops.cafe.slug}
        primaryBranch={ops.branches[0] ?? null}
        otherBranchCount={Math.max(0, ops.branches.length - 1)}
        onViewBranches={() =>
          branchesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      />

      <motion.div
        ref={branchesRef}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.06 }}
        className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start"
      >
        <div className="min-h-0 lg:col-span-8">
          <OpsBranchList
            cafeId={cafeId}
            slug={ops.cafe.slug}
            branches={ops.branches}
            branchDrafts={ops.branchDrafts}
            onBranchDraftChange={ops.setBranchDraft}
            cashierDraft={ops.cashierDraft}
            onCashierDraftChange={ops.setCashierDraftValue}
            onSaveBranch={(row) => ops.saveBranch.mutateAsync(row)}
            onDeleteBranch={(row) => ops.deleteBranch.mutateAsync(row)}
            onSavePin={(row, pin) => ops.commitCashierPin.mutateAsync({ row, pin })}
            onRotatePin={(row) => ops.rotateCashierPin.mutateAsync(row)}
            onAddBranch={(input) => ops.manualAddBranch.mutateAsync(input)}
            addPending={ops.manualAddBranch.isPending}
            saveBranchPending={ops.saveBranch.isPending}
            savePinPending={ops.commitCashierPin.isPending}
            rotatePending={ops.rotateCashierPin.isPending}
            deletePending={ops.deleteBranch.isPending}
          />
        </div>
        <div className="lg:col-span-4">
          <OpsSecurityTip />
        </div>
      </motion.div>
    </div>
  )
}
