import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cafeLocalDateString } from '@/routes/hq/home/cafeLocalDate'
import {
  isInactive,
  isLostStreak,
  isNearReward,
  isNewCustomer,
} from '@/routes/hq/customers/customerStatus'
import {
  HIGH_STREAK_THRESHOLD,
  normalizeCustomerRow,
  type CustomerRow,
  type MilestoneMeta,
} from '@/routes/hq/customers/types'

/**
 * Cafe-scoped snapshot for insights / KPI / client filters.
 * Always filtered by cafe_id — never global.
 */
export function useCustomersMeta(cafeId: string | null | undefined, enabled: boolean) {
  const cafeQuery = useQuery({
    queryKey: ['hq-cafe', cafeId],
    enabled: Boolean(supabaseBrowserClient && enabled && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('id, slug, timezone')
        .eq('id', cafeId!)
        .single()
      if (error) throw error
      return data as { id: string; slug: string; timezone: string }
    },
  })

  const milestonesQuery = useQuery({
    queryKey: ['hq-customers-milestones', cafeId],
    enabled: Boolean(supabaseBrowserClient && enabled && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('reward_milestones')
        .select('days_required, name, reward_label')
        .eq('cafe_id', cafeId!)
        .eq('active', true)
        .order('days_required', { ascending: true })
      if (error) throw error
      const rows: MilestoneMeta[] = []
      for (const m of data ?? []) {
        const days = Number(m.days_required ?? 0)
        if (days <= 0) continue
        rows.push({
          days,
          name: String(m.name ?? ''),
          rewardLabel: m.reward_label == null ? null : String(m.reward_label),
        })
      }
      return rows
    },
    staleTime: 60_000,
  })

  const snapshotQuery = useQuery({
    queryKey: ['hq-customers-snapshot', cafeId],
    enabled: Boolean(supabaseBrowserClient && enabled && cafeId),
    queryFn: async () => {
      const client = supabaseBrowserClient!
      const [{ data: customers, error: cErr }, { data: visits, error: vErr }] = await Promise.all([
        client
          .from('customers')
          .select(
            'id, full_name, pin_code, phone, current_streak, longest_streak, shields, created_at, updated_at',
          )
          .eq('cafe_id', cafeId!)
          .order('updated_at', { ascending: false })
          .limit(800),
        client
          .from('visits')
          .select('customer_id, visit_date')
          .eq('cafe_id', cafeId!)
          .eq('event_type', 'check_in')
          .order('visit_date', { ascending: false })
          .limit(4000),
      ])
      if (cErr) throw cErr
      if (vErr) throw vErr

      const lastVisit = new Map<string, string>()
      for (const v of visits ?? []) {
        const cid = (v as { customer_id: string }).customer_id
        const vd = String((v as { visit_date: string }).visit_date)
        if (cid && !lastVisit.has(cid)) lastVisit.set(cid, vd)
      }

      const rows: CustomerRow[] = []
      for (const raw of customers ?? []) {
        const normalized = normalizeCustomerRow({
          ...raw,
          last_visit_date: lastVisit.get((raw as { id: string }).id) ?? null,
        })
        if (normalized) rows.push(normalized)
      }
      return rows
    },
    staleTime: 30_000,
  })

  /** Unclaimed physical rewards — cafe-scoped only. */
  const readyRewardsQuery = useQuery({
    queryKey: ['hq-customers-ready-rewards', cafeId],
    enabled: Boolean(supabaseBrowserClient && enabled && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('rewards')
        .select('id, customer_id')
        .eq('cafe_id', cafeId!)
        .not('earned_at', 'is', null)
        .is('claimed_at', null)
        .limit(2000)
      if (error) throw error
      const customerIds = new Set<string>()
      for (const r of data ?? []) {
        const cid = (r as { customer_id: string | null }).customer_id
        if (cid) customerIds.add(cid)
      }
      return {
        count: (data ?? []).length,
        customerIds: [...customerIds],
      }
    },
    staleTime: 30_000,
  })

  const today = useMemo(
    () => cafeLocalDateString(cafeQuery.data?.timezone ?? 'UTC'),
    [cafeQuery.data?.timezone],
  )

  const milestones = milestonesQuery.data ?? []
  const milestoneDays = useMemo(() => milestones.map((m) => m.days), [milestones])
  const snapshot = snapshotQuery.data ?? []
  const readyCustomerIds = useMemo(
    () => new Set(readyRewardsQuery.data?.customerIds ?? []),
    [readyRewardsQuery.data],
  )

  const kpis = useMemo(() => {
    let nearReward = 0
    let returningToday = 0
    let visitedToday = 0
    let inactive = 0
    let lostStreak = 0
    let hasShield = 0
    let newest: CustomerRow | null = null
    let highest: CustomerRow | null = null

    for (const row of snapshot) {
      if (isNearReward(row.current_streak, milestones)) nearReward += 1
      if (row.last_visit_date === today) visitedToday += 1
      if (row.last_visit_date === today && row.longest_streak > 1) returningToday += 1
      if (isInactive(row, today)) inactive += 1
      if (isLostStreak(row)) lostStreak += 1
      if (row.shields > 0) hasShield += 1
      if (!highest || row.current_streak > highest.current_streak) highest = row
      if (!newest || row.created_at > newest.created_at) newest = row
    }

    return {
      totalSnapshot: snapshot.length,
      nearReward,
      returningToday,
      visitedToday,
      lostStreak,
      readyRewards: readyRewardsQuery.data?.count ?? 0,
      inactive,
      hasShield,
      newCount: snapshot.filter((r) => isNewCustomer(r, today)).length,
      highest,
      highStreakCount: snapshot.filter((r) => r.current_streak >= HIGH_STREAK_THRESHOLD).length,
    }
  }, [snapshot, milestones, today, readyRewardsQuery.data])

  return {
    today,
    milestones,
    milestoneDays,
    snapshot,
    readyCustomerIds,
    kpis,
    isLoading: cafeQuery.isLoading || snapshotQuery.isLoading || milestonesQuery.isLoading,
    timezone: cafeQuery.data?.timezone ?? 'UTC',
  }
}
