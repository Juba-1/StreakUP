import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

export type BranchGuestRow = {
  id: string
  full_name: string
  pin_code: string
  current_streak: number
}

type LifetimeReward = {
  milestone_id: string
  name: string
  days_required: number
  reward_label: string | null
  earned_at: string | null
  claimed_at: string | null
}

type Props = {
  guest: BranchGuestRow | null
  onClose: () => void
}

export function BranchGuestToolsDialog({ guest, onClose }: Props) {
  const { t, locale } = useI18n()
  const qc = useQueryClient()
  const { data: profile } = useProfile()
  const branchId = profile?.branch_id ?? null
  const cafeId = profile?.cafe_id ?? null
  const [adjustStreak, setAdjustStreak] = useState('')
  const [adjustNote, setAdjustNote] = useState('')

  useEffect(() => {
    if (!guest) return
    setAdjustStreak(String(guest.current_streak))
    setAdjustNote('')
  }, [guest])

  const lifetimeQuery = useQuery({
    queryKey: ['branch-manager-lifetime-rewards', branchId, cafeId, guest?.id],
    enabled: Boolean(supabaseBrowserClient && guest?.id && branchId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc(
        'branch_manager_list_customer_lifetime_rewards_secure',
        { p_customer_id: guest!.id },
      )
      if (error) throw error
      const res = data as { ok?: boolean; rewards?: LifetimeReward[]; reason?: string }
      if (!res?.ok) throw new Error(res.reason ?? 'list_failed')
      return res.rewards ?? []
    },
  })

  const adjustStreakMutation = useMutation({
    mutationFn: async () => {
      if (!guest) throw new Error('missing')
      const streak = parseInt(adjustStreak, 10)
      if (Number.isNaN(streak) || streak < 0) throw new Error('invalid_streak')

      const { data, error } = await supabaseBrowserClient!.rpc(
        'branch_manager_adjust_streak_secure',
        {
          p_customer_id: guest.id,
          p_streak: streak,
          p_note: adjustNote.trim() || null,
        },
      )
      if (error) throw error
      const res = data as { ok?: boolean; reason?: string }
      if (!res?.ok) throw new Error(res.reason ?? 'adjust_failed')
    },
    onSuccess: async () => {
      toast.success(t('branch.adjust.success'))
      await qc.invalidateQueries({ queryKey: ['branch-manager-customers', branchId, cafeId] })
      await qc.invalidateQueries({ queryKey: ['branch-manager-stats', branchId, cafeId] })
    },
    onError: () => toast.error(t('branch.adjust.fail')),
  })

  const resetReward = useMutation({
    mutationFn: async (milestoneId: string) => {
      if (!guest) throw new Error('missing')
      const { data, error } = await supabaseBrowserClient!.rpc(
        'branch_manager_reset_customer_lifetime_reward_secure',
        {
          p_customer_id: guest.id,
          p_milestone_id: milestoneId,
          p_note: adjustNote.trim() || null,
        },
      )
      if (error) throw error
      const res = data as { ok?: boolean; reason?: string }
      if (!res?.ok) throw new Error(res.reason ?? 'reset_failed')
    },
    onSuccess: async () => {
      toast.success(t('branch.ops.rewardResetOk'))
      await qc.invalidateQueries({
        queryKey: ['branch-manager-lifetime-rewards', branchId, cafeId, guest?.id],
      })
      await qc.invalidateQueries({ queryKey: ['branch-manager-customers', branchId, cafeId] })
    },
    onError: () => toast.error(t('branch.ops.rewardResetFail')),
  })

  const open = Boolean(guest)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto border-white/12 bg-zinc-950 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('branch.ops.guestToolsTitle')}</DialogTitle>
          <DialogDescription className="text-white/55">
            {guest?.full_name?.trim() || t('branch.customers.anonymous')}
            {guest ? (
              <span dir="ltr" className="ms-2 font-mono text-white/70">
                · PIN {guest.pin_code}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-1">
          <section className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-sm font-semibold text-white">{t('branch.adjust.title')}</p>
            <div className="space-y-2">
              <Label>{t('branch.adjust.streakLabel')}</Label>
              <Input
                dir="ltr"
                inputMode="numeric"
                value={adjustStreak}
                onChange={(e) => setAdjustStreak(e.target.value.replace(/\D/g, ''))}
                className="border-white/12 bg-black/40 font-mono text-white"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('branch.adjust.noteLabel')}</Label>
              <Textarea
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder={t('branch.adjust.notePlaceholder')}
                className="min-h-[72px] border-white/12 bg-black/40 text-white"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={adjustStreakMutation.isPending}
              onClick={() => void adjustStreakMutation.mutateAsync()}
            >
              {adjustStreakMutation.isPending ? t('branch.adjust.saving') : t('branch.adjust.save')}
            </Button>
          </section>

          <section className="space-y-3 rounded-xl border border-violet-500/20 bg-violet-950/15 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <Crown className="size-4 text-violet-200" aria-hidden />
              {t('branch.ops.rewardsTitle')}
            </p>
            <p className="text-xs text-white/45">{t('branch.ops.rewardsHint')}</p>
            {lifetimeQuery.isLoading ? (
              <Skeleton className="h-14 w-full bg-white/5" />
            ) : (lifetimeQuery.data ?? []).length === 0 ? (
              <p className="text-center text-xs text-white/45">{t('branch.ops.rewardsEmpty')}</p>
            ) : (
              <ul className="space-y-2">
                {(lifetimeQuery.data ?? []).map((reward) => {
                  const earnedDate = reward.earned_at
                    ? new Date(reward.earned_at).toLocaleDateString(
                        locale === 'ar' ? 'ar-SA' : 'en-US',
                      )
                    : '—'
                  const claimed = Boolean(reward.claimed_at)

                  return (
                    <li
                      key={reward.milestone_id}
                      className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/35 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-white">{reward.name}</p>
                        <p className="text-xs text-white/45">
                          {t('branch.ops.rewardDays').replace('{n}', String(reward.days_required))}
                          {reward.reward_label ? ` · ${reward.reward_label}` : ''}
                        </p>
                        <p className="mt-1 text-[10px] text-white/35">
                          {t('branch.ops.rewardEarned').replace('{date}', earnedDate)}
                        </p>
                        <Badge
                          className={cn(
                            'mt-1.5',
                            claimed
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-100',
                          )}
                        >
                          {claimed ? t('branch.ops.rewardClaimed') : t('branch.ops.rewardPending')}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={resetReward.isPending}
                        className="shrink-0 border-violet-500/25 bg-violet-500/10 text-violet-100"
                        onClick={() => void resetReward.mutateAsync(reward.milestone_id)}
                      >
                        {resetReward.isPending ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <RotateCcw className="size-4" aria-hidden />
                        )}
                        <span className="ms-2">{t('branch.ops.reactivateReward')}</span>
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('branch.adjust.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
