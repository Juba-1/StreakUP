import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flame, Loader2, RotateCcw, Shield, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { rewardProgress } from '@/routes/hq/customers/customerStatus'
import { initials, type CustomerRow } from '@/routes/hq/customers/types'
import { cn } from '@/lib/utils'

type LifetimeRewardRow = {
  milestone_id: string
  name: string
  days_required: number
  reward_label: string | null
  claimed_at: string | null
  earned_at: string | null
}

type TimelineItem = {
  id: string
  kind: 'visit' | 'reward' | 'joined'
  at: string
  label: string
}

type Props = {
  open: boolean
  customerId: string | null
  cafeId: string | null
  slug: string
  fallback: CustomerRow | null
  milestones: number[]
  onClose: () => void
  onEdit: (row: CustomerRow) => void
}

function parseLifetime(data: unknown): LifetimeRewardRow[] {
  if (!data || typeof data !== 'object') return []
  const o = data as Record<string, unknown>
  if (o.ok !== true || !Array.isArray(o.rewards)) return []
  return o.rewards
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      return {
        milestone_id: String(r.milestone_id ?? ''),
        name: String(r.name ?? ''),
        days_required: Number(r.days_required ?? 0),
        reward_label: r.reward_label == null ? null : String(r.reward_label),
        claimed_at: r.claimed_at == null ? null : String(r.claimed_at),
        earned_at: r.earned_at == null ? null : String(r.earned_at),
      }
    })
    .filter((r): r is LifetimeRewardRow => Boolean(r?.milestone_id))
}

export function CustomerDrawer({
  open,
  customerId,
  cafeId,
  slug,
  fallback,
  milestones,
  onClose,
  onEdit,
}: Props) {
  const { t, locale } = useI18n()
  const qc = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ['hq-customer-detail', customerId, cafeId],
    enabled: Boolean(open && supabaseBrowserClient && customerId && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('customers')
        .select(
          'id, full_name, pin_code, current_streak, longest_streak, shields, created_at, phone',
        )
        .eq('id', customerId!)
        .eq('cafe_id', cafeId!)
        .single()
      if (error) throw error
      return data
    },
  })

  const lifetimeQuery = useQuery({
    queryKey: ['hq-lifetime-rewards', customerId, cafeId],
    enabled: Boolean(open && supabaseBrowserClient && customerId && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc(
        'hq_list_customer_lifetime_rewards_secure',
        {
          p_customer_id: customerId!,
          p_cafe_id: cafeId,
          p_slug: slug,
        },
      )
      if (error) throw error
      return parseLifetime(data)
    },
  })

  const timelineQuery = useQuery({
    queryKey: ['hq-customer-timeline', customerId, cafeId],
    enabled: Boolean(open && supabaseBrowserClient && customerId && cafeId),
    queryFn: async () => {
      const client = supabaseBrowserClient!
      const [{ data: visits }, { data: rewards }] = await Promise.all([
        client
          .from('visits')
          .select('id, created_at, visit_date, streak_after, event_type')
          .eq('cafe_id', cafeId!)
          .eq('customer_id', customerId!)
          .order('created_at', { ascending: false })
          .limit(20),
        client
          .from('rewards')
          .select('id, claimed_at, earned_at')
          .eq('cafe_id', cafeId!)
          .eq('customer_id', customerId!)
          .order('claimed_at', { ascending: false })
          .limit(10),
      ])

      const items: TimelineItem[] = []
      for (const v of visits ?? []) {
        items.push({
          id: `v:${(v as { id: string }).id}`,
          kind: 'visit',
          at: String((v as { created_at: string }).created_at),
          label: t('hq.customers.timelineVisit').replace(
            '{n}',
            String((v as { streak_after?: number }).streak_after ?? ''),
          ),
        })
      }
      for (const r of rewards ?? []) {
        const at = (r as { claimed_at?: string | null }).claimed_at
        if (!at) continue
        items.push({
          id: `r:${(r as { id: string }).id}`,
          kind: 'reward',
          at,
          label: t('hq.customers.timelineReward'),
        })
      }
      items.sort((a, b) => (a.at < b.at ? 1 : -1))
      return items.slice(0, 24)
    },
  })

  const resetReward = useMutation({
    mutationFn: async (milestoneId: string) => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_reset_customer_lifetime_reward', {
        p_customer_id: customerId!,
        p_milestone_id: milestoneId,
        p_cafe_id: cafeId,
        p_slug: slug,
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

  const detail = detailQuery.data
  const name =
    (typeof detail?.full_name === 'string' && detail.full_name.trim()) ||
    fallback?.full_name ||
    t('hq.customers.unnamed')
  const streak = Number(detail?.current_streak ?? fallback?.current_streak ?? 0)
  const longest = Number(detail?.longest_streak ?? fallback?.longest_streak ?? 0)
  const shields = Number(detail?.shields ?? fallback?.shields ?? 0)
  const pin = String(detail?.pin_code ?? fallback?.pin_code ?? '')
  const progress = rewardProgress(streak, milestones)
  const visitCount = timelineQuery.data?.filter((i) => i.kind === 'visit').length

  const editRow: CustomerRow | null = fallback
    ? fallback
    : detail
      ? {
          id: String(detail.id),
          full_name: String(detail.full_name ?? ''),
          pin_code: String(detail.pin_code ?? ''),
          current_streak: streak,
          longest_streak: longest,
          shields,
          created_at: String(detail.created_at ?? ''),
          updated_at: String(detail.created_at ?? ''),
          last_visit_date: null,
        }
      : null

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full border-white/10 bg-zinc-950 text-white sm:max-w-md"
      >
        <SheetHeader className="border-b border-white/8 text-start">
          <div className="flex items-center gap-3 pe-8">
            <div className="grid size-11 place-items-center rounded-full border border-white/12 bg-white/[0.05] text-sm font-semibold">
              {initials(name)}
            </div>
            <div className="min-w-0">
              <SheetTitle className="truncate text-white">{name}</SheetTitle>
              <SheetDescription className="font-mono text-violet-300/90" dir="ltr">
                PIN · {pin || '—'}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-4">
          {detailQuery.isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-20 w-full bg-white/5" />
              <Skeleton className="h-40 w-full bg-white/5" />
            </div>
          ) : (
            <div className="space-y-5 py-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] text-white/40">{t('hq.customers.col.streak')}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {streak}
                    <span className="text-xs text-white/35"> / {longest}</span>
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] text-white/40">{t('hq.customers.col.shield')}</p>
                  <p className="mt-1 flex items-center gap-1 text-lg font-semibold tabular-nums">
                    <Shield className="size-3.5 text-sky-300" aria-hidden />
                    {shields}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-black/30 p-3">
                  <p className="text-[10px] text-white/40">{t('hq.customers.drawerVisits')}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {visitCount ?? '—'}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold tracking-wide text-white/40 uppercase">
                  {t('hq.customers.col.progress')}
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand-primary),var(--brand-secondary))]"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-white/45 tabular-nums">
                  {progress.target == null
                    ? t('hq.customers.progressMax')
                    : `${progress.current} / ${progress.target}`}
                </p>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-white/40 uppercase">
                  {t('hq.customerDetail.lifetimeTitle')}
                </p>
                {(lifetimeQuery.data ?? []).length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-white/40">
                    {t('hq.customerDetail.lifetimeEmpty')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {(lifetimeQuery.data ?? []).slice(0, 5).map((reward) => (
                      <li
                        key={reward.milestone_id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-black/25 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-white">{reward.name}</p>
                          <Badge
                            className={cn(
                              'mt-1',
                              reward.claimed_at
                                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
                                : 'border-amber-500/25 bg-amber-500/10 text-amber-100',
                            )}
                          >
                            {reward.claimed_at
                              ? t('hq.customerDetail.statusClaimed')
                              : t('hq.customerDetail.statusEarned')}
                          </Badge>
                        </div>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          disabled={resetReward.isPending}
                          onClick={() => void resetReward.mutateAsync(reward.milestone_id)}
                          aria-label={t('hq.customerDetail.reactivate')}
                        >
                          {resetReward.isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="size-3.5" />
                          )}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-white/40 uppercase">
                  {t('hq.customers.timelineHeading')}
                </p>
                {(timelineQuery.data ?? []).length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-white/40">
                    {t('hq.customers.timelineEmpty')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {(timelineQuery.data ?? []).map((item) => (
                      <li
                        key={item.id}
                        className="flex items-start gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2"
                      >
                        {item.kind === 'reward' ? (
                          <Sparkles className="mt-0.5 size-3.5 text-[var(--brand-secondary)]" />
                        ) : (
                          <Flame className="mt-0.5 size-3.5 text-orange-300" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs text-white/85">{item.label}</p>
                          <p className="text-[10px] text-white/35">
                            {new Date(item.at).toLocaleString(
                              locale === 'ar' ? 'ar-SA' : 'en-US',
                            )}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-white/8 pt-4">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] font-semibold text-black"
                  disabled={!editRow}
                  onClick={() => editRow && onEdit(editRow)}
                >
                  {t('hq.customers.actionEdit')}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={onClose}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
