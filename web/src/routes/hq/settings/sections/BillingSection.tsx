import { useQuery } from '@tanstack/react-query'
import { Crown, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'
import { SectionShell } from '@/routes/hq/settings/SectionShell'

type PlanTierRow = { code: string; display_name: string; limits: Record<string, unknown> }

type Props = {
  cafeId: string
}

export function BillingSection({ cafeId }: Props) {
  const { t } = useI18n()
  const plan = usePlanLimits(cafeId)

  const sub = useQuery({
    queryKey: ['hq-subscription', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('subscriptions')
        .select('plan_name, plan_tier, status, provider, stripe_customer_id, current_period_end')
        .eq('cafe_id', cafeId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const tiers = useQuery({
    queryKey: ['plan-tiers'],
    enabled: Boolean(supabaseBrowserClient),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.from('plan_tiers').select('*').order('sort_order', {
        ascending: true,
      })
      if (error) throw error
      return (data ?? []) as PlanTierRow[]
    },
  })

  const limits = useQuery({
    queryKey: ['hq-plan-limits', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('streakup_plan_limits_for_cafe', {
        p_cafe_id: cafeId,
      })
      if (error) throw error
      return (data ?? {}) as Record<string, unknown>
    },
  })

  const usage = useQuery({
    queryKey: ['hq-billing-usage', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId),
    queryFn: async () => {
      const [branches, hooks, keys] = await Promise.all([
        supabaseBrowserClient!.from('branches').select('id', { count: 'exact', head: true }).eq('cafe_id', cafeId),
        supabaseBrowserClient!
          .from('outbound_webhooks')
          .select('id', { count: 'exact', head: true })
          .eq('cafe_id', cafeId),
        supabaseBrowserClient!
          .from('api_keys')
          .select('id', { count: 'exact', head: true })
          .eq('cafe_id', cafeId)
          .is('revoked_at', null),
      ])
      return {
        branches: branches.count ?? 0,
        webhooks: hooks.count ?? 0,
        apiKeys: keys.count ?? 0,
      }
    },
  })

  if (sub.isLoading || plan.isLoading) {
    return <Skeleton className="h-72 w-full rounded-2xl bg-white/10" />
  }

  const currentTier = (sub.data?.plan_tier as string | undefined) ?? 'starter'
  const isEnterprise = currentTier === 'enterprise'
  const currentTierMeta = (tiers.data ?? []).find((tier) => tier.code === currentTier)
  const lim = limits.data ?? {}
  const fmt = (n: unknown) => {
    const v = Number(n)
    if (Number.isNaN(v) || v < 0) return '∞'
    return String(v)
  }

  return (
    <SectionShell titleKey="hq.settingsHub.billing.title" bodyKey="hq.settingsHub.billing.body">
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6">
        <div
          className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-[var(--brand-primary)]/15 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40">{t('hq.billing.currentPlan')}</p>
            <p className="mt-1 text-2xl font-bold text-white">
              {currentTierMeta?.display_name ?? (sub.data?.plan_name as string) ?? currentTier}
            </p>
          </div>
          <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-200">
            {String(sub.data?.status ?? 'active')}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label={t('hq.billing.usage.branches')}
          value={`${usage.data?.branches ?? 0}`}
          max={fmt(lim.max_branches)}
        />
        <Stat
          label={t('hq.billing.usage.webhooks')}
          value={`${usage.data?.webhooks ?? 0}`}
          max={fmt(lim.max_outbound_webhooks)}
        />
        <Stat label={t('hq.billing.usage.apiKeys')} value={`${usage.data?.apiKeys ?? 0}`} max={fmt(lim.max_api_keys)} />
      </div>

      {!isEnterprise ? (
        <div className="relative overflow-hidden rounded-2xl border border-violet-500/35 bg-gradient-to-br from-violet-950/70 via-black/50 to-fuchsia-950/40 p-5">
          <div className="pointer-events-none absolute -right-14 -top-14 size-48 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-fuchsia-200" aria-hidden />
                <p className="font-semibold text-white">{t('hq.billing.upgrade.title')}</p>
              </div>
              <p className="mt-1.5 max-w-xl text-sm text-fuchsia-100/80">{t('hq.billing.upgrade.body')}</p>
            </div>
            <Button
              type="button"
              className="shrink-0 bg-white text-violet-950 hover:bg-white/90"
              onClick={() => window.open('mailto:sales@streakup.local?subject=Enterprise%20upgrade', '_blank')}
            >
              <Crown className="size-4" />
              <span className="ms-2">{t('hq.billing.upgrade.cta')}</span>
            </Button>
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wide">{t('hq.billing.catalog')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(tiers.data ?? []).map((tier) => {
            const active = tier.code === currentTier
            const tl = tier.limits as Record<string, unknown>
            return (
              <div
                key={tier.code}
                className={cn(
                  'rounded-2xl border border-white/10 bg-black/25 p-4',
                  active && 'border-emerald-500/40 ring-1 ring-emerald-500/25',
                )}
              >
                <p className="text-sm font-semibold text-white">{tier.display_name}</p>
                <p className="mb-2 font-mono text-[10px] text-white/40">{tier.code}</p>
                <div className="space-y-0.5 text-xs text-white/60">
                  <p>
                    {t('hq.billing.limit.branches')}: {fmt(tl.max_branches)}
                  </p>
                  <p>
                    {t('hq.billing.limit.webhooks')}: {fmt(tl.max_outbound_webhooks)}
                  </p>
                  <p>
                    {t('hq.billing.limit.apiKeys')}: {fmt(tl.max_api_keys)}
                  </p>
                  <p>
                    {t('hq.billing.limit.whiteLabel')}: {tl.full_white_label ? t('common.yes') : t('common.no')}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-black/25 p-4">
        <p className="text-sm font-medium text-white/80">{t('hq.billing.stripe.title')}</p>
        <p className="mt-1 text-xs text-white/40">{t('hq.billing.stripe.body')}</p>
        <p className="mt-3 text-xs text-white/50">
          {t('hq.billing.stripe.customer')}:{' '}
          <span className="font-mono text-white/70">{(sub.data?.stripe_customer_id as string | null) ?? '—'}</span>
        </p>
      </div>
    </SectionShell>
  )
}

function Stat({ label, value, max }: { label: string; value: string; max: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/25 px-3 py-3">
      <p className="text-[10px] text-white/40">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">
        {value} <span className="text-xs font-normal text-white/40">/ {max}</span>
      </p>
    </div>
  )
}
