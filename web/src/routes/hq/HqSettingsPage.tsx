import { useCallback, useMemo, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useProfile } from '@/hooks/useProfile'
import { useHqOperations } from '@/routes/hq/operations/useHqOperations'
import { ComingSoonCard } from '@/routes/hq/settings/ComingSoonCard'
import { matchNavSearch } from '@/routes/hq/settings/nav'
import { SettingsHeader } from '@/routes/hq/settings/SettingsHeader'
import { SettingsSearch } from '@/routes/hq/settings/SettingsSearch'
import { SettingsSidebar } from '@/routes/hq/settings/SettingsSidebar'
import { BillingSection } from '@/routes/hq/settings/sections/BillingSection'
import { BranchesSection } from '@/routes/hq/settings/sections/BranchesSection'
import { BrandSection } from '@/routes/hq/settings/sections/BrandSection'
import { DangerSection } from '@/routes/hq/settings/sections/DangerSection'
import { GeneralSection } from '@/routes/hq/settings/sections/GeneralSection'
import { IntegrationsSection } from '@/routes/hq/settings/sections/IntegrationsSection'
import { NotificationsSection } from '@/routes/hq/settings/sections/NotificationsSection'
import { SecuritySection } from '@/routes/hq/settings/sections/SecuritySection'
import { TeamSection } from '@/routes/hq/settings/sections/TeamSection'
import { isSettingsTab, type SettingsTab } from '@/routes/hq/settings/types'
import { useQuery } from '@tanstack/react-query'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

function HubSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-20 w-full rounded-2xl bg-white/10" />
      <Skeleton className="h-11 w-full rounded-xl bg-white/10" />
      <div className="grid gap-4 lg:grid-cols-12">
        <Skeleton className="hidden h-[480px] rounded-2xl bg-white/10 lg:col-span-3 lg:block" />
        <Skeleton className="h-[480px] rounded-2xl bg-white/10 lg:col-span-9" />
      </div>
    </div>
  )
}

/** Settings Mega Hub — route remains `/hq/:slug/settings` with `?tab=`. */
export function HqSettingsPage() {
  const { slug } = useParams()
  const [params, setParams] = useSearchParams()
  const { t, locale } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()
  const cafeId = profile?.cafe_id
  const enabled = profile?.role === 'hq_owner' && Boolean(cafeId)
  const plan = usePlanLimits(cafeId)

  const rawTab = params.get('tab')
  const activeTab: SettingsTab = isSettingsTab(rawTab) ? rawTab : 'general'

  const setTab = useCallback(
    (tab: SettingsTab) => {
      const next = new URLSearchParams(params)
      next.set('tab', tab)
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const [search, setSearch] = useState('')
  const [brandDirty, setBrandDirty] = useState(false)

  const opsEnabled = enabled && (activeTab === 'branches' || activeTab === 'team')
  const ops = useHqOperations(cafeId, Boolean(opsEnabled))

  /** Light cafe meta for header — shared key with ops when warm. */
  const cafeMeta = useQuery({
    queryKey: ['hq-settings-cafe', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId && enabled),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('id, slug, name, timezone, status, logo_url')
        .eq('id', cafeId!)
        .single()
      if (error) throw error
      return data as {
        id: string
        slug: string
        name: string
        timezone: string
        status: string | null
        logo_url: string | null
      }
    },
    staleTime: 60_000,
  })

  const visibleTabs = useMemo(() => matchNavSearch(t, search), [t, search])

  const onBrandDirty = useCallback((d: boolean) => setBrandDirty(d), [])

  if (pLoading || (enabled && cafeMeta.isLoading)) {
    return <HubSkeleton />
  }

  if (!profile || profile.role !== 'hq_owner' || !cafeId) {
    return <Navigate to="/login" replace />
  }

  if (cafeMeta.data && slug && cafeMeta.data.slug !== slug) {
    return <Navigate to="/login" replace />
  }

  if (cafeMeta.isError || !cafeMeta.data || !slug) {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-6 text-center">
        <p className="text-sm font-medium text-white">{t('hq.settingsHub.loadError')}</p>
        <button
          type="button"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-xl border border-white/12 bg-white/5 px-5 text-sm font-semibold text-white hover:bg-white/10"
          onClick={() => void cafeMeta.refetch()}
        >
          {t('hq.settingsHub.retry')}
        </button>
      </div>
    )
  }

  const cafe = cafeMeta.data
  const planLabel = plan.data?.isStarter
    ? t('hq.tier.starterBadge')
    : t('hq.settingsHub.planGrowth')
  const statusLabel = cafe.status
    ? String(cafe.status)
    : t('hq.settingsHub.statusActive')

  const content = (() => {
    switch (activeTab) {
      case 'general':
        return (
          <GeneralSection
            cafeName={cafe.name}
            timezone={cafe.timezone}
            localeLabel={locale === 'ar' ? 'العربية' : 'English'}
          />
        )
      case 'brand':
        return <BrandSection cafeId={cafeId} onDirtyChange={onBrandDirty} />
      case 'team':
        return (
          <TeamSection slug={slug} branchCount={ops.branches.length || 0} />
        )
      case 'branches':
        if (ops.isLoading) return <HubSkeleton />
        if (ops.isError || !ops.cafe) {
          return (
            <ComingSoonCard
              title={t('hq.opsPage.loadError')}
              body={t('hq.settingsHub.retry')}
            />
          )
        }
        return <BranchesSection cafeId={cafeId} slug={slug} ops={ops} />
      case 'notifications':
        return <NotificationsSection />
      case 'billing':
        return <BillingSection cafeId={cafeId} />
      case 'integrations':
        return (
          <IntegrationsSection
            slug={slug}
            canIntegrations={plan.data?.canIntegrations ?? false}
          />
        )
      case 'security':
        return <SecuritySection />
      case 'danger':
        return <DangerSection />
      default:
        return null
    }
  })()

  return (
    <div className="space-y-5 pb-10">
      <SettingsHeader
        cafeName={cafe.name}
        logoUrl={cafe.logo_url}
        planLabel={planLabel}
        statusLabel={statusLabel}
        dirty={brandDirty}
      />

      <SettingsSearch value={search} onChange={setSearch} />

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-3">
          <SettingsSidebar
            active={activeTab}
            visible={visibleTabs}
            onSelect={setTab}
            query={search}
          />
        </div>
        <div className="min-w-0 lg:col-span-9">
          {visibleTabs.includes(activeTab) ? (
            content
          ) : (
            <ComingSoonCard
              title={t('hq.settingsHub.searchEmpty')}
              body={t('hq.settingsHub.searchEmptyBody')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
