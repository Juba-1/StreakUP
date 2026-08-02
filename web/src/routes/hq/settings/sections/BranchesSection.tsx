import { ArrowUpRight, Building2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/core/i18n/I18nProvider'
import { OpsAddBranchModal } from '@/routes/hq/operations/OpsAddBranchModal'
import { OpsEditBranchDialog } from '@/routes/hq/operations/OpsEditBranchDialog'
import type { OpsBranch, useHqOperations } from '@/routes/hq/operations/useHqOperations'
import { SectionShell } from '@/routes/hq/settings/SectionShell'
import { cn } from '@/lib/utils'

type Ops = ReturnType<typeof useHqOperations>

type Props = {
  cafeId: string
  slug: string
  ops: Ops
}

/**
 * Configuration-only view: create, edit basic details, or remove a branch.
 * Daily monitoring, cashier PINs, and QR codes live in the dedicated Operations workspace.
 */
export function BranchesSection({ cafeId, slug, ops }: Props) {
  const { t } = useI18n()
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<OpsBranch | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OpsBranch | null>(null)

  return (
    <SectionShell
      titleKey="hq.settingsHub.branches.title"
      bodyKey="hq.settingsHub.branches.body"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/hq/${slug}/operations`}
            className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }), 'border border-white/10')}
          >
            {t('hq.settingsHub.branches.openOperations')}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
          <Button
            type="button"
            size="sm"
            onClick={() => setAddOpen(true)}
            className="gap-1.5 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] font-semibold text-black"
          >
            <Plus className="size-3.5" aria-hidden />
            {t('hq.opsPage.addBranch')}
          </Button>
        </div>
      }
    >
      {ops.branches.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center">
          <Building2 className="size-5 text-white/30" aria-hidden />
          <p className="text-sm text-white/50">{t('hq.settingsHub.branches.empty')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/8 bg-black/25">
          {ops.branches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{b.name}</p>
                <p dir="ltr" className="mt-0.5 font-mono text-[11px] text-white/40">
                  {t('hq.settingsHub.branches.code')}: {b.branch_code}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-xs text-white/70 hover:bg-white/8 hover:text-white"
                  onClick={() => setEditTarget(b)}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  {t('hq.opsPage.menuEdit')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 text-xs text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                  onClick={() => setDeleteTarget(b)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {t('hq.branchCrud.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <OpsAddBranchModal
        open={addOpen}
        onOpenChange={setAddOpen}
        pending={ops.manualAddBranch.isPending}
        onSubmit={async (input) => {
          await ops.manualAddBranch.mutateAsync(input)
          setAddOpen(false)
        }}
      />

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
        pending={ops.deleteBranch.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return
          await ops.deleteBranch.mutateAsync(deleteTarget)
          setDeleteTarget(null)
        }}
      />

      <OpsEditBranchDialog
        open={Boolean(editTarget)}
        branch={editTarget}
        cafeId={cafeId}
        slug={slug}
        draft={
          editTarget
            ? (ops.branchDrafts[editTarget.id] ?? { name: editTarget.name, branch_code: editTarget.branch_code })
            : { name: '', branch_code: '' }
        }
        onDraftChange={(draft) => {
          if (editTarget) ops.setBranchDraft(editTarget.id, draft)
        }}
        pending={ops.saveBranch.isPending}
        onClose={() => setEditTarget(null)}
        onSave={async () => {
          if (!editTarget) return
          await ops.saveBranch.mutateAsync(editTarget)
          setEditTarget(null)
        }}
      />
    </SectionShell>
  )
}
