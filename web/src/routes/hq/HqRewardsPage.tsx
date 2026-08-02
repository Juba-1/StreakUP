import { useCallback, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { CustomerSimulation } from '@/routes/hq/loyalty/CustomerSimulation'
import { JourneyBuilder } from '@/routes/hq/loyalty/JourneyBuilder'
import { LoyaltyInsights, type LoyaltyInsight } from '@/routes/hq/loyalty/LoyaltyInsights'
import { LoyaltySummary } from '@/routes/hq/loyalty/LoyaltySummary'
import { MilestoneDrawer } from '@/routes/hq/loyalty/MilestoneDrawer'
import { ProgramBlueprint } from '@/routes/hq/loyalty/ProgramBlueprint'
import { RecoveryCard } from '@/routes/hq/loyalty/RecoveryCard'
import { RewardsGrid } from '@/routes/hq/loyalty/RewardsGrid'
import { useLoyaltyProgram } from '@/routes/hq/loyalty/useLoyaltyProgram'
import { rowToDraft, type DraftMilestone, type MilestoneRow } from '@/routes/hq/loyalty/types'

type DrawerState =
  | { open: false }
  | { open: true; mode: 'create' | 'edit' | 'view'; milestone: MilestoneRow | null }

function LoyaltySkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full rounded-2xl bg-white/10" />
      <Skeleton className="h-36 w-full rounded-2xl bg-white/10" />
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-[420px] rounded-2xl bg-white/10 xl:col-span-8" />
        <Skeleton className="h-[420px] rounded-2xl bg-white/10 xl:col-span-4" />
      </div>
    </div>
  )
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

export function HqRewardsPage() {
  const { t } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()
  const cafeId = profile?.cafe_id
  const enabled = profile?.role === 'hq_owner' && Boolean(cafeId)

  const loyalty = useLoyaltyProgram(cafeId, enabled)

  const [search, setSearch] = useState('')
  const [rewardsCollapsed, setRewardsCollapsed] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerState>({ open: false })
  const [deleteTarget, setDeleteTarget] = useState<MilestoneRow | null>(null)
  const [resetOpen, setResetOpen] = useState(false)

  const flash = useCallback((id: string | undefined) => {
    if (!id) return
    setHighlightId(id)
    window.setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2200)
  }, [])

  const openDrawer = (mode: 'create' | 'edit' | 'view', milestone: MilestoneRow | null = null) => {
    setDrawer({ open: true, mode, milestone })
  }

  const closeDrawer = () => setDrawer({ open: false })

  const handleInsight = (card: LoyaltyInsight) => {
    if (card.action === 'recovery') {
      scrollToId('loyalty-recovery')
      return
    }
    if (card.action === 'journey') {
      scrollToId('loyalty-journey')
      flash(card.milestoneId)
      return
    }
    if (card.action === 'milestone' && card.milestoneId) {
      scrollToId(`milestone-${card.milestoneId}`)
      flash(card.milestoneId)
      const m = loyalty.sorted.find((x) => x.id === card.milestoneId)
      if (m) openDrawer('edit', m)
      return
    }
    if (card.action === 'reward' && card.milestoneId) {
      setRewardsCollapsed(false)
      window.setTimeout(() => {
        scrollToId(`reward-${card.milestoneId}`)
        flash(card.milestoneId)
      }, 50)
      const m = loyalty.sorted.find((x) => x.id === card.milestoneId)
      if (m) openDrawer('view', m)
    }
  }

  const handleSave = async (draft: DraftMilestone & { id?: string }) => {
    if (draft.id) {
      await loyalty.updateMutation.mutateAsync({ ...draft, id: draft.id })
    } else {
      await loyalty.addMutation.mutateAsync(draft)
    }
    closeDrawer()
  }

  const handleDuplicate = (m: MilestoneRow) => {
    const draft = rowToDraft(m)
    draft.name = `${m.name} (copy)`.slice(0, 40)
    draft.id = undefined
    void loyalty.addMutation.mutateAsync(draft)
  }

  const handleDelete = (m: MilestoneRow) => setDeleteTarget(m)

  const confirmDelete = async () => {
    const m = deleteTarget
    if (!m) return
    await loyalty.deleteMutation.mutateAsync(m.id)
    setDeleteTarget(null)
  }

  const confirmReset = async () => {
    await loyalty.resetMutation.mutateAsync()
    setResetOpen(false)
  }

  if (pLoading || (enabled && loyalty.isLoading)) {
    return <LoyaltySkeleton />
  }

  if (!profile || profile.role !== 'hq_owner') {
    return <Navigate to="/login" replace />
  }

  if (!cafeId) {
    return <Navigate to="/login" replace />
  }

  if (loyalty.isError) {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-6 text-center">
        <p className="text-sm font-medium text-white">{t('hq.loyalty.loadError')}</p>
        <Button type="button" className="mt-4" onClick={() => void loyalty.refetch()}>
          {t('hq.loyalty.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-white/40 uppercase">
            {t('hq.loyalty.kicker')}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
            {t('hq.loyalty.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-white/50">{t('hq.loyalty.subtitle')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="border border-white/10 bg-white/[0.04] text-white/80"
          disabled={loyalty.resetMutation.isPending}
          title={t('hq.rewards.resetTitle')}
          onClick={() => setResetOpen(true)}
        >
          {t('hq.rewards.resetCta')}
        </Button>
      </header>

      <LoyaltyInsights cards={loyalty.insights} onAction={handleInsight} />

      <ProgramBlueprint milestones={loyalty.sorted} highlightId={highlightId} />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <JourneyBuilder
            milestones={loyalty.sorted}
            highlightId={highlightId}
            search={search}
            onSearch={setSearch}
            onAdd={() => openDrawer('create')}
            onEdit={(m) => openDrawer('edit', m)}
            onToggle={(m) =>
              void loyalty.toggleActiveMutation.mutateAsync({ id: m.id, next: !m.active })
            }
            onDelete={handleDelete}
            onMoveUp={(m, prev) => void loyalty.swapOrderMutation.mutateAsync({ a: m, b: prev })}
            onMoveDown={(m, next) => void loyalty.swapOrderMutation.mutateAsync({ a: m, b: next })}
            swapPending={loyalty.swapOrderMutation.isPending}
            seedPending={loyalty.resetMutation.isPending}
            onSeed={() => void loyalty.resetMutation.mutateAsync()}
          />

          <RewardsGrid
            milestones={loyalty.sorted}
            redemptions={loyalty.redemptions}
            highlightId={highlightId}
            collapsed={rewardsCollapsed}
            onToggleCollapse={() => setRewardsCollapsed((v) => !v)}
            onView={(m) => openDrawer('view', m)}
            onEdit={(m) => openDrawer('edit', m)}
            onDuplicate={handleDuplicate}
            onToggle={(m) =>
              void loyalty.toggleActiveMutation.mutateAsync({ id: m.id, next: !m.active })
            }
            onDelete={handleDelete}
          />
        </div>

        <aside className="space-y-4 xl:col-span-4">
          <LoyaltySummary
            milestones={loyalty.sorted}
            graceDays={loyalty.graceDays}
            policy={loyalty.policy}
          />
          <RecoveryCard
            cafeId={cafeId}
            graceDays={loyalty.graceDays}
            policy={loyalty.policy}
            milestones={loyalty.sorted}
          />
          <CustomerSimulation milestones={loyalty.sorted} />
        </aside>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        tone="danger"
        title={t('common.confirmTitle')}
        description={t('hq.rewards.row.confirmDelete')}
        pending={loyalty.deleteMutation.isPending}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t('common.confirmTitle')}
        description={t('hq.loyalty.resetConfirm')}
        pending={loyalty.resetMutation.isPending}
        onConfirm={confirmReset}
      />

      <MilestoneDrawer
        open={drawer.open}
        mode={drawer.open ? drawer.mode : 'view'}
        milestone={drawer.open ? drawer.milestone : null}
        pending={loyalty.addMutation.isPending || loyalty.updateMutation.isPending}
        onClose={closeDrawer}
        onSave={(draft) => {
          void handleSave(draft).catch(() => {
            toast.error(t('hq.rewards.toast.errGeneric'))
          })
        }}
      />
    </div>
  )
}
