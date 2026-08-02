import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Gift, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { JuicyRewardIcon } from '@/components/rewards/JuicyRewardIcon'
import { useI18n } from '@/core/i18n/I18nProvider'
import { hapticSuccess, hapticTap } from '@/lib/haptics'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

export type RedeemableReward = {
  reward_id: string
  milestone_id: string
  milestone_name: string
  reward_label: string
  days_required: number
  earned_at: string
}

type ListResponse = {
  ok?: boolean
  rewards?: RedeemableReward[]
  reason?: string
}

type RedeemResponse = {
  ok?: boolean
  reason?: string
  reward_label?: string
  milestone_name?: string
}

export function CashierRewardsPanel({
  customerId,
  branchId,
}: {
  customerId: string
  branchId: string
}) {
  const { t } = useI18n()
  const qc = useQueryClient()

  const rewardsQ = useQuery({
    queryKey: ['cashier-redeemable-rewards', customerId, branchId],
    enabled: Boolean(supabaseBrowserClient && customerId && branchId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('cashier_list_redeemable_rewards', {
        p_customer_id: customerId,
        p_branch_id: branchId,
      })
      if (error) throw error
      const res = data as ListResponse
      if (!res?.ok) throw new Error(res?.reason ?? 'list_failed')
      return (res.rewards ?? []) as RedeemableReward[]
    },
    staleTime: 5_000,
  })

  const redeem = useMutation({
    mutationFn: async (rewardId: string) => {
      const { data, error } = await supabaseBrowserClient!.rpc('cashier_redeem_reward_secure', {
        p_reward_id: rewardId,
        p_branch_id: branchId,
      })
      if (error) throw error
      const res = data as RedeemResponse
      if (!res?.ok) throw new Error(res?.reason ?? 'redeem_failed')
      return res
    },
    onMutate: () => hapticTap(),
    onSuccess: (res) => {
      hapticSuccess()
      const label = res.reward_label ?? res.milestone_name ?? t('cashier.rewards.fallbackLabel')
      toast.success(t('cashier.rewards.toastRedeemed').replace('{reward}', label))
      void qc.invalidateQueries({ queryKey: ['cashier-redeemable-rewards', customerId, branchId] })
    },
    onError: (e: Error) => {
      if (e.message === 'already_claimed') {
        toast.warning(t('cashier.rewards.toastAlreadyClaimed'))
        void qc.invalidateQueries({ queryKey: ['cashier-redeemable-rewards', customerId, branchId] })
        return
      }
      toast.error(t('cashier.rewards.toastFail'))
    },
  })

  if (rewardsQ.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs text-white/50">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {t('cashier.rewards.loading')}
      </div>
    )
  }

  if (rewardsQ.isError) {
    return (
      <p className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-100/90">
        {t('cashier.rewards.migrationHint')}
      </p>
    )
  }

  const items = rewardsQ.data ?? []

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-center">
        <Gift className="mx-auto size-6 text-white/30" aria-hidden />
        <p className="mt-2 text-xs text-white/45">{t('cashier.rewards.empty')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-amber-200" aria-hidden />
        <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-amber-100/80">
          {t('cashier.rewards.kicker')}
        </p>
        <span className="ms-auto rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-50">
          {items.length}
        </span>
      </div>

      <ul className="max-h-52 space-y-2 overflow-y-auto pe-1">
        {items.map((r) => (
          <motion.li
            key={r.reward_id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-500/10 to-transparent p-3"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/40">
              <JuicyRewardIcon iconType="gift" size="md" state="ready" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{r.reward_label}</p>
              <p className="text-[11px] text-white/45">
                {t('cashier.rewards.dayBadge').replace('{n}', String(r.days_required))}
              </p>
            </div>
            <button
              type="button"
              disabled={redeem.isPending}
              onClick={() => void redeem.mutateAsync(r.reward_id)}
              className={cn(
                'shrink-0 rounded-xl px-3 py-2 text-xs font-semibold transition',
                'bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black shadow-[0_0_24px_-8px_var(--brand-glow)]',
                'hover:opacity-90 disabled:opacity-50',
              )}
            >
              {redeem.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                t('cashier.rewards.redeemCta')
              )}
            </button>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}
