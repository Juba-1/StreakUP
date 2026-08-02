import { Link } from 'react-router-dom'

import { HqBranchManagerInvite } from '@/components/hq/HqBranchManagerInvite'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { OpsBranch } from '@/routes/hq/operations/useHqOperations'

type Props = {
  open: boolean
  branch: OpsBranch | null
  cafeId: string
  slug: string
  draft: { name: string; branch_code: string }
  onDraftChange: (draft: { name: string; branch_code: string }) => void
  pending?: boolean
  onClose: () => void
  onSave: () => Promise<void>
}

export function OpsEditBranchDialog({
  open,
  branch,
  cafeId,
  slug,
  draft,
  onDraftChange,
  pending,
  onClose,
  onSave,
}: Props) {
  const { t } = useI18n()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-white/12 bg-zinc-950 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('hq.opsPage.menuEdit')}</DialogTitle>
          <DialogDescription className="text-white/50">
            {branch?.name ?? ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label>{t('hq.manualBranch.name')}</Label>
            <Input
              value={draft.name}
              onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
              className="border-white/10 bg-black/40 text-white"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('hq.opsPage.slugLabel')}</Label>
            <Input
              dir="ltr"
              value={draft.branch_code}
              onChange={(e) =>
                onDraftChange({ ...draft, branch_code: e.target.value.toLowerCase() })
              }
              className="border-white/10 bg-black/40 font-mono text-white"
            />
          </div>
          {branch ? (
            <div className="space-y-2 border-t border-white/8 pt-3">
              <Link
                to={`/hq/${slug}/branches/${branch.branch_code}`}
                className="inline-flex text-xs font-medium text-[var(--brand-secondary)] hover:underline"
              >
                {t('hq.opsPage.openConsole')}
              </Link>
              <HqBranchManagerInvite
                cafeId={cafeId}
                branchId={branch.id}
                branchCode={branch.branch_code}
                branchName={branch.name}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-white/8 bg-transparent">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={pending} onClick={() => void onSave()}>
            {pending ? t('common.loading') : t('hq.branchCrud.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
