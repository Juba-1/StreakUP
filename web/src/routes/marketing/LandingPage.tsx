import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  BarChart3,
  CalendarOff,
  Flame,
  Map,
  Shield,
  Sparkles,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

const SALES_TEL = '0557217757'

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
}

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : 'hidden'}
      whileInView={reduceMotion ? undefined : 'visible'}
      viewport={{ once: true, margin: '-60px' }}
      variants={fadeUp}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

function MockRoadmapCard() {
  const days = [3, 7, 14, 21, 30]
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4 shadow-[0_24px_80px_-40px_rgba(139,92,246,0.5)] backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-[0.35em] text-violet-300/80 uppercase">Roadmap</span>
        <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-semibold text-orange-200">
          Day 14 🔥
        </span>
      </div>
      <div className="flex items-end justify-between gap-1 px-1">
        {days.map((d, i) => (
          <div key={d} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'flex size-9 items-center justify-center rounded-xl border text-[10px] font-bold',
                i < 3
                  ? 'border-violet-400/40 bg-violet-500/25 text-violet-100'
                  : i === 3
                    ? 'border-orange-400/50 bg-orange-500/30 text-orange-100 shadow-[0_0_20px_-4px_rgba(249,115,22,0.6)]'
                    : 'border-white/10 bg-white/5 text-white/30',
              )}
            >
              {d}
            </div>
            {i === 3 ? <Trophy className="size-3 text-orange-300" aria-hidden /> : <span className="size-3" />}
          </div>
        ))}
      </div>
    </div>
  )
}

function MockAnalyticsCard() {
  const bars = [42, 68, 55, 82, 74, 91, 88]
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4 shadow-[0_24px_80px_-40px_rgba(56,189,248,0.35)] backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 className="size-4 text-sky-300" aria-hidden />
        <span className="text-[10px] font-semibold tracking-[0.35em] text-sky-300/80 uppercase">Behavioral</span>
      </div>
      <div className="flex h-24 items-end justify-between gap-1.5">
        {bars.map((h, i) => (
          <div
            key={i}
            className="w-full rounded-t-md bg-gradient-to-t from-violet-600/80 to-sky-400/90"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-white/45">Retention · Churn risk · Visit cadence</p>
    </div>
  )
}

function MockShieldCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4 shadow-[0_24px_80px_-40px_rgba(34,211,238,0.35)] backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="grid size-12 place-items-center rounded-2xl border border-cyan-400/30 bg-cyan-500/15">
          <Shield className="size-6 text-cyan-300" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Shield Rescue</p>
          <p className="text-[11px] text-white/50">Streak protected · 1 shield used</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={cn(
              'h-2 flex-1 rounded-full',
              n <= 2 ? 'bg-gradient-to-r from-cyan-400 to-violet-500' : 'bg-white/10',
            )}
          />
        ))}
      </div>
    </div>
  )
}

export function LandingPage() {
  const { t, locale } = useI18n()
  const reduceMotion = useReducedMotion()

  const tiers = [
    {
      id: 'starter',
      name: t('landing.pricing.starter.name'),
      price: t('landing.pricing.starter.price'),
      desc: t('landing.pricing.starter.desc'),
      features: [
        t('landing.pricing.starter.f1'),
        t('landing.pricing.starter.f2'),
        t('landing.pricing.starter.f3'),
      ],
      highlight: false,
    },
    {
      id: 'growth',
      name: t('landing.pricing.growth.name'),
      price: t('landing.pricing.growth.price'),
      desc: t('landing.pricing.growth.desc'),
      features: [
        t('landing.pricing.growth.f1'),
        t('landing.pricing.growth.f2'),
        t('landing.pricing.growth.f3'),
      ],
      highlight: true,
    },
    {
      id: 'enterprise',
      name: t('landing.pricing.enterprise.name'),
      price: t('landing.pricing.enterprise.price'),
      desc: t('landing.pricing.enterprise.desc'),
      features: [
        t('landing.pricing.enterprise.f1'),
        t('landing.pricing.enterprise.f2'),
        t('landing.pricing.enterprise.f3'),
      ],
      highlight: false,
    },
  ]

  const features = [
    {
      icon: TrendingUp,
      title: t('landing.features.analytics.title'),
      body: t('landing.features.analytics.body'),
      accent: 'from-violet-500/20 to-sky-500/10',
    },
    {
      icon: Map,
      title: t('landing.features.gamification.title'),
      body: t('landing.features.gamification.body'),
      accent: 'from-orange-500/20 to-violet-500/10',
    },
    {
      icon: CalendarOff,
      title: t('landing.features.grace.title'),
      body: t('landing.features.grace.body'),
      accent: 'from-emerald-500/20 to-cyan-500/10',
    },
  ]

  return (
    <div className="pb-8">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:px-6 sm:pt-24 sm:pb-28">
        <motion.div
          className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[min(100%,720px)] -translate-x-1/2 rounded-full bg-violet-600/20 blur-[100px]"
          animate={reduceMotion ? undefined : { scale: [1, 1.08, 1], opacity: [0.35, 0.5, 0.35] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        />

        <div className="relative mx-auto max-w-6xl">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-3xl text-center"
          >
            <p className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-[11px] font-medium tracking-wide text-violet-200">
              <Sparkles className="size-3.5" aria-hidden />
              {t('landing.hero.badge')}
            </p>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl md:text-6xl">
              {t('landing.hero.title')}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
              {t('landing.hero.subtitle')}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={`tel:${SALES_TEL}`}
                className="inline-flex h-12 min-w-[220px] items-center justify-center rounded-2xl bg-gradient-to-r from-violet-500 via-violet-400 to-orange-400 px-8 text-base font-semibold text-black shadow-[0_0_48px_-12px_var(--brand-glow)] transition hover:scale-[1.02] hover:opacity-95"
              >
                {t('landing.hero.cta')}
              </a>
              <a
                href="#product"
                className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-8 text-sm font-medium text-white/80 transition hover:bg-white/10"
              >
                {t('landing.hero.secondary')}
              </a>
            </div>
          </motion.div>

          {/* Floating mock cards */}
          <div id="product" className="relative mx-auto mt-16 max-w-5xl sm:mt-20">
            <div className="grid gap-4 md:grid-cols-3">
              <motion.div
                className="md:translate-y-6"
                animate={reduceMotion ? undefined : { y: [0, -8, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              >
                <MockRoadmapCard />
              </motion.div>
              <motion.div
                animate={reduceMotion ? undefined : { y: [0, 10, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
              >
                <MockAnalyticsCard />
              </motion.div>
              <motion.div
                className="md:-translate-y-4"
                animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
              >
                <MockShieldCard />
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Value prop strip ── */}
      <section className="border-y border-white/[0.06] bg-white/[0.02] px-4 py-12 sm:px-6">
        <Reveal className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-3">
          {[
            { icon: Flame, label: t('landing.strip.streaks') },
            { icon: Shield, label: t('landing.strip.shields') },
            { icon: BarChart3, label: t('landing.strip.insights') },
          ].map(({ icon: Icon, label }, i) => (
            <div key={label} className="flex items-center gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-violet-500/10">
                <Icon className="size-5 text-violet-300" aria-hidden />
              </div>
              <p className="text-sm font-medium text-white/80">{label}</p>
              {i < 2 ? <div className="ms-auto hidden h-8 w-px bg-white/10 sm:block" aria-hidden /> : null}
            </div>
          ))}
        </Reveal>
      </section>

      {/* ── Features ── */}
      <section id="features" className="px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-6xl">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold tracking-[0.4em] text-violet-300/80 uppercase">
              {t('landing.features.kicker')}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{t('landing.features.heading')}</h2>
            <p className="mt-4 text-white/55">{t('landing.features.subheading')}</p>
          </Reveal>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.08}>
                <div
                  className={cn(
                    'group h-full rounded-[1.5rem] border border-white/10 bg-gradient-to-b p-6 backdrop-blur-md transition hover:border-violet-400/25',
                    f.accent,
                  )}
                >
                  <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-black/30 p-3">
                    <f.icon className="size-6 text-violet-300 transition group-hover:text-orange-300" aria-hidden />
                  </div>
                  <h3 className="text-lg font-semibold text-white">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/55">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="relative px-4 py-20 sm:px-6 sm:py-28">
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 h-64 -translate-y-1/2 bg-gradient-to-r from-violet-600/10 via-transparent to-orange-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold tracking-[0.4em] text-orange-300/80 uppercase">
              {t('landing.pricing.kicker')}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{t('landing.pricing.heading')}</h2>
            <p className="mt-4 text-white/55">{t('landing.pricing.subheading')}</p>
          </Reveal>

          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {tiers.map((tier, i) => (
              <Reveal key={tier.id} delay={i * 0.1}>
                <div
                  className={cn(
                    'relative flex h-full flex-col rounded-[1.75rem] border p-7 backdrop-blur-xl',
                    tier.highlight
                      ? 'border-violet-400/40 bg-gradient-to-b from-violet-500/15 to-zinc-950/90 shadow-[0_0_60px_-20px_rgba(139,92,246,0.5)]'
                      : 'border-white/10 bg-zinc-950/70',
                  )}
                >
                  {tier.highlight ? (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-violet-500 to-orange-400 px-3 py-0.5 text-[10px] font-bold tracking-wide text-black uppercase">
                      {t('landing.pricing.popular')}
                    </span>
                  ) : null}
                  <h3 className="text-lg font-semibold">{tier.name}</h3>
                  <p className="mt-1 text-3xl font-semibold tracking-tight">{tier.price}</p>
                  <p className="mt-2 text-sm text-white/50">{tier.desc}</p>
                  <ul className="mt-6 flex-1 space-y-2.5 text-sm text-white/70">
                    {tier.features.map((feat) => (
                      <li key={feat} className="flex gap-2">
                        <span className="text-violet-400">✓</span>
                        {feat}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={`tel:${SALES_TEL}`}
                    className={cn(
                      'mt-8 flex h-11 items-center justify-center rounded-xl text-sm font-semibold transition',
                      tier.highlight
                        ? 'bg-gradient-to-r from-violet-500 to-orange-400 text-black hover:opacity-90'
                        : 'border border-white/15 bg-white/5 text-white hover:bg-white/10',
                    )}
                  >
                    {t('landing.pricing.cta')}
                  </a>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="mx-4 mb-8 sm:mx-6">
        <Reveal>
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-violet-400/20 bg-gradient-to-br from-violet-600/25 via-zinc-900 to-orange-500/15 px-6 py-14 text-center sm:px-12">
            <h2 className="text-2xl font-semibold sm:text-3xl">{t('landing.cta.title')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/60">{t('landing.cta.body')}</p>
            <a
              href={`tel:${SALES_TEL}`}
              className="mt-8 inline-flex h-12 items-center justify-center rounded-2xl bg-white px-8 text-sm font-semibold text-zinc-950 transition hover:bg-white/90"
            >
              {t('landing.hero.cta')}
            </a>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.06] px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="text-center sm:text-start">
            <p className="text-sm font-semibold text-white">StreakUp</p>
            <p className="mt-1 text-xs text-white/45" dir="ltr">
              {locale === 'ar' ? `مشغّل بواسطة ستريك أب · ${SALES_TEL}` : `Powered by StreakUp · ${SALES_TEL}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-white/55">
            <Link to="/terms" className="transition hover:text-white">
              {t('legal.consent.terms')}
            </Link>
            <Link to="/privacy" className="transition hover:text-white">
              {t('legal.consent.privacy')}
            </Link>
            <Link to="/login" className="transition hover:text-white">
              {t('landing.nav.staffLogin')}
            </Link>
            <a href={`tel:${SALES_TEL}`} className="transition hover:text-violet-300" dir="ltr">
              {SALES_TEL}
            </a>
          </div>
        </div>
        <p className="mx-auto mt-8 max-w-6xl text-center text-[11px] text-white/30">
          {t('landing.footer.legal')}
        </p>
      </footer>
    </div>
  )
}
