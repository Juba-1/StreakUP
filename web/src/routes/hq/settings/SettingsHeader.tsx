import { motion, useReducedMotion } from 'framer-motion'

import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/core/i18n/I18nProvider'
import { sanitizeLogoUrl } from '@/lib/branding'
import { cn } from '@/lib/utils'

type Props = {
  cafeName: string
  logoUrl: string | null | undefined
  planLabel: string
  statusLabel: string
  dirty?: boolean
}

export function SettingsHeader({ cafeName, logoUrl, planLabel, statusLabel, dirty }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const logo = sanitizeLogoUrl(logoUrl)

  return (
    <motion.header
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/8 bg-zinc-950/50 px-4 py-4 backdrop-blur-xl md:px-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-black/40">
          {logo ? (
            <img src={logo} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-white/70">
              {cafeName.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-white/35 uppercase">
            {t('hq.settingsHub.kicker')}
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight text-white md:text-xl">
            {cafeName}
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="border-white/10 bg-white/[0.04] text-white/70">
          {planLabel}
        </Badge>
        <Badge variant="secondary" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-100">
          {statusLabel}
        </Badge>
        <span
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium',
            dirty
              ? 'border-amber-500/25 bg-amber-500/10 text-amber-100'
              : 'border-white/10 bg-white/[0.03] text-white/40',
          )}
        >
          {dirty ? t('hq.settingsHub.unsaved') : t('hq.settingsHub.saved')}
        </span>
      </div>
    </motion.header>
  )
}
