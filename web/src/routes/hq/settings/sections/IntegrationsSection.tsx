import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ComingSoonCard } from '@/routes/hq/settings/ComingSoonCard'
import { SectionShell } from '@/routes/hq/settings/SectionShell'
import { cn } from '@/lib/utils'

type Props = {
  slug: string
  canIntegrations: boolean
}

export function IntegrationsSection({ slug, canIntegrations }: Props) {
  const { t } = useI18n()
  return (
    <SectionShell
      titleKey="hq.settingsHub.integrations.title"
      bodyKey="hq.settingsHub.integrations.body"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Card
          title={t('hq.settingsHub.integrations.api')}
          body={
            canIntegrations
              ? t('hq.settingsHub.integrations.apiReady')
              : t('hq.settingsHub.integrations.apiLocked')
          }
          action={
            canIntegrations ? (
              <Link
                to={`/hq/${slug}/api`}
                className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }), 'border border-white/10')}
              >
                {t('hq.settingsHub.openFull')}
              </Link>
            ) : (
              <Link
                to={`/hq/${slug}/billing`}
                className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }), 'border border-white/10')}
              >
                {t('hq.settingsHub.upgrade')}
              </Link>
            )
          }
        />
        <Card
          title={t('hq.settingsHub.integrations.webhooks')}
          body={
            canIntegrations
              ? t('hq.settingsHub.integrations.webhooksReady')
              : t('hq.settingsHub.integrations.webhooksLocked')
          }
        />
      </div>
      <ComingSoonCard
        title={t('hq.settingsHub.integrations.posTitle')}
        body={t('hq.settingsHub.integrations.posBody')}
      />
    </SectionShell>
  )
}

function Card({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/25 p-4">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-xs text-white/40">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}
