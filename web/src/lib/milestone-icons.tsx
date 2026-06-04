import {
  Coffee,
  Cookie,
  Crown,
  Flame,
  Gift,
  Percent,
  Shield,
  Snowflake,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

/** Canonical milestone icon keys — must match `reward_milestones_icon_type_chk`. */
export const MILESTONE_ICON_TYPES = [
  'coffee',
  'pastry',
  'cold_drink',
  'gift',
  'shield',
  'crown',
  'discount',
  'flame',
] as const

export type MilestoneIconType = (typeof MILESTONE_ICON_TYPES)[number]

export function normalizeIconType(raw: string | null | undefined): MilestoneIconType {
  const key = (raw ?? 'gift').toLowerCase().trim()
  if ((MILESTONE_ICON_TYPES as readonly string[]).includes(key)) {
    return key as MilestoneIconType
  }
  return 'gift'
}

export const MILESTONE_ICON_META: Record<
  MilestoneIconType,
  { Icon: LucideIcon; labelKey: string }
> = {
  coffee: { Icon: Coffee, labelKey: 'hq.rewards.icon.coffee' },
  pastry: { Icon: Cookie, labelKey: 'hq.rewards.icon.pastry' },
  cold_drink: { Icon: Snowflake, labelKey: 'hq.rewards.icon.coldDrink' },
  gift: { Icon: Gift, labelKey: 'hq.rewards.icon.gift' },
  shield: { Icon: Shield, labelKey: 'hq.rewards.icon.shield' },
  crown: { Icon: Crown, labelKey: 'hq.rewards.icon.crown' },
  discount: { Icon: Percent, labelKey: 'hq.rewards.icon.discount' },
  flame: { Icon: Flame, labelKey: 'hq.rewards.icon.flame' },
}

export function MilestoneIconGlyph({
  iconType,
  discountPercentage,
  className,
  dimmed,
}: {
  iconType: MilestoneIconType
  discountPercentage?: number | null
  className?: string
  dimmed?: boolean
}) {
  const { Icon } = MILESTONE_ICON_META[iconType]

  if (iconType === 'discount' && discountPercentage != null && discountPercentage > 0) {
    return (
      <span
        className={cn(
          'relative flex flex-col items-center justify-center leading-none',
          dimmed && 'opacity-45 grayscale',
          className,
        )}
      >
        <span className="text-lg font-bold tabular-nums tracking-tight sm:text-xl">
          {discountPercentage}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wider opacity-90">%</span>
      </span>
    )
  }

  return (
    <Icon
      className={cn('size-7 sm:size-8', dimmed && 'opacity-40 grayscale', className)}
      strokeWidth={1.75}
      aria-hidden
    />
  )
}
