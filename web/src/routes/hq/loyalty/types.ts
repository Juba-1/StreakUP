import type { MilestoneIconType } from '@/lib/milestone-icons'

export type FulfillmentType = 'physical' | 'digital_shield'
export type ClaimLimit = 'once_per_lifetime' | 'every_streak_cycle'

export type MilestoneRow = {
  id: string
  cafe_id: string
  name: string
  days_required: number
  reward_label: string | null
  shield_grant_amount: number
  icon_type: string
  discount_percentage: number | null
  fulfillment_type: FulfillmentType
  claim_limit: ClaimLimit
  reactivate_after_inactivity_days?: number | null
  sort_order: number
  active: boolean
}

export type DraftMilestone = {
  id?: string
  name: string
  days_required: number
  reward_label: string
  shield_grant_amount: number
  icon_type: MilestoneIconType
  discount_percentage: number | null
  claim_limit: ClaimLimit
  reactivate_after_inactivity_days?: number | null
  active: boolean
}

export type CafeShieldPolicy = {
  shield_every: number | null
  max_shields: number | null
}

export const MIN_DAYS = 1
export const MAX_DAYS = 365
export const MAX_NAME = 40
export const MAX_REWARD = 80
export const SHIELD_GRANT_OPTIONS = [0, 1, 2, 3, 5] as const

export function defaultClaimLimit(days: number): ClaimLimit {
  return days <= 14 ? 'once_per_lifetime' : 'every_streak_cycle'
}

export function clampShieldGrant(n: number) {
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(10, Math.round(n))
}

export function clampDiscount(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null
  const v = Math.round(n)
  if (v < 1 || v > 100) return null
  return v
}

export function clampDays(n: number) {
  if (!Number.isFinite(n)) return MIN_DAYS
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(n)))
}

export function sanitizeName(n: string) {
  return n.trim().slice(0, MAX_NAME)
}

export function sanitizeReward(n: string) {
  return n.trim().slice(0, MAX_REWARD)
}

export function resolveFulfillment(icon_type: MilestoneIconType): FulfillmentType {
  return icon_type === 'shield' ? 'digital_shield' : 'physical'
}

export function gamificationPayload(icon_type: MilestoneIconType, discount_percentage: number | null) {
  return {
    icon_type,
    discount_percentage: icon_type === 'discount' ? clampDiscount(discount_percentage) : null,
    fulfillment_type: resolveFulfillment(icon_type),
  }
}

export function emptyDraft(): DraftMilestone {
  return {
    name: '',
    days_required: 7,
    reward_label: '',
    shield_grant_amount: 0,
    icon_type: 'gift',
    discount_percentage: null,
    claim_limit: 'once_per_lifetime',
    reactivate_after_inactivity_days: null,
    active: true,
  }
}

export function rowToDraft(m: MilestoneRow): DraftMilestone {
  return {
    id: m.id,
    name: m.name,
    days_required: m.days_required,
    reward_label: m.reward_label ?? '',
    shield_grant_amount: m.shield_grant_amount ?? 0,
    icon_type: (m.icon_type as MilestoneIconType) || 'gift',
    discount_percentage: m.discount_percentage,
    claim_limit: m.claim_limit ?? defaultClaimLimit(m.days_required),
    reactivate_after_inactivity_days: m.reactivate_after_inactivity_days ?? null,
    active: m.active,
  }
}
