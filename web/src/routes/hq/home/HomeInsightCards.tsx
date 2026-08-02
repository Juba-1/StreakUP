import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Flame, TrendingUp, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { HomeInsight } from '@/routes/hq/home/useHqHomeDashboard'
import { cn } from '@/lib/utils'

type Props = {
  insights: HomeInsight[]
  slug: string
  onRemind: () => void
}

const toneStyles = {
  success: {
    wrap: 'border-emerald-500/20 bg-emerald-500/10',
    icon: 'bg-emerald-500/15 text-emerald-300',
    Icon: Flame,
  },
  warning: {
    wrap: 'border-orange-500/20 bg-orange-500/10',
    icon: 'bg-orange-500/15 text-orange-300',
    Icon: Users,
  },
  info: {
    wrap: 'border-white/10 bg-white/[0.04]',
    icon: 'bg-[color-mix(in_oklab,var(--brand-primary)_18%,transparent)] text-[var(--brand-secondary)]',
    Icon: TrendingUp,
  },
} as const

function insightCopy(
  t: (k: string) => string,
  insight: HomeInsight,
): { title: string; body: string } {
  const n = insight.description
  switch (insight.title) {
    case 'nearReward':
      return {
        title: t('hq.home.insightNearTitle').replace('{n}', n),
        body: t('hq.home.insightNearBody'),
      }
    case 'broken':
      return {
        title: t('hq.home.insightBrokenTitle').replace('{n}', n),
        body: t('hq.home.insightBrokenBody'),
      }
    case 'retentionUp':
      return {
        title: t('hq.home.insightRetUpTitle').replace('{n}', n),
        body: t('hq.home.insightRetUpBody'),
      }
    case 'retentionDown':
      return {
        title: t('hq.home.insightRetDownTitle').replace('{n}', n),
        body: t('hq.home.insightRetDownBody'),
      }
    case 'retentionSteady':
      return {
        title: t('hq.home.insightRetSteadyTitle').replace('{n}', n),
        body: t('hq.home.insightRetSteadyBody'),
      }
    case 'visitsOk':
      return {
        title: t('hq.home.insightVisitsTitle').replace('{n}', n),
        body: t('hq.home.insightVisitsBody'),
      }
    default:
      return { title: insight.title, body: insight.description }
  }
}

export function HomeInsightCards({ insights, slug, onRemind }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  // TODO(backend): When branch-level performance metrics are available from an existing
  // RPC/field (e.g. weakest branch by visits), add a dedicated insight card here.
  // Do not invent SQL/RPC for this — keep the card empty until real data exists.

  if (insights.length === 0) {
    return (
      <section aria-label={t('hq.home.insightsAria')}>
        <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-4 py-6 text-center">
          <p className="text-sm font-medium text-white/70">{t('hq.home.insightsEmptyTitle')}</p>
          <p className="mt-1 text-xs text-white/40">{t('hq.home.insightsEmptyBody')}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-3" aria-label={t('hq.home.insightsAria')}>
      <h3 className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">
        {t('hq.home.insightsHeading')}
      </h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {insights.map((insight, i) => {
          const style = toneStyles[insight.tone]
          const Icon = style.Icon
          const copy = insightCopy(t, insight)
          return (
            <motion.article
              key={insight.id}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.03 }}
              className={cn(
                'flex flex-col gap-3 rounded-2xl border p-4 backdrop-blur-sm',
                style.wrap,
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'grid size-10 min-h-10 min-w-10 place-items-center rounded-xl',
                    style.icon,
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 space-y-1">
                  <h4 className="text-sm font-semibold leading-snug text-white">{copy.title}</h4>
                  <p className="text-xs leading-relaxed text-white/55">{copy.body}</p>
                </div>
              </div>
              {insight.action === 'remind' ? (
                <button
                  type="button"
                  onClick={onRemind}
                  className="inline-flex h-10 min-h-10 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-3 text-xs font-semibold text-black transition-transform duration-200 hover:scale-[1.02]"
                >
                  {t('hq.home.sendReminder')}
                  <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
                </button>
              ) : null}
              {insight.action === 'customers' ? (
                <Link
                  to={`/hq/${slug}/customers`}
                  className={cn(
                    buttonVariants({ variant: 'secondary' }),
                    'inline-flex h-10 min-h-10 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 text-xs text-white transition-transform duration-200 hover:scale-[1.02] hover:bg-white/10',
                  )}
                >
                  {t('hq.home.viewCustomers')}
                  <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
                </Link>
              ) : null}
            </motion.article>
          )
        })}
      </div>
    </section>
  )
}
