import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Award,
  Coffee,
  Flame,
  Gift,
  Shield,
  Skull,
  Sparkles,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { TenantAICopilot } from '@/components/hq/TenantAICopilot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { MILESTONE_ICON_META, normalizeIconType } from '@/lib/milestone-icons'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type BreakdownRow = { label: string; icon_type: string; count: number }

type OwnerPayload = {
  ok: boolean
  window_days?: number
  timezone?: string
  owner?: {
    active_streaks_now: number
    shield_saves: number
    streak_champions: number
    broken_streaks_this_week: number
    rewards_claimed_total: number
    rewards_ready_to_claim: number
  }
  claimed_breakdown?: BreakdownRow[]
  ready_breakdown?: BreakdownRow[]
  totals?: { customers: number; check_ins_window: number }
  reason?: string
}

const PIE_COLORS = ['#8b5cf6', '#22d3ee', '#f59e0b', '#f472b6', '#34d399', '#a78bfa', '#fb923c']

function parseOwner(data: unknown): OwnerPayload {
  if (!data || typeof data !== 'object') return { ok: false }
  return data as OwnerPayload
}

function OwnerMetricCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
  delay,
}: {
  icon: typeof Users
  label: string
  value: string
  hint: string
  accent: string
  delay: number
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26, delay }}
      className="relative overflow-hidden rounded-2xl border border-white/12 bg-zinc-950/70 p-5 backdrop-blur-xl"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{ background: accent }}
        aria-hidden
      />
      <div className="relative flex items-start gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/40">
          <Icon className="size-6 text-white/85" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/50">{label}</p>
          <p className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-white">{value}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-white/45">{hint}</p>
        </div>
      </div>
    </motion.div>
  )
}

function BreakdownList({
  rows,
  emptyLabel,
}: {
  rows: BreakdownRow[]
  emptyLabel: string
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-white/40">{emptyLabel}</p>
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const icon = normalizeIconType(row.icon_type)
        const meta = MILESTONE_ICON_META[icon]
        const Icon = meta.Icon
        return (
          <li
            key={`${row.label}-${row.icon_type}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/35 px-3 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/5">
                <Icon className="size-4 text-(--brand-secondary)" aria-hidden />
              </span>
              <span className="truncate text-sm font-medium text-white">{row.label}</span>
            </div>
            <span className="shrink-0 text-lg font-bold tabular-nums text-white">
              {row.count}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export function HqAnalyticsPage() {
  const { t } = useI18n()
  const [days, setDays] = useState(7)

  const q = useQuery({
    queryKey: ['hq-owner-analytics', days],
    enabled: Boolean(supabaseBrowserClient),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_roi_analytics_secure', {
        p_days: days,
      })
      if (error) throw error
      return parseOwner(data)
    },
    staleTime: 60_000,
  })

  const o = q.data?.owner
  const claimed = q.data?.claimed_breakdown ?? []
  const ready = q.data?.ready_breakdown ?? []

  const pieData = useMemo(
    () =>
      claimed.map((row, i) => ({
        name: row.label,
        value: row.count,
        fill: PIE_COLORS[i % PIE_COLORS.length],
      })),
    [claimed],
  )

  return (
    <div className="space-y-8 pb-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div className="space-y-2">
          <Badge variant="secondary" className="border-white/10 bg-black/40">
            {t('hq.owner.badge')}
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight text-white">{t('hq.owner.title')}</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-white/55">{t('hq.owner.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[7, 30].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? 'default' : 'secondary'}
              className={cn(
                days === d &&
                  'bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black',
              )}
              onClick={() => setDays(d)}
            >
              {t('hq.roi.windowDays').replace('{n}', String(d))}
            </Button>
          ))}
          <Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}>
            {q.isFetching ? t('common.loading') : t('hq.analytics.load')}
          </Button>
        </div>
      </motion.div>

      {q.isError ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
          {t('hq.owner.migrationHint')}
        </p>
      ) : null}

      {q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 bg-white/5" />
          ))}
        </div>
      ) : q.data?.ok && o ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <OwnerMetricCard
            icon={Flame}
            label={t('hq.owner.metricActive')}
            value={String(o.active_streaks_now)}
            hint={t('hq.owner.metricActiveHint')}
            accent="radial-gradient(80% 60% at 0% 0%, color-mix(in oklab, #f97316 22%, transparent), transparent 60%)"
            delay={0.04}
          />
          <OwnerMetricCard
            icon={Shield}
            label={t('hq.owner.metricShield')}
            value={String(o.shield_saves)}
            hint={t('hq.owner.metricShieldHint').replace('{n}', String(days))}
            accent="radial-gradient(80% 60% at 100% 0%, color-mix(in oklab, #38bdf8 20%, transparent), transparent 60%)"
            delay={0.08}
          />
          <OwnerMetricCard
            icon={Award}
            label={t('hq.owner.metricChampions')}
            value={String(o.streak_champions)}
            hint={t('hq.owner.metricChampionsHint')}
            accent="radial-gradient(80% 60% at 50% 0%, color-mix(in oklab, var(--brand-primary) 18%, transparent), transparent 60%)"
            delay={0.12}
          />
          <OwnerMetricCard
            icon={Skull}
            label={t('hq.owner.metricLost')}
            value={String(o.broken_streaks_this_week)}
            hint={t('hq.owner.metricLostHint')}
            accent="radial-gradient(80% 60% at 0% 100%, color-mix(in oklab, #f43f5e 16%, transparent), transparent 60%)"
            delay={0.16}
          />
          <OwnerMetricCard
            icon={Gift}
            label={t('hq.owner.metricClaimed')}
            value={String(o.rewards_claimed_total)}
            hint={t('hq.owner.metricClaimedHint')
              .replace('{ready}', String(o.rewards_ready_to_claim))
              .replace('{n}', String(days))}
            accent="radial-gradient(80% 60% at 100% 100%, color-mix(in oklab, var(--brand-secondary) 18%, transparent), transparent 60%)"
            delay={0.2}
          />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[1.75rem] border border-white/10 bg-zinc-950/60 p-6 backdrop-blur-xl"
        >
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Coffee className="size-5 text-(--brand-primary)" aria-hidden />
                <h3 className="text-lg font-semibold text-white">{t('hq.owner.costTitle')}</h3>
              </div>
              <p className="mt-1 max-w-lg text-sm text-white/50">{t('hq.owner.costSubtitle')}</p>
            </div>
            {o ? (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-200/70">
                  {t('hq.owner.pendingLabel')}
                </p>
                <p className="text-2xl font-bold tabular-nums text-amber-100">
                  {o.rewards_ready_to_claim}
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,280px)_1fr]">
            <div className="mx-auto w-full max-w-[280px]">
              {pieData.length > 0 ? (
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={62}
                        outerRadius={100}
                        paddingAngle={3}
                        stroke="rgba(0,0,0,0.35)"
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: '#0a0a0a',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="flex h-[280px] items-center justify-center text-sm text-white/40">
                  {t('hq.owner.costEmpty')}
                </p>
              )}
            </div>

            <div className="space-y-6">
              <div>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.35em] text-white/40">
                  {t('hq.owner.claimedListTitle')}
                </p>
                <BreakdownList rows={claimed} emptyLabel={t('hq.owner.costEmpty')} />
              </div>
              {ready.length > 0 ? (
                <div>
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.35em] text-amber-300/60">
                    {t('hq.owner.readyListTitle')}
                  </p>
                  <BreakdownList rows={ready} emptyLabel="" />
                </div>
              ) : null}
            </div>
          </div>
        </motion.section>

        <TenantAICopilot />
      </div>

      {q.data?.ok ? (
        <p className="flex items-center gap-2 text-[11px] text-white/35">
          <Sparkles className="size-3.5" aria-hidden />
          {t('hq.owner.footer')
            .replace('{customers}', String(q.data.totals?.customers ?? 0))
            .replace('{checkins}', String(q.data.totals?.check_ins_window ?? 0))}
        </p>
      ) : null}
    </div>
  )
}
