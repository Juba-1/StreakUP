import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Gift, Map, RotateCcw, Shield, TrendingUp, Users } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'
import type { ActiveTab, BreakdownRow, OwnerMetrics } from '@/routes/hq/reports/types'
import { cn } from '@/lib/utils'

type Props = {
  activeTab: ActiveTab
  owner?: OwnerMetrics
  claimed: BreakdownRow[]
  ready: BreakdownRow[]
  retPct: number | null
  activeWindow: number
  totalCustomers: number
  checkIns: number
  shieldSaves: number
  showRoi: boolean
}

type PanelId = 'retention' | 'rewards' | 'visits' | 'recovery' | 'roi'

export function DeepAnalysis({
  activeTab,
  owner,
  claimed,
  ready,
  retPct,
  activeWindow,
  totalCustomers,
  checkIns,
  shieldSaves,
  showRoi,
}: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState<PanelId | null>(null)

  useEffect(() => {
    // Highlight related accordion when tab changes — stay collapsed unless user opens.
    setOpen(null)
  }, [activeTab])

  const retentionBadge =
    owner && owner.broken_streaks_this_week > 0
      ? t('hq.reports.deepBadge.alert').replace('{n}', '1')
      : retPct != null && retPct >= 40
        ? t('hq.reports.deepBadge.healthy')
        : t('hq.reports.deepBadge.watch')

  const rewardsBadge =
    claimed.length > 0
      ? t('hq.reports.deepBadge.insights').replace('{n}', String(Math.min(claimed.length, 9)))
      : t('hq.reports.deepBadge.empty')

  const visitsBadge =
    checkIns > 0 ? t('hq.reports.deepBadge.healthy') : t('hq.reports.deepBadge.empty')

  const panels: Array<{
    id: PanelId
    title: string
    badge: string
    Icon: typeof Users
    related: ActiveTab
    body: ReactNode
  }> = [
    {
      id: 'retention',
      title: t('hq.reports.deep.retention'),
      badge: retentionBadge,
      Icon: Users,
      related: 'retention',
      body: (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Stat label={t('hq.reports.kpiRetention')} value={retPct == null ? '—' : `${retPct}%`} />
          <Stat label={t('hq.reports.kpiReturning')} value={String(activeWindow)} />
          <Stat label={t('hq.reports.deep.totalCustomers')} value={String(totalCustomers)} />
          <Stat label={t('hq.owner.metricChampions')} value={String(owner?.streak_champions ?? 0)} />
        </dl>
      ),
    },
    {
      id: 'rewards',
      title: t('hq.reports.deep.rewards'),
      badge: rewardsBadge,
      Icon: Gift,
      related: 'rewards',
      body:
        claimed.length === 0 && ready.length === 0 ? (
          <p className="text-xs text-white/40">{t('hq.owner.costEmpty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {claimed.map((r) => (
              <li
                key={`c-${r.label}`}
                className="flex justify-between gap-2 rounded-lg border border-white/8 bg-black/25 px-2.5 py-1.5 text-xs"
              >
                <span className="truncate text-white/80">{r.label}</span>
                <span className="tabular-nums text-white">{r.count}</span>
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: 'visits',
      title: t('hq.reports.deep.visits'),
      badge: visitsBadge,
      Icon: RotateCcw,
      related: 'visits',
      body: (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Stat label={t('hq.reports.deep.checkIns')} value={String(checkIns)} />
          <Stat label={t('hq.owner.metricActive')} value={String(owner?.active_streaks_now ?? 0)} />
          <Stat label={t('hq.owner.metricShield')} value={String(shieldSaves)} />
          <Stat label={t('hq.owner.metricLost')} value={String(owner?.broken_streaks_this_week ?? 0)} />
        </dl>
      ),
    },
    {
      id: 'recovery',
      title: t('hq.reports.deep.recovery'),
      badge:
        shieldSaves > 0
          ? t('hq.reports.deepBadge.insights').replace('{n}', '1')
          : t('hq.reports.deepBadge.watch'),
      Icon: Shield,
      related: 'retention',
      body: (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Stat label={t('hq.owner.metricShield')} value={String(shieldSaves)} />
          <Stat
            label={t('hq.owner.metricLost')}
            value={String(owner?.broken_streaks_this_week ?? 0)}
          />
        </dl>
      ),
    },
  ]

  if (showRoi) {
    panels.push({
      id: 'roi',
      title: t('hq.reports.kpiRoi'),
      badge: t('hq.reports.deepBadge.unavailable'),
      Icon: TrendingUp,
      related: 'roi',
      body: (
        <p className="text-xs text-white/40">
          {t('hq.reports.roiDrawerBody')}
          {/* TODO: Requires POS Integration */}
        </p>
      ),
    })
  } else {
    panels.push({
      id: 'roi',
      title: t('hq.reports.deep.milestones'),
      badge: t('hq.reports.deepBadge.unavailable'),
      Icon: Map,
      related: 'visits',
      body: (
        <p className="text-xs text-white/40">
          {t('hq.reports.deep.milestonesTodo')}
          {/* TODO: Requires backend support for milestone funnel analytics. */}
        </p>
      ),
    })
  }

  return (
    <section
      id="reports-deep"
      aria-label={t('hq.reports.deepAria')}
      className="rounded-2xl border border-white/8 bg-zinc-950/45 p-5 backdrop-blur-xl"
    >
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-white">{t('hq.reports.deepTitle')}</h2>
        <p className="mt-0.5 text-xs text-white/40">{t('hq.reports.deepBody')}</p>
      </div>
      <div className="space-y-1.5">
        {panels.map((p) => {
          const isOpen = open === p.id
          const related = p.related === activeTab
          return (
            <div
              key={p.id}
              className={cn(
                'overflow-hidden rounded-xl border bg-black/20 transition',
                related ? 'border-[color-mix(in_oklab,var(--brand-primary)_28%,transparent)]' : 'border-white/8',
              )}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2.5 text-start"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : p.id)}
              >
                <p.Icon className="size-3.5 text-[var(--brand-secondary)]" aria-hidden />
                <span className="flex-1 text-sm font-medium text-white">{p.title}</span>
                <span className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/45">
                  {p.badge}
                </span>
                <ChevronDown
                  className={cn('size-4 text-white/35 transition', isOpen && 'rotate-180')}
                  aria-hidden
                />
              </button>
              {isOpen ? <div className="border-t border-white/8 px-3 py-3">{p.body}</div> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-zinc-950/50 px-2.5 py-2">
      <dt className="text-[10px] text-white/35">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-white">{value}</dd>
    </div>
  )
}
