import type { CSSProperties } from 'react'
import { Outlet, Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'

import { PremiumStaticBackdrop } from '@/components/auth/PremiumStaticBackdrop'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

const SALES_TEL = '0557217757'

export function MarketingLayout() {
  const { locale, setLocale, t } = useI18n()
  const reduceMotion = useReducedMotion()

  return (
    <div
      className="relative min-h-dvh w-full overflow-x-hidden bg-zinc-950 text-white"
      style={
        {
          '--brand-primary': '#8b5cf6',
          '--brand-secondary': '#f97316',
          '--brand-accent': '#f97316',
          '--brand-glow': 'rgba(139, 92, 246, 0.45)',
        } as CSSProperties
      }
    >
      <PremiumStaticBackdrop />

      <motion.header
        initial={reduceMotion ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 z-50 border-b border-white/[0.06] bg-zinc-950/65 backdrop-blur-xl"
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:h-16 sm:px-6">
          <Link
            to="/"
            className="bg-gradient-to-r from-violet-300 via-white to-orange-200 bg-clip-text text-lg font-semibold tracking-tight text-transparent"
          >
            StreakUp
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-white/60 md:flex">
            <a href="#product" className="transition hover:text-white">
              {t('landing.nav.product')}
            </a>
            <a href="#features" className="transition hover:text-white">
              {t('landing.nav.features')}
            </a>
            <a href="#pricing" className="transition hover:text-white">
              {t('landing.nav.pricing')}
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5">
              <button
                type="button"
                className={cn(
                  'rounded-md px-2 py-1 text-[10px] font-medium transition',
                  locale === 'en' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80',
                )}
                onClick={() => setLocale('en', { userPicked: true })}
              >
                EN
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-md px-2 py-1 text-[10px] font-medium transition',
                  locale === 'ar' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80',
                )}
                onClick={() => setLocale('ar', { userPicked: true })}
              >
                ع
              </button>
            </div>
            <Link
              to="/login"
              className="hidden rounded-lg border border-white/12 bg-white/5 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10 sm:inline-block"
            >
              {t('landing.nav.staffLogin')}
            </Link>
            <a
              href={`tel:${SALES_TEL}`}
              className="rounded-lg bg-gradient-to-r from-violet-500 to-orange-400 px-3 py-1.5 text-xs font-semibold text-black shadow-[0_0_24px_-6px_var(--brand-glow)] transition hover:opacity-90"
            >
              {t('landing.nav.contact')}
            </a>
          </div>
        </div>
      </motion.header>

      <main className="relative z-10">
        <Outlet />
      </main>
    </div>
  )
}
