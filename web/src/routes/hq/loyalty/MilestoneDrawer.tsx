import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useI18n } from '@/core/i18n/I18nProvider'
import { normalizeIconType } from '@/lib/milestone-icons'
import {
  IconThemePicker,
  ShieldGrantSelect,
} from '@/routes/hq/loyalty/MilestoneFormControls'
import {
  clampDays,
  defaultClaimLimit,
  emptyDraft,
  MAX_DAYS,
  MAX_NAME,
  MAX_REWARD,
  MIN_DAYS,
  rowToDraft,
  type DraftMilestone,
  type MilestoneRow,
} from '@/routes/hq/loyalty/types'

type Props = {
  open: boolean
  mode: 'create' | 'edit' | 'view'
  milestone: MilestoneRow | null
  pending?: boolean
  onClose: () => void
  onSave: (draft: DraftMilestone & { id?: string }) => void
}

export function MilestoneDrawer({ open, mode, milestone, pending, onClose, onSave }: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<DraftMilestone>(emptyDraft())

  useEffect(() => {
    if (!open) return
    if (milestone) setDraft(rowToDraft(milestone))
    else setDraft(emptyDraft())
  }, [open, milestone])

  const readOnly = mode === 'view'

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="flex h-full w-full flex-col gap-0 border-white/10 bg-zinc-950 p-0 text-white sm:max-w-md">
        <SheetHeader className="shrink-0 border-b border-white/8 px-4 pt-4 pb-3 text-start">
          <SheetTitle className="text-white">
            {mode === 'create'
              ? t('hq.loyalty.addMilestone')
              : mode === 'view'
                ? t('hq.loyalty.viewMilestone')
                : t('hq.rewards.row.edit')}
          </SheetTitle>
          <SheetDescription className="text-white/45">
            {milestone?.name ?? t('hq.rewards.add.body')}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-4 py-4">
            <div className="space-y-1.5">
              <Label className="text-white/60">{t('hq.rewards.field.name')}</Label>
              <Input
                disabled={readOnly}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, MAX_NAME) })}
                className="border-white/10 bg-black/40 text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-white/60">{t('hq.rewards.field.days')}</Label>
                <Input
                  disabled={readOnly}
                  type="number"
                  min={MIN_DAYS}
                  max={MAX_DAYS}
                  value={draft.days_required}
                  onChange={(e) =>
                    setDraft({ ...draft, days_required: clampDays(Number(e.target.value)) })
                  }
                  className="border-white/10 bg-black/40 font-mono text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/60">{t('hq.rewards.field.shields')}</Label>
                {readOnly ? (
                  <p className="text-sm text-white/70">{draft.shield_grant_amount}</p>
                ) : (
                  <ShieldGrantSelect
                    compact
                    value={draft.shield_grant_amount}
                    onChange={(shield_grant_amount) => setDraft({ ...draft, shield_grant_amount })}
                    t={t}
                  />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/60">{t('hq.rewards.field.reward')}</Label>
              <Input
                disabled={readOnly}
                value={draft.reward_label}
                onChange={(e) =>
                  setDraft({ ...draft, reward_label: e.target.value.slice(0, MAX_REWARD) })
                }
                className="border-white/10 bg-black/40 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white/60">{t('hq.rewards.field.icon')}</Label>
              {readOnly ? (
                <p className="text-xs text-white/50">{normalizeIconType(draft.icon_type)}</p>
              ) : (
                <IconThemePicker
                  compact
                  value={draft.icon_type}
                  discountPercentage={draft.discount_percentage}
                  onChange={(icon_type, discount_percentage) =>
                    setDraft({ ...draft, icon_type, discount_percentage })
                  }
                  t={t}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/60">{t('hq.rewards.field.claimLimit')}</Label>
              <select
                disabled={readOnly}
                className="h-10 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white"
                value={draft.claim_limit}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    claim_limit: e.target.value as DraftMilestone['claim_limit'],
                    reactivate_after_inactivity_days:
                      e.target.value === 'once_per_lifetime'
                        ? draft.reactivate_after_inactivity_days
                        : null,
                  })
                }
              >
                <option value="once_per_lifetime">{t('hq.rewards.claimLimit.lifetime')}</option>
                <option value="every_streak_cycle">{t('hq.rewards.claimLimit.cycle')}</option>
              </select>
            </div>
            {draft.claim_limit === 'once_per_lifetime' ? (
              <div className="space-y-1.5">
                <Label className="text-white/60">{t('hq.rewards.field.winBack')}</Label>
                <Input
                  disabled={readOnly}
                  type="number"
                  min={1}
                  max={365}
                  value={draft.reactivate_after_inactivity_days ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reactivate_after_inactivity_days: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  className="border-white/10 bg-black/40 font-mono text-white"
                />
              </div>
            ) : null}

            {!readOnly ? (
              <div className="flex gap-2 border-t border-white/8 pt-4">
                <Button type="button" variant="ghost" onClick={onClose}>
                  {t('hq.rewards.row.cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={pending || draft.name.trim().length < 2}
                  className="bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] font-semibold text-black"
                  onClick={() =>
                    onSave({
                      ...draft,
                      claim_limit: draft.claim_limit ?? defaultClaimLimit(draft.days_required),
                      id: milestone?.id,
                    })
                  }
                >
                  {pending
                    ? t('common.loading')
                    : mode === 'create'
                      ? t('hq.rewards.add.submit')
                      : t('hq.rewards.row.save')}
                </Button>
              </div>
            ) : (
              <Button type="button" variant="secondary" onClick={onClose}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
