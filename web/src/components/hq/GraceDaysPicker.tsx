import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { Palmtree, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
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
  initialGraceDays: number[]
}

export function GraceDaysPicker({ cafeId, initialGraceDays }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const reduceMotion = useReducedMotion()
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialGraceDays))

  useEffect(() => {
    setSelected(new Set(initialGraceDays))
  }, [initialGraceDays])

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

  const toggle = (dow: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(dow)) next.delete(dow)
      else next.add(dow)
      return next
    })
  }

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-[1.5rem] border border-emerald-500/20 bg-gradient-to-br from-emerald-950/40 via-zinc-950/80 to-zinc-950/90 p-6 backdrop-blur-xl"
    >
      <div className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-500/15">
            <Palmtree className="size-5 text-emerald-300" aria-hidden />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{t('hq.grace.title')}</h3>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/50">{t('hq.grace.body')}</p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={save.isPending}
          onClick={() => void save.mutateAsync([...selected])}
          className="bg-emerald-600 text-white hover:bg-emerald-500"
        >
          <Save className="size-4" aria-hidden />
          {save.isPending ? t('common.loading') : t('hq.grace.save')}
        </Button>
      </div>

      <div className="relative mt-6 grid grid-cols-7 gap-2 sm:gap-3">
        {DOW.map(({ v, key }) => {
          const on = selected.has(v)
          return (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-3 text-center transition-all',
                on
                  ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100 shadow-[0_0_24px_-8px_rgba(52,211,153,0.55)]'
                  : 'border-white/10 bg-black/30 text-white/45 hover:border-white/20 hover:bg-white/5',
              )}
            >
              <span className="text-lg" aria-hidden>
                {on ? '🌴' : '·'}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {t(`hq.grace.dow.${key}`)}
              </span>
            </button>
          )
        })}
      </div>
      <p className="relative mt-4 text-xs text-emerald-200/60">{t('hq.grace.hint')}</p>
    </motion.section>
  )
}
