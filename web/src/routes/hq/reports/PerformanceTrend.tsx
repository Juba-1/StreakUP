import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { ActiveTab } from '@/routes/hq/reports/types'
import { cn } from '@/lib/utils'

type VisitPoint = { day: string; visits: number; unique: number; full: string }
type RewardPoint = { name: string; value: number; full: string }

type Props = {
  loading?: boolean
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
  visitData: VisitPoint[]
  rewardData: RewardPoint[]
  retentionPct: number | null
  showRoi: boolean
  onPointClick?: () => void
}

const TABS: ActiveTab[] = ['visits', 'retention', 'rewards', 'roi']

export function PerformanceTrend({
  loading,
  activeTab,
  onTabChange,
  visitData,
  rewardData,
  retentionPct,
  showRoi,
  onPointClick,
}: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  if (loading) {
    return <Skeleton className="h-[340px] w-full rounded-2xl bg-white/10" />
  }

  return (
    <section
      id="reports-trend"
      aria-label={t('hq.reports.trendAria')}
      className="rounded-2xl border border-white/10 bg-zinc-950/55 p-5 backdrop-blur-xl"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{t('hq.reports.trendTitle')}</h2>
          <p className="mt-0.5 text-xs text-white/40">{t('hq.reports.trendBody')}</p>
        </div>
        <div className="inline-flex flex-wrap rounded-xl border border-white/10 bg-black/30 p-1">
          {TABS.map((tab) => {
            if (tab === 'roi' && !showRoi) return null
            const active = activeTab === tab
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[11px] font-medium transition',
                  active
                    ? 'bg-violet-500/25 text-white'
                    : 'text-white/45 hover:text-white/80',
                )}
              >
                {t(`hq.reports.metric.${tab}`)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="h-[280px] rounded-xl border border-white/6 bg-black/25 p-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            className="h-full"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === 'visits' ? (
              visitData.length === 0 ? (
                <EmptyChart label={t('hq.reports.trendEmpty')} />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={visitData}
                    onClick={() => onPointClick?.()}
                    style={{ cursor: onPointClick ? 'pointer' : undefined }}
                  >
                    <defs>
                      <linearGradient id="visitsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="day" stroke="#71717a" fontSize={11} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} tickLine={false} width={28} />
                    <Tooltip
                      contentStyle={{
                        background: '#0a0a0a',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
                    <Area
                      type="monotone"
                      dataKey="visits"
                      name={t('hq.reports.chart.totalVisits')}
                      stroke="var(--brand-primary)"
                      fill="url(#visitsFill)"
                      strokeWidth={2.25}
                    />
                    <Area
                      type="monotone"
                      dataKey="unique"
                      name={t('hq.reports.chart.uniqueVisits')}
                      stroke="var(--brand-secondary)"
                      fill="transparent"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )
            ) : null}

            {activeTab === 'rewards' ? (
              rewardData.length === 0 ? (
                <EmptyChart label={t('hq.reports.trendRewardsEmpty')} />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={rewardData}
                    onClick={() => onPointClick?.()}
                    style={{ cursor: onPointClick ? 'pointer' : undefined }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={10} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} tickLine={false} width={28} />
                    <Tooltip
                      contentStyle={{
                        background: '#0a0a0a',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="value" fill="var(--brand-accent)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )
            ) : null}

            {activeTab === 'retention' ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-5xl font-semibold tabular-nums text-white">
                  {retentionPct == null ? '—' : `${retentionPct}%`}
                </p>
                <p className="max-w-sm text-xs text-white/40">{t('hq.reports.trendRetentionNote')}</p>
              </div>
            ) : null}

            {activeTab === 'roi' ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm font-medium text-white">{t('hq.reports.kpiRoiPos')}</p>
                <p className="max-w-sm text-xs text-white/40">{t('hq.reports.roiDrawerBody')}</p>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-white/35">
      {label}
    </div>
  )
}
