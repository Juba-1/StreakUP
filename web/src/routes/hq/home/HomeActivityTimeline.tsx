import { motion, useReducedMotion } from 'framer-motion'
import { Flame, Gift, Shield, UserPlus, Zap } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { HomeActivityItem } from '@/routes/hq/home/useHqHomeDashboard'
import { cn } from '@/lib/utils'

type Props = {
  items: HomeActivityItem[]
  empty: boolean
}

const kindMeta = {
  streak: {
    Icon: Flame,
    dot: 'bg-[color-mix(in_oklab,var(--brand-primary)_80%,white)]',
  },
  reward: { Icon: Gift, dot: 'bg-emerald-500' },
  joined: { Icon: UserPlus, dot: 'bg-sky-500' },
  shield: { Icon: Shield, dot: 'bg-orange-500' },
  broken: { Icon: Zap, dot: 'bg-rose-500' },
} as const

function formatTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso.slice(11, 16)
  }
}

function activityText(
  t: (k: string) => string,
  item: HomeActivityItem,
): { headline: string; sub?: string } {
  switch (item.kind) {
    case 'streak':
      return {
        headline: t('hq.home.actStreak')
          .replace('{name}', item.title)
          .replace('{n}', item.detail ?? '—'),
      }
    case 'reward':
      return {
        headline: t('hq.home.actReward').replace('{name}', item.title),
        sub: item.detail,
      }
    case 'joined':
      return { headline: t('hq.home.actJoined').replace('{name}', item.title) }
    case 'shield':
      return { headline: t('hq.home.actShield').replace('{name}', item.title) }
    case 'broken':
      return { headline: t('hq.home.actBroken').replace('{name}', item.title) }
    default:
      return { headline: item.title }
  }
}

export function HomeActivityTimeline({ items, empty }: Props) {
  const { t, locale } = useI18n()
  const reduce = useReducedMotion()

  return (
    <section
      className="flex h-[380px] flex-col rounded-2xl border border-white/10 bg-zinc-950/60 p-4 backdrop-blur-sm sm:h-[420px] sm:p-5"
      aria-label={t('hq.home.activityAria')}
    >
      <h3 className="shrink-0 text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">
        {t('hq.home.activityHeading')}
      </h3>

      {empty || items.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 text-center">
          <div className="grid size-11 place-items-center rounded-full border border-white/10 bg-white/5 text-[var(--brand-secondary)]">
            <Flame className="size-5" aria-hidden />
          </div>
          <p className="text-sm font-semibold text-white">{t('hq.home.activityEmptyTitle')}</p>
          <p className="max-w-xs text-xs text-white/45">{t('hq.home.activityEmptyBody')}</p>
        </div>
      ) : (
        <ScrollArea className="mt-3 min-h-0 flex-1 pe-2">
          <ol className="relative space-y-0 pe-1">
            {items.map((item, i) => {
              const meta = kindMeta[item.kind]
              const copy = activityText(t, item)
              return (
                <motion.li
                  key={item.id}
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i, 6) * 0.02 }}
                  className="relative flex gap-3 pb-4 last:pb-1"
                >
                  {i < items.length - 1 ? (
                    <span
                      className="absolute top-10 bottom-0 start-[1.15rem] w-px bg-white/10"
                      aria-hidden
                    />
                  ) : null}
                  <div
                    className={cn(
                      'relative z-10 grid size-9 min-h-9 min-w-9 place-items-center rounded-full ring-4 ring-zinc-950',
                      meta.dot,
                    )}
                  >
                    <meta.Icon className="size-3.5 text-black" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-white">{copy.headline}</p>
                      <time
                        dateTime={item.at}
                        className="text-[11px] font-medium tabular-nums text-white/40"
                      >
                        {formatTime(item.at, locale)}
                      </time>
                    </div>
                    {copy.sub ? <p className="mt-0.5 text-[11px] text-white/45">{copy.sub}</p> : null}
                  </div>
                </motion.li>
              )
            })}
          </ol>
        </ScrollArea>
      )}
    </section>
  )
}
