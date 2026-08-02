import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  MILESTONE_ICON_META,
  MILESTONE_ICON_TYPES,
  type MilestoneIconType,
} from '@/lib/milestone-icons'
import {
  clampDiscount,
  clampShieldGrant,
  SHIELD_GRANT_OPTIONS,
} from '@/routes/hq/loyalty/types'
import { cn } from '@/lib/utils'

export function IconThemePicker({
  value,
  discountPercentage,
  onChange,
  t,
  compact = false,
}: {
  value: MilestoneIconType
  discountPercentage: number | null
  onChange: (icon: MilestoneIconType, discount: number | null) => void
  t: (k: string) => string
  compact?: boolean
}) {
  return (
    <div className="space-y-3">
      <div className={cn('grid gap-2', compact ? 'grid-cols-4' : 'grid-cols-4 sm:grid-cols-8')}>
        {MILESTONE_ICON_TYPES.map((key) => {
          const { Icon } = MILESTONE_ICON_META[key]
          const selected = value === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key, key === 'discount' ? discountPercentage ?? 10 : null)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition',
                selected
                  ? 'border-(--brand-primary)/50 bg-[color-mix(in_oklab,var(--brand-primary)_18%,transparent)] text-white shadow-[0_0_20px_-8px_var(--brand-glow)]'
                  : 'border-white/10 bg-black/40 text-white/55 hover:border-white/25 hover:text-white',
              )}
              title={t(MILESTONE_ICON_META[key].labelKey)}
            >
              {key === 'discount' ? (
                <span className="text-sm font-bold tabular-nums">%</span>
              ) : (
                <Icon className="size-5" aria-hidden />
              )}
              <span className="max-w-full truncate text-[9px] font-medium tracking-wide uppercase">
                {t(MILESTONE_ICON_META[key].labelKey)}
              </span>
            </button>
          )
        })}
      </div>
      {value === 'discount' ? (
        <div className="flex items-center gap-3 rounded-xl border border-(--brand-primary)/25 bg-[color-mix(in_oklab,var(--brand-primary)_10%,transparent)] px-3 py-2">
          <Label className="shrink-0 text-[11px] text-white/70">{t('hq.rewards.field.discount')}</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={discountPercentage ?? ''}
            onChange={(e) => onChange(value, clampDiscount(Number(e.target.value)))}
            className="h-9 w-24 border-white/10 bg-black/50 text-center font-mono text-lg font-bold text-white"
          />
          <span className="text-sm font-semibold text-(--brand-primary)">%</span>
        </div>
      ) : null}
    </div>
  )
}

export function ShieldGrantSelect({
  value,
  onChange,
  t,
  compact = false,
}: {
  value: number
  onChange: (n: number) => void
  t: (k: string) => string
  compact?: boolean
}) {
  return (
    <select
      value={clampShieldGrant(value)}
      onChange={(e) => onChange(clampShieldGrant(Number(e.target.value)))}
      className={cn(
        'w-full rounded-xl border border-white/10 bg-black/40 text-white focus:border-(--brand-primary)/40 focus:outline-none focus:ring-2 focus:ring-(--brand-primary)/20',
        compact ? 'h-9 px-2 text-sm' : 'h-11 px-3 text-sm',
      )}
      aria-label={t('hq.rewards.field.shields')}
    >
      {SHIELD_GRANT_OPTIONS.map((n) => (
        <option key={n} value={n}>
          {n === 0
            ? t('hq.rewards.shields.none')
            : t('hq.rewards.shields.count').replace('{n}', String(n))}
        </option>
      ))}
    </select>
  )
}
