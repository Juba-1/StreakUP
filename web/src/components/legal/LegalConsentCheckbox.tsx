import { Link } from 'react-router-dom'

import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  id?: string
  /** `portal` = customer glass card (dark text); `dark` = staff login */
  variant?: 'portal' | 'dark'
}

export function LegalConsentCheckbox({
  checked,
  onChange,
  disabled,
  className,
  id = 'legal-consent',
  variant = 'dark',
}: Props) {
  const { t } = useI18n()

  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-start text-xs leading-relaxed',
        variant === 'portal'
          ? 'border-[color-mix(in_oklab,var(--brand-primary)_18%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_6%,white)]'
          : 'border-white/10 bg-black/20',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          'mt-0.5 size-4 shrink-0 rounded accent-[var(--brand-primary)]',
          variant === 'portal'
            ? 'border-[color-mix(in_oklab,var(--brand-primary)_30%,#111)]'
            : 'border-white/25',
        )}
        required
      />
      <span
        className={
          variant === 'portal'
            ? 'text-[color-mix(in_oklab,#1a1030_88%,var(--brand-primary))]'
            : 'text-white/75'
        }
      >
        {t('legal.consent.prefix')}{' '}
        <Link to="/terms" className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline">
          {t('legal.consent.terms')}
        </Link>{' '}
        {t('legal.consent.and')}{' '}
        <Link to="/privacy" className="font-semibold text-[var(--brand-primary)] underline-offset-2 hover:underline">
          {t('legal.consent.privacy')}
        </Link>
      </span>
    </label>
  )
}
