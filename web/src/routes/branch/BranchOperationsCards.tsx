import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  Copy,
  Eye,
  EyeOff,
  Link2,
  Monitor,
  QrCode,
  RefreshCw,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { CustomerPortalQrCode } from '@/components/qr/CustomerPortalQrCode'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { normalizeCashierPin, secureDigits4 } from '@/lib/secure-pin'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type BranchContext = {
  ok?: boolean
  branch_id?: string
  branch_code?: string
  branch_name?: string
  cashier_pin?: string
  cafe_slug?: string
  customer_portal_path?: string
  cashier_portal_path?: string
  reason?: string
}

export function BranchOperationsCards() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { data: profile } = useProfile()
  const [showPin, setShowPin] = useState(false)
  const [pinDraft, setPinDraft] = useState('')

  const contextQuery = useQuery({
    queryKey: ['branch-manager-context', profile?.branch_id, profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.branch_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('branch_manager_branch_context_secure')
      if (error) throw error
      const ctx = data as BranchContext
      if (!ctx?.ok) throw new Error(ctx.reason ?? 'context_failed')
      return ctx
    },
  })

  const ctx = contextQuery.data
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const customerUrl = useMemo(() => {
    const path = ctx?.customer_portal_path ?? ''
    return path ? `${origin}${path}` : ''
  }, [ctx?.customer_portal_path, origin])

  const cashierUrl = useMemo(() => {
    const path = ctx?.cashier_portal_path ?? ''
    return path ? `${origin}${path}` : ''
  }, [ctx?.cashier_portal_path, origin])

  const displayPin = pinDraft || ctx?.cashier_pin || ''

  const savePin = useMutation({
    mutationFn: async (pin: string) => {
      const clean = normalizeCashierPin(pin)
      if (!clean || !ctx?.branch_id) throw new Error('pin_shape')
      const { data, error } = await supabaseBrowserClient!.rpc(
        'branch_manager_update_cashier_pin',
        { p_branch_id: ctx.branch_id, p_pin: clean },
      )
      if (error) throw error
      const res = data as { ok?: boolean; reason?: string; cashier_pin?: string }
      if (!res?.ok) throw new Error(res.reason ?? 'save_failed')
      return res.cashier_pin ?? clean
    },
    onSuccess: async (saved) => {
      setPinDraft(saved)
      toast.success(t('branch.ops.pinSaved'))
      await qc.invalidateQueries({ queryKey: ['branch-manager-context', profile?.branch_id, profile?.cafe_id] })
    },
    onError: (e: Error) =>
      toast.error(
        e.message === 'pin_shape' ? t('branch.ops.pinInvalid') : t('branch.ops.pinSaveFail'),
      ),
  })

  const rotatePin = useMutation({
    mutationFn: async () => {
      const pin = secureDigits4()
      return savePin.mutateAsync(pin)
    },
  })

  async function copyText(value: string, okKey: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t(okKey))
    } catch {
      toast.error(t('branch.ops.copyFail'))
    }
  }

  if (contextQuery.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (contextQuery.isError || !ctx) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed border-white/12 px-4 py-6 text-sm">
        {t('branch.ops.contextFail')}
      </p>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="h-full border-emerald-500/20 bg-gradient-to-br from-emerald-950/30 via-zinc-950/90 to-transparent backdrop-blur-md">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="grid size-9 place-items-center rounded-xl border border-emerald-400/25 bg-emerald-500/10">
                <Link2 className="size-4 text-emerald-200" aria-hidden />
              </div>
              <div>
                <CardTitle className="text-base text-white">{t('branch.ops.receptionTitle')}</CardTitle>
                <CardDescription className="text-white/50">
                  {t('branch.ops.receptionDesc')}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {customerUrl ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/35 p-4">
                <p className="text-center text-xs font-semibold text-white/80">{t('hq.links.qrTitle')}</p>
                <CustomerPortalQrCode
                  value={customerUrl}
                  className="shadow-[0_0_40px_-12px_rgba(52,211,153,0.35)]"
                />
                <p className="max-w-[16rem] text-center text-[10px] leading-relaxed text-white/45">
                  {t('hq.links.qrHint')}
                </p>
              </div>
            ) : null}
            <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-black/35 p-3">
              <QrCode className="mt-0.5 size-4 shrink-0 text-emerald-300/80" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">
                  {t('branch.ops.customerLinkLabel')}
                </p>
                <p dir="ltr" className="mt-1 break-all font-mono text-xs text-emerald-100/90">
                  {customerUrl || '—'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="gap-1.5 border-white/10"
                disabled={!customerUrl}
                onClick={() => void copyText(customerUrl, 'branch.ops.copied')}
              >
                <Copy className="size-3.5" aria-hidden />
                {t('branch.ops.copyLink')}
              </Button>
              {ctx.customer_portal_path ? (
                <Link
                  to={ctx.customer_portal_path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 text-xs font-medium text-white hover:bg-white/10',
                  )}
                >
                  {t('branch.ops.openPortal')}
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Card className="h-full border-violet-500/20 bg-gradient-to-br from-violet-950/25 via-zinc-950/90 to-transparent backdrop-blur-md">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="grid size-9 place-items-center rounded-xl border border-violet-400/25 bg-violet-500/10">
                <Monitor className="size-4 text-violet-200" aria-hidden />
              </div>
              <div>
                <CardTitle className="text-base text-white">{t('branch.ops.posTitle')}</CardTitle>
                <CardDescription className="text-white/50">{t('branch.ops.posDesc')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-black/35 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/45">
                {t('branch.ops.cashierLinkLabel')}
              </p>
              <p dir="ltr" className="mt-1 break-all font-mono text-xs text-violet-100/90">
                {cashierUrl || '—'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 border-white/10 text-[11px]"
                  disabled={!cashierUrl}
                  onClick={() => void copyText(cashierUrl, 'branch.ops.copied')}
                >
                  <Copy className="size-3" aria-hidden />
                  {t('branch.ops.copyLink')}
                </Button>
                {ctx.cashier_portal_path ? (
                  <Link
                    to={ctx.cashier_portal_path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 items-center rounded-md border border-white/10 bg-white/5 px-2.5 text-[11px] text-white hover:bg-white/10"
                  >
                    {t('branch.ops.openPos')}
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-white/10 bg-black/35 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-white/70">{t('branch.ops.cashierPinLabel')}</Label>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
                  onClick={() => setShowPin((v) => !v)}
                >
                  {showPin ? (
                    <EyeOff className="size-3.5" aria-hidden />
                  ) : (
                    <Eye className="size-3.5" aria-hidden />
                  )}
                  {showPin ? t('branch.ops.hidePin') : t('branch.ops.showPin')}
                </button>
              </div>
              <p dir="ltr" className="font-mono text-2xl font-semibold tracking-[0.35em] text-white">
                {showPin ? displayPin || '••••' : '••••'}
              </p>
            </div>

            <div className="space-y-2 border-t border-white/10 pt-3">
              <p className="text-xs font-semibold text-white/80">{t('branch.ops.changePinTitle')}</p>
              <Input
                dir="ltr"
                inputMode="numeric"
                maxLength={8}
                value={pinDraft}
                onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder={t('branch.ops.newPinPlaceholder')}
                className="border-white/12 bg-black/40 font-mono text-white"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="gap-1 border-white/10"
                  disabled={rotatePin.isPending || savePin.isPending}
                  onClick={() => void rotatePin.mutateAsync()}
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                  {t('branch.ops.rotatePin')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={savePin.isPending || !pinDraft}
                  onClick={() => void savePin.mutateAsync(pinDraft)}
                >
                  {savePin.isPending ? t('branch.ops.savingPin') : t('branch.ops.savePin')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
