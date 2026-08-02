import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import type { CafeShieldPolicy, MilestoneRow } from '@/routes/hq/loyalty/types'
import { cn } from '@/lib/utils'

const DOW = [
  { v: 0, key: 'sun' },
  { v: 1, key: 'mon' },
  { v: 2, key: 'tue' },
  { v: 3, key: 'wed' },
  { v: 4, key: 'thu' },
  { v: 5, key: 'fri' },
  { v: 6, key: 'sat' },
] as const

type Props = {
  cafeId: string
  graceDays: number[]
  policy: CafeShieldPolicy
  milestones: MilestoneRow[]
}

export function RecoveryCard({ cafeId, graceDays, policy, milestones }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<number>>(() => new Set(graceDays))

  useEffect(() => {
    setSelected(new Set(graceDays))
  }, [graceDays])

  const save = useMutation({
    mutationFn: async (days: number[]) => {
      const sorted = [...days].sort((a, b) => a - b)
      const { error } = await supabaseBrowserClient!
        .from('cafes')
        .update({ grace_days: sorted, off_days: sorted })
        .eq('id', cafeId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(t('hq.grace.saved'))
      void qc.invalidateQueries({ queryKey: ['hq-cafe-grace', cafeId] })
    },
    onError: () => toast.error(t('hq.grace.saveFail')),
  })

  const shieldGrants = milestones
    .filter((m) => m.active && m.shield_grant_amount > 0)
    .reduce((sum, m) => sum + m.shield_grant_amount, 0)

  return (
    <section
      id="loyalty-recovery"
      aria-label={t('hq.loyalty.recoveryAria')}
      className="space-y-3 rounded-2xl border border-white/10 bg-zinc-950/60 p-4 backdrop-blur-xl"
    >
      <div>
        <h2 className="text-sm font-semibold text-white">{t('hq.loyalty.recoveryTitle')}</h2>
        <p className="text-xs text-white/45">{t('hq.loyalty.recoveryBody')}</p>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/8 bg-black/30 px-3 py-2">
          <dt className="text-[10px] text-white/40">{t('hq.loyalty.shieldGrants')}</dt>
          <dd className="mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums text-white">
            <Shield className="size-3.5 text-sky-300" />
            {shieldGrants}
          </dd>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/30 px-3 py-2">
          <dt className="text-[10px] text-white/40">{t('hq.loyalty.graceCount')}</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums text-white">{selected.size}</dd>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/30 px-3 py-2">
          <dt className="text-[10px] text-white/40">{t('hq.loyalty.shieldEvery')}</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums text-white/80">
            {policy.shield_every ?? t('hq.loyalty.placeholderDash')}
          </dd>
          {/* TODO: Requires backend support / owner edit UI for cafes.shield_every */}
        </div>
        <div className="rounded-xl border border-white/8 bg-black/30 px-3 py-2">
          <dt className="text-[10px] text-white/40">{t('hq.loyalty.maxShields')}</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums text-white/80">
            {policy.max_shields ?? t('hq.loyalty.placeholderDash')}
          </dd>
          {/* TODO: Requires backend support / owner edit UI for cafes.max_shields */}
        </div>
      </dl>

      <div>
        <p className="mb-2 text-[10px] font-semibold tracking-wide text-white/40 uppercase">
          {t('hq.grace.title')}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {DOW.map((d) => {
            const on = selected.has(d.v)
            return (
              <button
                key={d.v}
                type="button"
                onClick={() => {
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(d.v)) next.delete(d.v)
                    else next.add(d.v)
                    return next
                  })
                }}
                className={cn(
                  'rounded-lg border px-2 py-1 text-[11px] font-medium transition',
                  on
                    ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100'
                    : 'border-white/10 bg-black/30 text-white/45 hover:text-white/70',
                )}
              >
                {t(`hq.grace.dow.${d.key}`)}
              </button>
            )
          })}
        </div>
        <Button
          type="button"
          size="sm"
          className="mt-2"
          disabled={save.isPending}
          onClick={() => void save.mutateAsync([...selected])}
        >
          {t('hq.grace.save')}
        </Button>
      </div>
    </section>
  )
}
