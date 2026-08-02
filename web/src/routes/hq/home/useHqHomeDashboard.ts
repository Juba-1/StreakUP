import { useQuery } from '@tanstack/react-query'

import { cafeLocalDateString, greetingPeriod, shiftCafeDate } from '@/routes/hq/home/cafeLocalDate'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export type HomeInsightTone = 'success' | 'warning' | 'info'

export type HomeInsight = {
  id: string
  tone: HomeInsightTone
  title: string
  description: string
  action?: 'remind' | 'customers' | null
}

export type HomeActivityKind =
  | 'streak'
  | 'reward'
  | 'joined'
  | 'shield'
  | 'broken'

export type HomeActivityItem = {
  id: string
  kind: HomeActivityKind
  at: string
  title: string
  detail?: string
}

export type HomeKpis = {
  visitsToday: number
  visitsYesterday: number
  visitsTrendPct: number | null
  returningToday: number
  rewardsRedeemedToday: number
  retentionRate: number | null
  sparkVisits: number[]
  sparkReturning: number[]
  sparkRewards: number[]
  sparkRetention: number[]
}

export type HqHomeDashboard = {
  cafeName: string
  slug: string
  timezone: string
  greeting: 'morning' | 'afternoon' | 'evening'
  todayLabel: string
  kpis: HomeKpis
  insights: HomeInsight[]
  activity: HomeActivityItem[]
  firstCashierPath: string | null
  hasAnyVisitsEver: boolean
}

type Daily = { d: string; c: number }

function pctChange(today: number, yesterday: number): number | null {
  if (yesterday <= 0) return today > 0 ? 100 : null
  return Math.round(((today - yesterday) / yesterday) * 100)
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return phone || '—'
  return `•••${digits.slice(-4)}`
}

function customerLabel(fullName: string | null | undefined, phone: string | null | undefined): string {
  const name = (fullName ?? '').trim()
  if (name.length >= 2) return name
  if (phone) return maskPhone(phone)
  return 'Customer'
}

export function useHqHomeDashboard(cafeId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['hq-home-dashboard', cafeId],
    enabled: Boolean(enabled && cafeId && supabaseBrowserClient),
    staleTime: 60_000,
    queryFn: async (): Promise<HqHomeDashboard> => {
      const client = supabaseBrowserClient!
      const cafeIdSafe = cafeId!

      const { data: cafe, error: cafeErr } = await client
        .from('cafes')
        .select('id, slug, name, timezone')
        .eq('id', cafeIdSafe)
        .single()
      if (cafeErr) throw cafeErr

      const timezone = (cafe.timezone as string) || 'UTC'
      const today = cafeLocalDateString(timezone)
      const yesterday = shiftCafeDate(timezone, -1)

      const dayKeys: string[] = []
      for (let i = 6; i >= 0; i -= 1) {
        dayKeys.push(shiftCafeDate(timezone, -i))
      }
      const weekStart = dayKeys[0]!

      const [
        branchesRes,
        visitsTodayRes,
        visitsYesterdayRes,
        weekVisitsRes,
        rewardsTodayRes,
        weekRewardsRes,
        milestonesRes,
        customersRes,
        recentVisitsRes,
        recentRewardsRes,
        recentCustomersRes,
        analyticsRes,
        roiRes,
        allVisitsCountRes,
      ] = await Promise.all([
        client
          .from('branches')
          .select('id, branch_code, created_at')
          .eq('cafe_id', cafeIdSafe)
          .order('created_at', { ascending: true })
          .limit(20),
        client
          .from('visits')
          .select('id, customer_id', { count: 'exact' })
          .eq('cafe_id', cafeIdSafe)
          .eq('visit_date', today)
          .eq('event_type', 'check_in'),
        client
          .from('visits')
          .select('id', { count: 'exact', head: true })
          .eq('cafe_id', cafeIdSafe)
          .eq('visit_date', yesterday)
          .eq('event_type', 'check_in'),
        client
          .from('visits')
          .select('id, visit_date, customer_id, event_type')
          .eq('cafe_id', cafeIdSafe)
          .gte('visit_date', weekStart)
          .lte('visit_date', today)
          .limit(5000),
        client
          .from('rewards')
          .select('id', { count: 'exact', head: true })
          .eq('cafe_id', cafeIdSafe)
          .gte('claimed_at', `${today}T00:00:00`)
          .lte('claimed_at', `${today}T23:59:59.999`),
        client
          .from('rewards')
          .select('id, claimed_at')
          .eq('cafe_id', cafeIdSafe)
          .gte('claimed_at', `${weekStart}T00:00:00`)
          .not('claimed_at', 'is', null)
          .limit(2000),
        client
          .from('reward_milestones')
          .select('id, name, days_required, active')
          .eq('cafe_id', cafeIdSafe)
          .eq('active', true)
          .order('days_required', { ascending: true }),
        client
          .from('customers')
          .select('id, full_name, phone, current_streak, created_at')
          .eq('cafe_id', cafeIdSafe)
          .order('updated_at', { ascending: false })
          .limit(800),
        client
          .from('visits')
          .select('id, created_at, visit_date, streak_after, event_type, metadata, customers(full_name, phone)')
          .eq('cafe_id', cafeIdSafe)
          .order('created_at', { ascending: false })
          .limit(40),
        client
          .from('rewards')
          .select(
            'id, claimed_at, customers(full_name, phone), reward_milestones(name, reward_label)',
          )
          .eq('cafe_id', cafeIdSafe)
          .not('claimed_at', 'is', null)
          .order('claimed_at', { ascending: false })
          .limit(20),
        client
          .from('customers')
          .select('id, full_name, phone, created_at')
          .eq('cafe_id', cafeIdSafe)
          .order('created_at', { ascending: false })
          .limit(20),
        client.rpc('hq_analytics_series', { p_days: 30 }),
        client.rpc('hq_roi_analytics_secure', { p_days: 7 }),
        client
          .from('visits')
          .select('id', { count: 'exact', head: true })
          .eq('cafe_id', cafeIdSafe)
          .eq('event_type', 'check_in'),
      ])

      const visitsTodayRows = visitsTodayRes.data ?? []
      const visitsToday = visitsTodayRes.count ?? visitsTodayRows.length
      const visitsYesterday = visitsYesterdayRes.count ?? 0

      const todayCustomerIds = new Set(
        visitsTodayRows.map((v) => v.customer_id as string).filter(Boolean),
      )

      const priorCustomerIds = new Set<string>()
      for (const v of weekVisitsRes.data ?? []) {
        if (v.event_type !== 'check_in') continue
        if (v.visit_date === today) continue
        if (v.customer_id) priorCustomerIds.add(v.customer_id as string)
      }

      // Also mark returning if they had any visit before today (sample from week + customers who visited today)
      let returningToday = 0
      for (const id of todayCustomerIds) {
        if (priorCustomerIds.has(id)) returningToday += 1
      }

      // Refine returning with a cheap extra query when we have today visitors
      if (todayCustomerIds.size > 0 && todayCustomerIds.size <= 200) {
        const ids = [...todayCustomerIds]
        const { data: priorHits } = await client
          .from('visits')
          .select('customer_id')
          .eq('cafe_id', cafeIdSafe)
          .eq('event_type', 'check_in')
          .in('customer_id', ids)
          .lt('visit_date', today)
          .limit(2000)
        const hadPrior = new Set((priorHits ?? []).map((r) => r.customer_id as string))
        returningToday = hadPrior.size
      }

      const rewardsRedeemedToday = rewardsTodayRes.count ?? 0

      let retentionRate: number | null = null
      let dailySeries: Daily[] = []
      try {
        const raw = analyticsRes.data as unknown
        const parsed =
          typeof raw === 'string'
            ? (JSON.parse(raw) as {
                daily_visits?: Daily[]
                retention?: { active_customers_window: number; total_customers: number }
              })
            : (raw as {
                daily_visits?: Daily[]
                retention?: { active_customers_window: number; total_customers: number }
              })
        dailySeries = parsed?.daily_visits ?? []
        const ret = parsed?.retention
        if (ret && ret.total_customers > 0) {
          retentionRate = Math.round((100 * ret.active_customers_window) / ret.total_customers)
        }
      } catch {
        retentionRate = null
      }

      const visitsByDay = new Map<string, number>()
      const uniqueByDay = new Map<string, Set<string>>()
      for (const key of dayKeys) {
        visitsByDay.set(key, 0)
        uniqueByDay.set(key, new Set())
      }
      for (const v of weekVisitsRes.data ?? []) {
        if (v.event_type !== 'check_in') continue
        const d = String(v.visit_date)
        if (!visitsByDay.has(d)) continue
        visitsByDay.set(d, (visitsByDay.get(d) ?? 0) + 1)
        if (v.customer_id) uniqueByDay.get(d)?.add(v.customer_id as string)
      }

      const rewardsByDay = new Map<string, number>()
      for (const key of dayKeys) rewardsByDay.set(key, 0)
      for (const r of weekRewardsRes.data ?? []) {
        if (!r.claimed_at) continue
        const d = String(r.claimed_at).slice(0, 10)
        if (rewardsByDay.has(d)) rewardsByDay.set(d, (rewardsByDay.get(d) ?? 0) + 1)
      }

      let sparkVisits: number[] = dayKeys.map((d) => visitsByDay.get(d) ?? 0)
      const sparkReturning: number[] = dayKeys.map((d) => uniqueByDay.get(d)?.size ?? 0)
      const sparkRewards: number[] = dayKeys.map((d) => rewardsByDay.get(d) ?? 0)
      // Approximate retention spark from daily unique / total customers (stable shape)
      const totalCustomers = (customersRes.data ?? []).length || 1
      const sparkRetention: number[] = dayKeys.map((d) =>
        Math.min(100, Math.round((100 * (uniqueByDay.get(d)?.size ?? 0)) / totalCustomers)),
      )

      if (dailySeries.length >= 7 && sparkVisits.every((n) => n === 0)) {
        const last7 = dailySeries.slice(-7)
        sparkVisits = last7.map((row) => Number(row?.c ?? 0))
      }

      const milestones = (milestonesRes.data ?? [])
        .map((m) => ({
          days: Number(m.days_required),
          name: String(m.name ?? ''),
        }))
        .filter((m) => m.days > 0)
        .sort((a, b) => a.days - b.days)

      let nearRewardCount = 0
      for (const c of customersRes.data ?? []) {
        const streak = Number(c.current_streak ?? 0)
        const next = milestones.find((m) => m.days > streak)
        if (next && next.days - streak === 1) nearRewardCount += 1
      }

      let brokenThisWeek = 0
      let retentionDeltaHint: number | null = null
      try {
        const roiRaw = roiRes.data as unknown
        const roi =
          typeof roiRaw === 'string'
            ? (JSON.parse(roiRaw) as {
                owner?: { broken_streaks_this_week?: number; active_streaks_now?: number }
              })
            : (roiRaw as {
                owner?: { broken_streaks_this_week?: number; active_streaks_now?: number }
              })
        brokenThisWeek = Number(roi?.owner?.broken_streaks_this_week ?? 0)
      } catch {
        brokenThisWeek = 0
      }

      // Week-over-week unique visitors as retention narrative signal (real data)
      const mid = Math.floor(dayKeys.length / 2)
      const firstHalf = sparkReturning.slice(0, mid).reduce((a, b) => a + b, 0)
      const secondHalf = sparkReturning.slice(mid).reduce((a, b) => a + b, 0)
      if (firstHalf > 0) {
        retentionDeltaHint = Math.round(((secondHalf - firstHalf) / firstHalf) * 100)
      }

      const insights: HomeInsight[] = []
      if (nearRewardCount > 0) {
        insights.push({
          id: 'near-reward',
          tone: 'success',
          title: 'nearReward',
          description: String(nearRewardCount),
          action: 'remind',
        })
      }
      if (brokenThisWeek > 0) {
        insights.push({
          id: 'broken',
          tone: 'warning',
          title: 'broken',
          description: String(brokenThisWeek),
          action: 'customers',
        })
      }
      if (retentionDeltaHint != null && retentionDeltaHint !== 0) {
        insights.push({
          id: 'retention',
          tone: 'info',
          title: retentionDeltaHint > 0 ? 'retentionUp' : 'retentionDown',
          description: String(Math.abs(retentionDeltaHint)),
          action: null,
        })
      } else if (retentionRate != null && retentionRate > 0) {
        insights.push({
          id: 'retention-rate',
          tone: 'info',
          title: 'retentionSteady',
          description: String(retentionRate),
          action: null,
        })
      }
      if (insights.length === 0 && visitsToday > 0) {
        insights.push({
          id: 'visits-ok',
          tone: 'success',
          title: 'visitsOk',
          description: String(visitsToday),
          action: null,
        })
      }

      const activity: HomeActivityItem[] = []

      for (const v of recentVisitsRes.data ?? []) {
        const cust = v.customers as { full_name?: string; phone?: string } | null
        const label = customerLabel(cust?.full_name, cust?.phone)
        const meta = (v.metadata ?? {}) as Record<string, unknown>
        const et = String(v.event_type ?? 'check_in')
        if (et === 'check_in') {
          activity.push({
            id: `visit:${v.id}`,
            kind: 'streak',
            at: String(v.created_at),
            title: label,
            detail: String(v.streak_after ?? ''),
          })
        } else if (
          et === 'system' ||
          String(meta.reason ?? meta.kind ?? '').toLowerCase().includes('shield')
        ) {
          activity.push({
            id: `shield:${v.id}`,
            kind: 'shield',
            at: String(v.created_at),
            title: label,
          })
        } else if (String(meta.kind ?? '').includes('break') || Number(v.streak_after) === 1) {
          // System reset after break often lands as check_in with streak_after=1; skip false positives
        }
      }

      for (const r of recentRewardsRes.data ?? []) {
        if (!r.claimed_at) continue
        const cust = r.customers as { full_name?: string; phone?: string } | null
        const mile = r.reward_milestones as { name?: string; reward_label?: string } | null
        const rewardName = (mile?.reward_label || mile?.name || 'Reward').trim()
        activity.push({
          id: `reward:${r.id}`,
          kind: 'reward',
          at: String(r.claimed_at),
          title: customerLabel(cust?.full_name, cust?.phone),
          detail: rewardName,
        })
      }

      for (const c of recentCustomersRes.data ?? []) {
        activity.push({
          id: `join:${c.id}`,
          kind: 'joined',
          at: String(c.created_at),
          title: customerLabel(c.full_name as string, c.phone as string),
        })
      }

      activity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

      const firstBranch = (branchesRes.data ?? [])[0]
      const cafeSlug = String(cafe.slug ?? '')
      const firstCashierPath =
        firstBranch?.branch_code && cafeSlug
          ? `/cashier/${cafeSlug}/${firstBranch.branch_code}`
          : null

      return {
        cafeName: String(cafe.name ?? ''),
        slug: cafeSlug,
        timezone,
        greeting: greetingPeriod(timezone),
        todayLabel: today,
        kpis: {
          visitsToday,
          visitsYesterday,
          visitsTrendPct: pctChange(visitsToday, visitsYesterday),
          returningToday,
          rewardsRedeemedToday,
          retentionRate,
          sparkVisits,
          sparkReturning,
          sparkRewards,
          sparkRetention,
        },
        insights: insights.slice(0, 3),
        activity: activity.slice(0, 12),
        firstCashierPath,
        hasAnyVisitsEver: (allVisitsCountRes.count ?? 0) > 0,
      }
    },
  })
}
