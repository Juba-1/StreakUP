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
  draftPin: string
  onDraftChange: (value: string) => void
  pending?: boolean
  rotatePending?: boolean
  onClose: () => void
  onSave: () => Promise<void>
  onRotate: () => Promise<void>
}

export function OpsChangePinDialog({
  open,
  branch,
  draftPin,
  onDraftChange,
  pending,
  rotatePending,
  onClose,
  onSave,
  onRotate,
}: Props) {
  const { t } = useI18n()

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-white/12 bg-zinc-950 text-white sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('hq.opsPage.menuChangePin')}</DialogTitle>
          <DialogDescription className="text-white/50">
            {branch?.name ?? ''} · {t('hq.ops.cashierPin')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="rounded-xl border border-white/8 bg-black/30 px-3 py-2">
            <p className="text-[11px] text-white/40">{t('hq.ops.cashierPin')}</p>
            <p dir="ltr" className="mt-1 font-mono text-lg tabular-nums text-white">
              {branch?.cashier_pin ?? '—'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>{t('hq.ops.setPin')}</Label>
            <Input
              dir="ltr"
              inputMode="numeric"
              maxLength={8}
              placeholder={t('hq.ops.pinPlaceholder')}
              className="border-white/10 bg-black/40 font-mono text-white"
              value={draftPin}
              onChange={(e) => onDraftChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </div>
        </div>

        <DialogFooter className="border-white/8 bg-transparent sm:justify-between">
          <Button
            type="button"
            variant="secondary"
            disabled={rotatePending}
            onClick={() => void onRotate()}
          >
            {t('hq.ops.rotatePin')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={pending} onClick={() => void onSave()}>
              {pending ? t('common.loading') : t('hq.ops.savePin')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
