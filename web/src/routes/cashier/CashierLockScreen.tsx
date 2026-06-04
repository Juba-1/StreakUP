import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Delete, KeyRound, Lock, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { hapticError, hapticSuccess, hapticTap } from '@/lib/haptics'
import {
  CASHIER_PIN_WINDOW,
  getLockoutMsRemaining,
  registerFailure,
  registerSuccess,
} from '@/lib/security/rateLimit'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'
import type { CashierDeviceSession } from '@/lib/cashierDeviceUnlock'

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

type Props = {
  branchCode: string
  onUnlocked: (session: CashierDeviceSession) => void
}

export function CashierLockScreen({ branchCode, onUnlocked }: Props) {
  const { t } = useI18n()
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)

  const branchMeta = useQuery({
    queryKey: ['cashier-branch-public', branchCode],
    enabled: Boolean(supabaseBrowserClient && branchCode),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('cashier_branch_public_lookup', {
        p_branch_code: branchCode.toLowerCase(),
      })
      if (error) throw error
      return data as {
        ok?: boolean
        reason?: string
        branch_id?: string
        branch_code?: string
        branch_name?: string
        cafe_id?: string
        cafe_name?: string
      }
    },
  })

  const unlock = useMutation({
    mutationFn: async () => {
      const code = branchCode.toLowerCase()
      const subject = `device:${code}:${pin.trim()}`
      const remaining = getLockoutMsRemaining(CASHIER_PIN_WINDOW, subject)
      if (remaining > 0) {
        const err = new Error('locked') as Error & { retryMs?: number }
        err.retryMs = remaining
        throw err
      }

      const { data, error } = await supabaseBrowserClient!.rpc('verify_cashier_device_pin', {
        p_branch_code: code,
        p_pin: pin.trim(),
      })
      if (error) throw error

      const res = data as {
        ok?: boolean
        reason?: string
        device_token?: string
        branch_id?: string
        branch_code?: string
        branch_name?: string
        cafe_id?: string
        expires_at?: string
        retry_after_ms?: number
      }

      if (!res?.ok || !res.device_token || !res.branch_id) {
        if (res?.reason === 'rate_limited') {
          const err = new Error('locked') as Error & { retryMs?: number }
          err.retryMs = res.retry_after_ms ?? 90_000
          throw err
        }
        if (res?.reason === 'invalid_pin') throw new Error('invalid_pin')
        if (res?.reason === 'branch_not_found') throw new Error('branch_not_found')
        throw new Error('invalid_pin')
      }

      return { res, subject }
    },
    onSuccess: ({ res, subject }) => {
      registerSuccess(CASHIER_PIN_WINDOW, subject)
      hapticSuccess()
      const session: CashierDeviceSession = {
        token: res.device_token!,
        branchId: res.branch_id!,
        branchCode: res.branch_code ?? branchCode.toLowerCase(),
        branchName: res.branch_name,
        cafeId: res.cafe_id,
        expiresAt: res.expires_at ?? new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      }
      onUnlocked(session)
      toast.success(t('cashier.lock.unlocked'))
    },
    onError: (e: Error & { retryMs?: number }) => {
      hapticError()
      setShake(true)
      window.setTimeout(() => setShake(false), 480)
      setPin('')

      if (e.message === 'locked') {
        const secs = Math.ceil((e.retryMs ?? 90_000) / 1000)
        toast.error(t('cashier.lock.locked').replace('{seconds}', String(secs)))
        return
      }
      if (e.message === 'branch_not_found') {
        toast.error(t('cashier.branchMissing'))
        return
      }

      const subject = `device:${branchCode.toLowerCase()}:${pin.trim()}`
      const { lockedMs } = registerFailure(CASHIER_PIN_WINDOW, subject)
      if (lockedMs > 0) {
        toast.error(t('cashier.lock.locked').replace('{seconds}', String(Math.ceil(lockedMs / 1000))))
      } else {
        toast.error(t('cashier.lock.wrongPin'))
      }
    },
  })

  const pinReady = pin.trim().length >= PIN_MIN

  const handleKey = useCallback((key: string) => {
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
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (/^[0-9]$/.test(e.key)) handleKey(e.key)
      else if (e.key === 'Backspace') handleKey('DEL')
      else if (e.key === 'Escape') handleKey('CLR')
      else if (e.key === 'Enter' && pinReady && !unlock.isPending) {
        void unlock.mutateAsync()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleKey, pinReady, unlock])

  if (branchMeta.isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (branchMeta.isFetched && !branchMeta.data?.ok) {
    return (
      <p className="text-muted-foreground mx-auto max-w-md px-6 py-12 text-center text-sm">
        {t('cashier.branchMissing')}
      </p>
    )
  }

  const branchName = branchMeta.data?.branch_name ?? branchCode
  const cafeName = branchMeta.data?.cafe_name

  return (
    <div className="relative mx-auto flex min-h-[min(88vh,720px)] max-w-2xl flex-col justify-center px-4 py-8">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background: `
              radial-gradient(70% 45% at 50% 0%, color-mix(in oklab, var(--brand-primary) 22%, transparent), transparent 65%),
              radial-gradient(40% 35% at 100% 100%, color-mix(in oklab, var(--brand-secondary) 16%, transparent), transparent 55%)
            `,
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        className="overflow-hidden rounded-[2rem] border border-white/12 bg-zinc-950/70 shadow-[0_50px_140px_-60px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
      >
        <div className="flex items-center gap-3 border-b border-white/10 bg-black/40 px-6 py-4">
          <div className="grid size-11 place-items-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black">
            <Lock className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-white/45">
              {t('cashier.lock.kicker')}
            </p>
            <p className="truncate text-base font-semibold text-white">{branchName}</p>
            {cafeName ? (
              <p className="truncate text-xs text-white/50">{cafeName}</p>
            ) : null}
          </div>
          <ShieldCheck className="ms-auto size-5 shrink-0 text-emerald-400/80" aria-hidden />
        </div>

        <div className="grid gap-6 p-6 sm:p-8">
          <motion.div
            animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : { x: 0 }}
            className="space-y-4 text-center"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.45em] text-white/50">
              {t('cashier.lock.pinLabel')}
            </p>
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">{t('cashier.lock.heading')}</h1>
            <p className="text-sm text-white/55">{t('cashier.lock.subheading')}</p>
            <div className="flex justify-center gap-2.5 pt-2">
              {Array.from({ length: PIN_MAX }).map((_, i) => {
                const filled = i < pin.length
                return (
                  <motion.span
                    key={i}
                    initial={false}
                    animate={filled ? { scale: [0.6, 1.15, 1] } : { scale: 1 }}
                    className={cn(
                      'size-3.5 rounded-full border sm:size-4',
                      filled
                        ? 'border-(--brand-primary)/50 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] shadow-[0_0_20px_-4px_var(--brand-glow)]'
                        : 'border-white/15 bg-white/[0.06]',
                    )}
                  />
                )
              })}
            </div>
          </motion.div>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            {KEYPAD.flat().map((key) => (
              <PadKey key={key.k} label={key.k} intent={key.intent ?? 'digit'} onPress={() => handleKey(key.k)} />
            ))}
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            disabled={!pinReady || unlock.isPending}
            onClick={() => void unlock.mutateAsync()}
            className={cn(
              'flex h-14 items-center justify-center gap-2 rounded-2xl text-base font-semibold transition',
              pinReady
                ? 'bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black shadow-[0_24px_70px_-28px_var(--brand-glow)]'
                : 'cursor-not-allowed border border-white/10 bg-white/[0.04] text-white/35',
            )}
          >
            <KeyRound className="size-5" aria-hidden />
            {unlock.isPending ? t('cashier.lock.unlocking') : t('cashier.lock.cta')}
          </motion.button>
        </div>
      </motion.div>
    </div>
  )
}

function PadKey({
  label,
  intent,
  onPress,
}: {
  label: string
  intent: 'digit' | 'clear' | 'del'
  onPress: () => void
}) {
  const isDigit = intent === 'digit'
  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.94 }}
      onClick={onPress}
      className={cn(
        'h-14 rounded-xl border text-xl font-semibold sm:h-16 sm:text-2xl',
        isDigit
          ? 'border-white/10 bg-black/50 text-white hover:border-white/20'
          : intent === 'clear'
            ? 'border-rose-500/25 bg-rose-500/10 text-rose-200'
            : 'border-white/10 bg-white/[0.04] text-white/80',
      )}
    >
      {isDigit ? (
        label
      ) : intent === 'clear' ? (
        <X className="mx-auto size-5" aria-hidden />
      ) : (
        <Delete className="mx-auto size-5" aria-hidden />
      )}
    </motion.button>
  )
}
