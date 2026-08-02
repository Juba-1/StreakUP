import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { cn } from '@/lib/utils'
import { HomeActivityTimeline } from '@/routes/hq/home/HomeActivityTimeline'
import { HomeHero } from '@/routes/hq/home/HomeHero'
import { HomeInsightCards } from '@/routes/hq/home/HomeInsightCards'
import { HomeKpiGrid } from '@/routes/hq/home/HomeKpiGrid'
import { HomeQuickActions } from '@/routes/hq/home/HomeQuickActions'
import { useHqHomeDashboard } from '@/routes/hq/home/useHqHomeDashboard'

function HomeSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[220px] w-full rounded-2xl bg-white/10" />
      <div className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-24 rounded-2xl bg-white/10" />
        <Skeleton className="h-24 rounded-2xl bg-white/10" />
        <Skeleton className="h-24 rounded-2xl bg-white/10" />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Skeleton className="h-28 rounded-2xl bg-white/10" />
        <Skeleton className="h-28 rounded-2xl bg-white/10" />
        <Skeleton className="h-28 rounded-2xl bg-white/10" />
        <Skeleton className="h-28 rounded-2xl bg-white/10" />
      </div>
      <Skeleton className="h-[380px] w-full rounded-2xl bg-white/10" />
    </div>
  )
}

export function HqHomePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()

  const dash = useHqHomeDashboard(
    profile?.cafe_id,
    Boolean(profile?.role === 'hq_owner' && profile.cafe_id),
  )

  if (pLoading || (profile?.role === 'hq_owner' && dash.isLoading)) {
    return <HomeSkeleton />
  }

  if (!profile || profile.role !== 'hq_owner') {
    return <Navigate to="/login" replace />
  }

  if (dash.isFetched && dash.data && slug && dash.data.slug !== slug) {
    return <Navigate to="/login" replace />
  }

  if (dash.isError || !dash.data) {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-6 text-center">
        <p className="text-sm font-medium text-white">{t('hq.home.loadError')}</p>
        <button
          type="button"
          className="mt-4 inline-flex h-11 min-h-11 items-center justify-center rounded-xl border border-white/12 bg-white/5 px-5 text-sm font-semibold text-white hover:bg-white/10"
          onClick={() => void dash.refetch()}
        >
          {t('hq.home.retry')}
        </button>
      </div>
    )
  }

  const data = dash.data

  const goRemind = () => {
    toast.message(t('hq.home.remindToast'))
    void navigate(`/hq/${data.slug}/customers`)
  }

  const showEmptyDay = data.kpis.visitsToday === 0 && !data.hasAnyVisitsEver

  return (
    <div className="space-y-5">
      <HomeHero
        greeting={data.greeting}
        cafeName={data.cafeName}
        visitsToday={data.kpis.visitsToday}
        trendPct={data.kpis.visitsTrendPct}
        slug={data.slug}
        onRemind={goRemind}
      />

      {showEmptyDay ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-5 py-7 text-center">
          <p className="text-base font-semibold text-white">{t('hq.home.emptyDayTitle')}</p>
          <p className="max-w-md text-sm text-white/50">{t('hq.home.emptyDayBody')}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {data.firstCashierPath ? (
              <a
                href={data.firstCashierPath}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: 'default' }),
                  'h-11 min-h-11 rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-4 font-semibold text-black',
                )}
              >
                {t('hq.home.actionCashier')}
              </a>
            ) : (
              <Link
                to={`/hq/${data.slug}/rewards`}
                className={cn(
                  buttonVariants({ variant: 'default' }),
                  'h-11 min-h-11 rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-4 font-semibold text-black',
                )}
              >
                {t('hq.home.actionLoyalty')}
              </Link>
            )}
            <Link
              to={`/hq/${data.slug}/customers`}
              className={cn(
                buttonVariants({ variant: 'secondary' }),
                'h-11 min-h-11 rounded-xl border border-white/12 bg-white/5 px-4 text-white',
              )}
            >
              {t('hq.home.viewCustomers')}
            </Link>
          </div>
        </div>
      ) : null}

      <HomeInsightCards insights={data.insights} slug={data.slug} onRemind={goRemind} />

      <HomeKpiGrid kpis={data.kpis} />

      <HomeActivityTimeline
        items={data.activity}
        empty={!data.hasAnyVisitsEver && data.activity.length === 0}
      />

      <HomeQuickActions slug={data.slug} cashierPath={data.firstCashierPath} />
    </div>
  )
}
