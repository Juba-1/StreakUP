import { ComingSoonCard } from '@/routes/hq/settings/ComingSoonCard'
import { SectionShell } from '@/routes/hq/settings/SectionShell'
import { useI18n } from '@/core/i18n/I18nProvider'

export function SecuritySection() {
  const { t } = useI18n()
  return (
    <SectionShell titleKey="hq.settingsHub.security.title" bodyKey="hq.settingsHub.security.body">
      <div className="rounded-2xl border border-white/8 bg-black/25 p-4">
        <p className="text-sm text-white/75">{t('hq.settingsHub.security.sessionNote')}</p>
      </div>
      <ComingSoonCard
        title={t('hq.settingsHub.security.soonTitle')}
        body={t('hq.settingsHub.security.soonBody')}
      />
    </SectionShell>
  )
}
