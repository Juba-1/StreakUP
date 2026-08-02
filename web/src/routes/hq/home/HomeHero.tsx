import { motion, useReducedMotion } from 'framer-motion'
import { BarChart3, Bell } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button, buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

type Props = {
  greeting: 'morning' | 'afternoon' | 'evening'
  cafeName: string
  visitsToday: number
  trendPct: number | null
  slug: string
  onRemind: () => void
}

export function HomeHero({ greeting, cafeName, visitsToday, trendPct, slug, onRemind }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  const greetKey =
    greeting === 'morning'
      ? 'hq.home.greetMorning'
      : greeting === 'afternoon'
        ? 'hq.home.greetAfternoon'
        : 'hq.home.greetEvening'

  const trendLabel =
    trendPct == null
      ? t('hq.home.trendNone')
      : trendPct >= 0
        ? t('hq.home.trendUp').replace('{n}', String(trendPct))
        : t('hq.home.trendDown').replace('{n}', String(Math.abs(trendPct)))

  const tone =
    visitsToday === 0
      ? t('hq.home.heroQuiet')
      : (trendPct ?? 0) >= 0
        ? t('hq.home.heroGood')
        : t('hq.home.heroSoft')

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="relative flex min-h-[200px] max-h-[240px] flex-col justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-5 backdrop-blur-xl sm:p-6"
      aria-label={t('hq.home.heroAria')}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            'radial-gradient(70% 80% at 100% 0%, color-mix(in oklab, var(--brand-primary) 18%, transparent), transparent 55%)',
        }}
        aria-hidden
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-white/45">
            {t(greetKey)}
            {cafeName ? ` · ${cafeName}` : ''}
          </p>
          <h2 className="text-lg font-semibold tracking-tight text-white sm:text-xl">{tone}</h2>
          <div className="flex flex-wrap items-end gap-3 pt-0.5">
            <p className="text-4xl font-bold tabular-nums tracking-tight text-white sm:text-5xl">
              {visitsToday}
            </p>
            <div className="pb-1">
              <p className="text-xs font-medium text-white/55">{t('hq.home.visitsToday')}</p>
              <p
                className={cn(
                  'text-xs font-semibold',
                  trendPct == null
                    ? 'text-white/40'
                    : trendPct >= 0
                      ? 'text-emerald-400'
                      : 'text-orange-400',
                )}
              >
                {trendLabel}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch lg:flex-row">
          <Button
            type="button"
            onClick={onRemind}
            className="h-11 min-h-11 gap-2 rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-4 font-semibold text-black transition-transform duration-200 hover:scale-[1.02] hover:opacity-95"
            aria-label={t('hq.home.sendReminder')}
          >
            <Bell className="size-4" aria-hidden />
            {t('hq.home.sendReminder')}
          </Button>
          <Link
            to={`/hq/${slug}/analytics`}
            className={cn(
              buttonVariants({ variant: 'secondary' }),
              'inline-flex h-11 min-h-11 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 px-4 text-white transition-transform duration-200 hover:scale-[1.02] hover:bg-white/10',
            )}
            aria-label={t('hq.home.openReports')}
          >
            <BarChart3 className="size-4" aria-hidden />
            {t('hq.home.openReports')}
          </Link>
        </div>
      </div>
    </motion.section>
  )
}
