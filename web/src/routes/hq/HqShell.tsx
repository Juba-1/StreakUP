import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Gift,
  LayoutGrid,
  LineChart,
  Lock,
  Rocket,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react'
import { NavLink, Navigate, Outlet, useParams } from 'react-router-dom'

import { HqGlobalAnnouncementBanner } from '@/components/hq/HqGlobalAnnouncementBanner'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/core/i18n/I18nProvider'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useProfile } from '@/hooks/useProfile'
import { sanitizeLogoUrl } from '@/lib/branding'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

function sidebarItemClass(active: boolean) {
  return cn(
    'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
    active
      ? 'bg-white/[0.08] text-white shadow-[0_0_28px_-14px_var(--brand-glow)]'
      : 'text-white/55 hover:bg-white/[0.04] hover:text-white',
  )
}

function pillItemClass(active: boolean) {
  return cn(
    'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold whitespace-nowrap transition-all',
    active
      ? 'border-white/15 bg-white/[0.08] text-white shadow-[0_0_28px_-12px_var(--brand-glow)]'
      : 'border-transparent text-white/55 hover:border-white/10 hover:bg-white/[0.04] hover:text-white',
  )
}

export function HqShell() {
  const { slug } = useParams()
  const { t } = useI18n()
  const { data: profile, isLoading } = useProfile()
  const plan = usePlanLimits(profile?.cafe_id)

  const cafeRow = useQuery({
    queryKey: ['hq-cafe-slug', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'hq_owner' && profile.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('slug, name, logo_url')
        .eq('id', profile!.cafe_id!)
        .single()
      if (error) throw error
      return data as { slug: string; name: string; logo_url: string | null }
    },
  })

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
  }

  if (!profile || profile.role !== 'hq_owner' || !slug) {
    return <Navigate to="/login" replace />
  }

  if (cafeRow.isPending) {
    return <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
  }

  if (cafeRow.isFetched && cafeRow.data?.slug !== slug) {
    return <Navigate to="/login" replace />
  }

  const showIntegrations = plan.data?.canIntegrations ?? false
  const cafeName = cafeRow.data?.name ?? ''
  const logo = sanitizeLogoUrl(cafeRow.data?.logo_url)

  const nav = [
    { to: `/hq/${slug}`, end: true, Icon: LayoutGrid, label: t('hq.nav.overview') },
    { to: `/hq/${slug}/operations`, Icon: Rocket, label: t('hq.nav.operations') },
    { to: `/hq/${slug}/customers`, Icon: Users, label: t('hq.nav.customers') },
    { to: `/hq/${slug}/rewards`, Icon: Gift, label: t('hq.nav.rewards') },
    { to: `/hq/${slug}/analytics`, Icon: LineChart, label: t('hq.nav.analytics') },
    { to: `/hq/${slug}/settings`, Icon: SettingsIcon, label: t('hq.nav.settings') },
  ]

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      {/* Desktop workspace sidebar */}
      <aside className="hidden shrink-0 lg:sticky lg:top-6 lg:block lg:w-[228px]">
        <div className="rounded-2xl border border-white/8 bg-zinc-950/45 p-3">
          <div className="flex items-center gap-2.5 px-1 py-1.5">
            <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-black/40">
              {logo ? (
                <img src={logo} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-sm font-semibold text-white/70">
                  {(cafeName.slice(0, 1) || 'S').toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{cafeName}</p>
              <p className="text-[11px] text-white/40">{t('hq.badge.owner')}</p>
            </div>
          </div>

          <div className="my-2 border-t border-white/8" />

          <nav aria-label={t('hq.badge.owner')} className="space-y-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => sidebarItemClass(isActive)}
              >
                <item.Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {plan.data?.isStarter ? (
            <>
              <div className="my-2 border-t border-white/8" />
              <Badge
                variant="secondary"
                className="w-full justify-center border-violet-500/25 bg-violet-500/10 text-violet-200"
              >
                {t('hq.tier.starterBadge')}
              </Badge>
            </>
          ) : null}
        </div>
      </aside>

      {/* Mobile / tablet nav */}
      <div className="flex flex-wrap items-center justify-between gap-3 lg:hidden">
        <div className="flex flex-wrap gap-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => pillItemClass(isActive)}
            >
              <item.Icon className="size-3.5 opacity-80" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plan.data?.isStarter ? (
            <Badge variant="secondary" className="border-violet-500/25 bg-violet-500/10 text-violet-200">
              {t('hq.tier.starterBadge')}
            </Badge>
          ) : null}
          <Badge variant="secondary" className="border-white/10 bg-black/40">
            {t('hq.badge.owner')}
          </Badge>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-5">
        <HqGlobalAnnouncementBanner />

        {!showIntegrations ? (
          <p className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-white/45">
            <Lock className="size-3.5 shrink-0 opacity-70" aria-hidden />
            {t('hq.tier.integrationsHidden')}
          </p>
        ) : null}

        <motion.div
          key={slug}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <Outlet />
        </motion.div>
      </div>
    </div>
  )
}
