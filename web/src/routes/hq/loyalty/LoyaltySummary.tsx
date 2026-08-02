import { Flame, Gift, Map, Shield, Sparkles } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'
import type { CafeShieldPolicy, MilestoneRow } from '@/routes/hq/loyalty/types'

type Props = {
  milestones: MilestoneRow[]
  graceDays: number[]
  policy: CafeShieldPolicy
}

export function LoyaltySummary({ milestones, graceDays, policy }: Props) {
  const { t } = useI18n()
  const active = milestones.filter((m) => m.active)
  const rewards = active.filter((m) => Boolean(m.reward_label?.trim())).length
  const maxStreak = active.reduce((max, m) => Math.max(max, m.days_required), 0)
  const shieldGrants = active.reduce((sum, m) => sum + (m.shield_grant_amount || 0), 0)

  const items = [
    { label: t('hq.loyalty.kpiMilestones'), value: active.length, Icon: Map },
    { label: t('hq.loyalty.kpiRewards'), value: rewards, Icon: Gift },
    { label: t('hq.loyalty.kpiMaxStreak'), value: maxStreak, Icon: Flame },
    { label: t('hq.loyalty.kpiGrace'), value: graceDays.length, Icon: Sparkles },
    {
      label: t('hq.loyalty.kpiShields'),
      value: policy.max_shields ?? shieldGrants,
      Icon: Shield,
    },
  ].slice(0, 5)

  return (
    <section
      aria-label={t('hq.loyalty.summaryAria')}
      className="rounded-2xl border border-white/10 bg-zinc-950/55 p-4 backdrop-blur-xl"
    >
      <h2 className="text-sm font-semibold text-white">{t('hq.loyalty.summaryTitle')}</h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl border border-white/8 bg-black/25 px-3 py-2">
            <div className="flex items-center gap-1.5 text-white/40">
              <item.Icon className="size-3" />
              <p className="text-[10px]">{item.label}</p>
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums text-white">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
