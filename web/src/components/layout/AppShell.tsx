import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { AuroraMesh } from '@/components/layout/AuroraMesh'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

function cfgBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  return false
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { session, signOut } = useAuth()
  const { data: profile } = useProfile()
  const { locale, setLocale, t } = useI18n()
  const reduceMotion = useReducedMotion()

  const platformBanner = useQuery({
    queryKey: ['platform-public-config-banner'],
    enabled: Boolean(session && supabaseBrowserClient),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('platform_public_config')
        .select('key, value')
      if (error) {
        // Graceful degrade if phase27 not applied yet — no secrets exposed.
        return {}
      }
      return Object.fromEntries(
        (data ?? []).map((r) => {
          const row = r as { key: string; value: unknown }
          return [row.key, row.value]
        }),
      )
    },
  })

  const cfg = platformBanner.data ?? {}
  const maintenanceOn = cfgBool(cfg.maintenance_mode)
  const showMaintenanceBanner = Boolean(session && maintenanceOn && profile?.role !== 'super_admin')

  const streakMatch = location.pathname.match(/^\/my-streak\/([^/]+)/)

  async function handleSignOut() {
    const slugPart = streakMatch?.[1]
    if (slugPart) localStorage.removeItem(`streakup.portal.token.${slugPart}`)
    await signOut()
    if (slugPart) {
      window.location.assign(`/my-streak/${slugPart}`)
      return
    }
    navigate('/login', { replace: true })
  }

  return (
    <div className="relative flex min-h-dvh flex-col bg-background text-foreground">
      <AuroraMesh />
      <CommandPalette />

      <motion.header
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 z-40 border-b border-white/[0.08] bg-zinc-950/70 px-4 py-3 backdrop-blur-xl"
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <Link
            to={streakMatch ? `/my-streak/${streakMatch[1]}` : '/login'}
            className="bg-gradient-to-r from-white to-white/70 bg-clip-text text-base font-semibold tracking-tight text-transparent"
          >
            {t('shell.brand')}
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex items-center gap-1 pe-2">
              <button
                type="button"
                aria-pressed={locale === 'en'}
                className={cn(
                  buttonVariants({ variant: locale === 'en' ? 'default' : 'ghost', size: 'sm' }),
                  'h-7 px-2 text-[11px]',
                )}
                onClick={() => setLocale('en', { userPicked: true })}
              >
                {t('shell.locale.en')}
              </button>
              <button
                type="button"
                aria-pressed={locale === 'ar'}
                className={cn(
                  buttonVariants({ variant: locale === 'ar' ? 'default' : 'ghost', size: 'sm' }),
                  'h-7 px-2 text-[11px]',
                )}
                onClick={() => setLocale('ar', { userPicked: true })}
              >
                {t('shell.locale.ar')}
              </button>
            </div>
            {session ? (
              <button
                type="button"
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
                onClick={() => void handleSignOut()}
              >
                {t('shell.signOut')}
              </button>
            ) : streakMatch ? null : (
              <Link className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))} to="/login">
                {t('shell.signIn')}
              </Link>
            )}
          </div>
        </div>
      </motion.header>

      {showMaintenanceBanner ? (
        <div className="relative z-30 border-b border-amber-500/35 bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-50">
          {t('shell.banner.maintenance')}
        </div>
      ) : null}

      <main
        className={cn(
          'relative z-10 mx-auto flex w-full flex-1 flex-col',
          streakMatch ? 'max-w-none px-0 py-0' : 'max-w-6xl px-4 py-8',
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={location.pathname}
            className="flex flex-1 flex-col"
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
