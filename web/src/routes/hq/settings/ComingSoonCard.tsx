import { Sparkles } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'

type Props = {
  title?: string
  body?: string
}

export function ComingSoonCard({ title, body }: Props) {
  const { t } = useI18n()
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-10 text-center">
      <Sparkles className="mx-auto size-5 text-white/30" aria-hidden />
      <p className="mt-3 text-sm font-medium text-white">
        {title ?? t('hq.settingsHub.comingSoonTitle')}
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/40">
        {body ?? t('hq.settingsHub.comingSoonBody')}
      </p>
    </div>
  )
}
