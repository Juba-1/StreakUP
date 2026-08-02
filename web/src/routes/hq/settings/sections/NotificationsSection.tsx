import { ComingSoonCard } from '@/routes/hq/settings/ComingSoonCard'
import { SectionShell } from '@/routes/hq/settings/SectionShell'
import { useI18n } from '@/core/i18n/I18nProvider'

const CHANNELS = ['email', 'push', 'whatsapp', 'sms', 'marketing', 'operational'] as const

export function NotificationsSection() {
  const { t } = useI18n()
  return (
    <SectionShell
      titleKey="hq.settingsHub.notifications.title"
      bodyKey="hq.settingsHub.notifications.body"
    >
      <ul className="space-y-2">
        {CHANNELS.map((ch) => (
          <li
            key={ch}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/25 px-3 py-3"
          >
            <div>
              <p className="text-sm font-medium text-white">
                {t(`hq.settingsHub.notifications.${ch}`)}
              </p>
              <p className="text-[11px] text-white/40">{t('hq.settingsHub.comingSoonShort')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={false}
              disabled
              aria-disabled
              className="relative h-6 w-11 cursor-not-allowed rounded-full border border-white/10 bg-white/5 opacity-50"
              title={t('hq.settingsHub.comingSoonTitle')}
            >
              <span className="absolute top-0.5 start-0.5 size-5 rounded-full bg-white/30" />
            </button>
          </li>
        ))}
      </ul>
      <ComingSoonCard
        title={t('hq.settingsHub.notifications.soonTitle')}
        body={t('hq.settingsHub.notifications.soonBody')}
      />
    </SectionShell>
  )
}
