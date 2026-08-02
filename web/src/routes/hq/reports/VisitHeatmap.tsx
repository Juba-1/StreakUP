import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { HeatCell } from '@/routes/hq/reports/types'
import { cn } from '@/lib/utils'

type Props = {
  loading?: boolean
  cells: HeatCell[]
}

/** Hours shown in the grid (cafe daytime focus). */
const HOURS = [8, 10, 12, 14, 16, 18, 20, 22]
/** Sat→Fri order common in GCC calendars, but values are JS getDay(). */
const DOW_ORDER = [6, 0, 1, 2, 3, 4, 5]

export function VisitHeatmap({ loading, cells }: Props) {
  const { t } = useI18n()

  if (loading) {
    return <Skeleton className="h-[280px] w-full rounded-2xl bg-white/10" />
  }

  const max = Math.max(1, ...cells.map((c) => c.count))
  const lookup = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c.count]))

  const intensity = (count: number) => {
    if (count <= 0) return 'bg-white/[0.03]'
    const r = count / max
    if (r > 0.75) return 'bg-violet-500/80'
    if (r > 0.5) return 'bg-violet-500/55'
    if (r > 0.25) return 'bg-violet-500/35'
    return 'bg-violet-500/18'
  }

  return (
    <section
      aria-label={t('hq.reports.heatmapAria')}
      className="rounded-2xl border border-white/10 bg-zinc-950/55 p-5 backdrop-blur-xl"
    >
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-white">{t('hq.reports.heatmapTitle')}</h2>
        <p className="mt-0.5 text-xs text-white/40">{t('hq.reports.heatmapBody')}</p>
      </div>

      {cells.length === 0 ? (
        <p className="py-10 text-center text-xs text-white/35">{t('hq.reports.heatmapEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[320px]">
            <div
              className="mb-1 grid gap-1"
              style={{ gridTemplateColumns: `44px repeat(${HOURS.length}, minmax(0, 1fr))` }}
            >
              <span />
              {HOURS.map((h) => (
                <span key={h} className="text-center text-[10px] text-white/45 tabular-nums">
                  {h}
                </span>
              ))}
            </div>
            <div className="space-y-1">
              {DOW_ORDER.map((dow) => (
                <div
                  key={dow}
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `44px repeat(${HOURS.length}, minmax(0, 1fr))` }}
                >
                  <span className="flex items-center text-[10px] text-white/45">
                    {t(`hq.reports.dow.${dow}`)}
                  </span>
                  {HOURS.map((hour) => {
                    const count = lookup.get(`${dow}:${hour}`) ?? 0
                    return (
                      <div
                        key={`${dow}-${hour}`}
                        title={`${count}`}
                        className={cn(
                          'aspect-square rounded-md transition',
                          intensity(count),
                        )}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
