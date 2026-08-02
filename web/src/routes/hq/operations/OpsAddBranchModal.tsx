import { useEffect, useState } from 'react'

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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean
  onSubmit: (input: { name: string; city?: string }) => Promise<void>
}

export function OpsAddBranchModal({ open, onOpenChange, pending, onSubmit }: Props) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [city, setCity] = useState('')

  useEffect(() => {
    if (!open) {
      setName('')
      setCity('')
    }
  }, [open])

  const canSubmit = name.trim().length >= 2 && !pending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/12 bg-zinc-950 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('hq.opsPage.addBranchTitle')}</DialogTitle>
          <DialogDescription className="text-white/50">
            {t('hq.manualBranch.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="ops-branch-name">{t('hq.manualBranch.name')}</Label>
            <Input
              id="ops-branch-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              placeholder={t('hq.manualBranch.namePlaceholder')}
              className="border-white/10 bg-black/40 text-white"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ops-branch-city">{t('hq.opsPage.cityLabel')}</Label>
            <Input
              id="ops-branch-city"
              value={city}
              onChange={(e) => setCity(e.target.value.slice(0, 40))}
              placeholder={t('hq.opsPage.cityPlaceholder')}
              className="border-white/10 bg-black/40 text-white"
            />
            <p className="text-[11px] text-white/35">{t('hq.opsPage.cityHint')}</p>
          </div>
        </div>

        <DialogFooter className="border-white/8 bg-transparent">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            className="bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] font-semibold text-black"
            onClick={() => void onSubmit({ name, city: city.trim() || undefined })}
          >
            {pending ? t('common.loading') : t('hq.manualBranch.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
