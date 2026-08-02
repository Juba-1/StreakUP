import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Flame, Loader2, Shield, Sparkles, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useI18n } from '@/core/i18n/I18nProvider'
import { hapticError, hapticSuccess } from '@/lib/haptics'
import {
  classifyOverrideFailure,
  type OverrideFailure,
} from '@/lib/supabase/rpc-errors'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import type { CustomerRow } from '@/routes/hq/customers/types'
import { cn } from '@/lib/utils'

export type UpdatedCustomer = {
  id: string
  current_streak: number
  longest_streak: number
  shields: number
  full_name: string
}

type OverrideResult = {
  ok: boolean
  customer?: UpdatedCustomer
  reason?: string
}

function overrideFailureMessage(failure: OverrideFailure, t: (k: string) => string): string {
  if (failure.kind === 'transport') return failure.detail
  const reason = failure.reason
  const key = `hq.customers.override.reason.${reason}`
  const mapped = t(key)
  if (mapped !== key) {
    if (reason === 'shields_above_cap' && failure.cap != null) {
      return mapped.replace('{cap}', String(failure.cap))
    }
    return mapped
  }
  if (failure.message) {
    return t('hq.customers.override.reason.withDetail').replace('{detail}', failure.message)
  }
  return t('hq.customers.override.reason.unknown').replace('{code}', reason)
}

type Props = {
  customer: CustomerRow
  cafeId: string | null
  slug: string
  onClose: () => void
  onSuccess: (c: UpdatedCustomer) => void
}

export function CustomerOverrideModal({ customer, cafeId, slug, onClose, onSuccess }: Props) {
  const { t } = useI18n()
  const formId = useId()
  const [name, setName] = useState(customer.full_name)
  const [streak, setStreak] = useState(String(customer.current_streak))
  const [shields, setShields] = useState(String(customer.shields))
  const [inlineError, setInlineError] = useState<string | null>(null)

  const isDirty = useMemo(
    () =>
      name.trim() !== (customer.full_name ?? '').trim() ||
      Number(streak) !== customer.current_streak ||
      Number(shields) !== customer.shields,
    [customer, name, shields, streak],
  )

  const override = useMutation({
    mutationFn: async () => {
      setInlineError(null)
      const p_streak = parseInt(streak, 10)
      const p_shields = parseInt(shields, 10)
      const trimmedName = name.trim()
      if (Number.isNaN(p_streak) || p_streak < 0) {
        throw Object.assign(new Error('invalid_streak'), { client: true })
      }
      if (Number.isNaN(p_shields) || p_shields < 0) {
        throw Object.assign(new Error('invalid_shields'), { client: true })
      }
      const p_full_name = trimmedName === (customer.full_name ?? '').trim() ? null : trimmedName || null
      const p_streak_param = p_streak === customer.current_streak ? null : p_streak
      const p_shields_param = p_shields === customer.shields ? null : p_shields
      if (p_streak_param === null && p_shields_param === null && p_full_name === null) {
        throw Object.assign(new Error('no_changes'), { client: true })
      }
      const { data, error } = await supabaseBrowserClient!.rpc('hq_override_customer_secure', {
        p_customer_id: customer.id,
        p_streak: p_streak_param,
        p_shields: p_shields_param,
        p_full_name,
        p_cafe_id: cafeId,
        p_slug: slug || null,
      })
      const failure = classifyOverrideFailure(error, data, t('hq.customers.override.error'))
      if (failure) throw failure
      const res = data as OverrideResult
      if (!res?.customer) throw new Error('invalid_response')
      return res.customer
    },
    onSuccess: (updated) => {
      hapticSuccess()
      toast.success(t('hq.customers.override.success'))
      onSuccess(updated)
    },
    onError: (err: unknown) => {
      hapticError()
      if (err && typeof err === 'object' && 'client' in err && err instanceof Error) {
        const code = err.message
        if (code === 'invalid_streak') {
          const msg = t('hq.customers.override.invalidStreak')
          setInlineError(msg)
          toast.error(msg)
          return
        }
        if (code === 'invalid_shields') {
          const msg = t('hq.customers.override.invalidShields')
          setInlineError(msg)
          toast.error(msg)
          return
        }
        if (code === 'no_changes') {
          const msg = t('hq.customers.override.noChanges')
          setInlineError(msg)
          toast.info(msg)
          return
        }
      }
      if (err && typeof err === 'object' && 'kind' in err) {
        const msg = overrideFailureMessage(err as OverrideFailure, t)
        setInlineError(msg)
        toast.error(msg, { duration: 6000 })
        return
      }
      const msg = t('hq.customers.override.error')
      setInlineError(msg)
      toast.error(msg)
    },
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !override.isPending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, override.isPending])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => e.target === e.currentTarget && !override.isPending && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
        className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/12 bg-zinc-950/92 shadow-[0_70px_180px_-50px_rgba(0,0,0,0.85)] backdrop-blur-2xl"
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 12 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      >
        <div className="relative p-7 sm:p-8">
          <button
            type="button"
            onClick={onClose}
            disabled={override.isPending}
            className="absolute end-5 top-5 rounded-xl border border-white/10 bg-white/5 p-1.5 text-white/55 transition hover:text-white disabled:opacity-40"
            aria-label={t('hq.customers.override.close')}
          >
            <X className="size-4" aria-hidden />
          </button>

          <div className="space-y-2 pe-10">
            <p className="text-[10px] font-semibold tracking-[0.42em] text-white/45 uppercase">
              {t('hq.customers.override.kicker')}
            </p>
            <h3 id={`${formId}-title`} className="text-2xl font-semibold text-white">
              {customer.full_name || t('hq.customers.unnamed')}
            </h3>
            <p className="font-mono text-xs text-white/45" dir="ltr">
              PIN ••••
            </p>
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
            <p className="text-xs leading-relaxed text-amber-50/85">{t('hq.customers.override.warning')}</p>
          </div>

          <AnimatePresence>
            {inlineError ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 overflow-hidden rounded-2xl border border-rose-500/35 bg-rose-500/10 px-4 py-3"
                role="alert"
              >
                <p className="text-xs leading-relaxed text-rose-100">{inlineError}</p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <form
            id={formId}
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void override.mutateAsync()
            }}
          >
            <label className="block space-y-1.5">
              <span className="text-xs text-white/55">{t('hq.customers.override.nameLabel')}</span>
              <input
                type="text"
                value={name}
                disabled={override.isPending}
                placeholder={t('hq.customers.override.namePlaceholder')}
                onChange={(e) => {
                  setInlineError(null)
                  setName(e.target.value)
                }}
                className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white"
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="inline-flex items-center gap-1 text-xs text-white/55">
                  <Flame className="size-3.5 text-orange-300" aria-hidden />
                  {t('hq.customers.override.streakLabel')}
                </span>
                <input
                  type="number"
                  min={0}
                  value={streak}
                  disabled={override.isPending}
                  onChange={(e) => {
                    setInlineError(null)
                    setStreak(e.target.value)
                  }}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="inline-flex items-center gap-1 text-xs text-white/55">
                  <Shield className="size-3.5 text-sky-300" aria-hidden />
                  {t('hq.customers.override.shieldsLabel')}
                </span>
                <input
                  type="number"
                  min={0}
                  value={shields}
                  disabled={override.isPending}
                  onChange={(e) => {
                    setInlineError(null)
                    setShields(e.target.value)
                  }}
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white"
                />
              </label>
            </div>
          </form>

          <div className="mt-7 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={override.isPending}
              className="flex-1 rounded-2xl border border-white/12 bg-white/4 py-3.5 text-sm font-medium text-white/80 transition hover:bg-white/8 disabled:opacity-50"
            >
              {t('hq.customers.override.cancel')}
            </button>
            <button
              type="submit"
              form={formId}
              disabled={override.isPending || !isDirty}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-2xl py-3.5 text-sm font-semibold transition',
                'bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black',
                'disabled:cursor-not-allowed disabled:opacity-55',
              )}
            >
              {override.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {t('hq.customers.override.saving')}
                </>
              ) : (
                <>
                  <Sparkles className="size-4" aria-hidden />
                  {t('hq.customers.override.save')}
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

/** Quick override via existing hq_override_customer_secure — no new backend. */
export async function quickOverrideCustomer(opts: {
  customer: CustomerRow
  cafeId: string | null
  slug: string
  streak?: number | null
  shields?: number | null
}): Promise<UpdatedCustomer> {
  const { customer, cafeId, slug, streak, shields } = opts
  const { data, error } = await supabaseBrowserClient!.rpc('hq_override_customer_secure', {
    p_customer_id: customer.id,
    p_streak: streak ?? null,
    p_shields: shields ?? null,
    p_full_name: null,
    p_cafe_id: cafeId,
    p_slug: slug || null,
  })
  const failure = classifyOverrideFailure(error, data, 'override_failed')
  if (failure) throw failure
  const res = data as OverrideResult
  if (!res?.customer) throw new Error('invalid_response')
  return res.customer
}
