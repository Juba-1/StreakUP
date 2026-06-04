import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Megaphone, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

function cfgAnnouncement(v: unknown): {
  enabled: boolean
  title: string
  body: string
  severity: string
  fingerprint: string
} {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { enabled: false, title: '', body: '', severity: 'info', fingerprint: '' }
  }
  const o = v as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title : ''
  const body = typeof o.body === 'string' ? o.body : ''
  const severity = typeof o.severity === 'string' ? o.severity : 'info'
  return {
    enabled: Boolean(o.enabled),
    title,
    body,
    severity,
    fingerprint: `${severity}|${title}|${body}`,
  }
}

const DISMISS_PREFIX = 'streakup.hq.announcement.dismissed'

export function HqGlobalAnnouncementBanner() {
  const { t } = useI18n()
  const [dismissed, setDismissed] = useState(false)

  const banner = useQuery({
    queryKey: ['platform-public-config-banner'],
    enabled: Boolean(supabaseBrowserClient),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('platform_public_config')
        .select('key, value')
      if (error) return {}
      return Object.fromEntries(
        (data ?? []).map((r) => {
          const row = r as { key: string; value: unknown }
          return [row.key, row.value]
        }),
      )
    },
    staleTime: 60_000,
  })

  const ann = useMemo(() => cfgAnnouncement(banner.data?.global_announcement), [banner.data])

  useEffect(() => {
    if (!ann.fingerprint) {
      setDismissed(false)
      return
    }
    const stored = localStorage.getItem(`${DISMISS_PREFIX}.${ann.fingerprint}`)
    setDismissed(stored === '1')
  }, [ann.fingerprint])

  const visible =
    ann.enabled &&
    !dismissed &&
    (ann.title.trim().length > 0 || ann.body.trim().length > 0)

  function handleDismiss() {
    if (ann.fingerprint) localStorage.setItem(`${DISMISS_PREFIX}.${ann.fingerprint}`, '1')
    setDismissed(true)
  }

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          key={ann.fingerprint}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            'overflow-hidden rounded-2xl border px-4 py-3 shadow-[0_24px_60px_-40px_rgba(124,58,237,0.55)]',
            ann.severity === 'critical' && 'border-rose-500/40 bg-gradient-to-r from-rose-950/80 to-zinc-950/90',
            ann.severity === 'warning' && 'border-amber-500/35 bg-gradient-to-r from-amber-950/70 to-zinc-950/90',
            (ann.severity === 'info' || !ann.severity) &&
              'border-violet-500/35 bg-gradient-to-r from-violet-950/70 via-zinc-950/85 to-zinc-950/90',
          )}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
              <Megaphone className="size-4 text-violet-200" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-[10px] font-semibold tracking-[0.35em] text-white/50 uppercase">
                {t('hq.announcement.kicker')}
              </p>
              {ann.title ? <p className="font-semibold text-white">{ann.title}</p> : null}
              {ann.body ? <p className="text-sm leading-relaxed text-white/75">{ann.body}</p> : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
              aria-label={t('hq.announcement.dismiss')}
              onClick={handleDismiss}
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
