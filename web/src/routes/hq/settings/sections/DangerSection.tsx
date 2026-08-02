import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { SectionShell } from '@/routes/hq/settings/SectionShell'

export function DangerSection() {
  const { t } = useI18n()

  return (
    <SectionShell titleKey="hq.settingsHub.danger.title" bodyKey="hq.settingsHub.danger.body">
      <div className="space-y-3 rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] p-4">
        {(
          [
            ['transfer', 'hq.settingsHub.danger.transfer'],
            ['export', 'hq.settingsHub.danger.export'],
            ['reset', 'hq.settingsHub.danger.reset'],
            ['delete', 'hq.settingsHub.danger.delete'],
          ] as const
        ).map(([id, key]) => (
          <div
            key={id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-500/10 py-3 last:border-0"
          >
            <div>
              <p className="text-sm font-medium text-white">{t(key)}</p>
              <p className="text-[11px] text-white/40">{t(`${key}Body`)}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled
              title={t('hq.settingsHub.comingSoonTitle')}
              className="border border-rose-500/30 bg-rose-500/10 text-rose-100/60"
            >
              {t('hq.settingsHub.comingSoonShort')}
            </Button>
          </div>
        ))}
      </div>
    </SectionShell>
  )
}
