import { motion, useReducedMotion } from 'framer-motion'

import { normalizeIconType, type MilestoneIconType } from '@/lib/milestone-icons'
import { cn } from '@/lib/utils'

const JUICY_EMOJI: Partial<Record<MilestoneIconType, string>> = {
  coffee: '☕',
  pastry: '🥐',
  cold_drink: '🥤',
  gift: '🎁',
  shield: '🛡️',
  crown: '👑',
  flame: '🔥',
}

export type RewardVisualState = 'locked' | 'next' | 'ready' | 'claimed' | 'digital' | 'lifetime'

const frostedLockedShell =
  'border-[color-mix(in_oklab,var(--brand-primary)_22%,white_75%)] bg-[color-mix(in_oklab,white_62%,var(--brand-primary)_6%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_8px_32px_-16px_color-mix(in_oklab,var(--brand-primary)_25%,transparent)] backdrop-blur-2xl'

export function JuicyRewardIcon({
  iconType: raw,
  discountPercentage,
  state,
  size = 'lg',
}: {
  iconType: string | null | undefined
  discountPercentage?: number | null
  state: RewardVisualState
  size?: 'md' | 'lg'
}) {
  const iconType = normalizeIconType(raw)
  const reduceMotion = useReducedMotion()
  const ready = state === 'ready'
  const claimed = state === 'claimed'
  const digital = state === 'digital'
  const lifetime = state === 'lifetime'
  const next = state === 'next'
  const locked = state === 'locked'
  const glow = ready || digital

  const box =
    size === 'lg' ? 'size-[4.5rem] sm:size-[5.25rem]' : 'size-[3.75rem] sm:size-16'

  if (iconType === 'discount') {
    const pct = discountPercentage ?? 15
    return (
      <motion.div
        className={cn(
          'relative grid place-items-center overflow-hidden rounded-2xl border-2 font-black tabular-nums',
          box,
          glow &&
            !claimed &&
            'border-[color-mix(in_oklab,#f59e0b_65%,gold)] bg-[linear-gradient(145deg,#fff7e0,#ffd54a_45%,#ff9f1a)] text-[#5c2e00] shadow-[0_12px_40px_-8px_rgba(255,180,0,0.7)]',
          next &&
            'border-[color-mix(in_oklab,var(--brand-primary)_55%,white)] bg-[linear-gradient(145deg,#fff9e8,#ffe082)] text-[#6b3a00] shadow-[0_8px_32px_-10px_var(--brand-glow)]',
          claimed && 'opacity-50 grayscale',
          lifetime &&
            'border-violet-400/45 bg-[linear-gradient(145deg,#f5f3ff,#e9d5ff)] text-violet-900 opacity-90 shadow-[0_8px_28px_-12px_rgba(139,92,246,0.45)]',
          locked && frostedLockedShell,
        )}
        animate={
          ready && !reduceMotion
            ? { scale: [1, 1.08, 1], rotate: [-2, 2, -2] }
            : next && !reduceMotion
              ? { scale: [1, 1.06, 1] }
              : undefined
        }
        transition={{ duration: ready ? 1.6 : 2.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {locked ? <FrostVeil reduceMotion={Boolean(reduceMotion)} /> : null}
        <span className={cn('relative z-1 text-[2rem] leading-none sm:text-[2.35rem]', locked && 'opacity-[0.72] blur-[1.5px]')}>
          {pct}
        </span>
        <span className="absolute -bottom-1 z-1 rounded-full bg-[#5c2e00] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-100">
          OFF
        </span>
      </motion.div>
    )
  }

  const emoji = JUICY_EMOJI[iconType] ?? '🎁'

  return (
    <motion.div
      className={cn(
        'relative grid place-items-center overflow-hidden rounded-full border-2',
        box,
        ready &&
          'border-[color-mix(in_oklab,#f59e0b_55%,white)] bg-[radial-gradient(circle_at_30%_20%,#fef3c7,#fde68a)] shadow-[0_20px_52px_-12px_rgba(245,158,11,0.65)]',
        digital &&
          'border-sky-400/50 bg-[radial-gradient(circle_at_30%_20%,#e0f2fe,#bae6fd)] shadow-[0_16px_48px_-12px_rgba(14,165,233,0.5)]',
        next &&
          'border-[color-mix(in_oklab,var(--brand-primary)_40%,white)] bg-[radial-gradient(circle_at_30%_20%,white,color-mix(in_oklab,var(--brand-primary)_18%,white))] shadow-[0_12px_36px_-14px_var(--brand-glow)]',
        claimed && 'opacity-45 grayscale border-zinc-300/60 bg-zinc-100',
        lifetime &&
          'border-violet-400/40 bg-[radial-gradient(circle_at_30%_20%,#faf5ff,#ddd6fe)] opacity-85 shadow-[0_12px_36px_-14px_rgba(139,92,246,0.4)]',
        locked && frostedLockedShell,
      )}
      animate={
        ready && !reduceMotion
          ? { scale: [1, 1.1, 1], y: [0, -4, 0] }
          : next && !reduceMotion
            ? { scale: [1, 1.08, 1], y: [0, -3, 0] }
            : undefined
      }
      transition={{ duration: ready ? 1.5 : 2.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      {locked ? <FrostVeil reduceMotion={Boolean(reduceMotion)} /> : null}
      {ready && !reduceMotion ? (
        <motion.span
          className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-amber-400/70"
          animate={{ scale: [1, 1.35, 1], opacity: [0.9, 0, 0.9] }}
          transition={{ duration: 1.8, repeat: Infinity }}
          aria-hidden
        />
      ) : null}
      <span
        className={cn(
          'relative z-1 select-none leading-none',
          size === 'lg' ? 'text-[2.6rem] sm:text-[3rem]' : 'text-[2.1rem]',
          locked &&
            'opacity-[0.68] blur-[2px] saturate-[1.2] contrast-[0.95] drop-shadow-[0_2px_6px_color-mix(in_oklab,var(--brand-primary)_20%,transparent)]',
          !locked && !claimed && 'drop-shadow-[0_4px_8px_rgba(0,0,0,0.18)] saturate-[1.35] contrast-[1.08]',
        )}
        role="img"
        aria-hidden
      >
        {emoji}
      </span>
    </motion.div>
  )
}

function FrostVeil({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.12)_45%,rgba(255,255,255,0.28)_100%)]"
        aria-hidden
      />
      {!reduceMotion ? (
        <motion.div
          className="pointer-events-none absolute -inset-full opacity-40"
          style={{
            background:
              'linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.55) 50%, transparent 62%)',
          }}
          animate={{ x: ['-30%', '130%'] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.8 }}
          aria-hidden
        />
      ) : null}
    </>
  )
}
