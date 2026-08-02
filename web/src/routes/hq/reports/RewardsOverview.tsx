import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { BreakdownRow } from '@/routes/hq/reports/types'

const COLORS = [
  'var(--brand-primary)',
  'var(--brand-secondary)',
  'var(--brand-accent)',
  'color-mix(in oklab, var(--brand-primary) 55%, white)',
  'color-mix(in oklab, var(--brand-secondary) 55%, white)',
  'color-mix(in oklab, var(--brand-accent) 60%, white)',
]

type Props = {
  loading?: boolean
  claimed: BreakdownRow[]
  claimedTotal: number
  readyTotal: number
  redemptionRate: number | null
  onOpen?: () => void
}

export function RewardsOverview({
  loading,
  claimed,
  claimedTotal,
  readyTotal,
  redemptionRate,
  onOpen,
}: Props) {
  const { t } = useI18n()

  if (loading) {
    return <Skeleton className="h-[340px] w-full rounded-2xl bg-white/10" />
  }

  const pieData = claimed
    .filter((r) => r.count > 0)
    .slice(0, 6)
    .map((r) => ({ name: r.label, value: r.count }))

  const stats = [
    { label: t('hq.reports.rewards.claimed'), value: String(claimedTotal) },
    { label: t('hq.reports.rewards.ready'), value: String(readyTotal) },
    {
      label: t('hq.reports.rewards.rate'),
      value: redemptionRate == null ? '—' : `${redemptionRate}%`,
    },
  ]

  return (
    <section
      aria-label={t('hq.reports.rewardsAria')}
      className="flex h-full flex-col rounded-2xl border border-white/10 bg-zinc-950/55 p-5 backdrop-blur-xl"
    >
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-white">{t('hq.reports.rewardsTitle')}</h2>
        <p className="mt-0.5 text-xs text-white/40">{t('hq.reports.rewardsBody')}</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-white/8 bg-black/30 px-2.5 py-2">
            <p className="text-[10px] text-white/40">{s.label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 min-h-0 flex-1">
        {pieData.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center text-center text-xs text-white/35">
            {t('hq.reports.rewardsEmpty')}
          </div>
        ) : (
          <button type="button" className="h-full w-full" onClick={onOpen}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={2}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#0a0a0a',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <p className="text-center text-[11px] text-white/40">
              {t('hq.reports.rewardsCenter').replace('{n}', String(claimedTotal))}
            </p>
          </button>
        )}
      </div>
    </section>
  )
}
