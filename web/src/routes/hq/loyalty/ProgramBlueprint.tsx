import { motion, useReducedMotion } from 'framer-motion'
import { Gift, Sparkles, UserPlus } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'
import { MilestoneIconGlyph, normalizeIconType } from '@/lib/milestone-icons'
import type { MilestoneRow } from '@/routes/hq/loyalty/types'
import { cn } from '@/lib/utils'

type Props = {
  milestones: MilestoneRow[]
  highlightId?: string | null
}

type Node =
  | { kind: 'join' }
  | { kind: 'visit'; key: string }
  | { kind: 'reward'; m: MilestoneRow }
  | { kind: 'vip' }

export function ProgramBlueprint({ milestones, highlightId }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const active = milestones.filter((m) => m.active)

  const nodes: Node[] = [{ kind: 'join' }]
  let cursor = 0
  for (const m of active) {
    const gap = Math.max(1, m.days_required - cursor)
    const showVisits = Math.min(gap, 3)
    for (let i = 0; i < showVisits; i++) {
      nodes.push({ kind: 'visit', key: `${m.id}-v${i}` })
    }
    if (gap > 3) {
      nodes.push({ kind: 'visit', key: `${m.id}-more` })
    }
    nodes.push({ kind: 'reward', m })
    cursor = m.days_required
  }
  if (active.length > 0) nodes.push({ kind: 'vip' })

  return (
    <section
      id="loyalty-blueprint"
      aria-label={t('hq.loyalty.blueprintAria')}
      className="rounded-2xl border border-white/10 bg-zinc-950/55 p-4 backdrop-blur-xl"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">{t('hq.loyalty.blueprintTitle')}</h2>
          <p className="text-xs text-white/45">{t('hq.loyalty.blueprintBody')}</p>
        </div>
        <p className="text-[10px] tracking-wide text-white/35 uppercase">{t('hq.loyalty.blueprintReadonly')}</p>
      </div>

      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-10 text-center text-xs text-white/45">
          {t('hq.loyalty.blueprintEmpty')}
        </div>
      ) : (
        <ol className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {nodes.map((node, i) => (
            <motion.li
              key={node.kind === 'reward' ? node.m.id : node.kind === 'visit' ? node.key : `${node.kind}-${i}`}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.2) }}
              className="flex shrink-0 items-center gap-2"
            >
              <div
                className={cn(
                  'flex min-w-[72px] flex-col items-center gap-1 rounded-xl border px-2.5 py-2 text-center',
                  node.kind === 'reward' && highlightId === node.m.id
                    ? 'border-[color-mix(in_oklab,var(--brand-primary)_50%,transparent)] bg-[color-mix(in_oklab,var(--brand-primary)_12%,transparent)]'
                    : 'border-white/10 bg-black/30',
                )}
              >
                {node.kind === 'join' ? (
                  <>
                    <UserPlus className="size-4 text-[var(--brand-secondary)]" />
                    <span className="text-[10px] font-medium text-white/80">{t('hq.loyalty.nodeJoin')}</span>
                  </>
                ) : node.kind === 'visit' ? (
                  <>
                    <span className="size-2 rounded-full bg-white/40" />
                    <span className="text-[10px] text-white/55">{t('hq.loyalty.nodeVisit')}</span>
                  </>
                ) : node.kind === 'vip' ? (
                  <>
                    <Sparkles className="size-4 text-[var(--brand-secondary)]" />
                    <span className="text-[10px] font-medium text-white/80">{t('hq.loyalty.nodeVip')}</span>
                  </>
                ) : (
                  <>
                    <MilestoneIconGlyph
                      iconType={normalizeIconType(node.m.icon_type)}
                      discountPercentage={node.m.discount_percentage}
                      className="text-[var(--brand-primary)]"
                    />
                    <span className="line-clamp-1 text-[10px] font-medium text-white">{node.m.name}</span>
                    <span className="text-[9px] tabular-nums text-white/40">{node.m.days_required}d</span>
                  </>
                )}
              </div>
              {i < nodes.length - 1 ? <span className="text-white/25">→</span> : null}
            </motion.li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-white/40">
        <span className="inline-flex items-center gap-1">
          <UserPlus className="size-3" /> {t('hq.loyalty.nodeJoin')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-white/40" /> {t('hq.loyalty.nodeVisit')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Gift className="size-3" /> {t('hq.loyalty.nodeReward')}
        </span>
      </div>
    </section>
  )
}
