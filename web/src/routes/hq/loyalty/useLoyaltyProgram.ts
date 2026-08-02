import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

import { useI18n } from '@/core/i18n/I18nProvider'
import { normalizeIconType } from '@/lib/milestone-icons'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import {
  clampDays,
  clampShieldGrant,
  defaultClaimLimit,
  emptyDraft,
  gamificationPayload,
  sanitizeName,
  sanitizeReward,
  type CafeShieldPolicy,
  type DraftMilestone,
  type MilestoneRow,
} from '@/routes/hq/loyalty/types'

export function useLoyaltyProgram(cafeId: string | null | undefined, enabled: boolean) {
  const { t } = useI18n()
  const qc = useQueryClient()

  const graceQuery = useQuery({
    queryKey: ['hq-cafe-grace', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId && enabled),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('grace_days, off_days, shield_every, max_shields')
        .eq('id', cafeId!)
        .single()
      if (error) throw error
      const grace = (data?.grace_days as number[] | null) ?? []
      const legacy = (data?.off_days as number[] | null) ?? []
      const policy: CafeShieldPolicy = {
        shield_every: (data?.shield_every as number | null) ?? null,
        max_shields: (data?.max_shields as number | null) ?? null,
      }
      return {
        graceDays: grace.length > 0 ? grace : legacy,
        policy,
      }
    },
  })

  const milestonesQuery = useQuery({
    queryKey: ['hq-milestones', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId && enabled),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('reward_milestones')
        .select(
          'id, cafe_id, name, days_required, reward_label, shield_grant_amount, icon_type, discount_percentage, fulfillment_type, claim_limit, reactivate_after_inactivity_days, sort_order, active',
        )
        .eq('cafe_id', cafeId!)
        .order('days_required', { ascending: true })
      if (error) throw error
      return (data ?? []).map((m) => ({
        ...(m as MilestoneRow),
        icon_type: normalizeIconType((m as MilestoneRow).icon_type),
      })) as MilestoneRow[]
    },
  })

  /** Cafe-scoped redemption counts for insight cards — no new RPC. */
  const redemptionQuery = useQuery({
    queryKey: ['hq-loyalty-redemptions', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId && enabled),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('rewards')
        .select('milestone_id, claimed_at')
        .eq('cafe_id', cafeId!)
        .not('claimed_at', 'is', null)
        .limit(2000)
      if (error) throw error
      const counts = new Map<string, number>()
      for (const row of data ?? []) {
        const mid = (row as { milestone_id: string | null }).milestone_id
        if (!mid) continue
        counts.set(mid, (counts.get(mid) ?? 0) + 1)
      }
      return counts
    },
    staleTime: 60_000,
  })

  const milestones = milestonesQuery.data ?? []
  const sorted = useMemo(
    () => [...milestones].sort((a, b) => a.days_required - b.days_required || a.sort_order - b.sort_order),
    [milestones],
  )

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['hq-milestones', cafeId] }),
      qc.invalidateQueries({ queryKey: ['hq-loyalty-redemptions', cafeId] }),
      qc.invalidateQueries({ queryKey: ['hq-cafe-grace', cafeId] }),
    ])
  }

  const addMutation = useMutation({
    mutationFn: async (input: DraftMilestone) => {
      if (!supabaseBrowserClient || !cafeId) throw new Error('no_client')
      const name = sanitizeName(input.name)
      if (name.length < 2) throw new Error('invalid_name')
      const days = clampDays(input.days_required)
      const reward = sanitizeReward(input.reward_label) || null
      const shields = clampShieldGrant(input.shield_grant_amount)
      const nextOrder =
        sorted.length > 0 ? Math.max(...sorted.map((m) => m.sort_order ?? 0)) + 10 : 10
      const { error } = await supabaseBrowserClient.from('reward_milestones').insert({
        cafe_id: cafeId,
        name,
        days_required: days,
        reward_label: reward,
        shield_grant_amount: shields,
        ...gamificationPayload(input.icon_type, input.discount_percentage),
        claim_limit: input.claim_limit ?? defaultClaimLimit(days),
        reactivate_after_inactivity_days:
          input.claim_limit === 'once_per_lifetime'
            ? (input.reactivate_after_inactivity_days ?? null)
            : null,
        sort_order: nextOrder,
        active: input.active,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      toast.success(t('hq.rewards.toast.added'))
    },
    onError: (err: unknown) => {
      const raw = (err as { message?: string } | null)?.message ?? ''
      if (raw === 'invalid_name') toast.error(t('hq.rewards.toast.errInvalidName'))
      else if (raw.includes('reward_milestones_cafe_name_uidx') || raw.includes('duplicate key'))
        toast.error(t('hq.rewards.toast.errDuplicate'))
      else if (raw.includes('reward_milestones_days_chk')) toast.error(t('hq.rewards.toast.errDays'))
      else toast.error(t('hq.rewards.toast.errGeneric'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (input: DraftMilestone & { id: string }) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const name = sanitizeName(input.name)
      if (name.length < 2) throw new Error('invalid_name')
      const days = clampDays(input.days_required)
      const reward = sanitizeReward(input.reward_label) || null
      const shields = clampShieldGrant(input.shield_grant_amount)
      const { error } = await supabaseBrowserClient
        .from('reward_milestones')
        .update({
          name,
          days_required: days,
          reward_label: reward,
          shield_grant_amount: shields,
          ...gamificationPayload(input.icon_type, input.discount_percentage),
          claim_limit: input.claim_limit ?? defaultClaimLimit(days),
          reactivate_after_inactivity_days:
            input.claim_limit === 'once_per_lifetime'
              ? (input.reactivate_after_inactivity_days ?? null)
              : null,
          active: input.active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.id)
        .eq('cafe_id', cafeId!)
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      toast.success(t('hq.rewards.toast.saved'))
    },
    onError: (err: unknown) => {
      const raw = (err as { message?: string } | null)?.message ?? ''
      if (raw === 'invalid_name') toast.error(t('hq.rewards.toast.errInvalidName'))
      else if (raw.includes('reward_milestones_cafe_name_uidx') || raw.includes('duplicate key'))
        toast.error(t('hq.rewards.toast.errDuplicate'))
      else if (raw.includes('reward_milestones_days_chk')) toast.error(t('hq.rewards.toast.errDays'))
      else toast.error(t('hq.rewards.toast.errGeneric'))
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      if (!supabaseBrowserClient || !cafeId) throw new Error('no_client')
      const { error } = await supabaseBrowserClient
        .from('reward_milestones')
        .update({ active: next, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('cafe_id', cafeId)
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
    },
    onError: () => toast.error(t('hq.rewards.toast.errGeneric')),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!supabaseBrowserClient || !cafeId) throw new Error('no_client')
      const { error } = await supabaseBrowserClient
        .from('reward_milestones')
        .delete()
        .eq('id', id)
        .eq('cafe_id', cafeId)
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      toast.success(t('hq.rewards.toast.deleted'))
    },
    onError: () => toast.error(t('hq.rewards.toast.errGeneric')),
  })

  const swapOrderMutation = useMutation({
    mutationFn: async ({ a, b }: { a: MilestoneRow; b: MilestoneRow }) => {
      if (!supabaseBrowserClient || !cafeId) throw new Error('no_client')
      const [aOrder, bOrder] = [a.sort_order, b.sort_order]
      const { error: e1 } = await supabaseBrowserClient
        .from('reward_milestones')
        .update({ sort_order: bOrder, updated_at: new Date().toISOString() })
        .eq('id', a.id)
        .eq('cafe_id', cafeId)
      if (e1) throw e1
      const { error: e2 } = await supabaseBrowserClient
        .from('reward_milestones')
        .update({ sort_order: aOrder, updated_at: new Date().toISOString() })
        .eq('id', b.id)
        .eq('cafe_id', cafeId)
      if (e2) throw e2
    },
    onSuccess: async () => {
      await invalidate()
    },
    onError: () => toast.error(t('hq.rewards.toast.errGeneric')),
  })

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!supabaseBrowserClient || !cafeId) throw new Error('no_client')
      const { error } = await supabaseBrowserClient.rpc('seed_default_reward_milestones', {
        p_cafe_id: cafeId,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      toast.success(t('hq.rewards.toast.resetOk'))
    },
    onError: () => toast.error(t('hq.rewards.toast.errGeneric')),
  })

  const insights = useMemo(() => {
    const cards: Array<{
      id: string
      tone: 'success' | 'warning' | 'info'
      titleKey: string
      bodyKey: string
      action: 'journey' | 'milestone' | 'reward' | 'recovery'
      milestoneId?: string
      count?: number
    }> = []

    const first = sorted.find((m) => m.active)
    if (first && first.days_required >= 10) {
      cards.push({
        id: 'slow-first',
        tone: 'warning',
        titleKey: 'hq.loyalty.insightSlowTitle',
        bodyKey: 'hq.loyalty.insightSlowBody',
        action: 'journey',
        milestoneId: first.id,
        count: first.days_required,
      })
    }

    const redemptions = redemptionQuery.data
    if (redemptions && redemptions.size > 0) {
      let topId: string | null = null
      let topCount = 0
      for (const [id, c] of redemptions) {
        if (c > topCount) {
          topCount = c
          topId = id
        }
      }
      const top = sorted.find((m) => m.id === topId)
      if (top && topCount > 0) {
        cards.push({
          id: 'top-reward',
          tone: 'success',
          titleKey: 'hq.loyalty.insightTopRewardTitle',
          bodyKey: 'hq.loyalty.insightTopRewardBody',
          action: 'reward',
          milestoneId: top.id,
          count: topCount,
        })
      }
    }

    const shieldHeavy = sorted.find((m) => m.active && m.shield_grant_amount > 0 && m.days_required >= 5)
    if (shieldHeavy) {
      cards.push({
        id: 'shields',
        tone: 'info',
        titleKey: 'hq.loyalty.insightShieldTitle',
        bodyKey: 'hq.loyalty.insightShieldBody',
        action: 'recovery',
        milestoneId: shieldHeavy.id,
        count: shieldHeavy.shield_grant_amount,
      })
    }

    // TODO: Requires backend support for milestone drop-off analytics.
    if (cards.length === 0 && sorted.length > 0) {
      cards.push({
        id: 'healthy',
        tone: 'success',
        titleKey: 'hq.loyalty.insightHealthyTitle',
        bodyKey: 'hq.loyalty.insightHealthyBody',
        action: 'journey',
      })
    }

    return cards.slice(0, 4)
  }, [sorted, redemptionQuery.data])

  return {
    sorted,
    isLoading: milestonesQuery.isLoading || graceQuery.isLoading,
    isError: milestonesQuery.isError,
    graceDays: graceQuery.data?.graceDays ?? [],
    policy: graceQuery.data?.policy ?? { shield_every: null, max_shields: null },
    redemptions: redemptionQuery.data ?? new Map<string, number>(),
    insights,
    addMutation,
    updateMutation,
    toggleActiveMutation,
    deleteMutation,
    swapOrderMutation,
    resetMutation,
    emptyDraft,
    refetch: invalidate,
  }
}
