import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { invokeAiRouter } from '@/core/ai/router'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

type Props = {
  /** When false (e.g. zero branches), pulse is hidden. */
  enabled: boolean
}

export function HqPulseBanner({ enabled }: Props) {
  const { t, locale } = useI18n()
  const { data: profile } = useProfile()
  const cafeId = profile?.cafe_id ?? null
  const dismissKey = cafeId ? `streakup.hq.pulse.dismiss:${cafeId}` : 'streakup.hq.pulse.dismiss'
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(dismissKey) === '1')

  const dismiss = useCallback(() => {
    sessionStorage.setItem(dismissKey, '1')
    setDismissed(true)
  }, [dismissKey])

  const pulse = useQuery({
    queryKey: ['hq-live-pulse', cafeId, locale],
    enabled: enabled && !dismissed && Boolean(supabaseBrowserClient && cafeId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const res = await invokeAiRouter(supabaseBrowserClient!, {
        intent: 'hq_live_pulse',
        locale,
      })
      if (res.error) throw res.error
      const data = res.data as { ok?: boolean; insight?: string; error?: string }
      if (!data?.ok) throw new Error(data?.error ?? 'pulse_failed')
      return String(data.insight ?? '').trim()
    },
  })

  if (!enabled || dismissed) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-zinc-950/95 via-black/80 to-zinc-950/95 p-4 shadow-[0_20px_80px_-40px_var(--brand-glow)] backdrop-blur-md"
    >
      <motion.div
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 opacity-40"
        animate={{ x: ['-20%', '120%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
        style={{
          background:
            'linear-gradient(90deg, transparent, color-mix(in oklab, var(--brand-primary) 35%, transparent), transparent)',
        }}
      />
      <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/40 text-[var(--brand-secondary)]">
            <Sparkles className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[10px] font-semibold tracking-[0.35em] text-white/45">{t('hq.pulse.kicker')}</p>
            {pulse.isPending ? (
              <div className="space-y-2 pt-1">
                <Skeleton className="h-4 w-full max-w-xl bg-white/10" />
                <Skeleton className="h-4 w-2/3 max-w-md bg-white/10" />
              </div>
            ) : pulse.isError ? (
              <p className="text-sm text-rose-200/90">{t('hq.pulse.error')}</p>
            ) : (
              <p className="text-sm leading-relaxed font-medium text-white/90">
                {pulse.data ? pulse.data : t('hq.pulse.empty')}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          {pulse.isError ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => void pulse.refetch()}>
              {t('hq.pulse.retry')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-white/50 hover:text-white"
            onClick={dismiss}
            aria-label={t('hq.pulse.dismiss')}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
