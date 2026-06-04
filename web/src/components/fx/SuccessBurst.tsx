import { motion, useReducedMotion } from 'framer-motion'
import { createPortal } from 'react-dom'

const N = 18

type Props = {
  active: boolean
  anchor?: 'center' | 'bottom'
}

/**
 * Short-lived particle burst for high-signal confirmations (visit, reward).
 */
export function SuccessBurst({ active, anchor = 'center' }: Props) {
  const reduceMotion = useReducedMotion()
  if (typeof document === 'undefined') return null

  const originClass =
    anchor === 'bottom'
      ? 'fixed inset-x-0 bottom-[28%] flex justify-center'
      : 'fixed inset-0 flex items-center justify-center'

  if (!active || reduceMotion) return null

  return createPortal(
    <div className={`pointer-events-none z-120 ${originClass}`} aria-hidden>
      {Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * Math.PI * 2
        const dist = 72 + (i % 5) * 14
        const dx = Math.cos(angle) * dist
        const dy = Math.sin(angle) * dist - (anchor === 'bottom' ? 24 : 0)
        return (
          <motion.span
            key={`p-${i}`}
            className="absolute size-1.5 rounded-full bg-linear-to-br from-amber-200 via-orange-400 to-rose-500 shadow-[0_0_12px_rgba(251,191,36,0.6)]"
            initial={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            animate={{ opacity: 0, scale: 0.2, x: dx, y: dy }}
            transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
          />
        )
      })}
    </div>,
    document.body,
  )
}
