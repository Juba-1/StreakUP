import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Building2, Flame, Radio, Shield, TrendingUp, Users, Webhook, type LucideIcon } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import {
  parseSuperAdminGlobalMetrics,
  type SuperAdminGlobalMetrics,
} from '@/lib/admin/super-admin-metrics'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

async function fetchGlobalMetrics(): Promise<SuperAdminGlobalMetrics> {
  const { data, error } = await supabaseBrowserClient!.rpc('super_admin_global_metrics')
  if (error) throw error
  return parseSuperAdminGlobalMetrics(data)
}

function ExecutiveMetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tint,
  delay,
}: {
  label: string
  value: string
  hint?: string
  icon: LucideIcon
  tint: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 320, damping: 26 }}
    >
      <Card className="relative overflow-hidden border-white/10 bg-zinc-950/75 shadow-[0_32px_80px_-48px_rgba(0,0,0,0.9)] backdrop-blur-md">
        <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90', tint)} aria-hidden />
        <CardContent className="relative space-y-3 p-5 sm:p-6">
          <Icon className="size-5 text-white/75" aria-hidden />
          <p className="text-[10px] font-semibold tracking-[0.28em] text-white/45 uppercase">{label}</p>
          <p className="text-3xl font-semibold tabular-nums tracking-tight text-white sm:text-[2rem]">{value}</p>
          {hint ? <p className="text-[11px] leading-relaxed text-white/45">{hint}</p> : null}
        </CardContent>
      </Card>
    </motion.div>
  )
}

export function AdminOverviewPage() {
  const { t, locale } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()

  const metrics = useQuery({
    queryKey: ['admin-global-metrics'],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'super_admin'),
    queryFn: fetchGlobalMetrics,
    staleTime: 30_000,
  })

  if (pLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!profile || profile.role !== 'super_admin') {
    return <Navigate to="/login" replace />
  }

  const h = metrics.data?.headline
  const nf = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US')
  const daily = (metrics.data?.daily_check_ins ?? []).map((r) => ({
    label: r.date.slice(5),
    check_ins: r.check_ins,
  }))

  const ceoCards = [
    {
      key: 'cafes',
      label: t('admin.metrics.activeCafes'),
      value: metrics.isLoading ? '—' : nf(h?.active_cafes ?? 0),
      hint: t('admin.metrics.activeCafesHint'),
      icon: Building2,
      tint: 'from-violet-600/30 via-fuchsia-500/10 to-transparent',
    },
    {
      key: 'users',
      label: t('admin.metrics.platformUsers'),
      value: metrics.isLoading ? '—' : nf(h?.total_end_users ?? 0),
      hint: t('admin.metrics.platformUsersHint'),
      icon: Users,
      tint: 'from-sky-500/25 to-transparent',
    },
    {
      key: 'shields',
      label: t('admin.metrics.globalShieldSaves'),
      value: metrics.isLoading ? '—' : nf(h?.global_shield_saves ?? 0),
      hint: t('admin.metrics.globalShieldSavesHint'),
      icon: Shield,
      tint: 'from-emerald-500/22 to-transparent',
    },
    {
      key: 'commitment',
      label: t('admin.metrics.commitmentRate'),
      value: metrics.isLoading ? '—' : `${h?.avg_commitment_rate_pct ?? 0}%`,
      hint: t('admin.metrics.commitmentRateHint'),
      icon: Flame,
      tint: 'from-amber-500/22 to-transparent',
    },
  ] as const

  const opsCards = [
    {
      key: 'streaks',
      label: t('admin.metrics.activeStreaks'),
      value: metrics.isLoading ? '—' : nf(h?.active_streaks_now ?? 0),
      icon: TrendingUp,
    },
    {
      key: 'today',
      label: t('admin.metrics.checkInsToday'),
      value: metrics.isLoading ? '—' : nf(h?.check_ins_today ?? 0),
      icon: Flame,
    },
    {
      key: 'outbox',
      label: t('admin.metrics.outbox'),
      value: metrics.isLoading ? '—' : nf(h?.webhooks_pending ?? 0),
      icon: Radio,
    },
    {
      key: 'hooks',
      label: t('admin.metrics.hooks'),
      value: metrics.isLoading ? '—' : nf(h?.webhooks_live ?? 0),
      icon: Webhook,
    },
  ] as const

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('admin.overview.kicker')}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">{t('admin.overview.title')}</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{t('admin.overview.subtitleLive')}</p>
        </div>
        <Badge className="border-violet-500/35 bg-violet-500/12 text-violet-100">{t('admin.badge')}</Badge>
      </div>

      {metrics.error ? (
        <p className="text-destructive text-sm">{t('admin.overview.loadError')}</p>
      ) : null}

      <div>
        <p className="mb-3 text-[10px] font-semibold tracking-[0.35em] text-white/35 uppercase">
          {t('admin.overview.platformSection')}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ceoCards.map((c, i) => (
            <ExecutiveMetricCard
              key={c.key}
              label={c.label}
              value={c.value}
              hint={c.hint}
              icon={c.icon}
              tint={c.tint}
              delay={0.05 * i}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-3 text-[10px] font-semibold tracking-[0.35em] text-white/35 uppercase">
          {t('admin.overview.opsSection')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {opsCards.map((c, i) => (
            <motion.div
              key={c.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.04 }}
            >
              <Card className="border-white/8 bg-zinc-950/55 backdrop-blur-sm">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-[10px] font-medium tracking-wider text-white/40 uppercase">{c.label}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-white">{c.value}</p>
                  </div>
                  <c.icon className="size-4 text-white/35" aria-hidden />
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      <Card className="border-white/10 bg-zinc-950/75 backdrop-blur-md">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-white">{t('admin.overview.dailyChartTitle')}</h2>
          <p className="text-xs text-white/50">{t('admin.overview.dailyChartSubtitle')}</p>
          <div className="mt-6 h-56 w-full">
            {metrics.isLoading ? (
              <Skeleton className="h-full w-full bg-white/5" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dailyCheckInsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="label" stroke="rgba(255,255,255,0.35)" fontSize={11} />
                  <YAxis stroke="rgba(255,255,255,0.35)" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(12,12,16,0.92)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="check_ins"
                    stroke="var(--brand-primary)"
                    fill="url(#dailyCheckInsFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="rounded-2xl border border-white/10 bg-gradient-to-br from-violet-950/40 via-zinc-950/60 to-zinc-950/80 px-6 py-8 backdrop-blur-sm"
      >
        <p className="text-sm font-semibold text-white">{t('admin.overview.hintTitle')}</p>
        <p className="text-muted-foreground mx-auto mt-2 max-w-2xl text-sm leading-relaxed">
          {t('admin.overview.hintBody')}
        </p>
      </motion.div>
    </div>
  )
}
