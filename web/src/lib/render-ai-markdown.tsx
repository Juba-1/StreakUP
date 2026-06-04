import { motion } from 'framer-motion'

import { cn } from '@/lib/utils'

/** Lightweight markdown subset for AI copilot responses (no extra deps). */
export function RenderAiMarkdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n')

  return (
    <div className={cn('space-y-2 text-sm leading-relaxed text-white/85', className)}>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <motion.div key={i} className="h-1" />

        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={i} className="pt-1 text-xs font-semibold uppercase tracking-[0.25em] text-white/55">
              {trimmed.slice(4)}
            </h4>
          )
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={i} className="pt-1 text-sm font-semibold text-white">
              {trimmed.slice(3)}
            </h3>
          )
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={i} className="text-base font-semibold text-white">
              {trimmed.slice(2)}
            </h2>
          )
        }

        const bullet = trimmed.match(/^[-*•]\s+(.*)/)
        if (bullet) {
          return (
            <p key={i} className="flex gap-2 ps-1">
              <span className="text-(--brand-primary)">•</span>
              <span>{renderInline(bullet[1])}</span>
            </p>
          )
        }

        const numbered = trimmed.match(/^\d+\.\s+(.*)/)
        if (numbered) {
          return (
            <p key={i} className="ps-1">
              {renderInline(numbered[1])}
            </p>
          )
        }

        return <p key={i}>{renderInline(trimmed)}</p>
      })}
    </div>
  )
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <span key={i}>{part}</span>
  })
}
