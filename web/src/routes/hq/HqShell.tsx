import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  CreditCard,
  Flame,
  KeyRound,
  LayoutGrid,
  LineChart,
  Lock,
  Palette,
  Settings2,
  Users,
} from 'lucide-react'
import { NavLink, Navigate, Outlet, useParams } from 'react-router-dom'

import { HqGlobalAnnouncementBanner } from '@/components/hq/HqGlobalAnnouncementBanner'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/core/i18n/I18nProvider'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

function hqTabClass(active: boolean) {
  return cn(
    'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all',
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

  const slugRow = useQuery({
    queryKey: ['hq-cafe-slug', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'hq_owner' && profile.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('slug')
        .eq('id', profile!.cafe_id!)
        .single()
      if (error) throw error
      return data?.slug as string
    },
  })

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
  }

  if (!profile || profile.role !== 'hq_owner' || !slug) {
    return <Navigate to="/login" replace />
  }

  if (slugRow.isPending) {
    return <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
  }

  if (slugRow.isFetched && slugRow.data !== slug) {
    return <Navigate to="/login" replace />
  }

  const showIntegrations = plan.data?.canIntegrations ?? false

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <NavLink to={`/hq/${slug}`} end className={({ isActive }) => hqTabClass(isActive)}>
            <LayoutGrid className="size-3.5 opacity-80" aria-hidden />
            {t('hq.nav.overview')}
          </NavLink>
          <NavLink to={`/hq/${slug}/rewards`} className={({ isActive }) => hqTabClass(isActive)}>
            <Flame className="size-3.5 opacity-80" aria-hidden />
            {t('hq.nav.rewards')}
          </NavLink>
          <NavLink to={`/hq/${slug}/brand`} className={({ isActive }) => hqTabClass(isActive)}>
            <Palette className="size-3.5 opacity-80" aria-hidden />
            {t('hq.nav.brand')}
          </NavLink>
          {showIntegrations ? (
            <NavLink to={`/hq/${slug}/api`} className={({ isActive }) => hqTabClass(isActive)}>
              <KeyRound className="size-3.5 opacity-80" aria-hidden />
              {t('hq.nav.integrations')}
            </NavLink>
          ) : null}
          <NavLink to={`/hq/${slug}/customers`} className={({ isActive }) => hqTabClass(isActive)}>
            <Users className="size-3.5 opacity-80" aria-hidden />
            {t('hq.nav.customers')}
          </NavLink>
          <NavLink to={`/hq/${slug}/analytics`} className={({ isActive }) => hqTabClass(isActive)}>
            <LineChart className="size-3.5 opacity-80" aria-hidden />
            {t('hq.nav.analytics')}
          </NavLink>
          <NavLink to={`/hq/${slug}/settings`} className={({ isActive }) => hqTabClass(isActive)}>
            <Settings2 className="size-3.5 opacity-80" aria-hidden />
            {t('hq.nav.settings')}
          </NavLink>
          <NavLink to={`/hq/${slug}/billing`} className={({ isActive }) => hqTabClass(isActive)}>
            <CreditCard className="size-3.5 opacity-80" aria-hidden />
            {t('hq.nav.billing')}
          </NavLink>
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
  )
}
