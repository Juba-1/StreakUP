import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { PremiumStaticBackdrop } from '@/components/auth/PremiumStaticBackdrop'
import { LegalConsentCheckbox } from '@/components/legal/LegalConsentCheckbox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RouteFallback } from '@/components/layout/RouteFallback'
import { resolvePostLoginTarget } from '@/core/auth/resolvePostLoginTarget'
import { fetchStaffBootstrap } from '@/core/auth/resolveStaffDashboard'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/hooks/useProfile'
import { useStaffDashboardPath } from '@/hooks/useStaffDashboardPath'
import { recordLegalConsent } from '@/lib/legal/record-consent'
import {
  getLockoutMsRemaining,
  LOGIN_WINDOW,
  registerFailure,
  registerSuccess,
} from '@/lib/security/rateLimit'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'
import { loginSchema, zEmail, zPassword } from '@/lib/validation/schemas'
import { z } from 'zod'

function loginBlockedMessage(
  t: (key: string) => string,
  reason: string | null | undefined,
  cafeStatus?: string | null,
) {
  switch (reason) {
    case 'maintenance_mode':
      return t('auth.login.blocked.maintenance_mode')
    case 'cafe_inactive':
      return cafeStatus
        ? t('auth.login.blocked.cafe_inactive_status').replace('{status}', cafeStatus)
        : t('auth.login.blocked.cafe_inactive')
    case 'no_workspace':
      return t('auth.login.blocked.no_workspace')
    case 'unknown_role':
      return t('auth.login.blocked.unknown_role')
    case 'no_profile':
      return t('auth.login.blocked.no_profile')
    case 'missing_cafe':
    case 'missing_slug':
      return t('auth.login.blocked.misconfigured')
    case 'missing_branch':
    case 'missing_branch_code':
      return t('auth.login.blocked.misconfigured')
    case 'legal_consent_required':
      return t('auth.login.blocked.legal_consent_required')
    default:
      return t('auth.login.blocked.generic')
  }
}

function hashIndicatesRecovery(): boolean {
  if (typeof window === 'undefined') return false
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  try {
    return new URLSearchParams(raw).get('type') === 'recovery'
  } catch {
    return false
  }
}

const recoveryPwSchema = z
  .object({
    a: zPassword,
    b: z.string(),
  })
  .strict()
  .refine((v) => v.a === v.b, { message: 'recovery_mismatch' })

export function LoginPage() {
  const { session, loading } = useAuth()
  const { t, locale, setLocale } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { data: profile } = useProfile()
  const { data: homePath, isPending: homePending } = useStaffDashboardPath()

  const [recoveryActive, setRecoveryActive] = useState(hashIndicatesRecovery)
  const [newPwA, setNewPwA] = useState('')
  const [newPwB, setNewPwB] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)

  const [forgotOpen, setForgotOpen] = useState(false)
  const [resetEmail, setResetEmail] = useState('')

  const from = useMemo(() => {
    const state = location.state as { from?: string } | null
    const raw = state?.from
    if (!raw || raw === '/' || raw === '/login') return null
    if (raw.startsWith('/cashier') || raw.startsWith('/my-streak')) return null
    if (raw.startsWith('/branch')) return raw
    return raw
  }, [location.state])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [lockMs, setLockMs] = useState(0)
  const [legalConsent, setLegalConsent] = useState(false)

  useEffect(() => {
    if (!supabaseBrowserClient) return
    const { data } = supabaseBrowserClient.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryActive(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!forgotOpen) return
    setResetEmail(email.trim())
  }, [email, forgotOpen])

  useEffect(() => {
    if (lockMs <= 0) return
    const id = window.setInterval(() => {
      const remaining = getLockoutMsRemaining(LOGIN_WINDOW, email.trim().toLowerCase() || 'anon')
      setLockMs(remaining)
      if (remaining <= 0) window.clearInterval(id)
    }, 500)
    return () => window.clearInterval(id)
  }, [lockMs, email])

  if (!supabaseBrowserClient) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        <h1 className="text-xl font-semibold">{t('auth.login.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('auth.login.noEnv')}</p>
      </div>
    )
  }

  const supabase = supabaseBrowserClient

  if (!loading && session && recoveryActive) {
    return (
      <div className="relative mx-auto flex w-full max-w-lg flex-col gap-8 py-6">
        <PremiumStaticBackdrop />

        <div className="relative overflow-hidden rounded-[1.75rem] border border-white/9 bg-zinc-950/75 p-8 shadow-[0_40px_120px_-48px_var(--brand-glow)] backdrop-blur-2xl md:p-10">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t('auth.login.recoveryTitle')}</h1>
          <p className="text-muted-foreground mt-6 text-sm">{t('auth.login.recoveryHint')}</p>

          <form
            className="mt-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setRecoveryBusy(true)

              const ok = recoveryPwSchema.safeParse({ a: newPwA, b: newPwB })
              if (!ok.success) {
                toast.error(
                  ok.error.issues.some((i) => i.message === 'recovery_mismatch')
                    ? t('auth.login.recoveryMismatch')
                    : t('auth.login.invalid'),
                )
                setRecoveryBusy(false)
                return
              }

              const { error: ue } = await supabase.auth.updateUser({
                password: ok.data.a,
              })
              if (ue) {
                toast.error(ue.message)
                setRecoveryBusy(false)
                return
              }

              toast.success(t('auth.login.recoveryDone'))
              setRecoveryActive(false)
              window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)

              await qc.invalidateQueries({ queryKey: ['profile'] })
              await qc.invalidateQueries({ queryKey: ['staff-dashboard-path'] })

              const boot = await fetchStaffBootstrap(supabase)
              if (!boot.ok || boot.path === '/login') {
                await supabase.auth.signOut()
                setRecoveryBusy(false)
                toast.error(loginBlockedMessage(t, boot.reason, boot.cafe_status))
                navigate('/login', { replace: true })
                return
              }

              setRecoveryBusy(false)
              navigate(from ?? boot.path, { replace: true })
            }}
          >
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground text-xs font-medium">{t('auth.login.newPassword')}</span>
              <input
                className={cn(
                  'border-input bg-background/80 h-11 rounded-xl border px-3 text-sm outline-none',
                  'focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--brand-primary)_55%,transparent)] focus-visible:ring-offset-0',
                )}
                type="password"
                autoComplete="new-password"
                value={newPwA}
                onChange={(e) => setNewPwA(e.target.value)}
                required
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground text-xs font-medium">{t('auth.login.confirmPassword')}</span>
              <input
                className={cn(
                  'border-input bg-background/80 h-11 rounded-xl border px-3 text-sm outline-none',
                  'focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--brand-primary)_55%,transparent)] focus-visible:ring-offset-0',
                )}
                type="password"
                autoComplete="new-password"
                value={newPwB}
                onChange={(e) => setNewPwB(e.target.value)}
                required
              />
            </label>
            <Button
              className="h-12 w-full rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-base font-semibold text-black"
              disabled={recoveryBusy}
              type="submit"
            >
              {recoveryBusy ? t('auth.login.working') : t('auth.login.recoverySubmit')}
            </Button>
          </form>
        </div>
      </div>
    )
  }

  if (!loading && session) {
    if (homePending || homePath === undefined) {
      return <RouteFallback />
    }
    const target = resolvePostLoginTarget(homePath, from, profile?.role)
    if (target === '/login') {
      return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-8">
          <p className="text-destructive text-sm">{t('auth.login.portal.unsupported')}</p>
          <Button type="button" variant="secondary" onClick={() => void supabase.auth.signOut()}>
            {t('shell.signOut')}
          </Button>
        </div>
      )
    }
    return <Navigate to={target} replace />
  }

  async function sendReset(emailVal: string) {
    const parsed = zEmail.safeParse(emailVal.trim())
    if (!parsed.success) {
      toast.error(t('auth.login.resetInvalidEmail'))
      return
    }
    setResetBusy(true)
    const redirectTo = `${window.location.origin}/login`
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo,
    })
    setResetBusy(false)
    if (error) {
      toast.error(error.message ?? t('auth.login.resetFail'))
      return
    }
    toast.success(t('auth.login.resetSent'))
    setForgotOpen(false)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const subject = email.trim().toLowerCase() || 'anon'
    const existingLock = getLockoutMsRemaining(LOGIN_WINDOW, subject)
    if (existingLock > 0) {
      setLockMs(existingLock)
      setBusy(false)
      setError(t('auth.login.lockout').replace('{seconds}', String(Math.ceil(existingLock / 1000))))
      return
    }

    if (!legalConsent) {
      setBusy(false)
      setError(t('legal.consent.required'))
      return
    }

    const parsed = loginSchema.safeParse({ email, password })
    if (!parsed.success) {
      setBusy(false)
      setError(t('auth.login.invalid'))
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    })

    if (signInError) {
      const { lockedMs } = registerFailure(LOGIN_WINDOW, subject)
      setLockMs(lockedMs)
      setBusy(false)
      setError(
        lockedMs > 0
          ? t('auth.login.lockout').replace('{seconds}', String(Math.ceil(lockedMs / 1000)))
          : signInError.message,
      )
      return
    }

    const user = (await supabase.auth.getUser()).data.user
    if (!user) {
      setBusy(false)
      setError(t('auth.login.sessionError'))
      return
    }

    const consent = await recordLegalConsent(supabase)
    if (!consent.ok) {
      await supabase.auth.signOut()
      setError(t('legal.consent.required'))
      setBusy(false)
      return
    }

    await qc.invalidateQueries({ queryKey: ['profile'] })
    await qc.invalidateQueries({ queryKey: ['staff-dashboard-path'] })
    const boot = await fetchStaffBootstrap(supabase)
    if (!boot.ok || boot.path === '/login') {
      await supabase.auth.signOut()
      await qc.invalidateQueries({ queryKey: ['profile'] })
      await qc.invalidateQueries({ queryKey: ['staff-dashboard-path'] })
      setError(loginBlockedMessage(t, boot.reason, boot.cafe_status))
      setBusy(false)
      return
    }
    registerSuccess(LOGIN_WINDOW, subject)
    const target = resolvePostLoginTarget(boot.path, from, boot.role)
    setBusy(false)
    navigate(target, { replace: true })
  }

  return (
    <div className="relative mx-auto flex w-full max-w-lg flex-col gap-8 py-6">
      <PremiumStaticBackdrop />

      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/9 bg-zinc-950/75 p-8 shadow-[0_40px_120px_-48px_var(--brand-glow)] backdrop-blur-2xl md:p-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(125deg, color-mix(in oklab, var(--brand-primary) 55%, transparent), transparent 45%), linear-gradient(215deg, color-mix(in oklab, var(--brand-secondary) 40%, transparent), transparent 50%)',
          }}
        />

        <div className="relative flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">{t('auth.login.portal.title')}</h1>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant={locale === 'en' ? 'default' : 'secondary'}
              size="sm"
              className="h-8 px-2 text-[11px]"
              onClick={() => setLocale('en', { userPicked: true })}
            >
              {t('shell.locale.en')}
            </Button>
            <Button
              type="button"
              variant={locale === 'ar' ? 'default' : 'secondary'}
              size="sm"
              className="h-8 px-2 text-[11px]"
              onClick={() => setLocale('ar', { userPicked: true })}
            >
              {t('shell.locale.ar')}
            </Button>
          </div>
        </div>

        <form className="relative mt-10 space-y-4" onSubmit={onSubmit}>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground text-xs font-medium">{t('auth.login.email')}</span>
            <input
              className={cn(
                'border-input bg-background/80 h-11 rounded-xl border px-3 text-sm outline-none',
                'ring-offset-background focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--brand-primary)_55%,transparent)] focus-visible:ring-offset-0',
              )}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground text-xs font-medium">{t('auth.login.password')}</span>
            <input
              className={cn(
                'border-input bg-background/80 h-11 rounded-xl border px-3 text-sm outline-none',
                'ring-offset-background focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--brand-primary)_55%,transparent)] focus-visible:ring-offset-0',
              )}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <LegalConsentCheckbox
            checked={legalConsent}
            onChange={setLegalConsent}
            disabled={busy || lockMs > 0}
            id="staff-legal-consent"
          />

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <div className="text-end">
            <button
              type="button"
              className="text-xs text-white/65 transition hover:text-white"
              onClick={() => {
                setForgotOpen(true)
                setResetEmail(email.trim())
              }}
            >
              {t('auth.login.forgot')}
            </button>
          </div>

          <Button
            className="h-12 w-full rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-base font-semibold text-black shadow-lg transition hover:opacity-95"
            disabled={busy || lockMs > 0 || !legalConsent}
            type="submit"
          >
            {busy
              ? t('auth.login.working')
              : lockMs > 0
                ? t('auth.login.lockout').replace('{seconds}', String(Math.ceil(lockMs / 1000)))
                : t('auth.login.portal.cta')}
          </Button>
        </form>
      </div>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent showCloseButton className="bg-zinc-950/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>{t('auth.login.forgotTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Label className="text-white/85">{t('auth.login.email')}</Label>
            <Input
              type="email"
              autoComplete="email"
              className="h-11 border-white/15 bg-black/40 text-white"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" onClick={() => setForgotOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={resetBusy} onClick={() => void sendReset(resetEmail)}>
              {resetBusy ? t('auth.login.working') : t('auth.login.resetAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
