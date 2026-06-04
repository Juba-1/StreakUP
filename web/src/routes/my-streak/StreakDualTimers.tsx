import { motion, useReducedMotion } from 'framer-motion'
import { Clock, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useI18n } from '@/core/i18n/I18nProvider'
import {
  formatCountdown,
  getStreakTimerAnchors,
  type StreakTimerAnchors,
} from '@/lib/cafe-time'
import { portalGlassPanel, portalTextMuted, portalTextPrimary } from '@/lib/portal-surfaces'
import { cn } from '@/lib/utils'

type Props = {
  timeZone: string
  visitedToday: boolean
  currentStreak: number
  nextVisitOpensAt?: string | null
  streakExpiresAt?: string | null
}

function msUntil(target: Date | null, nowMs: number): number {
  if (!target) return 0
  return target.getTime() - nowMs
}

function TimerRing({
  label,
  value,
  sublabel,
  progress,
  accent,
  openNow,
  openNowLabel,
}: {
  label: string
  value: string
  sublabel: string
  progress: number
  accent: 'primary' | 'secondary'
  openNow?: boolean
  openNowLabel?: string
}) {
  const reduceMotion = useReducedMotion()
  const r = 46
  const c = 2 * Math.PI * r
  const dash = c * (1 - Math.min(1, Math.max(0, progress)))
  const stroke =
    accent === 'primary' ? 'var(--brand-primary)' : 'var(--brand-secondary)'

  return (
    <article
      className={cn(
        portalGlassPanel,
        'rounded-[1.5rem] p-5 transition',
        accent === 'primary'
          ? 'shadow-[0_28px_80px_-50px_var(--brand-glow)]'
          : 'shadow-[0_24px_70px_-55px_var(--brand-glow)]',
      )}
      style={{
        background:
          accent === 'primary'
            ? 'linear-gradient(145deg, color-mix(in oklab, var(--brand-primary) 14%, white), color-mix(in oklab, var(--brand-secondary) 8%, white))'
            : 'linear-gradient(145deg, color-mix(in oklab, var(--brand-secondary) 12%, white), color-mix(in oklab, var(--brand-primary) 6%, white))',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            accent === 'primary'
              ? 'radial-gradient(75% 65% at 0% 0%, color-mix(in oklab, var(--brand-primary) 24%, transparent), transparent 62%)'
              : 'radial-gradient(75% 65% at 100% 0%, color-mix(in oklab, var(--brand-secondary) 22%, transparent), transparent 62%)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            accent === 'primary'
              ? 'color-mix(in oklab, var(--brand-primary) 55%, transparent)'
              : 'color-mix(in oklab, var(--brand-secondary) 50%, transparent)',
        }}
        aria-hidden
      />

      <div className="relative flex items-center gap-5">
        <div className="relative grid size-[6.25rem] shrink-0 place-items-center">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden>
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="5"
            />
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="5"
              strokeDasharray={`${c * 0.08} ${c * 0.04}`}
            />
            <motion.circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={stroke}
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeDasharray={c}
              initial={false}
              animate={{ strokeDashoffset: reduceMotion ? c * 0.3 : dash }}
              transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
              style={{ filter: 'drop-shadow(0 0 14px var(--brand-glow))' }}
            />
          </svg>
          <div className="text-center">
            {openNow ? (
              <span className="text-[9px] font-bold uppercase tracking-[0.28em] text-emerald-200">
                {openNowLabel}
              </span>
            ) : (
              <span
                className={cn(
                  'font-mono text-[11px] font-semibold tabular-nums leading-none',
                  portalTextPrimary,
                )}
                dir="ltr"
              >
                {value}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className={cn('text-[10px] font-semibold uppercase tracking-[0.38em]', portalTextMuted)}>
            {label}
          </p>
          {!openNow ? (
            <p
              className={cn(
                'font-mono text-[1.65rem] font-semibold leading-none tabular-nums tracking-[0.06em] sm:text-[1.85rem]',
                portalTextPrimary,
              )}
              dir="ltr"
              style={{
                textShadow: '0 0 32px color-mix(in oklab, var(--brand-glow) 65%, transparent)',
              }}
            >
              {value}
            </p>
          ) : null}
          <p className={cn('text-xs leading-relaxed', portalTextMuted)}>{sublabel}</p>
        </div>
      </div>
    </article>
  )
}

export function StreakDualTimers({
  timeZone,
  visitedToday,
  currentStreak,
  nextVisitOpensAt,
  streakExpiresAt,
}: Props) {
  const { t } = useI18n()
  const [nowMs, setNowMs] = useState(() => Date.now())

  const anchors: StreakTimerAnchors = useMemo(
    () =>
      getStreakTimerAnchors({
        timeZone,
        visitedToday,
        currentStreak,
        serverNextVisitOpensAt: nextVisitOpensAt,
        serverStreakExpiresAt: streakExpiresAt,
      }),
    [timeZone, visitedToday, currentStreak, nextVisitOpensAt, streakExpiresAt],
  )

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const nextMs = msUntil(anchors.nextVisitOpensAt, nowMs)
  const expireMs = msUntil(anchors.streakExpiresAt, nowMs)

  const nextWindowMs = anchors.nextVisitOpenNow
    ? 24 * 3600_000
    : Math.max(1, (anchors.nextVisitOpensAt?.getTime() ?? nowMs) - nowMs + 24 * 3600_000)

  const expireWindowMs =
    anchors.streakExpiresAt && currentStreak > 0
      ? visitedToday
        ? 48 * 3600_000
        : 24 * 3600_000
      : 1

  const nextProgress = anchors.nextVisitOpenNow
    ? 1
    : 1 - Math.min(1, nextMs / nextWindowMs)

  const expireProgress =
    anchors.streakExpiresAt && currentStreak > 0
      ? 1 - Math.min(1, expireMs / expireWindowMs)
      : 0

  return (
    <section
      className="mt-4 space-y-3"
      aria-label={t('myStreak.timers.sectionLabel')}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TimerRing
          label={t('myStreak.timers.nextVisitLabel')}
          value={formatCountdown(nextMs)}
          sublabel={
            anchors.nextVisitOpenNow
              ? t('myStreak.timers.nextVisitOpenNow')
              : t('myStreak.timers.nextVisitHint')
          }
          progress={nextProgress}
          accent="primary"
          openNow={anchors.nextVisitOpenNow}
          openNowLabel={t('myStreak.timers.openNow')}
        />

        {currentStreak > 0 ? (
          <TimerRing
            label={t('myStreak.timers.streakExpiresLabel')}
            value={formatCountdown(expireMs)}
            sublabel={t('myStreak.timers.streakExpiresHint')}
            progress={expireProgress}
            accent="secondary"
          />
        ) : (
          <div className={cn(portalGlassPanel, 'rounded-[1.5rem] p-5')}>
            <div className={cn('flex items-start gap-3', portalTextMuted)}>
              <ShieldAlert className="mt-0.5 size-4 shrink-0 opacity-50" aria-hidden />
              <div className="space-y-1">
                <p className={cn('text-[10px] font-semibold uppercase tracking-[0.35em]', portalTextMuted)}>
                  {t('myStreak.timers.streakExpiresLabel')}
                </p>
                <p className={cn('text-sm leading-relaxed', portalTextPrimary)}>
                  {t('myStreak.timers.noStreakYet')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className={cn('flex items-center gap-1.5 px-1 text-[10px]', portalTextMuted)}>
        <Clock className="size-3" aria-hidden />
        {t('myStreak.timers.timezoneFootnote').replace('{tz}', timeZone)}
      </p>
    </section>
  )
}
