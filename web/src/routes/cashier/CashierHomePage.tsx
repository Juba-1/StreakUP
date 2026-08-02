import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Clock,
  Crown,
  Delete,
  KeyRound,
  ShieldCheck,
  Sparkles,
  WifiOff,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { SuccessBurst } from '@/components/fx/SuccessBurst'
import { CashierRewardsPanel } from '@/routes/cashier/CashierRewardsPanel'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import type { CashierDeviceSession } from '@/lib/cashierDeviceUnlock'
import { recordVisitByDevice } from '@/lib/cashierDeviceVisit'
import { hapticError, hapticSuccess, hapticTap } from '@/lib/haptics'
import {
  enqueueOfflineVisit,
  listQueuedVisits,
  removeQueuedVisit,
} from '@/lib/cashierOfflineQueue'
import {
  CASHIER_PIN_WINDOW,
  getLockoutMsRemaining,
  registerFailure,
  registerSuccess,
} from '@/lib/security/rateLimit'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'
import { zPin } from '@/lib/validation/schemas'

// Phone-pad layout (1-2-3 top row, 0 bottom-middle) — universally recognised
// by baristas and matches every POS terminal on the market.
const KEYPAD: Array<Array<{ k: string; intent?: 'digit' | 'clear' | 'del' }>> = [
  [
    { k: '1', intent: 'digit' },
    { k: '2', intent: 'digit' },
    { k: '3', intent: 'digit' },
  ],
  [
    { k: '4', intent: 'digit' },
    { k: '5', intent: 'digit' },
    { k: '6', intent: 'digit' },
  ],
  [
    { k: '7', intent: 'digit' },
    { k: '8', intent: 'digit' },
    { k: '9', intent: 'digit' },
  ],
  [
    { k: 'CLR', intent: 'clear' },
    { k: '0', intent: 'digit' },
    { k: 'DEL', intent: 'del' },
  ],
]

const PIN_MAX = 8
const PIN_MIN = 4

type FoundCustomer = {
  id: string
  fullName: string | null
  currentStreak: number
}

type CashierHomePageProps = {
  deviceSession: CashierDeviceSession
  cafeSlug: string
  branchCode: string
}

export function CashierHomePage({
  deviceSession,
  cafeSlug: cafeSlugProp,
  branchCode: branchCodeProp,
}: CashierHomePageProps) {
  const { cafeSlug: cafeSlugParam, branchCode: branchCodeParam } = useParams()
  const cafeSlug = (cafeSlugProp ?? cafeSlugParam ?? '').toLowerCase()
  const branchCode = (branchCodeProp ?? branchCodeParam ?? '').toLowerCase()
  const qc = useQueryClient()
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const { data: profile } = useProfile()

  const [pin, setPin] = useState('')
  const [verified, setVerified] = useState<FoundCustomer | null>(null)
  const [alreadyToday, setAlreadyToday] = useState<FoundCustomer | null>(null)
  const [offlinePending, setOfflinePending] = useState(0)
  const [visitBurst, setVisitBurst] = useState(false)
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const burstTimerRef = useRef<number | null>(null)
  const clearVisitPanelTimerRef = useRef<number | null>(null)

  const refreshQueueCount = useCallback(() => {
    setOfflinePending(listQueuedVisits(deviceSession.branchId).length)
  }, [deviceSession.branchId])

  const branchQuery = useQuery({
    queryKey: ['cashier-branch-device', cafeSlug, branchCode, deviceSession.branchId],
    enabled: Boolean(supabaseBrowserClient && cafeSlug && branchCode && deviceSession.token),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('cashier_branch_public_lookup', {
        p_cafe_slug: cafeSlug,
        p_branch_code: branchCode,
      })
      if (error) throw error
      const res = data as {
        ok?: boolean
        branch_id?: string
        branch_name?: string
        branch_code?: string
        cafe_id?: string
        cafe_slug?: string
      }
      if (!res?.ok || !res.branch_id) return null
      if (res.branch_id !== deviceSession.branchId) return null
      if (res.cafe_slug && res.cafe_slug.toLowerCase() !== cafeSlug) return null
      if (deviceSession.cafeSlug && deviceSession.cafeSlug.toLowerCase() !== cafeSlug) return null
      return {
        id: res.branch_id,
        name: res.branch_name ?? deviceSession.branchName ?? branchCode,
        branch_code: res.branch_code ?? branchCode,
        cafe_id: res.cafe_id ?? deviceSession.cafeId,
        cafe_slug: res.cafe_slug ?? cafeSlug,
      }
    },
  })

  const branch = branchQuery.data ?? {
    id: deviceSession.branchId,
    name: deviceSession.branchName ?? branchCode,
    branch_code: deviceSession.branchCode,
    cafe_id: deviceSession.cafeId,
    cafe_slug: deviceSession.cafeSlug ?? cafeSlug,
  }

  // Fail closed: URL café must match device session café (prevents cross-tenant reuse).
  const sessionCafeOk =
    Boolean(deviceSession.cafeSlug) &&
    deviceSession.cafeSlug.toLowerCase() === cafeSlug &&
    (!deviceSession.branchCode || deviceSession.branchCode.toLowerCase() === branchCode)

  // Access matrix — see server-side mirror in supabase/phase18.sql.
  const accessLevel = useMemo<'cashier' | 'manager' | 'hq' | 'super' | 'denied'>(() => {
    if (!profile || !branch) return 'denied'
    if (profile.role === 'super_admin') return 'super'
    if (profile.role === 'hq_owner' && profile.cafe_id === branch.cafe_id) return 'hq'
    if (
      profile.role === 'branch_manager' &&
      profile.branch_id === branch.id &&
      profile.cafe_id === branch.cafe_id
    )
      return 'manager'
    if (
      profile.role === 'cashier' &&
      profile.branch_id === branch.id &&
      profile.cafe_id === branch.cafe_id
    )
      return 'cashier'
    return 'denied'
  }, [profile, branch])

  const isPrivilegedPreview = accessLevel === 'hq' || accessLevel === 'super'

  const flushOfflineQueue = useCallback(async () => {
    if (!navigator.onLine || !deviceSession.token) {
      refreshQueueCount()
      return
    }
    const items = listQueuedVisits(deviceSession.branchId)
    const before = items.length
    for (const q of items) {
      try {
        await recordVisitByDevice(deviceSession.token, q.input)
        removeQueuedVisit(deviceSession.branchId, q.id)
      } catch {
        break
      }
    }
    refreshQueueCount()
    await qc.invalidateQueries({ queryKey: ['cashier-branch'] })
    const after = listQueuedVisits(deviceSession.branchId).length
    if (before > after) {
      toast.success(t('cashier.toast.syncedBatch').replace('{n}', String(before - after)))
    }
  }, [deviceSession.token, deviceSession.branchId, qc, refreshQueueCount, t])

  useEffect(() => {
    function onOnline() {
      setIsOnline(true)
      void flushOfflineQueue()
    }
    function onOffline() {
      setIsOnline(false)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void flushOfflineQueue()
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [flushOfflineQueue])

  useEffect(() => {
    return () => {
      if (burstTimerRef.current != null) window.clearTimeout(burstTimerRef.current)
      if (clearVisitPanelTimerRef.current != null) window.clearTimeout(clearVisitPanelTimerRef.current)
    }
  }, [])

  const findCustomer = useMutation({
    mutationFn: async (): Promise<{ customer: FoundCustomer; subject: string }> => {
      const parsed = zPin.safeParse(pin)
      if (!parsed.success) throw new Error('invalid_pin')
      if (!branch?.id || !branch?.cafe_id) throw new Error('missing_branch')

      // Client-side preflight: localStorage lockout (offline reconnect path).
      const subject = `${branch.cafe_id}:pin:${parsed.data}`
      const remaining = getLockoutMsRemaining(CASHIER_PIN_WINDOW, subject)
      if (remaining > 0) {
        const err = new Error('locked') as Error & { retryMs?: number }
        err.retryMs = remaining
        throw err
      }

      const { data, error } = await supabaseBrowserClient!.rpc('cashier_find_customer_by_device', {
        p_device_token: deviceSession.token,
        p_branch_id: branch.id,
        p_pin: parsed.data,
      })
      if (error) throw error

      const res = data as
        | {
            ok?: boolean
            customer_id?: string
            full_name?: string | null
            current_streak?: number
            reason?: string
            retry_after_ms?: number
          }
        | null

      if (!res?.ok || !res.customer_id) {
        if (res?.reason === 'rate_limited') {
          const err = new Error('locked') as Error & { retryMs?: number }
          err.retryMs = res.retry_after_ms ?? 45_000
          throw err
        }
        if (res?.reason === 'forbidden') throw new Error('forbidden')
        if (res?.reason === 'invalid_pin') throw new Error('invalid_pin')
        throw new Error('not_found')
      }

      return {
        customer: {
          id: res.customer_id,
          fullName: res.full_name ?? null,
          currentStreak: res.current_streak ?? 0,
        },
        subject,
      }
    },
    onSuccess: ({ customer, subject }) => {
      hapticSuccess()
      registerSuccess(CASHIER_PIN_WINDOW, subject)
      setVerified(customer)
      toast.success(t('cashier.toast.verified'))
    },
    onError: (e: Error & { retryMs?: number }) => {
      hapticError()
      if (e.message === 'locked') {
        const secs = Math.ceil((e.retryMs ?? 45_000) / 1000)
        toast.error(t('cashier.toast.locked').replace('{seconds}', String(secs)))
        return
      }
      if (e.message === 'invalid_pin') {
        toast.error(t('cashier.toast.invalidPin'))
        return
      }
      if (e.message === 'forbidden') {
        toast.error(t('cashier.toast.forbidden'))
        return
      }
      if (e.message === 'missing_branch') {
        toast.error(t('cashier.branchMissing'))
        return
      }
      // Transport failures are not "wrong PIN" — don't burn lockout attempts.
      if (!navigator.onLine || /failed to fetch|fetch failed|networkerror|load failed/i.test(e.message ?? '')) {
        toast.error(t('cashier.toast.network'))
        return
      }
      const cafeId = profile?.cafe_id ?? branch?.cafe_id ?? 'unknown'
      const subject = `${cafeId}:pin:${pin.trim()}`
      const { lockedMs } = registerFailure(CASHIER_PIN_WINDOW, subject)
      if (lockedMs > 0) {
        toast.error(t('cashier.toast.locked').replace('{seconds}', String(Math.ceil(lockedMs / 1000))))
      } else {
        toast.error(t('cashier.toast.noMatch'))
      }
      // Shake the pad — clear the wrong PIN so the cashier can retry cleanly.
      setPin('')
    },
  })

  const visit = useMutation({
    mutationFn: async () => {
      if (!branch?.id || !verified?.id) throw new Error('missing')

      const input = {
        branchId: branch.id,
        customerId: verified.id,
        idempotencyKey: `cashier_${crypto.randomUUID()}`,
        eventType: 'check_in' as const,
        clientVisitDate: null as string | null,
      }

      if (!navigator.onLine) {
        enqueueOfflineVisit(input)
        return { mode: 'queued' as const, alreadyVisitedToday: false, streakAfter: undefined }
      }

      try {
        const res = await recordVisitByDevice(deviceSession.token, input)
        const alreadyVisitedToday = Boolean(res.already_visited_today)
        const created =
          (res.status === 'created' || res.status === 'replay') && !alreadyVisitedToday

        return {
          mode: created ? ('created' as const) : ('synced' as const),
          alreadyVisitedToday,
          streakAfter: res.streak_after,
          status: res.status,
        }
      } catch (e) {
        // Only transport failures belong in the offline queue — server rejections
        // (e.g. revoked device token) would sit at the queue head and block sync.
        const msg = e instanceof Error ? e.message : ''
        const transport =
          !navigator.onLine || /failed to fetch|fetch failed|networkerror|load failed/i.test(msg)
        if (transport) {
          enqueueOfflineVisit(input)
          return { mode: 'queued' as const, alreadyVisitedToday: false, streakAfter: undefined }
        }
        throw e
      }
    },
    onSuccess: async (result) => {
      refreshQueueCount()
      await qc.invalidateQueries({ queryKey: ['cashier-branch'] })

      if (result.mode === 'queued') {
        hapticSuccess()
        toast.info(t('cashier.offlineQueued'))
        setVerified(null)
        setPin('')
        return
      }

      if (result.alreadyVisitedToday) {
        hapticError()
        toast.warning(t('cashier.alreadyToday.toast'))
        setAlreadyToday(verified)
        setVerified(null)
        setPin('')
        return
      }

      const nextStreak =
        typeof result.streakAfter === 'number'
          ? result.streakAfter
          : (verified?.currentStreak ?? 0) + 1

      if (verified) {
        setVerified({ ...verified, currentStreak: nextStreak })
      }

      hapticSuccess()
      setVisitBurst(true)
      if (burstTimerRef.current != null) window.clearTimeout(burstTimerRef.current)
      burstTimerRef.current = window.setTimeout(() => setVisitBurst(false), 800)
      toast.success(t('cashier.toast.visitConfirmed'))

      if (clearVisitPanelTimerRef.current != null) {
        window.clearTimeout(clearVisitPanelTimerRef.current)
      }
      clearVisitPanelTimerRef.current = window.setTimeout(() => {
        clearVisitPanelTimerRef.current = null
        setVerified(null)
        setPin('')
      }, 900)
    },
    onError: (e: Error) => {
      hapticError()
      if (e.message === 'forbidden') {
        toast.error(t('cashier.toast.forbidden'))
        return
      }
      toast.error(t('cashier.toast.visitFailed'))
    },
  })

  const pinReady = pin.trim().length >= PIN_MIN

  const handleKey = useCallback(
    (key: string) => {
      hapticTap()
      if (key === 'CLR') {
        setPin('')
        return
      }
      if (key === 'DEL') {
        setPin((p) => p.slice(0, -1))
        return
      }
      setPin((p) => (p.length >= PIN_MAX ? p : p + key))
    },
    [],
  )

  // Hardware-keyboard fallback (Bluetooth iPad keyboard).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (/^[0-9]$/.test(e.key)) {
        handleKey(e.key)
      } else if (e.key === 'Backspace') {
        handleKey('DEL')
      } else if (e.key === 'Escape') {
        handleKey('CLR')
      } else if (e.key === 'Enter') {
        if (alreadyToday) {
          setAlreadyToday(null)
        } else if (verified) {
          if (!visit.isPending) visit.mutate()
        } else if (pinReady && !findCustomer.isPending) {
          void findCustomer.mutateAsync()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [alreadyToday, verified, findCustomer, handleKey, pinReady, visit])

  if (!sessionCafeOk) {
    return <p className="text-muted-foreground text-sm">{t('cashier.branchMissing')}</p>
  }

  // Offline reload: the device session is the authority — render with the
  // session fallback instead of stranding the kiosk on skeleton/error screens.
  if (branchQuery.isLoading && isOnline) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[28rem] w-full" />
          <Skeleton className="h-[28rem] w-full" />
        </div>
      </div>
    )
  }

  if (isOnline && (branchQuery.isError || (branchQuery.isFetched && !branch?.id))) {
    return <p className="text-muted-foreground text-sm">{t('cashier.branchMissing')}</p>
  }

  return (
    <div className="relative">
      <SuccessBurst active={visitBurst} anchor="center" />

      {/* Brand-tinted background wash ----------------------------------- */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background: `
              radial-gradient(80% 50% at 50% -8%, color-mix(in oklab, var(--brand-primary) 18%, transparent), transparent 60%),
              radial-gradient(45% 40% at 100% 100%, color-mix(in oklab, var(--brand-secondary) 14%, transparent), transparent 55%)
            `,
          }}
        />
      </div>

      {/* Terminal frame ------------------------------------------------- */}
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950/55 shadow-[0_60px_160px_-50px_rgba(0,0,0,0.7)] backdrop-blur-2xl">
        {/* Header strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/35 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black shadow-[0_0_30px_-8px_var(--brand-glow)]">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.45em] text-white/45">
                {t('cashier.header.kicker')}
              </p>
              <p className="truncate text-base font-semibold text-white">
                {branch?.name ?? '—'}{' '}
                <span dir="ltr" className="text-muted-foreground font-mono text-xs">
                  · {branchCode}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isPrivilegedPreview ? (
              <Chip
                tone="brand"
                icon={<Crown className="size-3" aria-hidden />}
                label={
                  accessLevel === 'super'
                    ? t('cashier.badge.superPreview')
                    : t('cashier.badge.hqPreview')
                }
              />
            ) : null}
            <Chip
              tone={isOnline ? 'live' : 'warn'}
              icon={
                isOnline ? (
                  <CircleDot className="size-3 animate-pulse text-emerald-300" aria-hidden />
                ) : (
                  <WifiOff className="size-3 text-amber-300" aria-hidden />
                )
              }
              label={isOnline ? t('cashier.badge.live') : t('cashier.badge.offline')}
            />
            {offlinePending > 0 ? (
              <Chip
                tone="warn"
                icon={<Zap className="size-3 text-amber-200" aria-hidden />}
                label={`${t('cashier.badge.pending')}: ${offlinePending}`}
              />
            ) : null}
          </div>
        </div>

        {/* Body --------------------------------------------------------- */}
        {alreadyToday ? (
          <AlreadyTodayPanel
            customer={alreadyToday}
            t={t}
            onDismiss={() => setAlreadyToday(null)}
          />
        ) : !verified ? (
          <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:p-8">
            {/* LEFT — Hero PIN display + verify CTA --------------------- */}
            <section className="flex flex-col gap-5">
              <PinHero
                value={pin}
                max={PIN_MAX}
                kicker={t('cashier.pin.kicker')}
                heading={t('cashier.pin.heading')}
                subheading={t('cashier.pin.subheading')}
                clearLabel={t('cashier.pad.clear')}
                onClear={() => setPin('')}
                shake={findCustomer.isError}
              />

              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                disabled={findCustomer.isPending || !pinReady}
                onClick={() => void findCustomer.mutateAsync()}
                className={cn(
                  'group relative h-20 overflow-hidden rounded-2xl text-lg font-semibold transition',
                  pinReady
                    ? 'bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black shadow-[0_30px_80px_-30px_var(--brand-glow)]'
                    : 'cursor-not-allowed border border-white/10 bg-white/[0.04] text-white/35',
                )}
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  {findCustomer.isPending ? (
                    <>
                      <CircleDot className="size-5 animate-pulse" aria-hidden />
                      {t('cashier.verify.pending')}
                    </>
                  ) : (
                    <>
                      <KeyRound className="size-5" aria-hidden />
                      {t('cashier.verify.cta')}
                    </>
                  )}
                </span>
                {pinReady && !reduceMotion ? (
                  <motion.span
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.55)_50%,transparent_65%)]"
                    animate={{ x: ['-100%', '120%'] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.4 }}
                    aria-hidden
                  />
                ) : null}
              </motion.button>

              <p className="text-[11px] leading-relaxed text-white/40">{t('cashier.pin.footnote')}</p>
            </section>

            {/* RIGHT — Massive numpad ---------------------------------- */}
            <section className="rounded-3xl border border-white/10 bg-black/30 p-5 backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-white/40">
                  {t('cashier.pad.kicker')}
                </p>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/55">
                  {t('cashier.pad.modePin')}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {KEYPAD.flat().map((key) => (
                  <NumpadButton
                    key={key.k}
                    label={key.k}
                    intent={key.intent ?? 'digit'}
                    onPress={() => handleKey(key.k)}
                  />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <ConfirmPanel
            customer={verified}
            branchId={branch!.id}
            pending={visit.isPending}
            t={t}
            onConfirm={() => visit.mutate()}
            onCancel={() => {
              setVerified(null)
              setPin('')
            }}
          />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Already-visited-today panel                                        */
/* ------------------------------------------------------------------ */
function AlreadyTodayPanel({
  customer,
  t,
  onDismiss,
}: {
  customer: FoundCustomer
  t: (k: string) => string
  onDismiss: () => void
}) {
  const greeting = customer.fullName?.trim() || t('cashier.confirm.fallbackName')
  return (
    <AnimatePresence>
      <motion.section
        key="already-today"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ type: 'spring', stiffness: 240, damping: 26 }}
        className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1.15fr_0.85fr] lg:p-10"
        role="status"
        aria-live="polite"
      >
        <div className="relative overflow-hidden rounded-3xl border border-amber-500/35 bg-amber-500/[0.08] p-8 shadow-[0_30px_100px_-40px_rgba(245,158,11,0.45)]">
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{ background: 'radial-gradient(80% 60% at 0% 0%, rgba(245,158,11,0.18), transparent 55%)' }}
            aria-hidden
          />
          <div className="relative space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.45em] text-amber-200/80">
              {t('cashier.alreadyToday.kicker')}
            </p>
            <h2 className="text-2xl font-semibold leading-tight text-amber-50 sm:text-3xl">
              {t('cashier.alreadyToday.headline')}
            </h2>
            <p className="text-lg font-medium text-white">{greeting}</p>
            <p className="text-sm leading-relaxed text-amber-100/75">
              {t('cashier.alreadyToday.body')}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-50">
                <Clock className="size-3.5 text-amber-200" aria-hidden />
                {t('cashier.alreadyToday.tomorrow')}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/80">
                <Sparkles className="size-3.5 text-amber-200" aria-hidden />
                {t('cashier.confirm.streak').replace('{n}', String(customer.currentStreak))}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onDismiss}
            className="relative h-24 overflow-hidden rounded-3xl border border-amber-500/25 bg-amber-500/12 text-xl font-semibold text-amber-50 transition hover:bg-amber-500/18"
          >
            <span className="flex items-center justify-center gap-2">
              <ArrowLeft className="size-6" aria-hidden />
              {t('cashier.alreadyToday.next')}
            </span>
          </button>
          <p className="px-1 text-[11px] leading-relaxed text-white/40">
            {t('cashier.alreadyToday.helper')}
          </p>
        </div>
      </motion.section>
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Chip({
  tone,
  icon,
  label,
}: {
  tone: 'live' | 'warn' | 'muted' | 'brand'
  icon: React.ReactNode
  label: string
}) {
  const cls =
    tone === 'live'
      ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-100'
      : tone === 'warn'
        ? 'border-amber-500/35 bg-amber-500/12 text-amber-100'
        : tone === 'brand'
          ? 'border-(--brand-primary)/40 bg-[color-mix(in_oklab,var(--brand-primary)_18%,transparent)] text-white shadow-[0_0_18px_-6px_var(--brand-glow)]'
          : 'border-white/10 bg-white/[0.05] text-white/75'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur',
        cls,
      )}
    >
      {icon}
      {label}
    </span>
  )
}

/**
 * Hero PIN display — a single, focused, oversized panel.
 * Dots scale up as the cashier types. The whole panel briefly shakes on
 * a failed verification (declarative via the `shake` prop).
 */
function PinHero({
  value,
  max,
  kicker,
  heading,
  subheading,
  clearLabel,
  onClear,
  shake,
}: {
  value: string
  max: number
  kicker: string
  heading: string
  subheading: string
  clearLabel: string
  onClear: () => void
  shake: boolean
}) {
  return (
    <motion.div
      animate={shake ? { x: [0, -10, 10, -7, 7, -3, 3, 0] } : { x: 0 }}
      transition={{ duration: 0.45, ease: 'easeInOut' }}
      className={cn(
        'relative overflow-hidden rounded-3xl border bg-black/40 px-6 py-7 backdrop-blur-md transition',
        'border-(--brand-primary)/35 shadow-[0_40px_120px_-50px_var(--brand-glow)]',
      )}
    >
      {/* Inner gradient wash */}
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        aria-hidden
        style={{
          background:
            'radial-gradient(60% 80% at 0% 0%, color-mix(in oklab, var(--brand-primary) 18%, transparent), transparent 60%), radial-gradient(50% 70% at 100% 100%, color-mix(in oklab, var(--brand-secondary) 16%, transparent), transparent 60%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.45em] text-white/55">
          <span className="inline-flex items-center gap-2">
            <KeyRound className="size-3.5 text-(--brand-primary)/80" aria-hidden />
            {kicker}
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={value.length === 0}
            className="rounded-md border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-white/60 transition hover:text-white disabled:opacity-40"
          >
            {clearLabel}
          </button>
        </div>

        <p className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{heading}</p>
        <p className="mt-1 text-sm text-white/55">{subheading}</p>

        <div className="mt-6 flex items-center justify-center">
          <PinDotsLarge value={value} max={max} />
        </div>
      </div>
    </motion.div>
  )
}

function PinDotsLarge({ value, max }: { value: string; max: number }) {
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      {Array.from({ length: max }).map((_, i) => {
        const filled = i < value.length
        return (
          <motion.span
            key={i}
            initial={false}
            animate={
              filled
                ? { scale: [0.55, 1.22, 1], opacity: [0.35, 1, 1] }
                : { scale: 1, opacity: 0.4 }
            }
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'inline-block rounded-full border transition-colors',
              'size-5 sm:size-6',
              filled
                ? 'border-(--brand-primary)/50 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] shadow-[0_0_24px_-3px_var(--brand-glow)]'
                : 'border-white/15 bg-white/[0.06]',
            )}
          />
        )
      })}
    </div>
  )
}

function NumpadButton({
  label,
  intent,
  onPress,
}: {
  label: string
  intent: 'digit' | 'clear' | 'del'
  onPress: () => void
}) {
  const isDigit = intent === 'digit'
  const isClear = intent === 'clear'
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={onPress}
      className={cn(
        'relative h-20 select-none overflow-hidden rounded-2xl border text-3xl font-semibold transition-all sm:h-24 sm:text-4xl',
        isDigit
          ? 'border-white/10 bg-[linear-gradient(180deg,#1a1a1f_0%,#0a0a0d_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_18px_40px_-30px_rgba(0,0,0,0.9)] hover:border-white/20'
          : isClear
            ? 'border-rose-500/25 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15'
            : 'border-white/10 bg-white/[0.04] text-white/85 hover:bg-white/[0.08]',
      )}
      aria-label={label}
    >
      {isDigit ? (
        <span className="relative">{label}</span>
      ) : isClear ? (
        <span className="inline-flex items-center gap-1.5 text-base font-medium">
          <X className="size-5" aria-hidden />
          {label}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-base font-medium">
          <Delete className="size-5" aria-hidden />
          {label}
        </span>
      )}
    </motion.button>
  )
}

function ConfirmPanel({
  customer,
  branchId,
  pending,
  t,
  onConfirm,
  onCancel,
}: {
  customer: FoundCustomer
  branchId: string
  pending: boolean
  t: (k: string) => string
  onConfirm: () => void
  onCancel: () => void
}) {
  const greeting = customer.fullName?.trim()
    ? customer.fullName.trim()
    : t('cashier.confirm.fallbackName')

  return (
    <AnimatePresence>
      <motion.section
        key="confirm"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ type: 'spring', stiffness: 240, damping: 26 }}
        className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_1fr] lg:p-10"
      >
        <div className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.04] p-8 shadow-[0_30px_120px_-50px_rgba(16,185,129,0.45)]">
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background:
                'radial-gradient(80% 60% at 0% 0%, rgba(16,185,129,0.16), transparent 55%)',
            }}
            aria-hidden
          />
          <div className="relative space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.45em] text-emerald-200/70">
              {t('cashier.confirm.kicker')}
            </p>
            <p className="text-2xl font-semibold text-white sm:text-3xl">{greeting}</p>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/80">
              <Sparkles className="size-3.5 text-amber-200" aria-hidden />
              <span key={customer.currentStreak}>
                {t('cashier.confirm.streak').replace('{n}', String(customer.currentStreak))}
              </span>
            </div>
            <p className="pt-2 text-sm text-white/55">{t('cashier.ready')}</p>
            <div className="pt-4">
              <CashierRewardsPanel customerId={customer.id} branchId={branchId} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            disabled={pending}
            onClick={onConfirm}
            className="relative h-24 overflow-hidden rounded-3xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-2xl font-semibold text-black shadow-[0_40px_100px_-30px_var(--brand-glow)] disabled:opacity-70"
          >
            <span className="relative z-10 flex items-center justify-center gap-2.5">
              {pending ? (
                <>
                  <CircleDot className="size-6 animate-pulse" aria-hidden />
                  {t('cashier.record.pending')}
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-7" aria-hidden />
                  {t('cashier.record.cta')}
                </>
              )}
            </span>
            <motion.span
              className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.55)_50%,transparent_65%)]"
              animate={{ x: ['-100%', '120%'] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.4 }}
              aria-hidden
            />
          </motion.button>

          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] text-base font-medium text-white/85 transition hover:bg-white/[0.08]"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t('cashier.cancel')}
          </button>

          <p className="px-1 text-[11px] leading-relaxed text-white/40">
            {t('cashier.confirm.helper')}
          </p>
        </div>
      </motion.section>
    </AnimatePresence>
  )
}
