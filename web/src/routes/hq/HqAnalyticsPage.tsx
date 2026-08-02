import { useCallback, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { ActionableInsights } from '@/routes/hq/reports/ActionableInsights'
import { BranchPerformance } from '@/routes/hq/reports/BranchPerformance'
import { DateRangeFilter } from '@/routes/hq/reports/DateRangeFilter'
import { DeepAnalysis } from '@/routes/hq/reports/DeepAnalysis'
import { ExecutiveSummary } from '@/routes/hq/reports/ExecutiveSummary'
import { PerformanceTrend } from '@/routes/hq/reports/PerformanceTrend'
import { QuickInsightsBar } from '@/routes/hq/reports/QuickInsightsBar'
import { ReportsDrawer } from '@/routes/hq/reports/ReportsDrawer'
import { RewardsOverview } from '@/routes/hq/reports/RewardsOverview'
import { VisitHeatmap } from '@/routes/hq/reports/VisitHeatmap'
import { useHqReportsDashboard } from '@/routes/hq/reports/useHqReportsDashboard'
import type {
  ActiveTab,
  BranchTotal,
  DatePreset,
  DrawerKind,
  InsightAction,
  ReportsInsight,
} from '@/routes/hq/reports/types'

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function HqAnalyticsPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()
  const cafeId = profile?.cafe_id
  const enabled = profile?.role === 'hq_owner' && Boolean(cafeId)

  const [preset, setPreset] = useState<DatePreset>('30d')
  const [activeTab, setActiveTab] = useState<ActiveTab>('visits')
  const [drawer, setDrawer] = useState<DrawerKind>(null)
  const [branch, setBranch] = useState<BranchTotal | null>(null)

  const dash = useHqReportsDashboard(cafeId, enabled, preset, activeTab)

  const openDrawer = useCallback((kind: DrawerKind, b: BranchTotal | null = null) => {
    setBranch(b)
    setDrawer(kind)
  }, [])

  const runAction = useCallback(
    (action: InsightAction, insight?: ReportsInsight) => {
      if (action.type === 'drawer') {
        openDrawer(action.kind)
        return
      }
      if (action.type === 'tab') {
        setActiveTab(action.tab)
        scrollToId('reports-trend')
        return
      }
      if (action.type === 'scroll') {
        if (insight?.branchId) {
          const b = dash.rankedBranches.find((x) => x.branch_id === insight.branchId)
          if (b) openDrawer('branch', b)
        }
        scrollToId(action.id)
        return
      }
      if (action.type === 'route' && slug) {
        void navigate(`/hq/${slug}/${action.path}`)
      }
    },
    [dash.rankedBranches, navigate, openDrawer, slug],
  )

  const periodLabel = useMemo(() => {
    if (dash.days == null) return t('hq.reports.date.custom')
    return t('hq.reports.periodDays').replace('{n}', String(dash.days))
  }, [dash.days, t])

  if (pLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-full max-w-md rounded-xl bg-white/10 ms-auto" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl bg-white/10" />
          ))}
        </div>
        <Skeleton className="h-[320px] w-full rounded-2xl bg-white/10" />
      </div>
    )
  }

  if (!profile || profile.role !== 'hq_owner' || !cafeId || !slug) {
    return <Navigate to="/login" replace />
  }

  const kpisLoading = dash.ownerQuery.isLoading && dash.seriesQuery.isLoading
  const chartLoading = dash.seriesQuery.isLoading && !dash.series
  const pulseLoading = dash.visitPulseQuery.isLoading
  const ownerError = dash.ownerQuery.isError
  const seriesError = dash.seriesQuery.isError

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {t('hq.reports.title')}
          </h1>
          <p className="mt-1 text-sm text-white/45">{t('hq.reports.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter value={preset} onChange={setPreset} />
        </div>
      </header>

      {ownerError || seriesError ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
          {t('hq.owner.migrationHint')}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ms-3"
            onClick={() => void dash.refetch()}
          >
            {t('hq.reports.retry')}
          </Button>
        </div>
      ) : null}

      <ExecutiveSummary
        loading={kpisLoading}
        retentionPct={dash.retPct}
        returning={dash.retention?.active_customers_window ?? null}
        rewards={dash.owner?.rewards_claimed_total ?? null}
        activeStreaks={dash.owner?.active_streaks_now ?? null}
        shieldSaves={dash.owner?.shield_saves ?? null}
        sparkVisits={dash.sparkVisits}
        momentum={dash.momentum}
        showRoi={dash.canAdvanced}
        activeTab={activeTab}
        onFocusTab={setActiveTab}
        onOpen={(id) => {
          if (id === 'roi') openDrawer('roi')
          else if (id === 'returning') openDrawer('returning')
          else if (id === 'rewards') openDrawer('rewards')
          else if (id === 'streaks' || id === 'shields') openDrawer('retention')
          else openDrawer('retention')
        }}
      />

      <div className="grid gap-4 lg:grid-cols-12 lg:items-stretch">
        <div className="lg:col-span-8">
          <PerformanceTrend
            loading={chartLoading}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            visitData={dash.chartVisits}
            rewardData={dash.chartRewards}
            retentionPct={dash.retPct}
            showRoi={dash.canAdvanced}
            onPointClick={() => {
              if (activeTab === 'roi') openDrawer('roi')
              else if (activeTab === 'rewards') openDrawer('rewards')
              else if (activeTab === 'retention') openDrawer('retention')
              else openDrawer('visits')
            }}
          />
        </div>
        <div className="lg:col-span-4">
          <RewardsOverview
            loading={kpisLoading}
            claimed={dash.claimed}
            claimedTotal={dash.owner?.rewards_claimed_total ?? 0}
            readyTotal={dash.owner?.rewards_ready_to_claim ?? 0}
            redemptionRate={dash.redemptionRate}
            onOpen={() => openDrawer('rewards')}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-4">
          <VisitHeatmap loading={pulseLoading} cells={dash.heatmap} />
        </div>
        <div className="lg:col-span-8">
          {dash.canBranches ? (
            <BranchPerformance
              loading={chartLoading}
              visible
              branches={dash.rankedBranches}
              onOpen={(b) => openDrawer('branch', b)}
            />
          ) : (
            <ActionableInsights
              loading={kpisLoading && !dash.owner}
              insights={dash.insightsForTab}
              onAction={(action, insight) => runAction(action, insight)}
            />
          )}
        </div>
      </div>

      {dash.canBranches ? (
        <ActionableInsights
          loading={kpisLoading && !dash.owner}
          insights={dash.insightsForTab}
          onAction={(action, insight) => runAction(action, insight)}
        />
      ) : null}

      <QuickInsightsBar facts={dash.quickFacts} periodLabel={periodLabel} />

      <DeepAnalysis
        activeTab={activeTab}
        owner={dash.owner}
        claimed={dash.claimed}
        ready={dash.ready}
        retPct={dash.retPct}
        activeWindow={dash.retention?.active_customers_window ?? 0}
        totalCustomers={dash.retention?.total_customers ?? dash.totals?.customers ?? 0}
        checkIns={dash.totals?.check_ins_window ?? 0}
        shieldSaves={dash.owner?.shield_saves ?? 0}
        showRoi={dash.canAdvanced}
      />

      <ReportsDrawer
        kind={drawer}
        onClose={() => {
          setDrawer(null)
          setBranch(null)
        }}
        owner={dash.owner}
        retPct={dash.retPct}
        returning={dash.retention?.active_customers_window ?? 0}
        totalCustomers={dash.retention?.total_customers ?? dash.totals?.customers ?? 0}
        checkIns={dash.totals?.check_ins_window ?? 0}
        claimed={dash.claimed}
        ready={dash.ready}
        sparkVisits={dash.sparkVisits}
        rankedBranches={dash.rankedBranches}
        branch={branch}
        momentum={dash.momentum}
      />
    </div>
  )
}
