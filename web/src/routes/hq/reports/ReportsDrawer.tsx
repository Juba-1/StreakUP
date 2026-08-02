import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useI18n } from '@/core/i18n/I18nProvider'
import { MilestoneIconGlyph, normalizeIconType } from '@/lib/milestone-icons'
import { MiniSparkline } from '@/routes/hq/home/MiniSparkline'
import type {
  BranchTotal,
  BreakdownRow,
  DrawerKind,
  OwnerMetrics,
  RankedBranch,
} from '@/routes/hq/reports/types'

type Props = {
  kind: DrawerKind
  onClose: () => void
  owner?: OwnerMetrics
  retPct: number | null
  returning: number
  totalCustomers: number
  checkIns: number
  claimed: BreakdownRow[]
  ready: BreakdownRow[]
  sparkVisits: number[]
  rankedBranches: RankedBranch[]
  branch: BranchTotal | null
  momentum: number | null
}

export function ReportsDrawer({
  kind,
  onClose,
  owner,
  retPct,
  returning,
  totalCustomers,
  checkIns,
  claimed,
  ready,
  sparkVisits,
  rankedBranches,
  branch,
  momentum,
}: Props) {
  const { t } = useI18n()
  const open = kind != null
  const best = rankedBranches[0] ?? null
  const worst =
    rankedBranches.length > 1 ? rankedBranches[rankedBranches.length - 1]! : null

  const title =
    kind === 'retention'
      ? t('hq.reports.drawer.retention')
      : kind === 'returning'
        ? t('hq.reports.drawer.returning')
        : kind === 'rewards'
          ? t('hq.reports.drawer.rewards')
          : kind === 'branch'
            ? t('hq.reports.drawer.branch')
            : kind === 'roi'
              ? t('hq.reports.drawer.roi')
              : kind === 'visits'
                ? t('hq.reports.drawer.visits')
                : ''

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 border-white/10 bg-zinc-950 p-0 text-white sm:max-w-md"
      >
        <SheetHeader className="shrink-0 border-b border-white/8 px-4 pt-4 pb-3 text-start">
          <SheetTitle className="text-white">{title}</SheetTitle>
          <SheetDescription className="text-white/40">
            {kind === 'branch' && branch
              ? branch.name || branch.branch_code
              : t('hq.reports.drawer.subtitle')}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-4 py-4">
            {kind && kind !== 'roi' && kind !== 'branch' ? (
              <>
                <section>
                  <p className="mb-2 text-[10px] font-semibold tracking-wide text-white/35 uppercase">
                    {t('hq.reports.drawer.trend')}
                  </p>
                  {sparkVisits.length > 1 ? (
                    <div className="rounded-xl border border-white/8 bg-black/25 px-3 py-3">
                      <MiniSparkline
                        values={sparkVisits}
                        className="w-full text-[var(--brand-primary)]"
                        aria-hidden
                      />
                      <p className="mt-2 text-[11px] text-white/40">
                        {momentum == null
                          ? t('hq.reports.trendNone')
                          : momentum >= 0
                            ? t('hq.reports.drawer.momentumUp').replace('{n}', String(momentum))
                            : t('hq.reports.drawer.momentumDown').replace(
                                '{n}',
                                String(Math.abs(momentum)),
                              )}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-white/35">{t('hq.reports.trendEmpty')}</p>
                  )}
                </section>

                <section>
                  <p className="mb-2 text-[10px] font-semibold tracking-wide text-white/35 uppercase">
                    {t('hq.reports.drawer.keyNumbers')}
                  </p>
                  <dl className="grid grid-cols-2 gap-2">
                    {kind === 'retention' || kind === 'returning' ? (
                      <>
                        <Cell
                          label={t('hq.reports.kpiRetention')}
                          value={retPct == null ? '—' : `${retPct}%`}
                        />
                        <Cell label={t('hq.reports.kpiReturning')} value={String(returning)} />
                        <Cell
                          label={t('hq.reports.deep.totalCustomers')}
                          value={String(totalCustomers)}
                        />
                        <Cell
                          label={t('hq.owner.metricLost')}
                          value={String(owner?.broken_streaks_this_week ?? 0)}
                        />
                      </>
                    ) : null}
                    {kind === 'visits' ? (
                      <>
                        <Cell label={t('hq.reports.deep.checkIns')} value={String(checkIns)} />
                        <Cell label={t('hq.reports.kpiReturning')} value={String(returning)} />
                        <Cell
                          label={t('hq.owner.metricActive')}
                          value={String(owner?.active_streaks_now ?? 0)}
                        />
                        <Cell
                          label={t('hq.owner.metricShield')}
                          value={String(owner?.shield_saves ?? 0)}
                        />
                      </>
                    ) : null}
                    {kind === 'rewards' ? (
                      <>
                        <Cell
                          label={t('hq.reports.kpiRewards')}
                          value={String(owner?.rewards_claimed_total ?? 0)}
                        />
                        <Cell
                          label={t('hq.owner.pendingLabel')}
                          value={String(owner?.rewards_ready_to_claim ?? 0)}
                        />
                      </>
                    ) : null}
                  </dl>
                </section>

                {(best || worst) && (
                  <section>
                    <p className="mb-2 text-[10px] font-semibold tracking-wide text-white/35 uppercase">
                      {t('hq.reports.drawer.branches')}
                    </p>
                    <div className="space-y-2">
                      {best ? (
                        <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-3 py-2">
                          <p className="text-[10px] text-emerald-200/60">
                            {t('hq.reports.drawer.topBranch')}
                          </p>
                          <p className="text-sm font-medium text-white">
                            {best.name || best.branch_code}
                          </p>
                        </div>
                      ) : null}
                      {worst && best && worst.branch_id !== best.branch_id ? (
                        <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-3 py-2">
                          <p className="text-[10px] text-amber-200/60">
                            {t('hq.reports.drawer.worstBranch')}
                          </p>
                          <p className="text-sm font-medium text-white">
                            {worst.name || worst.branch_code}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </section>
                )}
              </>
            ) : null}

            {kind === 'rewards' ? (
              <section>
                <p className="mb-2 text-[10px] font-semibold tracking-wide text-white/35 uppercase">
                  {t('hq.reports.drawer.timeline')}
                </p>
                <ul className="space-y-1.5">
                  {claimed.map((r) => (
                    <li
                      key={r.label}
                      className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-3 py-2"
                    >
                      <MilestoneIconGlyph
                        iconType={normalizeIconType(r.icon_type)}
                        className="text-[var(--brand-primary)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-white">{r.label}</span>
                      <span className="tabular-nums text-sm font-semibold text-white">{r.count}</span>
                    </li>
                  ))}
                  {claimed.length === 0 ? (
                    <p className="py-4 text-center text-xs text-white/35">{t('hq.owner.costEmpty')}</p>
                  ) : null}
                </ul>
                {ready.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {ready.map((r) => (
                      <li
                        key={`ready-${r.label}`}
                        className="flex justify-between rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm"
                      >
                        <span className="truncate text-amber-50/90">{r.label}</span>
                        <span className="tabular-nums font-semibold text-amber-100">{r.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {kind === 'branch' && branch ? (
              <dl className="grid grid-cols-2 gap-2">
                <Cell label={t('hq.reports.branchVisits')} value={String(branch.visits)} />
                <Cell label={t('hq.reports.branchPeople')} value={String(branch.unique_customers)} />
                <Cell label={t('hq.reports.branchCode')} value={branch.branch_code} />
              </dl>
            ) : null}

            {kind === 'roi' ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-white">{t('hq.reports.kpiRoiPos')}</p>
                <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-xs leading-relaxed text-white/45">
                  {t('hq.reports.roiDrawerBody')}
                </p>
                {/* TODO: Requires POS Integration — never invent revenue / ROI. */}
              </div>
            ) : null}

            {kind && kind !== 'roi' ? (
              <section>
                <p className="mb-2 text-[10px] font-semibold tracking-wide text-white/35 uppercase">
                  {t('hq.reports.drawer.observations')}
                </p>
                <p className="text-xs leading-relaxed text-white/45">
                  {kind === 'returning'
                    ? t('hq.reports.drawer.returningHint')
                    : t('hq.reports.drawer.obsGeneric')}
                </p>
              </section>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/30 px-3 py-2">
      <p className="text-[10px] text-white/40">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-white">{value}</p>
    </div>
  )
}
