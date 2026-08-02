import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { useI18n } from '@/core/i18n/I18nProvider'

type Props = {
  value: string
  onChange: (v: string) => void
}

export function SettingsSearch({ value, onChange }: Props) {
  const { t } = useI18n()
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-white/35" aria-hidden />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('hq.settingsHub.searchPlaceholder')}
        aria-label={t('hq.settingsHub.searchAria')}
        className="h-11 border-white/10 bg-black/35 ps-10 text-sm text-white placeholder:text-white/35"
      />
    </div>
  )
}
