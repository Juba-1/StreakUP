import { motion, useReducedMotion } from 'framer-motion'
import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useI18n } from '@/core/i18n/I18nProvider'
import { OpsAddBranchModal } from '@/routes/hq/operations/OpsAddBranchModal'
import { OpsBranchRow } from '@/routes/hq/operations/OpsBranchRow'
import { OpsChangePinDialog } from '@/routes/hq/operations/OpsChangePinDialog'
import { OpsEditBranchDialog } from '@/routes/hq/operations/OpsEditBranchDialog'
import type { OpsBranch, OpsBranchStatus } from '@/routes/hq/operations/useHqOperations'
import { cn } from '@/lib/utils'

type FilterId = 'all' | OpsBranchStatus

type Props = {
  cafeId: string
  slug: string
  branches: OpsBranch[]
  branchDrafts: Record<string, { name: string; branch_code: string }>
  onBranchDraftChange: (id: string, draft: { name: string; branch_code: string }) => void
  cashierDraft: Record<string, string>
  onCashierDraftChange: (id: string, value: string) => void
  onSaveBranch: (row: OpsBranch) => Promise<unknown>
  onDeleteBranch: (row: OpsBranch) => Promise<unknown>
  onSavePin: (row: OpsBranch, pin: string) => Promise<unknown>
  onRotatePin: (row: OpsBranch) => Promise<unknown>
  onAddBranch: (input: { name: string; city?: string }) => Promise<unknown>
  addPending?: boolean
  saveBranchPending?: boolean
  savePinPending?: boolean
  rotatePending?: boolean
  deletePending?: boolean
}

export function OpsBranchList({
  cafeId,
  slug,
  branches,
  branchDrafts,
  onBranchDraftChange,
  cashierDraft,
  onCashierDraftChange,
  onSaveBranch,
  onDeleteBranch,
  onSavePin,
  onRotatePin,
  onAddBranch,
  addPending,
  saveBranchPending,
  savePinPending,
  rotatePending,
  deletePending,
}: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterId>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<OpsBranch | null>(null)
  const [pinTarget, setPinTarget] = useState<OpsBranch | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OpsBranch | null>(null)

  const filters: { id: FilterId; label: string }[] = [
    { id: 'all', label: t('hq.opsPage.filterAll') },
    { id: 'running', label: t('hq.opsPage.filterRunning') },
    { id: 'attention', label: t('hq.opsPage.filterAttention') },
    { id: 'no_visits', label: t('hq.opsPage.filterNoVisits') },
  ]

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return branches.filter((b) => {
      if (filter !== 'all' && b.status !== filter) return false
      if (!q) return true
      return b.name.toLowerCase().includes(q) || b.branch_code.toLowerCase().includes(q)
    })
  }, [branches, filter, query])

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-zinc-950/60 backdrop-blur-xl"
      aria-label={t('hq.opsPage.branchesAria')}
    >
      <div className="space-y-3 border-b border-white/8 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-white">
              {t('hq.opsPage.branchesHeading')}
            </h2>
            <p className="mt-0.5 text-xs text-white/45">{t('hq.opsPage.branchesBody')}</p>
          </div>
          <span className="text-[11px] tabular-nums text-white/40">
            {t('hq.opsPage.branchCount')
              .replace('{shown}', String(filtered.length))
              .replace('{total}', String(branches.length))}
          </span>
        </div>

        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-white/35"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('hq.opsPage.searchPlaceholder')}
              className="h-9 border-white/10 bg-black/35 ps-9 text-sm text-white placeholder:text-white/35"
              aria-label={t('hq.opsPage.searchPlaceholder')}
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => setAddOpen(true)}
            className="h-9 shrink-0 gap-1.5 rounded-lg bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-3 font-semibold text-black"
          >
            <Plus className="size-3.5" aria-hidden />
            {t('hq.opsPage.addBranch')}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('hq.opsPage.filtersAria')}>
          {filters.map((f) => {
            const active = filter === f.id
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'border-white/20 bg-white/10 text-white'
                    : 'border-transparent bg-white/[0.03] text-white/45 hover:bg-white/[0.06] hover:text-white/70',
                )}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      </div>

      <ScrollArea className="h-[min(520px,62vh)] min-h-[280px]">
        {branches.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <p className="text-sm font-medium text-white">{t('hq.ops.cashierEmptyTitle')}</p>
            <p className="max-w-sm text-xs leading-relaxed text-white/45">
              {t('hq.ops.cashierEmptyBody')}
            </p>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
              <Plus className="me-1.5 size-3.5" aria-hidden />
              {t('hq.opsPage.addBranch')}
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-white/45">{t('hq.opsPage.searchEmpty')}</p>
        ) : (
          <ul className="divide-y divide-white/[0.06] px-1">
            {filtered.map((b, i) => (
              <OpsBranchRow
                key={b.id}
                slug={slug}
                branch={b}
                index={i}
                onChangePin={() => setPinTarget(b)}
                onEdit={() => setEditTarget(b)}
                onDelete={() => setDeleteTarget(b)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        tone="danger"
        title={t('common.confirmTitle')}
        description={
          deleteTarget
            ? t('hq.branchCrud.confirmDelete').replace('{code}', deleteTarget.branch_code)
            : undefined
        }
        pending={deletePending}
        onConfirm={async () => {
          if (!deleteTarget) return
          await onDeleteBranch(deleteTarget)
          setDeleteTarget(null)
        }}
      />

      <OpsAddBranchModal
        open={addOpen}
        onOpenChange={setAddOpen}
        pending={addPending}
        onSubmit={async (input) => {
          await onAddBranch(input)
          setAddOpen(false)
        }}
      />

      <OpsEditBranchDialog
        open={Boolean(editTarget)}
        branch={editTarget}
        cafeId={cafeId}
        slug={slug}
        draft={
          editTarget
            ? (branchDrafts[editTarget.id] ?? {
                name: editTarget.name,
                branch_code: editTarget.branch_code,
              })
            : { name: '', branch_code: '' }
        }
        onDraftChange={(draft) => {
          if (editTarget) onBranchDraftChange(editTarget.id, draft)
        }}
        pending={saveBranchPending}
        onClose={() => setEditTarget(null)}
        onSave={async () => {
          if (!editTarget) return
          await onSaveBranch(editTarget)
          setEditTarget(null)
        }}
      />

      <OpsChangePinDialog
        open={Boolean(pinTarget)}
        branch={pinTarget}
        draftPin={pinTarget ? (cashierDraft[pinTarget.id] ?? '') : ''}
        onDraftChange={(v) => {
          if (pinTarget) onCashierDraftChange(pinTarget.id, v)
        }}
        pending={savePinPending}
        rotatePending={rotatePending}
        onClose={() => setPinTarget(null)}
        onSave={async () => {
          if (!pinTarget) return
          await onSavePin(pinTarget, cashierDraft[pinTarget.id] ?? '')
          setPinTarget(null)
        }}
        onRotate={async () => {
          if (!pinTarget) return
          await onRotatePin(pinTarget)
        }}
      />
    </motion.section>
  )
}
