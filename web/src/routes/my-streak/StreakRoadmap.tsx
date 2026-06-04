import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Crown, Flame, MapPin, Shield, Sparkles, Stamp, Trophy } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { SuccessBurst } from '@/components/fx/SuccessBurst'
import { PortalAmbientMesh } from '@/components/portal/PortalAmbientMesh'
import { JuicyRewardIcon } from '@/components/rewards/JuicyRewardIcon'
import { useI18n } from '@/core/i18n/I18nProvider'
import { portalGlassPanel, portalTextMuted, portalTextPrimary } from '@/lib/portal-surfaces'
import { normalizeIconType } from '@/lib/milestone-icons'
import { cn } from '@/lib/utils'

export type RoadmapMilestone = {
  id: string
  name: string
  days_required: number
  reward_label: string | null
  icon_type?: string | null
  discount_percentage?: number | null
  fulfillment_type?: 'physical' | 'digital_shield' | string | null
  claim_limit?: 'once_per_lifetime' | 'every_streak_cycle' | string | null
  reactivate_after_inactivity_days?: number | null
  lifetime_achieved?: boolean
  welcome_back_bonus?: boolean
  earned_at: string | null
  claimed_at: string | null
}

type Props = {
  streak: number
  milestones: RoadmapMilestone[]
  /** Triggers a one-shot “just claimed” animation on this milestone card. */
  claimFlashId?: string | null
}

export type NodeVisualState = 'locked' | 'next' | 'ready' | 'claimed' | 'digital' | 'lifetime'

function isDigitalShield(m: RoadmapMilestone): boolean {
  return m.fulfillment_type === 'digital_shield' || normalizeIconType(m.icon_type) === 'shield'
}

function isPhysical(m: RoadmapMilestone): boolean {
  return !isDigitalShield(m)
}

type TrailStop =
  | { kind: 'day'; day: number }
  | {
      kind: 'milestone'
      day: number
      milestone: RoadmapMilestone
      state: NodeVisualState
      ordinal: number
    }

type PositionedStop = TrailStop & {
  x: number
  y: number
  index: number
  centerX: number
  /** Stacked card under icon (mobile) vs flanking card (desktop). */
  stackedLayout: boolean
}

/** Vertical gap between consecutive day capsules. */
const DAY_GAP = 76
/** Extra breathing room around milestone rows (icon + card + label). */
const MILESTONE_GAP = 156
const MILESTONE_GAP_STACKED = 200
const PAD_TOP = 56
const PAD_BOTTOM = 88
const PAD_X = 16
/** Safe inset from container edges — cards must never cross this. */
const SAFE_EDGE = 14
/** Below this width: stacked milestones + tight river weave. */
const MOBILE_LAYOUT_WIDTH = 520

function resolveMilestoneStates(
  milestones: RoadmapMilestone[],
  streak: number,
): Map<string, NodeVisualState> {
  const sorted = [...milestones].sort((a, b) => a.days_required - b.days_required)
  const map = new Map<string, NodeVisualState>()
  let foundNext = false

  for (const m of sorted) {
    if (isDigitalShield(m)) {
      if (streak >= m.days_required) {
        map.set(m.id, 'digital')
      } else if (!foundNext) {
        map.set(m.id, 'next')
        foundNext = true
      } else {
        map.set(m.id, 'locked')
      }
      continue
    }

    if (m.lifetime_achieved || (m.earned_at && m.claim_limit === 'once_per_lifetime' && streak < m.days_required)) {
      map.set(m.id, 'lifetime')
    } else if (m.claimed_at) {
      map.set(m.id, 'claimed')
    } else if (m.earned_at) {
      map.set(m.id, 'ready')
    } else if (streak < m.days_required) {
      if (!foundNext) {
        map.set(m.id, 'next')
        foundNext = true
      } else {
        map.set(m.id, 'locked')
      }
    } else {
      map.set(m.id, 'locked')
    }
  }
  return map
}

/** Day-by-day trail with milestone anchors (same rules as legacy rail). */
function buildTrail(milestones: RoadmapMilestone[], streak: number): TrailStop[] {
  const sorted = [...milestones]
    .filter((m) => m.days_required > 0)
    .sort((a, b) => a.days_required - b.days_required)
  const states = resolveMilestoneStates(sorted, streak)
  const items: TrailStop[] = []
  let prevDay = 0

  sorted.forEach((m, idx) => {
    for (let d = prevDay + 1; d < m.days_required; d++) {
      items.push({ kind: 'day', day: d })
    }
    items.push({
      kind: 'milestone',
      day: m.days_required,
      milestone: m,
      state: states.get(m.id) ?? 'locked',
      ordinal: idx + 1,
    })
    prevDay = m.days_required
  })

  return items
}

function waveAmplitude(innerW: number, containerWidth: number): number {
  if (containerWidth < MOBILE_LAYOUT_WIDTH) return innerW * 0.07
  if (containerWidth < 768) return innerW * 0.16
  return Math.min(innerW * 0.42, innerW * 0.44)
}

function layoutTrail(stops: TrailStop[], width: number): PositionedStop[] {
  const stackedLayout = width < MOBILE_LAYOUT_WIDTH
  const padX = PAD_X + SAFE_EDGE
  const innerW = Math.max(260, width - padX * 2)
  const centerX = padX + innerW / 2
  const amplitude = waveAmplitude(innerW, width)
  const waveStrength = stackedLayout ? 0.45 : 0.72
  const xMin = padX + (stackedLayout ? innerW * 0.08 : innerW * 0.12)
  const xMax = width - padX - (stackedLayout ? innerW * 0.08 : innerW * 0.12)

  let y = PAD_TOP

  return stops.map((stop, index) => {
    if (index > 0) {
      const prev = stops[index - 1]!
      const isMilestoneRow = prev.kind === 'milestone' || stop.kind === 'milestone'
      if (isMilestoneRow) {
        y += stackedLayout ? MILESTONE_GAP_STACKED : MILESTONE_GAP
      } else {
        y += DAY_GAP
      }
    }

    const side = index % 2 === 0 ? -1 : 1
    const sine = Math.sin(index * 0.88 + Math.PI * 0.48)
    const wave = side * waveStrength + sine * (1 - waveStrength) * 0.35
    const xRaw = centerX + wave * amplitude
    const x = Math.max(xMin, Math.min(xMax, xRaw))

    return {
      ...stop,
      index,
      centerX,
      x,
      y,
      stackedLayout,
    }
  })
}

/** Max reward-card width that fits inside the trail container with safe margins. */
function milestoneCardWidth(containerWidth: number): number {
  return Math.min(248, Math.max(168, containerWidth - (PAD_X + SAFE_EDGE) * 2 - 8))
}

function trailCanvasHeight(stops: PositionedStop[]): number {
  if (stops.length === 0) return 200
  const last = stops[stops.length - 1]!
  const tail =
    last.kind === 'milestone'
      ? last.stackedLayout
        ? 168
        : 120
      : 48
  return last.y + PAD_BOTTOM + tail
}

/** Centripetal Catmull–Rom → cubic Bézier for an organic, river-like path. */
function buildOrganicPath(points: Array<{ x: number; y: number }>, tension = 0.32): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  if (points.length === 2) {
    const [a, b] = points
    const midY = (a!.y + b!.y) / 2
    return `M ${a!.x} ${a!.y} C ${a!.x} ${midY}, ${b!.x} ${midY}, ${b!.x} ${b!.y}`
  }

  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(i + 2, points.length - 1)]!

    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = p2.y - (p3.y - p1.y) * tension

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

function youAreHereDay(streak: number, maxDay: number): number | null {
  if (maxDay <= 0) return null
  if (streak >= maxDay) return maxDay
  return streak + 1
}

/* ----------------------------------------------------------------------- */
/* Roadmap                                                                 */
/* ----------------------------------------------------------------------- */

export function StreakRoadmap({ streak, milestones, claimFlashId }: Props) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const gradId = useId().replace(/:/g, '')
  const [width, setWidth] = useState(360)
  const [pathLen, setPathLen] = useState(0)

  const activeMilestones = useMemo(
    () =>
      [...milestones]
        .filter((m) => m.days_required > 0)
        .sort((a, b) => a.days_required - b.days_required),
    [milestones],
  )

  const portalMilestones = useMemo(
    () => activeMilestones.filter((m) => isPhysical(m) || isDigitalShield(m)),
    [activeMilestones],
  )

  const trail = useMemo(() => buildTrail(portalMilestones, streak), [portalMilestones, streak])
  const positioned = useMemo(() => layoutTrail(trail, width), [trail, width])
  const pathD = useMemo(
    () => buildOrganicPath(positioned.map((p) => ({ x: p.x, y: p.y }))),
    [positioned],
  )

  const maxDay = useMemo(() => {
    if (positioned.length === 0) return 0
    return Math.max(...positioned.map((p) => p.day))
  }, [positioned])

  const hereDay = youAreHereDay(streak, maxDay)

  const litCount = useMemo(
    () => positioned.filter((p) => p.day <= streak).length,
    [positioned, streak],
  )

  const fillRatio = positioned.length > 0 ? litCount / positioned.length : 0
  const dashOffset = pathLen > 0 ? pathLen * (1 - fillRatio) : 0

  const stateMap = useMemo(
    () => resolveMilestoneStates(portalMilestones, streak),
    [portalMilestones, streak],
  )
  const earnedMilestones = portalMilestones.filter((m) => {
    const state = stateMap.get(m.id)
    return state === 'ready' || state === 'claimed' || state === 'digital'
  }).length
  const nextMilestone = portalMilestones.find((m) => streak < m.days_required) ?? null
  const daysToNext = nextMilestone ? Math.max(0, nextMilestone.days_required - streak) : 0

  const height = useMemo(() => trailCanvasHeight(positioned), [positioned])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!pathRef.current || !pathD) return
    setPathLen(pathRef.current.getTotalLength())
  }, [pathD, width, height])

  if (portalMilestones.length === 0) {
    return (
      <div
        className={cn(
          portalGlassPanel,
          'p-8 text-center text-sm',
          portalTextMuted,
        )}
      >
        {t('roadmap.empty')}
      </div>
    )
  }

  return (
    <section
      ref={containerRef}
      className={cn(portalGlassPanel, 'overflow-hidden border-2')}
      aria-label={t('roadmap.title')}
      style={{
        background: `
          radial-gradient(95% 70% at 0% 0%, color-mix(in oklab, var(--brand-primary) 20%, white), transparent 55%),
          radial-gradient(80% 60% at 100% 100%, color-mix(in oklab, var(--brand-secondary) 16%, white), transparent 50%),
          color-mix(in oklab, var(--brand-primary) 6%, white 94%)
        `,
      }}
    >
      <PortalAmbientMesh variant="panel" />
      <TrailHeader
        earned={earnedMilestones}
        total={portalMilestones.length}
        streak={streak}
        maxDay={maxDay}
        next={nextMilestone}
        daysToNext={daysToNext}
        fillRatio={fillRatio}
        t={t}
      />

      <div className="relative overflow-x-hidden px-4 pb-10 pt-4 sm:px-5">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMin meet"
          className="max-w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id={`neon-${gradId}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="var(--brand-primary)" />
              <stop offset="45%" stopColor="var(--brand-secondary)" />
              <stop offset="100%" stopColor="var(--brand-primary)" />
            </linearGradient>
            <filter id={`glow-${gradId}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4.5" result="blur" />
              <feColorMatrix
                in="blur"
                type="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.65 0"
                result="softGlow"
              />
              <feMerge>
                <feMergeNode in="softGlow" />
                <feMergeNode in="softGlow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Luxurious blueprint — unachieved trail */}
          <path
            d={pathD}
            fill="none"
            stroke="color-mix(in oklab, var(--brand-primary) 55%, var(--brand-secondary))"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 9"
            opacity={0.2}
          />

          {/* Soft under-glow for achieved liquid */}
          <motion.path
            d={pathD}
            fill="none"
            stroke={`url(#neon-${gradId})`}
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.22}
            strokeDasharray={pathLen > 0 ? pathLen : undefined}
            animate={{ strokeDashoffset: dashOffset }}
            transition={{ duration: reduceMotion ? 0 : 1.25, ease: [0.22, 1, 0.36, 1] }}
          />

          {/* Liquid neon — achieved progress */}
          <motion.path
            ref={pathRef}
            d={pathD}
            fill="none"
            stroke={`url(#neon-${gradId})`}
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#glow-${gradId})`}
            strokeDasharray={pathLen > 0 ? pathLen : undefined}
            animate={{ strokeDashoffset: dashOffset }}
            transition={{ duration: reduceMotion ? 0 : 1.25, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>

        <ol
          className="absolute inset-x-0 top-0 max-w-full overflow-x-hidden"
          style={{ height, minHeight: height }}
        >
          {positioned.map((stop) => (
            <TrailStopNode
              key={`${stop.kind}-${stop.day}`}
              stop={stop}
              streak={streak}
              hereDay={hereDay}
              trailWidth={width}
              reduceMotion={Boolean(reduceMotion)}
              claimFlashId={claimFlashId}
              t={t}
            />
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------------- */
/* Header                                                                  */
/* ----------------------------------------------------------------------- */

function TrailHeader({
  earned,
  total,
  streak,
  maxDay,
  next,
  daysToNext,
  fillRatio,
  t,
}: {
  earned: number
  total: number
  streak: number
  maxDay: number
  next: RoadmapMilestone | null
  daysToNext: number
  fillRatio: number
  t: (k: string) => string
}) {
  return (
    <div
      className="border-b border-[color-mix(in_oklab,var(--brand-primary)_22%,white)] px-5 py-4 sm:px-7 sm:py-5"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in oklab, var(--brand-primary) 16%, white), color-mix(in oklab, var(--brand-secondary) 12%, white))',
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={cn('text-[10px] font-bold uppercase tracking-[0.42em]', portalTextMuted)}>
            {t('roadmap.kicker')}
          </p>
          <h3 className={cn('text-xl font-bold sm:text-2xl', portalTextPrimary)}>
            {t('roadmap.title')}
          </h3>
          <p className={cn('mt-1 text-sm', portalTextMuted)}>
            {t('roadmap.headerSub')
              .replace('{earned}', String(earned))
              .replace('{total}', String(total))
              .replace('{streak}', String(streak))}
          </p>
        </div>
        {next ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--brand-primary)_35%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_14%,white)] px-3 py-1.5 text-[11px] font-semibold text-[color-mix(in_oklab,#1a1030_80%,var(--brand-primary))] shadow-[0_0_18px_-6px_var(--brand-glow)]">
            <Flame className="size-3.5 text-(--brand-primary)" aria-hidden />
            {t('roadmap.nextChip').replace('{days}', String(daysToNext)).replace('{name}', next.name)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-100/80 px-3 py-1.5 text-[11px] font-semibold text-emerald-800">
            <Trophy className="size-3.5" aria-hidden />
            {t('roadmap.allDone')}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider">
        <span className={portalTextMuted}>{t('roadmap.dayShort').replace('{n}', '1')}</span>
        <span className={portalTextMuted}>
          {t('roadmap.dayShort').replace('{n}', String(maxDay))}
        </span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--brand-primary)_10%,white)]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--brand-primary),var(--brand-secondary))] shadow-[0_0_14px_var(--brand-glow)]"
          animate={{ width: `${Math.round(fillRatio * 100)}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------------- */
/* Trail nodes                                                             */
/* ----------------------------------------------------------------------- */

function TrailStopNode({
  stop,
  streak,
  hereDay,
  trailWidth,
  reduceMotion,
  claimFlashId,
  t,
}: {
  stop: PositionedStop
  streak: number
  hereDay: number | null
  trailWidth: number
  reduceMotion: boolean
  claimFlashId?: string | null
  t: (k: string) => string
}) {
  const lit = stop.day <= streak
  const isHere = hereDay != null && stop.day === hereDay

  return (
    <li
      className="absolute z-10 list-none"
      style={{
        left: stop.x,
        top: stop.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      {stop.kind === 'day' ? (
        <DayMarker day={stop.day} lit={lit} isHere={isHere} reduceMotion={reduceMotion} t={t} />
      ) : (
        <MilestoneMarker
          stop={stop}
          lit={lit}
          isHere={isHere}
          trailWidth={trailWidth}
          reduceMotion={reduceMotion}
          claimFlashId={claimFlashId}
          t={t}
        />
      )}
    </li>
  )
}

function DayMarker({
  day,
  lit,
  isHere,
  reduceMotion,
  t,
}: {
  day: number
  lit: boolean
  isHere: boolean
  reduceMotion: boolean
  t: (k: string) => string
}) {
  return (
    <div className="relative flex flex-col items-center">
      {isHere ? (
        <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 max-w-[min(100%,11rem)] -translate-x-1/2">
          <YouAreHereBadge reduceMotion={reduceMotion} t={t} compact />
        </div>
      ) : null}
      <motion.div
        className={cn(
          'relative z-10 grid h-7 min-w-[1.85rem] place-items-center rounded-full border px-2 backdrop-blur-md',
          lit
            ? 'border-[color-mix(in_oklab,var(--brand-primary)_45%,white)] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--brand-primary)_22%,white),color-mix(in_oklab,var(--brand-secondary)_14%,white))] shadow-[0_0_20px_-4px_var(--brand-glow),inset_0_1px_0_rgba(255,255,255,0.65)]'
            : 'border-[color-mix(in_oklab,var(--brand-primary)_14%,white_80%)] bg-[color-mix(in_oklab,white_72%,var(--brand-primary)_4%)]',
          isHere &&
            'ring-[3px] ring-[color-mix(in_oklab,var(--brand-primary)_28%,transparent)] ring-offset-2 ring-offset-[color-mix(in_oklab,white_90%,transparent)]',
        )}
        initial={false}
        animate={
          lit && !reduceMotion
            ? { scale: [1, 1.06, 1] }
            : isHere && !reduceMotion
              ? { scale: [1, 1.08, 1] }
              : { scale: 1 }
        }
        transition={{
          duration: isHere ? 1.8 : 2.8,
          repeat: isHere || lit ? Infinity : 0,
          ease: 'easeInOut',
        }}
        aria-label={t('roadmap.dayAria').replace('{n}', String(day))}
      >
        {lit && !reduceMotion ? (
          <motion.span
            className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.5),transparent_65%)]"
            animate={{ opacity: [0.4, 0.85, 0.4] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          />
        ) : null}
        <span
          className={cn(
            'relative font-mono text-[10px] font-bold tabular-nums leading-none',
            lit ? portalTextPrimary : portalTextMuted,
            isHere && 'text-(--brand-primary)',
          )}
        >
          {day}
        </span>
      </motion.div>
    </div>
  )
}

function MilestoneMarker({
  stop,
  lit,
  isHere,
  trailWidth,
  reduceMotion,
  claimFlashId,
  t,
}: {
  stop: Extract<PositionedStop, { kind: 'milestone' }>
  lit: boolean
  isHere: boolean
  trailWidth: number
  reduceMotion: boolean
  claimFlashId?: string | null
  t: (k: string) => string
}) {
  const { milestone, state } = stop
  const cardW = milestoneCardWidth(trailWidth)
  const iconSize = stop.stackedLayout ? ('md' as const) : ('lg' as const)

  if (stop.stackedLayout) {
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="flex flex-col items-center gap-2.5"
        style={{ width: cardW, maxWidth: cardW }}
      >
        {isHere ? (
          <div className="mb-0.5 flex w-full justify-center">
            <YouAreHereBadge reduceMotion={reduceMotion} t={t} compact />
          </div>
        ) : null}
        <MilestoneIconCluster
          milestone={milestone}
          state={state}
          stop={stop}
          lit={lit}
          iconSize={iconSize}
          t={t}
        />
        <div className="w-full min-w-0">
          <RewardCard
            milestone={milestone}
            state={state}
            claimFlash={claimFlashId === milestone.id}
            t={t}
          />
        </div>
      </motion.div>
    )
  }

  const cardOnRight = stop.x >= stop.centerX
  const iconHalf = iconSize === 'lg' ? 42 : 34
  const gap = 10
  const flankFitsRight = stop.x + iconHalf + gap + cardW <= trailWidth - PAD_X - SAFE_EDGE
  const flankFitsLeft = stop.x - iconHalf - gap - cardW >= PAD_X + SAFE_EDGE
  const useFlank = cardOnRight ? flankFitsRight : flankFitsLeft
  const effectiveRight = useFlank ? cardOnRight : stop.x >= stop.centerX

  if (!useFlank) {
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="flex flex-col items-center gap-2.5"
        style={{ width: cardW, maxWidth: cardW }}
      >
        {isHere ? (
          <div className="flex w-full justify-center">
            <YouAreHereBadge reduceMotion={reduceMotion} t={t} compact />
          </div>
        ) : null}
        <MilestoneIconCluster
          milestone={milestone}
          state={state}
          stop={stop}
          lit={lit}
          iconSize={iconSize}
          t={t}
        />
        <div className="w-full min-w-0">
          <RewardCard
            milestone={milestone}
            state={state}
            claimFlash={claimFlashId === milestone.id}
            t={t}
          />
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      className="relative"
      style={{ width: 0, height: 0 }}
    >
      {isHere ? (
        <div className="pointer-events-none absolute bottom-[calc(100%+3.25rem)] left-1/2 z-40 max-w-[11rem] -translate-x-1/2">
          <YouAreHereBadge reduceMotion={reduceMotion} t={t} compact />
        </div>
      ) : null}

      <div
        className={cn(
          'pointer-events-auto absolute top-1/2 z-0 -translate-y-1/2',
          effectiveRight ? 'text-left' : 'text-right',
        )}
        style={{
          width: cardW,
          maxWidth: cardW,
          ...(effectiveRight
            ? { left: `calc(50% + ${iconHalf + gap}px)` }
            : { right: `calc(50% + ${iconHalf + gap}px)` }),
        }}
      >
        <RewardCard
          milestone={milestone}
          state={state}
          claimFlash={claimFlashId === milestone.id}
          t={t}
        />
      </div>

      <MilestoneIconCluster
        milestone={milestone}
        state={state}
        stop={stop}
        lit={lit}
        iconSize={iconSize}
        t={t}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      />
    </motion.div>
  )
}

function MilestoneIconCluster({
  milestone,
  state,
  stop,
  lit,
  iconSize,
  t,
  className,
}: {
  milestone: RoadmapMilestone
  state: NodeVisualState
  stop: Extract<PositionedStop, { kind: 'milestone' }>
  lit: boolean
  iconSize: 'md' | 'lg'
  t: (k: string) => string
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative z-20 flex flex-col items-center',
        state === 'ready' &&
          'rounded-full shadow-[0_0_0_4px_color-mix(in_oklab,#f59e0b_45%,transparent),0_0_32px_-4px_rgba(245,158,11,0.55)]',
        lit &&
          state === 'next' &&
          'rounded-full shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand-primary)_35%,transparent),0_0_24px_-4px_var(--brand-glow)]',
        className,
      )}
    >
      {state === 'claimed' ? (
        <span className="absolute -right-0.5 -top-0.5 z-30 grid size-6 place-items-center rounded-full bg-zinc-600 text-white shadow-md">
          <Stamp className="size-3" aria-hidden />
        </span>
      ) : state === 'ready' ? (
        <motion.span
          className="absolute -right-0.5 -top-0.5 z-30 grid size-6 place-items-center rounded-full bg-[linear-gradient(135deg,#f59e0b,#fbbf24)] text-white shadow-[0_0_14px_rgba(245,158,11,0.7)]"
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Sparkles className="size-3.5" aria-hidden />
        </motion.span>
      ) : state === 'digital' ? (
        <span className="absolute -right-0.5 -top-0.5 z-30 grid size-6 place-items-center rounded-full bg-sky-500 text-white shadow-[0_0_12px_rgba(56,189,248,0.55)]">
          <Shield className="size-3.5" aria-hidden />
        </span>
      ) : state === 'lifetime' ? (
        <span className="absolute -right-0.5 -top-0.5 z-30 grid size-6 place-items-center rounded-full bg-violet-600 text-white shadow-[0_0_12px_rgba(139,92,246,0.55)]">
          <Crown className="size-3.5" aria-hidden />
        </span>
      ) : null}
      <JuicyRewardIcon
        iconType={normalizeIconType(milestone.icon_type)}
        discountPercentage={milestone.discount_percentage}
        state={state}
        size={iconSize}
      />
      <p
        className={cn(
          'mt-1.5 w-[4.5rem] text-center text-[9px] font-bold uppercase tracking-widest sm:w-[5rem]',
          state === 'locked' ? portalTextMuted : portalTextPrimary,
        )}
      >
        {t('roadmap.milestoneNo').replace('{n}', String(stop.ordinal))}
      </p>
    </div>
  )
}

function YouAreHereBadge({
  t,
  reduceMotion,
  compact,
}: {
  t: (k: string) => string
  reduceMotion: boolean
  compact?: boolean
}) {
  return (
    <motion.span
      className={cn(
        'inline-flex max-w-full items-center justify-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--brand-primary)_40%,white)] bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] font-bold uppercase tracking-[0.16em] text-white shadow-[0_6px_20px_-6px_var(--brand-glow)]',
        compact ? 'px-2.5 py-1 text-[7px] sm:text-[8px]' : 'px-3 py-1 text-[8px] sm:text-[9px]',
      )}
      animate={reduceMotion ? undefined : { scale: [1, 1.04, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      <MapPin className={cn(compact ? 'size-2.5' : 'size-3')} aria-hidden />
      {t('roadmap.youAreHere')}
    </motion.span>
  )
}

function RewardCard({
  milestone,
  state,
  claimFlash,
  t,
}: {
  milestone: RoadmapMilestone
  state: NodeVisualState
  claimFlash?: boolean
  t: (k: string) => string
}) {
  const reduceMotion = useReducedMotion()
  const claimed = state === 'claimed'
  const ready = state === 'ready'
  const digital = state === 'digital'
  const lifetime = state === 'lifetime'

  return (
    <div
      className={cn(
        'relative w-full min-w-0 overflow-hidden rounded-3xl border px-3.5 py-3 backdrop-blur-md',
        'min-h-[7.25rem]',
        lifetime &&
          'border-violet-400/35 bg-[linear-gradient(145deg,color-mix(in_oklab,#ede9fe_92%,white),color-mix(in_oklab,#ddd6fe_75%,white))] shadow-[0_10px_32px_-16px_rgba(139,92,246,0.45)]',
        claimed && 'border-zinc-300/40 bg-zinc-100/80 grayscale-[0.9]',
        ready &&
          'border-[color-mix(in_oklab,#f59e0b_45%,white)] bg-[linear-gradient(145deg,color-mix(in_oklab,#fef3c7_90%,white),color-mix(in_oklab,#fde68a_70%,white))] shadow-[0_12px_36px_-14px_rgba(245,158,11,0.55)]',
        digital &&
          'border-sky-400/35 bg-[color-mix(in_oklab,#0ea5e9_8%,white_92%)] shadow-[0_8px_24px_-16px_rgba(14,165,233,0.45)]',
        state === 'next' &&
          'border-[color-mix(in_oklab,var(--brand-secondary)_32%,white)] bg-[color-mix(in_oklab,var(--brand-secondary)_8%,white_90%)]',
        state === 'locked' &&
          'border-[color-mix(in_oklab,var(--brand-primary)_14%,white_80%)] bg-[color-mix(in_oklab,white_62%,var(--brand-primary)_4%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] backdrop-blur-xl',
        claimFlash && !reduceMotion && 'motion-safe:animate-pulse',
      )}
    >
      <p
        className={cn(
          'text-[9px] font-bold uppercase tracking-[0.22em]',
          state === 'locked' ? portalTextMuted : claimed ? 'text-zinc-500' : 'text-(--brand-primary)',
        )}
      >
        {lifetime
          ? t('roadmap.statusLifetime')
          : claimed
            ? t('roadmap.statusClaimed')
            : ready
              ? t('roadmap.statusReady')
              : digital
                ? t('roadmap.statusDigitalShield')
                : state === 'next'
                  ? t('roadmap.statusNext')
                  : t('roadmap.statusLocked')}
      </p>
      <p
        className={cn(
          'mt-0.5 line-clamp-2 text-sm font-bold leading-snug',
          lifetime ? 'text-violet-700' : claimed ? 'text-zinc-500' : portalTextPrimary,
        )}
        title={milestone.name}
      >
        {milestone.name}
      </p>
      {milestone.reward_label ? (
        <p
          className={cn(
            'mt-0.5 break-words text-[11px] leading-snug [overflow-wrap:anywhere]',
            lifetime ? 'text-violet-600/80' : claimed ? 'text-zinc-400' : portalTextMuted,
          )}
        >
          {milestone.reward_label}
        </p>
      ) : null}
      <div className="mt-1.5 min-h-[2.25rem]">
        {lifetime ? (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-violet-800">
            <Trophy className="size-3 shrink-0" aria-hidden />
            <span className="line-clamp-2">{t('roadmap.lifetimeHint')}</span>
          </p>
        ) : milestone.welcome_back_bonus ? (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-800">
            <Sparkles className="size-3 shrink-0" aria-hidden />
            <span className="line-clamp-2">{t('roadmap.welcomeBackBonus')}</span>
          </p>
        ) : ready ? (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-amber-800">
            <Sparkles className="size-3 shrink-0" aria-hidden />
            <span className="line-clamp-2">{t('roadmap.readyHint')}</span>
          </p>
        ) : digital ? (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-sky-700">
            <Shield className="size-3 shrink-0" aria-hidden />
            <span className="line-clamp-2">{t('roadmap.digitalShieldHint')}</span>
          </p>
        ) : state === 'next' ? (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-(--brand-secondary)">
            <Sparkles className="size-3 shrink-0" aria-hidden />
            <span className="line-clamp-2">{t('roadmap.targetPulse')}</span>
          </p>
        ) : (
          <span className="block h-[2.25rem]" aria-hidden />
        )}
      </div>

      <AnimatePresence>
        {claimed ? (
          <motion.div
            key="claimed-stamp"
            initial={reduceMotion ? false : { opacity: 0, scale: 1.35, rotate: -18 }}
            animate={{ opacity: 1, scale: 1, rotate: -12 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
            aria-hidden
          >
            <div className="rounded-xl border-4 border-rose-600/85 bg-rose-50/90 px-4 py-2 shadow-[0_8px_32px_-8px_rgba(225,29,72,0.55)]">
              <p className="text-center text-sm font-black uppercase tracking-[0.2em] text-rose-700">
                {t('roadmap.claimedStamp')}
              </p>
              <p className="text-center text-[10px] font-bold text-rose-600/90">{t('roadmap.claimedStampAr')}</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {claimFlash && !reduceMotion ? (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-3xl ring-2 ring-rose-400/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 0.85 }}
          aria-hidden
        />
      ) : null}
    </div>
  )
}

/* ----------------------------------------------------------------------- */
/* Celebration (unchanged contract)                                        */
/* ----------------------------------------------------------------------- */

export function StreakCelebrationDialog({
  open,
  onOpenChange,
  streak,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  streak: number
}) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const [burst, setBurst] = useState(false)

  useEffect(() => {
    if (!open) return
    if (reduceMotion) {
      setBurst(false)
      return
    }
    setBurst(true)
    const id = window.setTimeout(() => setBurst(false), 720)
    return () => window.clearTimeout(id)
  }, [open, reduceMotion])

  return (
    <>
      <SuccessBurst active={burst && !reduceMotion} />
      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-60 flex items-center justify-center bg-[color-mix(in_oklab,var(--brand-primary)_25%,#0a0612_75%)] p-6 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-[color-mix(in_oklab,var(--brand-primary)_35%,white)] p-8 text-center shadow-[0_0_140px_-20px_var(--brand-glow)]"
              style={{
                background:
                  'linear-gradient(160deg, color-mix(in oklab, var(--brand-primary) 22%, white), color-mix(in oklab, var(--brand-secondary) 18%, white))',
              }}
            >
              <p className={cn('text-xs font-bold uppercase tracking-[0.35em]', portalTextMuted)}>
                {t('celebration.badge')}
              </p>
              <p
                className="mt-2 text-5xl font-black tabular-nums text-(--brand-primary)"
                style={{ textShadow: '0 0 28px var(--brand-glow)' }}
              >
                {streak}
              </p>
              <p className={cn('mt-2 text-sm', portalTextMuted)}>{t('celebration.body')}</p>
              <button
                type="button"
                className="mt-6 w-full rounded-2xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] py-3 text-sm font-bold text-white shadow-[0_16px_40px_-16px_var(--brand-glow)]"
                onClick={() => onOpenChange(false)}
              >
                {t('celebration.continue')}
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
