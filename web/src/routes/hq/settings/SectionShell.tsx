import type { ReactNode } from 'react'

import { useI18n } from '@/core/i18n/I18nProvider'

type Props = {
  titleKey: string
  bodyKey: string
  children: ReactNode
  actions?: ReactNode
}

export function SectionShell({ titleKey, bodyKey, children, actions }: Props) {
  const { t } = useI18n()
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">{t(titleKey)}</h2>
          <p className="mt-1 max-w-2xl text-sm text-white/45">{t(bodyKey)}</p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}
