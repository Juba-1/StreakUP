import { useMutation } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Check, CheckCircle2, Copy, Flame, Palmtree, Shield, Snowflake, Sparkles, Trophy } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { SuccessBurst } from '@/components/fx/SuccessBurst'
import { PortalAmbientMesh } from '@/components/portal/PortalAmbientMesh'
import { CustomerPortalShell } from '@/components/portal/CustomerPortalShell'
import { LegalConsentCheckbox } from '@/components/legal/LegalConsentCheckbox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  portalGlassPanel,
  portalMeshBg,
  portalTextMuted,
  portalTextPrimary,
} from '@/lib/portal-surfaces'
import { cn } from '@/lib/utils'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useCafePublicProfile } from '@/hooks/useCafePublicProfile'
import {
  CUSTOMER_PORTAL_WINDOW,
  getLockoutMsRemaining,
  registerFailure,
  registerSuccess,
} from '@/lib/security/rateLimit'
import { constrainSaudiFiveDisplay, normalizeSaudiMobileToE164 } from '@/lib/phone/saudi-mobile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { portalNameStepSchema, portalPhoneOnlySchema } from '@/lib/validation/schemas'
import { useStreakupPortalRealtime } from '@/hooks/useStreakupRealtime'

import { StreakCelebrationDialog, StreakRoadmap, type RoadmapMilestone } from './StreakRoadmap'
import { StreakDualTimers } from './StreakDualTimers'

type PortalOk = {
  ok: true
  customer_id: string
  cafe_id: string
  current_streak: number
  longest_streak: number
  shields: number
  pin_code: string
  display_name: string
  session_token: string
  is_new: boolean
  resumed: boolean
  milestones: RoadmapMilestone[]
  last_visit_date: string | null
  visited_today: boolean
  cafe_timezone: string
  next_visit_opens_at: string | null
  streak_expires_at: string | null
  is_grace_day_today?: boolean
  grace_days?: number[]
}

type OnboardingStep = 'phone' | 'name'

function parsePortal(data: unknown): PortalOk | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.ok !== true) return null
  if (typeof o.customer_id !== 'string') return null
  return {
    ok: true,
    customer_id: o.customer_id,
    cafe_id: String(o.cafe_id),
    current_streak: Number(o.current_streak ?? 0),
    longest_streak: Number(o.longest_streak ?? 0),
    shields: Number(o.shields ?? 0),
    pin_code: String(o.pin_code ?? ''),
    display_name: String(o.display_name ?? ''),
    session_token: String(o.session_token ?? ''),
    is_new: Boolean(o.is_new),
    resumed: Boolean(o.resumed),
    milestones: Array.isArray(o.milestones) ? (o.milestones as RoadmapMilestone[]) : [],
    last_visit_date: typeof o.last_visit_date === 'string' ? o.last_visit_date : null,
    visited_today: Boolean(o.visited_today),
    cafe_timezone: typeof o.cafe_timezone === 'string' ? o.cafe_timezone : 'UTC',
    next_visit_opens_at:
      typeof o.next_visit_opens_at === 'string' ? o.next_visit_opens_at : null,
    streak_expires_at:
      typeof o.streak_expires_at === 'string' ? o.streak_expires_at : null,
    is_grace_day_today: Boolean(o.is_grace_day_today),
    grace_days: Array.isArray(o.grace_days) ? (o.grace_days as number[]) : [],
  }
}

export function MyStreakHomePage() {
  const { slug } = useParams()
  const { t, locale } = useI18n()
  const { data: branding, isLoading: brandingLoading } = useCafePublicProfile(slug)

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [step, setStep] = useState<OnboardingStep>('phone')
  const [session, setSession] = useState<PortalOk | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  const [welcomeBurst, setWelcomeBurst] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [pinJustCopied, setPinJustCopied] = useState(false)
  const [claimFlashId, setClaimFlashId] = useState<string | null>(null)
  const [liveVisitPulse, setLiveVisitPulse] = useState(0)
  const [legalConsent, setLegalConsent] = useState(false)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const claimedIdsRef = useRef<Set<string>>(new Set())
  const longPressTimer = useRef<number | null>(null)
  const sessionKey = `streakup.portal.token.${slug ?? 'unknown'}`
  const reduceMotion = useReducedMotion()

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const copyShareLink = useCallback(() => {
    const url = window.location.href
    void navigator.clipboard.writeText(url).then(
      () => toast.success(t('myStreak.linkCopied')),
      () => toast.error(t('myStreak.linkCopyFail')),
    )
  }, [t])

  const copyPinCode = useCallback(() => {
    if (!session?.pin_code) return
    void navigator.clipboard.writeText(session.pin_code).then(() => {
      setPinJustCopied(true)
      toast.success(t('myStreak.pinCopied'))
      window.setTimeout(() => setPinJustCopied(false), 2200)
    })
  }, [session?.pin_code, t])

  const startLongPress = useCallback(() => {
    clearLongPress()
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null
      copyShareLink()
    }, 620)
  }, [clearLongPress, copyShareLink])

  const beginPortalSession = useCallback(
    async (args: {
      phone?: string
      name?: string
      sessionToken?: string
      termsAccepted?: boolean
      privacyAccepted?: boolean
    }) => {
      if (!slug || !supabaseBrowserClient) throw new Error('not_ready')

      let rateSubject = `${slug}:resume`
      let pPhone: string | null = null
      let pName: string | null = null

      if (!args.sessionToken) {
        const rawPhone = (args.phone ?? '').trim()
        const nm = (args.name ?? '').trim()

        let e164: string
        if (nm.length >= 2) {
          const full = portalNameStepSchema.safeParse({ phone: rawPhone, name: nm })
          if (!full.success) throw new Error('invalid_input')
          e164 = full.data.phone
          pName = nm
        } else {
          const only = portalPhoneOnlySchema.safeParse({ phone: rawPhone })
          if (!only.success) throw new Error('invalid_input')
          e164 = only.data.phone
          pName = null
        }
        pPhone = e164
        rateSubject = `${slug}:${e164}`
      }

      const remaining = getLockoutMsRemaining(CUSTOMER_PORTAL_WINDOW, rateSubject)
      if (remaining > 0 && !args.sessionToken) {
        const err = new Error('locked') as Error & { retryMs?: number }
        err.retryMs = remaining
        throw err
      }

      const { data, error } = await supabaseBrowserClient.rpc('customer_portal_begin', {
        p_slug: slug,
        p_phone: pPhone,
        p_name:
          args.sessionToken ? null : typeof pName === 'string' && pName.trim().length >= 2 ? pName.trim() : null,
        p_session_token: args.sessionToken ?? null,
        // Consent is required only for first-time registration (name step).
        // Returning customers can continue without re-ticking consent.
        p_terms_accepted: args.sessionToken ? null : (args.termsAccepted ?? null),
        p_privacy_accepted: args.sessionToken ? null : (args.privacyAccepted ?? null),
      })
      if (error) {
        const transport = Object.assign(new Error('rpc_transport'), {
          detailParts: [
            typeof error.code === 'string' ? error.code : null,
            error.message ?? null,
            typeof error.details === 'string' ? error.details : null,
          ]
            .filter(Boolean)
            .join(' — '),
        }) as Error & { detailParts?: string }
        throw transport
      }

      const parsed = parsePortal(data)
      if (!parsed) {
        const root = (data ?? {}) as {
          error?: string
          retry_after_ms?: number
          status?: string
        }
        if (root.error === 'name_required') throw new Error('name_required')
        if (root.error === 'rate_limited') {
          const err = new Error('locked') as Error & { retryMs?: number }
          err.retryMs = Number(root.retry_after_ms ?? 45_000)
          throw err
        }
        if (root.error === 'invalid_phone') throw new Error('invalid_phone')
        if (root.error === 'cafe_not_found') throw new Error('cafe_not_found')
        if (root.error === 'customer_resolution_failed') throw new Error('customer_resolution_failed')
        if (root.error === 'cafe_inactive') {
          const err = Object.assign(new Error('cafe_inactive'), {
            cafeStatus: root.status ?? '',
          }) as Error & { cafeStatus?: string }
          throw err
        }
        if (root.error === 'legal_consent_required') throw new Error('legal_consent_required')
        if (!args.sessionToken) registerFailure(CUSTOMER_PORTAL_WINDOW, rateSubject)
        throw new Error('auth_failed')
      }

      if (!args.sessionToken) registerSuccess(CUSTOMER_PORTAL_WINDOW, rateSubject)
      return parsed
    },
    [slug],
  )

  const applyPortalSession = useCallback(
    (s: PortalOk, { silent = false }: { silent?: boolean } = {}) => {
      const claimedNow = new Set(
        s.milestones.filter((m) => m.claimed_at).map((m) => m.id),
      )
      if (silent && claimedIdsRef.current.size > 0) {
        for (const m of s.milestones) {
          if (m.claimed_at && !claimedIdsRef.current.has(m.id)) {
            setClaimFlashId(m.id)
            toast.success(t('roadmap.toastClaimed'))
            window.setTimeout(() => setClaimFlashId(null), 1400)
            break
          }
        }
      }
      claimedIdsRef.current = claimedNow

      localStorage.setItem(sessionKey, s.session_token)
      setSession(s)
      setStep('phone')
      setName('')

      if (!silent) {
        if (s.is_new) {
          toast.success(t('myStreak.toast.welcomeNew'))
        } else if (!s.resumed) {
          toast.success(t('myStreak.toast.welcomeBack'))
        }

        setWelcomeBurst(true)
        window.setTimeout(() => setWelcomeBurst(false), 700)
      }

      const celebrateKey = `streakup.celebrate.${s.customer_id}`
      if (s.current_streak >= 3 && !sessionStorage.getItem(celebrateKey)) {
        sessionStorage.setItem(celebrateKey, '1')
        setCelebrate(true)
      }
    },
    [sessionKey, t],
  ) // t for claim toast

  const onPortalSuccess = useCallback((s: PortalOk) => applyPortalSession(s), [applyPortalSession])

  const portalErrorToast = useCallback(
    (e: Error & { retryMs?: number; detailParts?: string; cafeStatus?: string }) => {
      if (e.message === 'locked') {
        const secs = Math.ceil((e.retryMs ?? 60_000) / 1000)
        toast.error(t('myStreak.toast.locked').replace('{seconds}', String(secs)))
      } else if (e.message === 'invalid_input') toast.error(t('myStreak.toast.invalid'))
      else if (e.message === 'invalid_phone') toast.error(t('myStreak.toast.invalidPhone'))
      else if (e.message === 'cafe_not_found') toast.error(t('myStreak.cafeMissing'))
      else if (e.message === 'cafe_inactive')
        toast.error(
          typeof e.cafeStatus === 'string' && e.cafeStatus.length > 0
            ? `${t('myStreak.toast.cafeInactive')} (${e.cafeStatus})`
            : t('myStreak.toast.cafeInactive'),
        )
      else if (e.message === 'rpc_transport')
        toast.error(
          e.detailParts?.length
            ? `${t('myStreak.toast.rpcError')} ${e.detailParts}`
            : t('myStreak.toast.rpcError'),
        )
      else if (e.message === 'name_required') toast.error(t('myStreak.toast.nameRequired'))
      else if (e.message === 'auth_failed') toast.error(t('myStreak.toast.authFailed'))
      else if (e.message === 'customer_resolution_failed') toast.error(t('myStreak.toast.resolutionFailed'))
      else if (e.message === 'legal_consent_required') toast.error(t('legal.consent.required'))
      else toast.error(t('myStreak.loginError'))
    },
    [t],
  )

  const phoneStep = useMutation({
    mutationFn: () =>
      beginPortalSession({
        phone,
        // Phone step: passive disclaimer only (no checkbox).
        termsAccepted: undefined,
        privacyAccepted: undefined,
      }),
    onSuccess: onPortalSuccess,
    onError: (e: Error & { retryMs?: number }) => {
      // New customer path: open registration modal (name + explicit consent).
      if (e.message === 'name_required' || e.message === 'legal_consent_required') {
        setRegistrationOpen(true)
        return
      }
      portalErrorToast(e)
    },
  })

  const nameStep = useMutation({
    mutationFn: () =>
      beginPortalSession({
        phone,
        name,
        termsAccepted: legalConsent,
        privacyAccepted: legalConsent,
      }),
    onSuccess: onPortalSuccess,
    onError: portalErrorToast,
  })

  const registerStep = useMutation({
    mutationFn: () =>
      beginPortalSession({
        phone,
        name,
        termsAccepted: legalConsent,
        privacyAccepted: legalConsent,
      }),
    onSuccess: (s) => {
      setRegistrationOpen(false)
      onPortalSuccess(s)
    },
    onError: portalErrorToast,
  })

  const heroSub = useMemo(() => {
    if (!branding) return t('myStreak.heroSubtitle')
    return `${branding.name} · ${branding.currency_code}`
  }, [branding, t])

  const phoneParsesOk = useMemo(() => normalizeSaudiMobileToE164(phone) !== null, [phone])

  const displayGreetingName = session?.display_name?.trim().length
    ? session.display_name.trim()
    : t('myStreak.dashboard.you')

  useEffect(() => {
    setSession(null)
    setPhone('')
    setName('')
    setStep('phone')
    setRegistrationOpen(false)
    setLegalConsent(false)
    setRestoring(true)
  }, [slug])

  useEffect(() => () => clearLongPress(), [clearLongPress])

  useEffect(() => {
    if (!slug || !supabaseBrowserClient) return
    const token = localStorage.getItem(sessionKey)
    if (!token) {
      setRestoring(false)
      return
    }
    let live = true
    void beginPortalSession({ sessionToken: token })
      .then((s) => {
        if (!live) return
        applyPortalSession(s, { silent: true })
      })
      .catch(() => {
        if (!live) return
        localStorage.removeItem(sessionKey)
      })
      .finally(() => {
        if (live) setRestoring(false)
      })
    return () => {
      live = false
    }
  }, [applyPortalSession, beginPortalSession, sessionKey, slug])

  useStreakupPortalRealtime({
    supabase: supabaseBrowserClient,
    customerId: session?.customer_id ?? null,
    onRewardsUpdate: () => {
      const token = localStorage.getItem(sessionKey)
      if (!token) return
      void beginPortalSession({ sessionToken: token })
        .then((s) => applyPortalSession(s, { silent: true }))
        .catch(() => {})
    },
    onVisitPoke: () => {
      const token = localStorage.getItem(sessionKey)
      if (!token) return

      setLiveVisitPulse((n) => n + 1)

      void beginPortalSession({ sessionToken: token })
        .then((s) => applyPortalSession(s, { silent: true }))
        .catch(() => {})
    },
  })

  if (!slug) return null

  if (!supabaseBrowserClient) {
    return <p className="text-muted-foreground text-sm">{t('myStreak.notConfigured')}</p>
  }

  const busyRestore = restoring && !session
  const onboardingBusy = phoneStep.isPending || nameStep.isPending || registerStep.isPending

  const legalLinks = useMemo(() => {
    const terms = (
      <Link to="/terms" className="font-semibold text-(--brand-primary) underline-offset-2 hover:underline">
        {locale === 'ar' ? 'شروط الاستخدام' : 'Terms of Service'}
      </Link>
    )
    const privacy = (
      <Link to="/privacy" className="font-semibold text-(--brand-primary) underline-offset-2 hover:underline">
        {locale === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy'}
      </Link>
    )
    return { terms, privacy }
  }, [locale])

  const handleLockSession = useCallback(() => {
    setSession(null)
    localStorage.removeItem(sessionKey)
  }, [sessionKey])

  const onboarding = !session

  return (
    <CustomerPortalShell showSessionBar={Boolean(session)} onLockSession={handleLockSession}>
    <div
      className={cn(
        'relative flex w-full flex-1 flex-col',
        onboarding ? 'min-h-dvh' : 'min-h-0',
      )}
    >
      {/* Full-viewport ambient background (not clipped by AppShell padding) */}
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0" style={portalMeshBg} />
        <PortalAmbientMesh />
        <div
          className="absolute inset-0 opacity-[0.025] mix-blend-overlay"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-11deg, transparent, transparent 1px, color-mix(in oklab, var(--brand-primary) 12%, transparent) 1px, color-mix(in oklab, var(--brand-primary) 12%, transparent) 2px)',
          }}
        />
      </div>

      {/* Café identity header */}
      <header className={cn('space-y-2 px-4 pt-4', onboarding && 'relative z-10')}>
        {brandingLoading ? (
          <Skeleton className="h-12 w-48" />
        ) : branding ? (
          <div className="flex items-center gap-3">
            {branding.logo_url ? (
              <img
                src={branding.logo_url}
                alt=""
                className="size-12 cursor-pointer rounded-2xl border border-white/15 bg-white/8 object-cover shadow-[0_0_28px_-10px_var(--brand-glow)] backdrop-blur-md transition hover:border-white/30 active:scale-[0.98]"
                onPointerDown={startLongPress}
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
              />
            ) : (
              <div
                className={cn(
                  'grid size-12 cursor-pointer place-items-center rounded-2xl border border-[color-mix(in_oklab,var(--brand-primary)_25%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,white)] text-xl font-semibold backdrop-blur-md transition hover:border-[color-mix(in_oklab,var(--brand-primary)_40%,white)] active:scale-[0.98]',
                  portalTextPrimary,
                )}
                onPointerDown={startLongPress}
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
              >
                {branding.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className={cn('text-2xl font-semibold tracking-tight', portalTextPrimary)}>
                {branding.name}
              </h1>
              <p className={cn('text-xs', portalTextMuted)}>{heroSub}</p>
            </div>
          </div>
        ) : (
          <p className={cn('text-sm', portalTextMuted)}>{t('myStreak.cafeMissing')}</p>
        )}
      </header>

      {!session ? (
        // ────────────────────────────────────────────────────────────────
        // ONBOARDING / SIGN-IN  (ultra-premium glass card)
        // ────────────────────────────────────────────────────────────────
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 26 }}
          className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-8"
        >
          <div className="relative mx-auto w-full max-w-sm">
          <div
            className="pointer-events-none absolute -inset-12 -z-10 opacity-80 blur-3xl"
            style={{
              background:
                'radial-gradient(50% 50% at 50% 35%, color-mix(in oklab, var(--brand-primary) 26%, transparent), transparent 75%)',
            }}
            aria-hidden
          />
          <div className={cn(portalGlassPanel, 'p-6')}>
            <div
              className="pointer-events-none absolute inset-x-0 -top-1 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent, color-mix(in oklab, var(--brand-primary) 80%, transparent), transparent)',
              }}
              aria-hidden
            />
            {step === 'name' ? (
              <button
                type="button"
                className={cn(
                  'mb-3 flex items-center gap-1.5 text-xs font-medium transition hover:opacity-100',
                  portalTextMuted,
                  'opacity-80 hover:text-[color-mix(in_oklab,#1a1030_90%,var(--brand-primary))]',
                )}
                onClick={() => {
                  setStep('phone')
                  setName('')
                }}
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                {t('myStreak.back')}
              </button>
            ) : null}

            <p className={cn('text-[10px] font-semibold uppercase tracking-[0.45em]', portalTextMuted)}>
              {step === 'phone' ? t('myStreak.signin.kicker') : t('myStreak.signup.kicker')}
            </p>
            <h2 className={cn('mt-1.5 text-2xl font-semibold tracking-tight', portalTextPrimary)}>
              {step === 'phone' ? t('myStreak.stepPhoneTitle') : t('myStreak.stepNameTitle')}
            </h2>
            <p className={cn('mt-1 text-xs', portalTextMuted)}>
              {step === 'phone' ? t('myStreak.stepPhoneHint') : t('myStreak.stepNameHint')}
            </p>

            <form
              className="mt-6 space-y-5"
              onSubmit={(e) => {
                e.preventDefault()
                if (step === 'phone') void phoneStep.mutateAsync().catch(() => {})
                else void nameStep.mutateAsync().catch(() => {})
              }}
            >
              {step === 'phone' ? (
                <div className="space-y-2">
                  <Label
                    htmlFor="portal-phone"
                    className={cn('text-[11px] font-semibold uppercase tracking-wider', portalTextMuted)}
                  >
                    {t('myStreak.phone')}
                  </Label>
                  <div className="relative">
                    <span
                      className={cn(
                        'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 select-none rounded-md border border-[color-mix(in_oklab,var(--brand-primary)_20%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_8%,white)] px-1.5 py-0.5 text-[10px] font-mono',
                        portalTextMuted,
                      )}
                    >
                      +966
                    </span>
                    <Input
                      id="portal-phone"
                      value={phone}
                      onChange={(e) => setPhone(constrainSaudiFiveDisplay(e.target.value))}
                      placeholder={t('myStreak.phonePlaceholder')}
                      dir="ltr"
                      className={cn(
                        'h-14 border-[color-mix(in_oklab,var(--brand-primary)_22%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_6%,white)] pl-16 text-left font-mono text-lg tracking-wide placeholder:opacity-40 focus-visible:border-(--brand-primary)/50 focus-visible:ring-(--brand-primary)/30',
                        portalTextPrimary,
                      )}
                      inputMode="numeric"
                      autoComplete="tel-national"
                      autoFocus
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border border-[color-mix(in_oklab,var(--brand-primary)_18%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_8%,white)] px-3.5 py-2.5 text-xs backdrop-blur-md">
                    <p className={cn('text-[10px] uppercase tracking-wider', portalTextMuted)}>
                      {t('myStreak.phone')}
                    </p>
                    <p dir="ltr" className={cn('mt-0.5 font-mono text-sm', portalTextPrimary)}>
                      +966 {phone || '—'}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="portal-name"
                      className={cn('text-[11px] font-semibold uppercase tracking-wider', portalTextMuted)}
                    >
                      {t('myStreak.nameShort')}
                    </Label>
                    <Input
                      id="portal-name"
                      className={cn(
                        'h-14 border-[color-mix(in_oklab,var(--brand-primary)_22%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_6%,white)] text-base placeholder:opacity-40 focus-visible:border-(--brand-primary)/50 focus-visible:ring-(--brand-primary)/30',
                        portalTextPrimary,
                      )}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('myStreak.namePlaceholder')}
                      autoComplete="name"
                      autoCapitalize="words"
                      autoFocus
                    />
                  </div>
                </>
              )}
              {(phoneStep.isError && step === 'phone') || (nameStep.isError && step === 'name') ? (
                <p className="text-destructive text-sm">{t('myStreak.loginError')}</p>
              ) : null}
              {/* Legacy inline name step retained, but new users register via modal. */}
              {step === 'phone' ? (
                <p className={cn('text-[11px] leading-relaxed', portalTextMuted)}>
                  {locale === 'ar' ? (
                    <>
                      بالمتابعة، أنت توافق على {legalLinks.terms} و{legalLinks.privacy}.
                    </>
                  ) : (
                    <>
                      By continuing, you agree to the {legalLinks.terms} and {legalLinks.privacy}.
                    </>
                  )}
                </p>
              ) : null}
              <motion.button
                type="submit"
                whileTap={{ scale: 0.98 }}
                disabled={
                  onboardingBusy ||
                  busyRestore ||
                  !branding ||
                  (step === 'phone' && !phoneParsesOk) ||
                  (step === 'name' && name.trim().length < 2)
                }
                className={cn(
                  'relative h-14 w-full overflow-hidden rounded-2xl text-base font-semibold transition',
                  ((step === 'phone' && phoneParsesOk) ||
                    (step === 'name' && name.trim().length >= 2))
                    ? 'bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black shadow-[0_30px_80px_-30px_var(--brand-glow)]'
                    : cn(
                        'cursor-not-allowed border border-[color-mix(in_oklab,var(--brand-primary)_15%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_6%,white)]',
                        portalTextMuted,
                        'opacity-60',
                      ),
                )}
              >
                <span className="relative z-10">
                  {step === 'phone'
                    ? phoneStep.isPending
                      ? t('myStreak.checking')
                      : t('myStreak.continue')
                    : nameStep.isPending
                      ? t('myStreak.creating')
                      : t('myStreak.finish')}
                </span>
                {!reduceMotion ? (
                  <motion.span
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.55)_50%,transparent_65%)]"
                    animate={{ x: ['-100%', '120%'] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.6 }}
                    aria-hidden
                  />
                ) : null}
              </motion.button>

            </form>
          </div>
          </div>
        </motion.div>
      ) : (
        // ────────────────────────────────────────────────────────────────
        // DASHBOARD  (premium glass surface)
        // ────────────────────────────────────────────────────────────────
        <motion.div
          key="dashboard"
          className="relative z-10 px-4 pb-4"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26, mass: 0.7 }}
        >
          <SuccessBurst active={welcomeBurst} anchor="center" />

          <div className="mt-8 space-y-1 px-1">
            <p className={cn('text-[10px] font-semibold tracking-[0.45em]', portalTextMuted)}>
              {session.is_new ? t('myStreak.dashboard.kickerNew') : t('myStreak.dashboard.kickerReturning')}
            </p>
            <h2 className={cn('text-[1.75rem] font-semibold tracking-tight', portalTextPrimary)}>
              {t('myStreak.dashboard.hi').replace('{name}', displayGreetingName)}
            </h2>
          </div>

          {/* HERO STREAK — the prestige medal */}
          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, type: 'spring', stiffness: 240, damping: 24 }}
            className={cn(portalGlassPanel, 'mt-5 p-7')}
          >
            {/* aurora wash */}
            <motion.div
              className="pointer-events-none absolute inset-0 opacity-95"
              style={{
                background:
                  'radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--brand-primary) 32%, transparent), transparent 55%), radial-gradient(80% 60% at 100% 100%, color-mix(in oklab, var(--brand-secondary) 26%, transparent), transparent 55%)',
              }}
              animate={reduceMotion ? undefined : { opacity: [0.85, 1, 0.85] }}
              transition={reduceMotion ? undefined : { duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
              aria-hidden
            />
            {/* top-edge hairline accent */}
            <div
              className="pointer-events-none absolute inset-x-6 -top-px h-px opacity-90"
              style={{
                background:
                  'linear-gradient(90deg, transparent, color-mix(in oklab, var(--brand-primary) 75%, white 20%), transparent)',
              }}
              aria-hidden
            />

            <div className="relative flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1.5">
                <p className={cn('text-[11px] font-semibold uppercase tracking-[0.35em]', portalTextMuted)}>
                  {t('myStreak.stat.streak')}
                </p>
                <p className="flex items-baseline gap-2.5">
                  <motion.span
                    key={session.current_streak}
                    initial={reduceMotion ? false : { scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                    className={cn('text-6xl font-semibold tabular-nums', portalTextPrimary)}
                    style={{ textShadow: '0 0 32px var(--brand-glow)' }}
                  >
                    {session.current_streak}
                  </motion.span>
                  <span className={cn('text-sm font-medium', portalTextMuted)}>
                    {t('myStreak.dashboard.days')}
                  </span>
                </p>
                {session.is_grace_day_today ? (
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/35 bg-cyan-500/12 px-3 py-1.5 text-xs font-semibold text-cyan-100"
                  >
                    <Palmtree className="size-3.5" aria-hidden />
                    {t('myStreak.graceDayBadge')}
                  </motion.div>
                ) : null}
                {session.visited_today ? (
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.88 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 22, delay: 0.1 }}
                    className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/12 px-3 py-1.5 text-xs font-semibold text-emerald-200 shadow-[0_0_20px_-6px_rgba(16,185,129,0.5)]"
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    {t('myStreak.todaySecured')}
                  </motion.div>
                ) : !session.is_grace_day_today ? (
                  <p className={cn('text-xs leading-relaxed', portalTextMuted)}>
                    {session.is_new
                      ? t('myStreak.dashboard.firstVisitHint')
                      : t('myStreak.dashboard.returningHint')}
                  </p>
                ) : null}
              </div>

              {/* animated flame medallion */}
              <div className="relative">
                <motion.div
                  key={`visit-pulse-${liveVisitPulse}`}
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1.25 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                  className="pointer-events-none absolute inset-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, color-mix(in oklab, var(--brand-primary) 50%, transparent), transparent 70%)',
                    filter: 'blur(6px)',
                  }}
                  aria-hidden
                />
                {session.is_grace_day_today ? (
                  <motion.div
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                      background:
                        'radial-gradient(circle, rgba(56,189,248,0.35), transparent 70%)',
                    }}
                    animate={reduceMotion ? undefined : { opacity: [0.4, 0.75, 0.4] }}
                    transition={reduceMotion ? undefined : { duration: 3, repeat: Infinity }}
                    aria-hidden
                  />
                ) : (
                  <motion.div
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                      background:
                        'radial-gradient(circle, color-mix(in oklab, var(--brand-secondary) 70%, transparent), transparent 70%)',
                    }}
                    animate={reduceMotion ? undefined : { scale: [0.9, 1.25, 0.9], opacity: [0.5, 0.85, 0.5] }}
                    transition={reduceMotion ? undefined : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                    aria-hidden
                  />
                )}
                <motion.div
                  animate={
                    session.is_grace_day_today
                      ? reduceMotion
                        ? undefined
                        : { scale: [1, 1.03, 1] }
                      : reduceMotion
                        ? undefined
                        : { rotate: [-3, 3, -3], scale: [1, 1.06, 1] }
                  }
                  transition={
                    reduceMotion ? undefined : { duration: session.is_grace_day_today ? 3.2 : 2.4, repeat: Infinity, ease: 'easeInOut' }
                  }
                  className={cn(
                    'relative grid size-20 shrink-0 place-items-center rounded-3xl border backdrop-blur-md',
                    session.is_grace_day_today
                      ? 'border-cyan-300/40 bg-[linear-gradient(145deg,#ecfeff,#bae6fd)]'
                      : 'border-[color-mix(in_oklab,var(--brand-primary)_28%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_12%,white)]',
                  )}
                  aria-hidden
                >
                  {session.is_grace_day_today ? (
                    <Snowflake className="size-9 text-cyan-600 drop-shadow-[0_0_18px_rgba(56,189,248,0.45)]" />
                  ) : (
                    <Flame className="size-9 text-(--brand-secondary) drop-shadow-[0_0_18px_var(--brand-glow)]" />
                  )}
                </motion.div>
              </div>
            </div>
          </motion.section>

          <StreakDualTimers
            timeZone={session.cafe_timezone || branding?.timezone || 'UTC'}
            visitedToday={session.visited_today}
            currentStreak={session.current_streak}
            nextVisitOpensAt={session.next_visit_opens_at}
            streakExpiresAt={session.streak_expires_at}
          />

          {/* PIN reveal — luxe shimmer card */}
          <motion.section
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 280, damping: 26 }}
            className={cn(portalGlassPanel, 'mt-4 rounded-3xl p-5')}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <p className={cn('flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider', portalTextMuted)}>
                  <Sparkles className="size-3 text-(--brand-secondary)" aria-hidden />
                  {t('myStreak.pinReveal')}
                </p>
                <p
                  dir="ltr"
                  className={cn('font-mono text-3xl font-semibold tracking-[0.45em]', portalTextPrimary)}
                  style={{ textShadow: '0 0 28px var(--brand-glow)' }}
                >
                  {session.pin_code}
                </p>
                <p className={cn('max-w-[24ch] text-[11px] leading-relaxed', portalTextMuted)}>
                  {t('myStreak.pinRevealHint')}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className={cn(
                  'shrink-0 border border-[color-mix(in_oklab,var(--brand-primary)_28%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,white)] backdrop-blur hover:bg-[color-mix(in_oklab,var(--brand-primary)_18%,white)]',
                  portalTextPrimary,
                )}
                onClick={() => void copyPinCode()}
              >
                {pinJustCopied ? (
                  <Check className="me-2 size-4 text-emerald-300" aria-hidden />
                ) : (
                  <Copy className="me-2 size-4" aria-hidden />
                )}
                {pinJustCopied ? t('myStreak.pinCopied') : t('myStreak.pinCopy')}
              </Button>
            </div>
          </motion.section>

          {/* Stat tiles — premium glass with iconography */}
          <div className="mt-5 grid grid-cols-3 gap-2.5 px-1">
            {[
              {
                k: t('myStreak.stat.best'),
                v: session.longest_streak,
                Icon: Trophy,
                tint: 'text-amber-200/85',
              },
              {
                k: t('myStreak.stat.shields'),
                v: session.shields,
                Icon: Shield,
                tint: 'text-sky-200/85',
              },
              {
                k: t('myStreak.stat.milestones'),
                v: session.milestones.filter((m) => m.earned_at).length,
                Icon: Flame,
                tint: 'text-rose-200/85',
              },
            ].map((c, i) => (
              <motion.div
                key={`stat-${String(i)}`}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * 0.04, type: 'spring', stiffness: 320, damping: 24 }}
                className={cn(
                  portalGlassPanel,
                  'rounded-2xl p-3.5 text-center',
                )}
              >
                <div
                  className="pointer-events-none absolute inset-0 opacity-60"
                  style={{
                    background:
                      'radial-gradient(80% 60% at 50% 0%, color-mix(in oklab, white 6%, transparent), transparent 60%)',
                  }}
                  aria-hidden
                />
                <div className="relative flex items-center justify-center gap-1">
                  <c.Icon className={cn('size-3.5', c.tint)} aria-hidden />
                  <p className={cn('text-[9px] font-semibold tracking-[0.25em]', portalTextMuted)}>{c.k}</p>
                </div>
                <p className={cn('relative mt-1 text-2xl font-semibold tabular-nums', portalTextPrimary)}>
                  {c.v}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Roadmap section header */}
          <div className="mt-12 min-w-0 overflow-x-hidden px-1">
            <div className="mb-4 flex items-end justify-between gap-3 px-1">
              <div>
                <p className={cn('text-[10px] font-semibold tracking-[0.4em]', portalTextMuted)}>
                  {t('myStreak.section.roadmap')}
                </p>
                <p className={cn('mt-1 text-sm', portalTextPrimary)}>{t('myStreak.section.roadmapSub')}</p>
              </div>
              <span
                className={cn(
                  'rounded-full border border-[color-mix(in_oklab,var(--brand-primary)_25%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,white)] px-2 py-1 text-[10px] font-mono tabular-nums backdrop-blur',
                  portalTextMuted,
                )}
              >
                {session.milestones.filter((m) => m.earned_at && !m.claimed_at).length}/
                {session.milestones.length}
              </span>
            </div>
            <StreakRoadmap
              streak={session.current_streak}
              milestones={session.milestones}
              claimFlashId={claimFlashId}
            />
          </div>

          <StreakCelebrationDialog open={celebrate} onOpenChange={setCelebrate} streak={session.current_streak} />
        </motion.div>
      )}

      {/* Registration modal (new customer path) */}
      <Dialog open={registrationOpen} onOpenChange={setRegistrationOpen}>
        <DialogContent className="border-white/10 bg-zinc-950/92 text-white">
          <DialogHeader>
            <DialogTitle>
              {locale === 'ar' ? 'إكمال التسجيل' : 'Complete registration'}
            </DialogTitle>
            <DialogDescription className="text-white/60">
              {locale === 'ar'
                ? 'أدخل اسمك ووافق على الشروط لإكمال التسجيل.'
                : 'Enter your name and accept the legal terms to finish signing up.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70" dir="ltr">
              +966 {phone || '—'}
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-white/70" htmlFor="portal-register-name">
                {t('myStreak.nameShort')}
              </Label>
              <Input
                id="portal-register-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('myStreak.namePlaceholder')}
                className="border-white/10 bg-black/40 text-white"
                autoFocus
                disabled={registerStep.isPending}
              />
            </div>

            <LegalConsentCheckbox
              variant="portal"
              checked={legalConsent}
              onChange={setLegalConsent}
              disabled={registerStep.isPending}
              id="portal-legal-consent-register"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRegistrationOpen(false)}
              disabled={registerStep.isPending}
            >
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button
              onClick={() => void registerStep.mutateAsync()}
              disabled={registerStep.isPending || name.trim().length < 2 || !legalConsent}
            >
              {registerStep.isPending
                ? locale === 'ar'
                  ? 'جارٍ التسجيل...'
                  : 'Registering...'
                : locale === 'ar'
                  ? 'تسجيل'
                  : 'Register'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </CustomerPortalShell>
  )
}
