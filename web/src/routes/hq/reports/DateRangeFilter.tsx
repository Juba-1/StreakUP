import { useI18n } from '@/core/i18n/I18nProvider'
import type { DatePreset } from '@/routes/hq/reports/types'
import { cn } from '@/lib/utils'

const PRESETS: DatePreset[] = ['today', '7d', '30d', '90d', 'ytd', 'all', 'custom']

type Props = {
  value: DatePreset
  onChange: (p: DatePreset) => void
}

export function DateRangeFilter({ value, onChange }: Props) {
  const { t } = useI18n()

  return (
    <div
      className="inline-flex max-w-full flex-wrap rounded-xl border border-white/10 bg-black/35 p-1"
      role="group"
      aria-label={t('hq.reports.dateAria')}
    >
      {PRESETS.map((p) => {
        const disabled = p === 'custom'
        // TODO: Connect backend date parameters for custom from/to ranges.
        const active = value === p
        return (
          <button
            key={p}
            type="button"
            disabled={disabled}
            title={disabled ? t('hq.reports.dateCustomTodo') : undefined}
            onClick={() => onChange(p)}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition',
              active
                ? 'bg-[color-mix(in_oklab,var(--brand-primary)_28%,transparent)] text-white shadow-sm'
                : 'text-white/45 hover:text-white/80',
              disabled && 'cursor-not-allowed opacity-35',
            )}
          >
            {t(`hq.reports.date.${p}`)}
          </button>
        )
      })}
    </div>
  )
}
