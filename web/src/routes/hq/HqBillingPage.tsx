import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Crown, Sparkles } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type PlanTierRow = { code: string; display_name: string; limits: Record<string, unknown> }

export function HqBillingPage() {
  const { slug } = useParams()
  const { t } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()
  const plan = usePlanLimits(profile?.cafe_id)

  const cafeQuery = useQuery({
    queryKey: ['hq-cafe-billing', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'hq_owner' && profile.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('id, slug, name, status')
        .eq('id', profile!.cafe_id!)
        .single()
      if (error) throw error
      return data
    },
  })

  const sub = useQuery({
    queryKey: ['hq-subscription', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('subscriptions')
        .select('plan_name, plan_tier, status, provider, stripe_customer_id, current_period_end')
        .eq('cafe_id', profile!.cafe_id!)
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
    queryKey: ['hq-plan-limits', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('streakup_plan_limits_for_cafe', {
        p_cafe_id: profile!.cafe_id!,
      })
      if (error) throw error
      return (data ?? {}) as Record<string, unknown>
    },
  })

  const usage = useQuery({
    queryKey: ['hq-billing-usage', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.cafe_id),
    queryFn: async () => {
      const cid = profile!.cafe_id!
      const [branches, hooks, keys] = await Promise.all([
        supabaseBrowserClient!.from('branches').select('id', { count: 'exact', head: true }).eq('cafe_id', cid),
        supabaseBrowserClient!.from('outbound_webhooks').select('id', { count: 'exact', head: true }).eq('cafe_id', cid),
        supabaseBrowserClient!.from('api_keys').select('id', { count: 'exact', head: true }).eq('cafe_id', cid).is('revoked_at', null),
      ])
      return {
        branches: branches.count ?? 0,
        webhooks: hooks.count ?? 0,
        apiKeys: keys.count ?? 0,
      }
    },
  })

  const cafe = cafeQuery.data
  const slugOk = Boolean(slug && cafe && cafe.slug === slug)
  const currentTier = (sub.data?.plan_tier as string | undefined) ?? 'starter'
  const isEnterprise = currentTier === 'enterprise'

  if (pLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'hq_owner') {
    return <Navigate to="/login" replace />
  }

  if (cafeQuery.isFetched && !slugOk) {
    return <Navigate to="/login" replace />
  }

  if (!cafe) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const lim = limits.data ?? {}
  const fmt = (n: unknown) => {
    const v = Number(n)
    if (Number.isNaN(v) || v < 0) return '∞'
    return String(v)
  }

  const currentTierMeta = (tiers.data ?? []).find((tier) => tier.code === currentTier)

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[1.75rem] border border-white/12 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-8"
      >
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-[var(--brand-primary)]/15 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('hq.billing.kicker')}</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">{t('hq.billing.title')}</h2>
            <p className="mt-2 max-w-xl text-sm text-white/55">{t('hq.billing.subtitle')}</p>
          </div>
          <div className="text-end">
            <p className="text-[10px] uppercase tracking-widest text-white/40">{t('hq.billing.currentPlan')}</p>
            <p className="mt-1 text-2xl font-bold text-white">
              {currentTierMeta?.display_name ?? (sub.data?.plan_name as string) ?? currentTier}
            </p>
            <Badge className="mt-2 border-emerald-500/30 bg-emerald-500/15 text-emerald-200">
              {String(sub.data?.status ?? 'active')}
            </Badge>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: t('hq.billing.usage.branches'), u: usage.data?.branches ?? '—', m: fmt(lim.max_branches) },
          { label: t('hq.billing.usage.webhooks'), u: usage.data?.webhooks ?? '—', m: fmt(lim.max_outbound_webhooks) },
          { label: t('hq.billing.usage.apiKeys'), u: usage.data?.apiKeys ?? '—', m: fmt(lim.max_api_keys) },
        ].map((c, i) => (
          <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}>
            <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
              <CardHeader className="pb-2">
                <CardDescription className="text-white/45">{c.label}</CardDescription>
                <CardTitle className="text-2xl text-white">
                  {c.u} <span className="text-base font-normal text-white/40">/ {c.m}</span>
                </CardTitle>
              </CardHeader>
            </Card>
          </motion.div>
        ))}
      </div>

      {!isEnterprise ? (
        <Card className="relative overflow-hidden border-violet-500/35 bg-gradient-to-br from-violet-950/70 via-black/50 to-fuchsia-950/40">
          <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-fuchsia-200" aria-hidden />
              <CardTitle className="text-white">{t('hq.billing.upgrade.title')}</CardTitle>
            </div>
            <CardDescription className="max-w-2xl text-fuchsia-100/80">{t('hq.billing.upgrade.body')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              className="bg-white text-violet-950 hover:bg-white/90"
              onClick={() => {
                window.open('mailto:sales@streakup.local?subject=Enterprise%20upgrade', '_blank')
              }}
            >
              <Crown className="size-4" />
              <span className="ms-2">{t('hq.billing.upgrade.cta')}</span>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div>
        <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wide">{t('hq.billing.catalog')}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {(tiers.data ?? []).map((tier) => {
            const active = tier.code === currentTier
            const tl = tier.limits as Record<string, unknown>
            return (
              <Card
                key={tier.code}
                className={cn(
                  'border-white/10 bg-zinc-950/60 backdrop-blur-md',
                  active && 'border-emerald-500/40 ring-1 ring-emerald-500/25',
                )}
              >
                <CardHeader>
                  <CardTitle className="text-base text-white">{tier.display_name}</CardTitle>
                  <CardDescription className="font-mono text-[11px] text-white/45">{tier.code}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-xs text-white/70">
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
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      <Card className="border-white/10 bg-black/30">
        <CardHeader>
          <CardTitle className="text-sm text-white/80">{t('hq.billing.stripe.title')}</CardTitle>
          <CardDescription className="text-white/45">{t('hq.billing.stripe.body')}</CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-white/50">
          <p>
            {t('hq.billing.stripe.customer')}:{' '}
            <span className="font-mono text-white/70">{(sub.data?.stripe_customer_id as string | null) ?? '—'}</span>
          </p>
          <p className="mt-2">
            {t('hq.billing.stripe.status')}: <span className="text-white/80">{String(sub.data?.status ?? '—')}</span>
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {plan.data?.canIntegrations ? (
          <Link className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'inline-flex')} to={`/hq/${slug}/api`}>
            {t('hq.billing.link.integrations')}
          </Link>
        ) : null}
        <Link className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'inline-flex text-white/70')} to={`/hq/${slug}/brand`}>
          {t('hq.billing.link.brand')}
        </Link>
      </div>
    </div>
  )
}
