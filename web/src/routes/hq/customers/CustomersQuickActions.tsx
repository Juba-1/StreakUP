import { RotateCcw, Shield, UserRoundPen } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'
import type { CustomerRow } from '@/routes/hq/customers/types'
import { cn } from '@/lib/utils'

type Props = {
  selected: CustomerRow | null
  onEdit: (row: CustomerRow) => void
  onGrantShield: (row: CustomerRow) => void
  onResetStreak: (row: CustomerRow) => void
  onView: (row: CustomerRow) => void
}

export function CustomersQuickActions({
  selected,
  onEdit,
  onGrantShield,
  onResetStreak,
  onView,
}: Props) {
  const { t } = useI18n()
  const disabled = !selected

  const actions = [
    {
      id: 'edit',
      label: t('hq.customers.actionEdit'),
      Icon: UserRoundPen,
      onClick: () => selected && onEdit(selected),
    },
    {
      id: 'shield',
      label: t('hq.customers.actionGrantShield'),
      Icon: Shield,
      onClick: () => selected && onGrantShield(selected),
    },
    {
      id: 'reset',
      label: t('hq.customers.actionResetStreak'),
      Icon: RotateCcw,
      onClick: () => selected && onResetStreak(selected),
    },
  ]

  return (
    <aside
      className="rounded-2xl border border-white/10 bg-zinc-950/55 p-4 backdrop-blur-xl"
      aria-label={t('hq.customers.quickActionsAria')}
    >
      <h2 className="text-sm font-semibold text-white">{t('hq.customers.quickActionsTitle')}</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-white/40">
        {selected
          ? selected.full_name || t('hq.customers.unnamed')
          : t('hq.customers.quickActionsHint')}
      </p>

      <div className="mt-4 space-y-1.5">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={disabled}
            onClick={action.onClick}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl border border-transparent px-3 py-2.5 text-start text-xs font-medium transition',
              disabled
                ? 'cursor-not-allowed text-white/25'
                : 'text-white/80 hover:border-white/10 hover:bg-white/5 hover:text-white',
            )}
          >
            <action.Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
            {action.label}
          </button>
        ))}

        {selected ? (
          <button
            type="button"
            onClick={() => onView(selected)}
            className="mt-2 flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-white/8"
          >
            {t('hq.customers.view')}
          </button>
        ) : null}
      </div>
    </aside>
  )
}
