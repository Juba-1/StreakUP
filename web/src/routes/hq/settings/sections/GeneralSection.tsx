import { useI18n } from '@/core/i18n/I18nProvider'
import { ComingSoonCard } from '@/routes/hq/settings/ComingSoonCard'
import { SectionShell } from '@/routes/hq/settings/SectionShell'

type Props = {
  cafeName: string
  timezone: string
  localeLabel: string
}

export function GeneralSection({ cafeName, timezone, localeLabel }: Props) {
  const { t } = useI18n()

  return (
    <SectionShell titleKey="hq.settingsHub.general.title" bodyKey="hq.settingsHub.general.body">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('hq.settingsHub.general.name')} value={cafeName} />
        <Field label={t('hq.settingsHub.general.timezone')} value={timezone || '—'} />
        <Field label={t('hq.settingsHub.general.language')} value={localeLabel} />
        <Field label={t('hq.settingsHub.general.currency')} value={t('hq.settingsHub.comingSoonShort')} muted />
        <Field label={t('hq.settingsHub.general.region')} value={t('hq.settingsHub.comingSoonShort')} muted />
        <Field label={t('hq.settingsHub.general.dateFormat')} value={t('hq.settingsHub.comingSoonShort')} muted />
      </div>
      <ComingSoonCard
        title={t('hq.settingsHub.general.editTitle')}
        body={t('hq.settingsHub.general.editBody')}
      />
      <p className="text-xs text-white/35">{t('hq.settingsHub.general.localeHint')}</p>
    </SectionShell>
  )
}

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/25 px-3 py-3">
      <p className="text-[10px] tracking-wide text-white/35 uppercase">{label}</p>
      <p className={`mt-1 text-sm font-medium ${muted ? 'text-white/35' : 'text-white'}`}>{value}</p>
    </div>
  )
}
