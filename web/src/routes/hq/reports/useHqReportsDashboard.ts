import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { usePlanLimits } from '@/hooks/usePlanLimits'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import {
  parseOwner,
  parseSeries,
  peakVisitDay,
  presetToDays,
  rankBranches,
  retentionPct,
  visitMomentumPct,
  type ActiveTab,
  type DatePreset,
  type DailyVisit,
  type ExecutiveBrief,
  type HeatCell,
  type ReportsInsight,
} from '@/routes/hq/reports/types'

function windowStartIso(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - Math.max(days, 1))
  return d.toISOString()
}

function windowStartDate(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - Math.max(days, 1))
  return d.toISOString().slice(0, 10)
}

/**
 * Single page-level analytics load — always cafe-scoped via RPC + cafe_id filters.
 * Tab switches only re-derive presentation.
 */
export function useHqReportsDashboard(
  cafeId: string | null | undefined,
  enabled: boolean,
  preset: DatePreset,
  activeTab: ActiveTab,
) {
  const days = presetToDays(preset)
  const plan = usePlanLimits(cafeId)

  const ownerQuery = useQuery({
    queryKey: ['hq-owner-analytics', cafeId, days],
    enabled: Boolean(supabaseBrowserClient && cafeId && enabled && days != null),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_roi_analytics_secure', {
        p_days: days!,
      })
      if (error) throw error
      return parseOwner(data)
    },
    staleTime: 60_000,
  })

  const seriesQuery = useQuery({
    queryKey: ['hq-analytics-series', cafeId, days],
    enabled: Boolean(supabaseBrowserClient && cafeId && enabled && days != null),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_analytics_series', {
        p_days: days!,
      })
      if (error) throw error
      return parseSeries(data)
    },
    staleTime: 60_000,
  })

  const branchCountQuery = useQuery({
    queryKey: ['hq-reports-branch-count', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId && enabled),
    queryFn: async () => {
      const { count, error } = await supabaseBrowserClient!
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('cafe_id', cafeId!)
      if (error) throw error
      return count ?? 0
    },
    staleTime: 120_000,
  })

  /** Cafe-scoped visit rows for unique-per-day + heatmap — never global. */
  const visitPulseQuery = useQuery({
    queryKey: ['hq-reports-visit-pulse', cafeId, days],
    enabled: Boolean(supabaseBrowserClient && cafeId && enabled && days != null),
    queryFn: async () => {
      const startDate = windowStartDate(days!)
      const startIso = windowStartIso(days!)
      const client = supabaseBrowserClient!
      const [{ data: byDay, error: dayErr }, { data: stamps, error: stampErr }] = await Promise.all([
        client
          .from('visits')
          .select('visit_date, customer_id')
          .eq('cafe_id', cafeId!)
          .eq('event_type', 'check_in')
          .gte('visit_date', startDate)
          .limit(8000),
        client
          .from('visits')
          .select('created_at')
          .eq('cafe_id', cafeId!)
          .eq('event_type', 'check_in')
          .gte('created_at', startIso)
          .limit(5000),
      ])
      if (dayErr) throw dayErr
      if (stampErr) throw stampErr
      return {
        byDay: (byDay ?? []) as { visit_date: string; customer_id: string | null }[],
        stamps: (stamps ?? []) as { created_at: string }[],
      }
    },
    staleTime: 60_000,
  })

  const owner = ownerQuery.data?.ok ? ownerQuery.data.owner : undefined
  const series = seriesQuery.data
  const claimed = ownerQuery.data?.claimed_breakdown ?? []
  const ready = ownerQuery.data?.ready_breakdown ?? []
  const retention = series?.retention
  const retPct = retention
    ? retentionPct(retention.active_customers_window, retention.total_customers)
    : null

  const limits = plan.data
  const isStarter = limits?.isStarter ?? true
  const canAdvanced = !isStarter
  const canBranches =
    Boolean(limits?.canBulkBranches) && (branchCountQuery.data ?? 0) > 1 && canAdvanced

  const uniqueByDay = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const row of visitPulseQuery.data?.byDay ?? []) {
      const day = String(row.visit_date)
      if (!map.has(day)) map.set(day, new Set())
      if (row.customer_id) map.get(day)!.add(row.customer_id)
    }
    return map
  }, [visitPulseQuery.data])

  const enrichedDaily: DailyVisit[] = useMemo(() => {
    const base = series?.daily_visits ?? []
    return base.map((d) => ({
      ...d,
      u: uniqueByDay.get(String(d.d))?.size ?? 0,
    }))
  }, [series?.daily_visits, uniqueByDay])

  const heatmap: HeatCell[] = useMemo(() => {
    const grid = new Map<string, number>()
    for (const row of visitPulseQuery.data?.stamps ?? []) {
      const dt = new Date(row.created_at)
      if (Number.isNaN(dt.getTime())) continue
      const dow = dt.getDay()
      const hour = dt.getHours()
      const key = `${dow}:${hour}`
      grid.set(key, (grid.get(key) ?? 0) + 1)
    }
    const cells: HeatCell[] = []
    for (const [key, count] of grid) {
      const [dow, hour] = key.split(':').map(Number)
      cells.push({ dow: dow!, hour: hour!, count })
    }
    return cells
  }, [visitPulseQuery.data])

  const sparkVisits = useMemo(
    () => enrichedDaily.map((d) => Number(d.c)),
    [enrichedDaily],
  )

  const momentum = useMemo(() => visitMomentumPct(enrichedDaily), [enrichedDaily])

  const peak = useMemo(() => peakVisitDay(enrichedDaily), [enrichedDaily])

  const rankedBranches = useMemo(
    () => rankBranches(series?.branch_totals ?? []),
    [series?.branch_totals],
  )

  const topReward = useMemo(() => {
    if (claimed.length === 0) return null
    return [...claimed].sort((a, b) => b.count - a.count)[0] ?? null
  }, [claimed])

  const chartVisits = useMemo(
    () =>
      enrichedDaily.map((x) => ({
        day: String(x.d).slice(5),
        visits: Number(x.c),
        unique: Number(x.u ?? 0),
        full: String(x.d),
      })),
    [enrichedDaily],
  )

  const chartRewards = useMemo(
    () =>
      claimed.map((r) => ({
        name: r.label.length > 16 ? `${r.label.slice(0, 16)}…` : r.label,
        value: r.count,
        full: r.label,
      })),
    [claimed],
  )

  const redemptionRate = useMemo(() => {
    const claimedTotal = owner?.rewards_claimed_total ?? 0
    const readyTotal = owner?.rewards_ready_to_claim ?? 0
    const pool = claimedTotal + readyTotal
    if (pool <= 0) return null
    return Math.round((100 * claimedTotal) / pool)
  }, [owner])

  const busiestDow = useMemo(() => {
    if (heatmap.length === 0) return null
    const byDow = new Array(7).fill(0) as number[]
    for (const c of heatmap) byDow[c.dow] += c.count
    let best = 0
    for (let i = 1; i < 7; i++) if (byDow[i]! > byDow[best]!) best = i
    return { dow: best, count: byDow[best]! }
  }, [heatmap])

  const insights = useMemo(() => {
    const cards: ReportsInsight[] = []

    if (retPct != null && retPct < 35) {
      cards.push({
        id: 'low-retention',
        tone: 'warning',
        titleKey: 'hq.reports.actionLowRetentionTitle',
        bodyKey: 'hq.reports.actionLowRetentionBody',
        action: { type: 'drawer', kind: 'retention' },
        count: retPct,
        tabs: ['retention', 'visits'],
      })
    }

    if (owner && owner.broken_streaks_this_week > 0) {
      cards.push({
        id: 'inactive',
        tone: 'warning',
        titleKey: 'hq.reports.actionInactiveTitle',
        bodyKey: 'hq.reports.actionInactiveBody',
        action: { type: 'route', path: 'customers' },
        count: owner.broken_streaks_this_week,
        tabs: ['retention', 'visits'],
      })
    }

    if (topReward && topReward.count > 0) {
      cards.push({
        id: 'top-reward',
        tone: 'success',
        titleKey: 'hq.reports.actionTopRewardTitle',
        bodyKey: 'hq.reports.actionTopRewardBody',
        action: { type: 'route', path: 'rewards' },
        name: topReward.label,
        count: topReward.count,
        tabs: ['rewards'],
      })
    } else if ((owner?.rewards_claimed_total ?? 0) === 0 && enrichedDaily.some((d) => d.c > 0)) {
      cards.push({
        id: 'weak-reward',
        tone: 'info',
        titleKey: 'hq.reports.actionWeakRewardTitle',
        bodyKey: 'hq.reports.actionWeakRewardBody',
        action: { type: 'route', path: 'rewards' },
        tabs: ['rewards', 'visits'],
      })
    }

    if (canBranches && rankedBranches.length > 1) {
      const best = rankedBranches[0]!
      cards.push({
        id: 'best-branch',
        tone: 'success',
        titleKey: 'hq.reports.actionBestBranchTitle',
        bodyKey: 'hq.reports.actionBestBranchBody',
        action: { type: 'scroll', id: 'reports-branches' },
        name: best.name || best.branch_code,
        count: best.share,
        branchId: best.branch_id,
        tabs: ['visits', 'retention'],
      })
    }

    if (canAdvanced && owner && owner.shield_saves > 0) {
      cards.push({
        id: 'shields',
        tone: 'info',
        titleKey: 'hq.reports.actionShieldTitle',
        bodyKey: 'hq.reports.actionShieldBody',
        action: { type: 'tab', tab: 'retention' },
        count: owner.shield_saves,
        tabs: ['retention'],
      })
    }

    if (momentum != null && Math.abs(momentum) >= 8) {
      cards.push({
        id: 'momentum',
        tone: momentum > 0 ? 'success' : 'warning',
        titleKey: momentum > 0 ? 'hq.reports.actionMomentumUpTitle' : 'hq.reports.actionMomentumDownTitle',
        bodyKey: momentum > 0 ? 'hq.reports.actionMomentumUpBody' : 'hq.reports.actionMomentumDownBody',
        action: { type: 'tab', tab: 'visits' },
        count: Math.abs(momentum),
        tabs: ['visits'],
      })
    }

    return cards.slice(0, 6)
  }, [
    retPct,
    owner,
    topReward,
    canBranches,
    rankedBranches,
    enrichedDaily,
    canAdvanced,
    momentum,
  ])

  const brief = useMemo((): ExecutiveBrief | null => {
    if (!owner && !series) return null

    const bullets: ExecutiveBrief['bullets'] = []

    if (momentum != null && momentum !== 0) {
      bullets.push({
        id: 'momentum',
        textKey: momentum > 0 ? 'hq.reports.brief.momentumUp' : 'hq.reports.brief.momentumDown',
        n: Math.abs(momentum),
        tabs: ['visits', 'retention'],
      })
    }

    if (peak) {
      bullets.push({
        id: 'peak',
        textKey: 'hq.reports.brief.peakDay',
        name: String(peak.d).slice(5),
        n: Number(peak.c),
        tabs: ['visits'],
      })
    }

    if (topReward?.label) {
      bullets.push({
        id: 'reward',
        textKey: 'hq.reports.brief.topReward',
        name: topReward.label,
        tabs: ['rewards', 'visits'],
      })
    }

    if (canBranches && rankedBranches[0]) {
      bullets.push({
        id: 'branch',
        textKey: 'hq.reports.brief.leadBranch',
        name: rankedBranches[0].name || rankedBranches[0].branch_code,
        tabs: ['visits', 'retention'],
      })
    }

    if (owner && owner.shield_saves > 0 && canAdvanced) {
      bullets.push({
        id: 'shield',
        textKey: 'hq.reports.brief.shields',
        n: owner.shield_saves,
        tabs: ['retention'],
      })
    }

    if (ready.length > 0) {
      const pending = ready.reduce((s, r) => s + r.count, 0)
      if (pending > 0) {
        bullets.push({
          id: 'pending',
          textKey: 'hq.reports.brief.pending',
          n: pending,
          tabs: ['rewards'],
        })
      }
    }

    let recommendationKey: string | null = null
    let cta: ExecutiveBrief['cta'] = null

    if (owner && owner.broken_streaks_this_week > 0) {
      recommendationKey = 'hq.reports.brief.recRecover'
      cta = { type: 'route', path: 'customers' }
    } else if (retPct != null && retPct < 35) {
      recommendationKey = 'hq.reports.brief.recRetention'
      cta = { type: 'drawer', kind: 'retention' }
    } else if ((owner?.rewards_claimed_total ?? 0) === 0 && enrichedDaily.some((d) => d.c > 0)) {
      recommendationKey = 'hq.reports.brief.recRewards'
      cta = { type: 'route', path: 'rewards' }
    } else if (canBranches && rankedBranches.length > 1) {
      recommendationKey = 'hq.reports.brief.recBranch'
      cta = { type: 'scroll', id: 'reports-branches' }
    } else if (bullets.length > 0) {
      recommendationKey = 'hq.reports.brief.recSteady'
      cta = { type: 'tab', tab: 'visits' }
    }

    if (bullets.length === 0 && !recommendationKey) return null
    return { bullets, recommendationKey, cta }
  }, [
    owner,
    series,
    momentum,
    peak,
    topReward,
    canBranches,
    rankedBranches,
    canAdvanced,
    ready,
    retPct,
    enrichedDaily,
  ])

  const insightsForTab = useMemo(() => {
    const filtered = insights.filter((c) => !c.tabs || c.tabs.includes(activeTab))
    const pool = filtered.length > 0 ? filtered : insights
    return pool.slice(0, 4)
  }, [insights, activeTab])

  const briefForTab = useMemo((): ExecutiveBrief | null => {
    if (!brief) return null
    if (activeTab === 'roi') {
      return {
        bullets: [],
        recommendationKey: 'hq.reports.brief.recRoi',
        cta: { type: 'drawer', kind: 'roi' },
      }
    }
    const bullets = brief.bullets.filter((b) => !b.tabs || b.tabs.includes(activeTab))
    return {
      bullets: bullets.length > 0 ? bullets : brief.bullets,
      recommendationKey: brief.recommendationKey,
      cta: brief.cta,
    }
  }, [brief, activeTab])

  const quickFacts = useMemo(() => {
    const facts: Array<{ id: string; textKey: string; name?: string; n?: number }> = []
    if (canBranches && rankedBranches[0]) {
      facts.push({
        id: 'branch',
        textKey: 'hq.reports.quick.bestBranch',
        name: rankedBranches[0].name || rankedBranches[0].branch_code,
        n: rankedBranches[0].share,
      })
    }
    if (momentum != null && Math.abs(momentum) >= 1) {
      facts.push({
        id: 'growth',
        textKey: momentum >= 0 ? 'hq.reports.quick.visitsUp' : 'hq.reports.quick.visitsDown',
        n: Math.abs(momentum),
      })
    }
    if (busiestDow && busiestDow.count > 0) {
      facts.push({
        id: 'dow',
        textKey: 'hq.reports.quick.busyDay',
        n: busiestDow.dow,
        name: String(busiestDow.count),
      })
    }
    if (retPct != null) {
      facts.push({
        id: 'ret',
        textKey: 'hq.reports.quick.retention',
        n: retPct,
      })
    }
    return facts.slice(0, 4)
  }, [canBranches, rankedBranches, momentum, busiestDow, retPct])

  return {
    days,
    ownerQuery,
    seriesQuery,
    visitPulseQuery,
    branchCount: branchCountQuery.data ?? 0,
    owner,
    series,
    retention,
    retPct,
    sparkVisits,
    momentum,
    peak,
    claimed,
    ready,
    totals: ownerQuery.data?.totals,
    rankedBranches,
    topReward,
    chartVisits,
    chartRewards,
    heatmap,
    redemptionRate,
    briefForTab,
    insightsForTab,
    quickFacts,
    isStarter,
    canAdvanced,
    canBranches,
    refetch: async () => {
      await Promise.all([
        ownerQuery.refetch(),
        seriesQuery.refetch(),
        branchCountQuery.refetch(),
        visitPulseQuery.refetch(),
      ])
    },
  }
}
