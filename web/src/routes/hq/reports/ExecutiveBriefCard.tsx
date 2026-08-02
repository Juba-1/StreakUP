import { ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { ExecutiveBrief, InsightAction } from '@/routes/hq/reports/types'

type Props = {
  loading?: boolean
  periodLabel: string
  brief: ExecutiveBrief | null
  advanced: boolean
  onAction: (action: InsightAction) => void
}

/** Primary executive component — what happened, why, what next. */
export function ExecutiveBriefCard({ loading, periodLabel, brief, advanced, onAction }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  if (loading) {
    return <Skeleton className="h-44 w-full rounded-2xl bg-white/10" />
  }

  if (!advanced) {
    return (
      <section className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center">
        <p className="text-sm font-medium text-white">{t('hq.reports.upgradeStoryTitle')}</p>
        <p className="mt-1 text-xs text-white/40">{t('hq.reports.upgradeStoryBody')}</p>
      </section>
    )
  }

  if (!brief || (brief.bullets.length === 0 && !brief.recommendationKey)) {
    return (
      <section
        aria-label={t('hq.reports.storyAria')}
        className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center"
      >
        <p className="text-sm font-medium text-white">{t('hq.reports.briefEmptyTitle')}</p>
        <p className="mt-1 text-xs text-white/40">{t('hq.reports.briefEmptyBody')}</p>
      </section>
    )
  }

  return (
    <motion.section
      aria-label={t('hq.reports.storyAria')}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/10 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--brand-primary)_10%,transparent),transparent_55%),rgb(9_9_11_/_0.65)] p-5 backdrop-blur-xl md:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-white/35 uppercase">
            {t('hq.reports.briefHeading')}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">{t('hq.reports.briefTitle')}</h2>
        </div>
        <p className="text-[11px] text-white/40">{periodLabel}</p>
      </div>

      {brief.bullets.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {brief.bullets.map((b) => (
            <li key={b.id} className="flex gap-2 text-sm leading-relaxed text-white/75">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--brand-secondary)]" aria-hidden />
              <span>
                {t(b.textKey)
                  .replace('{n}', String(b.n ?? ''))
                  .replace('{name}', b.name ?? '')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {brief.recommendationKey ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-white/35 uppercase">
              {t('hq.reports.briefRecLabel')}
            </p>
            <p className="mt-1 text-sm text-white/85">{t(brief.recommendationKey)}</p>
          </div>
          {brief.cta ? (
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] font-semibold text-black"
              onClick={() => onAction(brief.cta!)}
            >
              {t('hq.reports.briefCta')}
              <ArrowRight className="size-3.5 rtl:rotate-180" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </motion.section>
  )
}
