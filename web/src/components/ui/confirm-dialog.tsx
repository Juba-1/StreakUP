import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useI18n } from '@/core/i18n/I18nProvider'

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  pending?: boolean
  onConfirm: () => void | Promise<unknown>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n()

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel ?? t('common.cancel')}
          </Button>
            <Button
              type="button"
              variant={tone === 'danger' ? 'destructive' : 'default'}
              disabled={pending}
              onClick={() => {
                // Errors are surfaced by each mutation's own onError toast;
                // swallow here so a failed confirm never logs an unhandled rejection.
                void Promise.resolve(onConfirm()).catch(() => {})
              }}
            >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
