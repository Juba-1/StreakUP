import { motion, useReducedMotion } from 'framer-motion'
import { Play, RotateCcw, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { MilestoneRow } from '@/routes/hq/loyalty/types'
import { cn } from '@/lib/utils'

type Props = {
  milestones: MilestoneRow[]
}

type Step =
  | { kind: 'join' }
  | { kind: 'visit'; day: number }
  | { kind: 'reward_ready'; name: string }
  | { kind: 'reward_redeemed'; name: string }
  | { kind: 'shield'; amount: number }
  | { kind: 'continue' }

/**
 * Pure frontend simulation — never writes to DB / never calls RPCs.
 */
export function CustomerSimulation({ milestones }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const active = useMemo(
    () => [...milestones].filter((m) => m.active).sort((a, b) => a.days_required - b.days_required),
    [milestones],
  )

  const [day, setDay] = useState(0)
  const [log, setLog] = useState<Step[]>([{ kind: 'join' }])
  const [shields, setShields] = useState(0)

  const nextMilestone = active.find((m) => m.days_required > day)

  const simulate = () => {
    if (active.length === 0) return
    const nextDay = day + 1
    const hit = active.find((m) => m.days_required === nextDay)
    const nextLog: Step[] = [...log, { kind: 'visit', day: nextDay }]

    if (hit) {
      nextLog.push({ kind: 'reward_ready', name: hit.reward_label || hit.name })
      nextLog.push({ kind: 'reward_redeemed', name: hit.reward_label || hit.name })
      if (hit.shield_grant_amount > 0) {
        nextLog.push({ kind: 'shield', amount: hit.shield_grant_amount })
        setShields((s) => s + hit.shield_grant_amount)
      }
      nextLog.push({ kind: 'continue' })
    }

    setDay(nextDay)
    setLog(nextLog.slice(-12))
  }

  const reset = () => {
    setDay(0)
    setShields(0)
    setLog([{ kind: 'join' }])
  }

  return (
    <section
      id="loyalty-simulation"
      aria-label={t('hq.loyalty.simAria')}
      className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4 backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">{t('hq.loyalty.simTitle')}</h2>
          <p className="text-xs text-white/45">{t('hq.loyalty.simBody')}</p>
        </div>
        <Sparkles className="size-4 text-[var(--brand-secondary)]" aria-hidden />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/55">
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 tabular-nums">
          {t('hq.loyalty.simDay').replace('{n}', String(day))}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 tabular-nums">
          {t('hq.loyalty.simShields').replace('{n}', String(shields))}
        </span>
        {nextMilestone ? (
          <span className="text-white/40">
            {t('hq.loyalty.simNext').replace('{name}', nextMilestone.name).replace('{n}', String(nextMilestone.days_required - day))}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={active.length === 0}
          onClick={simulate}
          className="gap-1.5 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] font-semibold text-black"
        >
          <Play className="size-3.5" />
          {t('hq.loyalty.simVisit')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={reset} className="gap-1.5 text-white/60">
          <RotateCcw className="size-3.5" />
          {t('hq.loyalty.simReset')}
        </Button>
      </div>

      <ol className="mt-3 max-h-48 space-y-1.5 overflow-y-auto">
        {log.map((step, i) => (
          <motion.li
            key={`${i}-${step.kind}`}
            initial={reduce ? false : { opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className={cn(
              'rounded-lg border border-white/8 bg-black/25 px-2.5 py-1.5 text-[11px] text-white/75',
            )}
          >
            {step.kind === 'join'
              ? t('hq.loyalty.simLogJoin')
              : step.kind === 'visit'
                ? t('hq.loyalty.simLogVisit').replace('{n}', String(step.day))
                : step.kind === 'reward_ready'
                  ? t('hq.loyalty.simLogReady').replace('{name}', step.name)
                  : step.kind === 'reward_redeemed'
                    ? t('hq.loyalty.simLogRedeemed').replace('{name}', step.name)
                    : step.kind === 'shield'
                      ? t('hq.loyalty.simLogShield').replace('{n}', String(step.amount))
                      : t('hq.loyalty.simLogContinue')}
          </motion.li>
        ))}
      </ol>

      {active.length === 0 ? (
        <p className="mt-3 text-center text-[11px] text-white/40">{t('hq.loyalty.simEmpty')}</p>
      ) : null}
    </section>
  )
}
