import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ComingSoonCard } from '@/routes/hq/settings/ComingSoonCard'
import { SectionShell } from '@/routes/hq/settings/SectionShell'
import { cn } from '@/lib/utils'

type Props = {
  slug: string
  branchCount: number
}

export function TeamSection({ slug, branchCount }: Props) {
  const { t } = useI18n()
  return (
    <SectionShell titleKey="hq.settingsHub.team.title" bodyKey="hq.settingsHub.team.body">
      <div className="rounded-2xl border border-white/8 bg-black/25 p-4">
        <p className="text-sm text-white/75">{t('hq.settingsHub.team.branchManagers')}</p>
        <p className="mt-1 text-xs text-white/40">
          {t('hq.settingsHub.team.branchManagersBody').replace('{n}', String(branchCount))}
        </p>
        <Link
          to={`/hq/${slug}/settings?tab=branches`}
          className={cn(buttonVariants({ size: 'sm', variant: 'secondary' }), 'mt-3 border border-white/10')}
        >
          {t('hq.settingsHub.team.openBranches')}
        </Link>
      </div>
      <ComingSoonCard
        title={t('hq.settingsHub.team.rosterTitle')}
        body={t('hq.settingsHub.team.rosterBody')}
      />
    </SectionShell>
  )
}
