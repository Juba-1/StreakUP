import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Activity,
  Building2,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LineChart,
  Menu,
  ScrollText,
  Settings2,
  Shield,
} from 'lucide-react'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'

import { RouteFallback } from '@/components/layout/RouteFallback'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { cn } from '@/lib/utils'

const COLLAPSE_KEY = 'streakup.admin.sidebar.collapsed'

function navClass(active: boolean, collapsed: boolean) {
  return cn(
    'group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-medium transition-all duration-200',
    collapsed ? 'justify-center px-2' : '',
    active
      ? 'border-white/10 bg-white/[0.08] text-white shadow-[0_0_40px_-18px_var(--brand-glow)]'
      : 'text-white/60 hover:border-white/10 hover:bg-white/[0.04] hover:text-white',
  )
}

export function AdminLayout() {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const { data: profile, isLoading } = useProfile()
  const reduceMotion = useReducedMotion()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const closeMobile = useCallback(() => setMobileOpen(false), [])
  useEffect(() => {
    closeMobile()
  }, [pathname, closeMobile])

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-white/10" />
        <div className="h-64 w-full animate-pulse rounded-xl bg-white/5" />
      </div>
    )
  }

  if (!profile || profile.role !== 'super_admin') {
    return <Navigate to="/login" replace />
  }

  const links = [
    { to: '/admin/overview', label: t('admin.nav.overview'), icon: LayoutDashboard },
    { to: '/admin/analytics', label: t('admin.nav.analytics'), icon: LineChart },
    { to: '/admin/tenants', label: t('admin.nav.tenants'), icon: Building2 },
    { to: '/admin/audit', label: t('admin.nav.audit'), icon: ScrollText },
    { to: '/admin/settings', label: t('admin.nav.settings'), icon: Settings2 },
  ] as const

  function SidebarNav({ compact }: { compact: boolean }) {
    return (
      <div className="flex h-full flex-col">
        <div
          className={cn(
            'border-b border-white/[0.07] px-3 py-4',
            compact ? 'flex flex-col items-center gap-2' : 'flex items-start justify-between gap-2',
          )}
        >
          <div className={cn('min-w-0', compact ? 'text-center' : '')}>
            <div className="flex items-center gap-2">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-rose-500/30 bg-gradient-to-br from-rose-500/25 to-violet-600/20 shadow-[0_0_28px_-8px_rgba(244,63,94,0.45)]">
                <Shield className="size-4 text-rose-100" aria-hidden />
              </div>
              {!compact ? (
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-semibold tracking-[0.35em] text-white/40">
                    {t('admin.shell.kicker')}
                  </p>
                  <p className="truncate text-sm font-semibold text-white">{t('admin.shell.title')}</p>
                </div>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden shrink-0 text-white/50 hover:text-white lg:inline-flex"
            aria-label={compact ? t('admin.sidebar.expand') : t('admin.sidebar.collapse')}
            onClick={() => setCollapsed((c) => !c)}
          >
            {compact ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </Button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => navClass(isActive, compact)} onClick={closeMobile}>
              <Icon className="size-[18px] shrink-0 opacity-90" aria-hidden />
              {!compact ? <span className="truncate">{label}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-white/[0.06] p-3">
          <div
            className={cn(
              'flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-2 py-2',
              compact ? 'justify-center' : '',
            )}
          >
            <Activity className="size-4 shrink-0 text-emerald-300/90" aria-hidden />
            {!compact ? (
              <p className="text-[11px] leading-snug text-white/50">{t('admin.shell.footerHint')}</p>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100dvh-5.5rem)] flex-1 gap-0 lg:gap-6">
      {/* Mobile */}
      <div className="mb-4 flex items-center justify-between gap-2 lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button type="button" variant="secondary" size="sm" className="border-white/10">
                <Menu className="size-4" />
                <span className="ms-2">{t('admin.shell.menu')}</span>
              </Button>
            }
          />
          <SheetContent side="left" className="w-[min(100%,18rem)] border-white/10 bg-zinc-950 p-0">
            <SheetHeader className="border-b border-white/10 px-4 py-3 text-start">
              <SheetTitle className="text-sm text-white">{t('admin.shell.title')}</SheetTitle>
            </SheetHeader>
            <div className="h-[calc(100dvh-6rem)]">
              <SidebarNav compact={false} />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 80 : 260 }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }}
        className="relative hidden shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80 shadow-[0_40px_120px_-60px_rgba(0,0,0,0.85)] backdrop-blur-xl lg:block"
      >
        <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />
        <SidebarNav compact={collapsed} />
      </motion.aside>

      <motion.div
        className="min-w-0 flex-1"
        initial={reduceMotion ? false : { opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <AnimatePresence mode="wait">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
