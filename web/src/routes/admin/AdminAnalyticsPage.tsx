import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Activity, Bell, Flame, Shield, TrendingUp, type LucideIcon } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
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
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type SurvivalRow = { day: number; reached: number; eligible: number; rate_pct: number }
type AnalyticsPayload = {
  ok: boolean
  generated_at?: string
  streak_survival?: SurvivalRow[]
  shield_salvage?: {
    check_in_saves: number
    midnight_saves: number
    total_saves: number
    gap_opportunities: number
    salvage_rate_pct: number
  }
  retention_uplift?: {
    casual_avg_visits: number
    activated_avg_visits: number
    power_avg_visits: number
    uplift_pct: number
  }
  platform?: {
    total_customers: number
    push_enabled_customers: number
    warnings_sent_30d: number
  }
}

async function fetchInvestorAnalytics(): Promise<AnalyticsPayload> {
  const { data, error } = await supabaseBrowserClient!.rpc('admin_investor_analytics_secure')
  if (error) throw error
  return (data ?? { ok: false }) as AnalyticsPayload
}

function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint: string
  accent?: string
}) {
  return (
    <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.35em] text-white/45 uppercase">{label}</p>
            <p className={cn('mt-2 text-3xl font-semibold tabular-nums tracking-tight', accent ?? 'text-white')}>
              {value}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-white/50">{hint}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-white/70">
            <Icon className="size-5" aria-hidden />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function AdminAnalyticsPage() {
  const { t } = useI18n()
  const { data: profile, isLoading: profileLoading } = useProfile()
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'investor-analytics'],
    queryFn: fetchInvestorAnalytics,
    enabled: profile?.role === 'super_admin',
    staleTime: 60_000,
  })

  if (profileLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72 bg-white/10" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-36 bg-white/5" />
          <Skeleton className="h-36 bg-white/5" />
          <Skeleton className="h-36 bg-white/5" />
        </div>
      </div>
    )
  }

  if (!profile || profile.role !== 'super_admin') {
    return <Navigate to="/login" replace />
  }

  const survival = data?.streak_survival ?? []
  const shield = data?.shield_salvage
  const retention = data?.retention_uplift
  const platform = data?.platform

  const retentionChart = [
    { tier: t('admin.analytics.tierCasual'), visits: Number(retention?.casual_avg_visits ?? 0) },
    { tier: t('admin.analytics.tierActivated'), visits: Number(retention?.activated_avg_visits ?? 0) },
    { tier: t('admin.analytics.tierPower'), visits: Number(retention?.power_avg_visits ?? 0) },
  ]

  const shieldChart = [
    { name: t('admin.analytics.shieldCheckIn'), value: Number(shield?.check_in_saves ?? 0) },
    { name: t('admin.analytics.shieldMidnight'), value: Number(shield?.midnight_saves ?? 0) },
  ]

  return (
    <div className="space-y-8 pb-10">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-6 py-8"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(80% 120% at 0% 0%, color-mix(in oklab, var(--brand-primary) 28%, transparent), transparent 55%), radial-gradient(60% 80% at 100% 100%, color-mix(in oklab, var(--brand-secondary) 22%, transparent), transparent 50%)',
          }}
          aria-hidden
        />
        <div className="relative">
          <Badge variant="outline" className="border-white/15 bg-white/5 text-white/70">
            {t('admin.analytics.kicker')}
          </Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{t('admin.analytics.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">{t('admin.analytics.subtitle')}</p>
        </div>
      </motion.header>

      {error ? (
        <p className="text-destructive text-sm">
          {t('admin.analytics.loadError')}
          {error instanceof Error && error.message ? ` (${error.message})` : ''}
        </p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          icon={Flame}
          label={t('admin.analytics.metricSurvival')}
          value={
            isLoading
              ? '—'
              : `${survival.find((s) => s.day === 10)?.rate_pct ?? 0}%`
          }
          hint={t('admin.analytics.metricSurvivalHint')}
          accent="text-amber-300"
        />
        <MetricTile
          icon={Shield}
          label={t('admin.analytics.metricSalvage')}
          value={isLoading ? '—' : `${shield?.salvage_rate_pct ?? 0}%`}
          hint={t('admin.analytics.metricSalvageHint')}
          accent="text-sky-300"
        />
        <MetricTile
          icon={TrendingUp}
          label={t('admin.analytics.metricUplift')}
          value={isLoading ? '—' : `+${retention?.uplift_pct ?? 0}%`}
          hint={t('admin.analytics.metricUpliftHint')}
          accent="text-emerald-300"
        />
        <MetricTile
          icon={Bell}
          label={t('admin.analytics.metricPush')}
          value={
            isLoading
              ? '—'
              : String(platform?.push_enabled_customers ?? 0)
          }
          hint={t('admin.analytics.metricPushHint')}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="border-white/10 bg-white/[0.03] xl:col-span-3">
          <CardContent className="p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">{t('admin.analytics.survivalTitle')}</h2>
                <p className="text-xs text-white/50">{t('admin.analytics.survivalSubtitle')}</p>
              </div>
              <Activity className="size-5 text-white/40" aria-hidden />
            </div>
            <div className="mt-6 h-72 w-full">
              {isLoading ? (
                <Skeleton className="h-full w-full bg-white/5" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={survival} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="survivalFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(d) => `D${d}`} stroke="rgba(255,255,255,0.35)" fontSize={11} />
                    <YAxis unit="%" stroke="rgba(255,255,255,0.35)" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(12,12,16,0.92)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 12,
                      }}
                      formatter={(v) => [`${Number(v ?? 0)}%`, t('admin.analytics.survivalRate')]}
                      labelFormatter={(d) => t('admin.analytics.dayLabel').replace('{day}', String(d))}
                    />
                    <Area
                      type="monotone"
                      dataKey="rate_pct"
                      stroke="var(--brand-primary)"
                      fill="url(#survivalFill)"
                      strokeWidth={2.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.03] xl:col-span-2">
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-white">{t('admin.analytics.shieldTitle')}</h2>
            <p className="text-xs text-white/50">{t('admin.analytics.shieldSubtitle')}</p>
            <div className="mt-6 h-72">
              {isLoading ? (
                <Skeleton className="h-full w-full bg-white/5" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={shieldChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                    <XAxis type="number" stroke="rgba(255,255,255,0.35)" fontSize={11} />
                    <YAxis type="category" dataKey="name" width={100} stroke="rgba(255,255,255,0.35)" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(12,12,16,0.92)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 12,
                      }}
                    />
                    <Bar dataKey="value" fill="var(--brand-secondary)" radius={[0, 8, 8, 0]} barSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="mt-2 text-center text-xs text-white/45">
              {t('admin.analytics.shieldFootnote')
                .replace('{gaps}', String(shield?.gap_opportunities ?? 0))
                .replace('{saves}', String(shield?.total_saves ?? 0))}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-white/[0.03]">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-white">{t('admin.analytics.retentionTitle')}</h2>
          <p className="text-xs text-white/50">{t('admin.analytics.retentionSubtitle')}</p>
          <div className="mt-6 h-64">
            {isLoading ? (
              <Skeleton className="h-full w-full bg-white/5" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={retentionChart}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="tier" stroke="rgba(255,255,255,0.35)" fontSize={11} />
                  <YAxis stroke="rgba(255,255,255,0.35)" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(12,12,16,0.92)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="visits" fill="var(--brand-primary)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
