import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/utils'

type Props = {
  className?: string
  /** Softer orbs when nested inside a card (roadmap panel). */
  variant?: 'page' | 'panel'
}

/**
 * Slow-moving brand orbs — immersive depth without garish neon.
 */
export function PortalAmbientMesh({ className, variant = 'page' }: Props) {
  const reduceMotion = useReducedMotion()
  const scale = variant === 'panel' ? 0.72 : 1
  const blur = variant === 'panel' ? 'blur-[56px]' : 'blur-[88px]'
  const opacity = variant === 'panel' ? 0.55 : 0.85

  const drift = (duration: number, x: number[], y: number[]) =>
    reduceMotion
      ? undefined
      : {
          x,
          y,
          transition: { duration, repeat: Infinity, ease: 'easeInOut' as const },
        }

  return (
    <div
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      aria-hidden
    >
      <motion.div
        className={cn('absolute rounded-full', blur)}
        style={{
          width: `${52 * scale}%`,
          height: `${48 * scale}%`,
          left: '-12%',
          top: '-18%',
          opacity,
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--brand-primary) 32%, transparent) 0%, transparent 70%)',
        }}
        animate={drift(24, [0, 28, 12, 0], [0, 22, 8, 0])}
      />
      <motion.div
        className={cn('absolute rounded-full', blur)}
        style={{
          width: `${44 * scale}%`,
          height: `${40 * scale}%`,
          right: '-8%',
          top: '8%',
          opacity: opacity * 0.9,
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--brand-secondary) 28%, transparent) 0%, transparent 72%)',
        }}
        animate={drift(28, [0, -20, -8, 0], [0, 16, 28, 0])}
      />
      <motion.div
        className={cn('absolute rounded-full', blur)}
        style={{
          width: `${38 * scale}%`,
          height: `${36 * scale}%`,
          left: '28%',
          bottom: '-12%',
          opacity: opacity * 0.75,
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--brand-primary) 22%, var(--brand-secondary) 12%, transparent) 0%, transparent 68%)',
        }}
        animate={drift(32, [0, 18, -10, 0], [0, -14, 6, 0])}
      />
      {!reduceMotion ? (
        <motion.div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            background: `
              radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in oklab, var(--brand-primary) 8%, transparent), transparent 55%),
              radial-gradient(ellipse 60% 40% at 100% 80%, color-mix(in oklab, var(--brand-secondary) 6%, transparent), transparent 50%)
            `,
          }}
          animate={{ opacity: [0.28, 0.42, 0.28] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : null}
    </div>
  )
}
