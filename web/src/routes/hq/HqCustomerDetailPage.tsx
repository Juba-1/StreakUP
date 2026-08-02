import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Crown, Flame, Loader2, RotateCcw, Shield, Sparkles } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type LifetimeRewardRow = {
  milestone_id: string
  name: string
  days_required: number
  reward_label: string | null
  icon_type: string | null
  fulfillment_type: string | null
  earned_at: string | null
  claimed_at: string | null
  reward_id: string
}

function parseLifetimeList(data: unknown): LifetimeRewardRow[] {
  if (!data || typeof data !== 'object') return []
  const o = data as Record<string, unknown>
  if (o.ok !== true) return []
  const rewards = o.rewards
  if (!Array.isArray(rewards)) return []
  return rewards
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      return {
        milestone_id: String(r.milestone_id ?? ''),
        name: String(r.name ?? ''),
        days_required: Number(r.days_required ?? 0),
        reward_label: r.reward_label == null ? null : String(r.reward_label),
        icon_type: r.icon_type == null ? null : String(r.icon_type),
        fulfillment_type: r.fulfillment_type == null ? null : String(r.fulfillment_type),
        earned_at: r.earned_at == null ? null : String(r.earned_at),
        claimed_at: r.claimed_at == null ? null : String(r.claimed_at),
        reward_id: String(r.reward_id ?? ''),
      }
    })
    .filter((r): r is LifetimeRewardRow => Boolean(r?.milestone_id))
}

export function HqCustomerDetailPage() {
  const { slug, customerId } = useParams()
  const { t, locale } = useI18n()
  const qc = useQueryClient()
  const { data: profile, isLoading: profileLoading } = useProfile()

  const cafeId = profile?.cafe_id ?? null

  const customerQuery = useQuery({
    queryKey: ['hq-customer-detail', customerId, cafeId],
    enabled: Boolean(supabaseBrowserClient && customerId && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('customers')
        .select('id, full_name, pin_code, current_streak, longest_streak, shields')
        .eq('id', customerId!)
        .eq('cafe_id', cafeId!)
        .single()
      if (error) throw error
      return data
    },
  })

  const lifetimeQuery = useQuery({
    queryKey: ['hq-lifetime-rewards', customerId, cafeId],
    enabled: Boolean(supabaseBrowserClient && customerId && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_list_customer_lifetime_rewards_secure', {
        p_customer_id: customerId!,
        p_cafe_id: cafeId,
        p_slug: slug ?? '',
      })
      if (error) throw error
      return parseLifetimeList(data)
    },
  })

  const resetReward = useMutation({
    mutationFn: async (milestoneId: string) => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_reset_customer_lifetime_reward', {
        p_customer_id: customerId!,
        p_milestone_id: milestoneId,
        p_cafe_id: cafeId,
        p_slug: slug ?? '',
      })
      if (error) throw error
      const o = data as { ok?: boolean; reason?: string }
      if (!o?.ok) throw new Error(o?.reason ?? 'reset_failed')
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['hq-lifetime-rewards', customerId, cafeId] })
      toast.success(t('hq.customerDetail.resetSuccess'))
    },
    onError: () => toast.error(t('hq.customerDetail.resetFail')),
  })

  if (profileLoading) {
    return <Skeleton className="h-48 w-full rounded-2xl bg-white/5" />
  }

  if (!profile || profile.role !== 'hq_owner' || !slug || !customerId) {
    return <Navigate to="/login" replace />
  }

  const customer = customerQuery.data as Record<string, unknown> | null | undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/hq/${slug}/customers`}
          className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'rounded-xl border-white/10' })}
        >
          <ArrowLeft className="size-4" />
          <span className="ms-2">{t('hq.customerDetail.back')}</span>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-white/40">
            {t('hq.customerDetail.kicker')}
          </p>
          <h2 className="truncate text-2xl font-semibold text-white">
            {typeof customer?.full_name === 'string' && customer.full_name.trim()
              ? customer.full_name
              : t('hq.customers.unnamed')}
          </h2>
        </div>
      </div>

      {customerQuery.isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl bg-white/5" />
      ) : customer ? (
        <div className="flex flex-wrap gap-3">
          <Badge variant="outline" className="gap-1 border-orange-500/30 bg-orange-500/10 text-orange-100">
            <Flame className="size-3" aria-hidden />
            {Number(customer.current_streak ?? 0)} / {Number(customer.longest_streak ?? 0)}
          </Badge>
          <Badge variant="outline" className="gap-1 border-sky-500/30 bg-sky-500/10 text-sky-100">
            <Shield className="size-3" aria-hidden />
            {Number(customer.shields ?? 0)}
          </Badge>
          <Badge variant="secondary" className="font-mono" dir="ltr">
            PIN {String(customer.pin_code ?? '—')}
          </Badge>
        </div>
      ) : null}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-violet-500/20 bg-zinc-950/75 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Crown className="size-4 text-violet-200" aria-hidden />
              {t('hq.customerDetail.lifetimeTitle')}
            </CardTitle>
            <CardDescription className="text-white/50">{t('hq.customerDetail.lifetimeHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {lifetimeQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full bg-white/5" />
                <Skeleton className="h-16 w-full bg-white/5" />
              </div>
            ) : (lifetimeQuery.data ?? []).length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 py-10 text-center text-sm text-white/45">
                {t('hq.customerDetail.lifetimeEmpty')}
              </p>
            ) : (
              (lifetimeQuery.data ?? []).map((reward) => {
                const claimed = Boolean(reward.claimed_at)
                const earnedDate = reward.earned_at
                  ? new Date(reward.earned_at).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US')
                  : '—'

                return (
                  <div
                    key={reward.milestone_id}
                    className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-violet-500/25 bg-violet-500/10">
                        <Sparkles className="size-4 text-violet-200" aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white">{reward.name}</p>
                        <p className="text-xs text-white/45">
                          {t('hq.customerDetail.dayBadge').replace('{n}', String(reward.days_required))}
                          {reward.reward_label ? ` · ${reward.reward_label}` : ''}
                        </p>
                        <p className="mt-1 text-[11px] text-white/40">
                          {t('hq.customerDetail.earnedOn').replace('{date}', earnedDate)}
                        </p>
                        <Badge
                          className={cn(
                            'mt-2',
                            claimed
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                              : 'border-amber-500/30 bg-amber-500/10 text-amber-100',
                          )}
                        >
                          {claimed
                            ? t('hq.customerDetail.statusClaimed')
                            : t('hq.customerDetail.statusEarned')}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={resetReward.isPending}
                      className="shrink-0 rounded-xl border-violet-500/25 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20"
                      onClick={() => void resetReward.mutateAsync(reward.milestone_id)}
                    >
                      {resetReward.isPending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <RotateCcw className="size-4" aria-hidden />
                      )}
                      <span className="ms-2">{t('hq.customerDetail.reactivate')}</span>
                    </Button>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
