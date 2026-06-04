import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Building2, Check, Crown, Sparkles, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { manageTenantViaEdge, type ManageTenantFailure } from '@/core/admin/manage-tenant'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type CafeStatus = 'active' | 'suspended' | 'archived'
type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled'

type PlanTierRow = {
  code: string
  display_name: string
  limits: Record<string, unknown>
  sort_order: number
}

function tierAccent(code: string) {
  switch (code) {
    case 'free':
      return 'from-slate-500/30 via-slate-400/10 to-transparent border-slate-400/25'
    case 'starter':
      return 'from-sky-500/25 via-cyan-500/10 to-transparent border-sky-400/30'
    case 'growth':
      return 'from-violet-500/30 via-fuchsia-500/10 to-transparent border-violet-400/35'
    case 'enterprise':
      return 'from-amber-500/35 via-rose-500/15 to-transparent border-amber-300/40'
    default:
      return 'from-white/15 to-transparent border-white/15'
  }
}

function TierIcon({ code }: { code: string }) {
  if (code === 'enterprise') return <Crown className="size-5 text-amber-200/90" aria-hidden />
  if (code === 'growth') return <Zap className="size-5 text-violet-200/90" aria-hidden />
  if (code === 'free') return <Sparkles className="size-5 text-slate-200/80" aria-hidden />
  return <Sparkles className="size-5 text-sky-200/90" aria-hidden />
}

function summarizeLimits(limits: Record<string, unknown>, t: (k: string) => string) {
  const b = limits.max_branches
  const k = limits.max_api_keys
  const w = limits.max_outbound_webhooks
  const fmt = (v: unknown) => (typeof v === 'number' && v < 0 ? '∞' : String(v ?? '—'))
  return `${t('admin.tenant.tier.branches')}: ${fmt(b)} · ${t('admin.tenant.tier.keys')}: ${fmt(k)} · ${t('admin.tenant.tier.hooks')}: ${fmt(w)}`
}

export function AdminTenantDetailPage() {
  const { tenantSlug } = useParams()
  const { t } = useI18n()
  const qc = useQueryClient()
  const { data: profile, isLoading: pLoading } = useProfile()

  const [selectedTier, setSelectedTier] = useState<string>('starter')
  const [subStatus, setSubStatus] = useState<SubscriptionStatus>('active')
  const [commitOpen, setCommitOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editTimezone, setEditTimezone] = useState('UTC')
  const [editCurrency, setEditCurrency] = useState('USD')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const cafeQuery = useQuery({
    queryKey: ['admin-tenant', tenantSlug],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'super_admin' && tenantSlug),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('id, name, slug, status, timezone, currency_code, created_at')
        .eq('slug', tenantSlug!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const cafeId = cafeQuery.data?.id

  const planTiersQuery = useQuery({
    queryKey: ['plan-tiers-catalog'],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'super_admin'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('plan_tiers')
        .select('code, display_name, limits, sort_order')
        .order('sort_order', { ascending: true })
      if (error) throw error
      return (data ?? []) as PlanTierRow[]
    },
  })

  const statsQuery = useQuery({
    queryKey: ['admin-tenant-stats', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId),
    queryFn: async () => {
      const [branches, customers, visits] = await Promise.all([
        supabaseBrowserClient!.from('branches').select('id', { count: 'exact', head: true }).eq('cafe_id', cafeId!),
        supabaseBrowserClient!.from('customers').select('id', { count: 'exact', head: true }).eq('cafe_id', cafeId!),
        supabaseBrowserClient!.from('visits').select('id', { count: 'exact', head: true }).eq('cafe_id', cafeId!),
      ])
      if (branches.error) throw branches.error
      if (customers.error) throw customers.error
      if (visits.error) throw visits.error
      return {
        branches: branches.count ?? 0,
        customers: customers.count ?? 0,
        visits: visits.count ?? 0,
      }
    },
  })

  const subQuery = useQuery({
    queryKey: ['admin-tenant-sub', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('subscriptions')
        .select('id, plan_name, plan_tier, status, provider, current_period_end')
        .eq('cafe_id', cafeId!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  useEffect(() => {
    if (subQuery.data?.plan_tier) {
      setSelectedTier(subQuery.data.plan_tier)
    }
    if (subQuery.data?.status) {
      setSubStatus(subQuery.data.status as SubscriptionStatus)
    }
  }, [subQuery.data])

  useEffect(() => {
    if (!cafeQuery.data) return
    setEditName(cafeQuery.data.name ?? '')
    setEditSlug(cafeQuery.data.slug ?? '')
    setEditTimezone(cafeQuery.data.timezone ?? 'UTC')
    setEditCurrency(cafeQuery.data.currency_code ?? 'USD')
  }, [cafeQuery.data])

  const selectedTierMeta = useMemo(
    () => planTiersQuery.data?.find((r) => r.code === selectedTier),
    [planTiersQuery.data, selectedTier],
  )

  const setStatus = useMutation({
    mutationFn: async (status: CafeStatus) => {
      const { data, error } = await supabaseBrowserClient!.rpc('super_admin_set_cafe_status', {
        p_cafe_id: cafeId!,
        p_status: status,
      })
      if (error) throw error
      return data as { ok?: boolean }
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        toast.error(t('admin.tenant.toastStatusFail'))
        return
      }
      void qc.invalidateQueries({ queryKey: ['admin-tenant'] })
      void qc.invalidateQueries({ queryKey: ['admin-tenant-stats', cafeId] })
      void qc.invalidateQueries({ queryKey: ['admin-cafes'] })
      toast.success(t('admin.tenant.toastStatusOk'))
    },
    onError: () => toast.error(t('admin.tenant.toastStatusFail')),
  })

  const failureToToast = (failure: ManageTenantFailure, fallback: string) => {
    if (failure.kind === 'rate_limited') {
      const secs = Math.max(1, Math.ceil((failure.retryMs ?? 30_000) / 1000))
      toast.error(t('admin.tenant.toastRateLimited').replace('{seconds}', String(secs)))
      return
    }
    if (failure.kind === 'not_authenticated') {
      toast.error(t('admin.tenant.toastNotAuthenticated'))
      return
    }
    if (failure.kind === 'forbidden') {
      toast.error(t('admin.tenant.toastForbidden'))
      return
    }
    if (failure.kind === 'cafe_not_found') {
      toast.error(t('admin.tenant.toastCafeMissing'))
      return
    }
    if (failure.kind === 'owner_not_found') {
      toast.error(t('admin.tenant.toastOwnerMissing'))
      return
    }
    if (failure.kind === 'confirm_slug_mismatch') {
      toast.error(t('admin.tenant.toastConfirmMismatch'))
      return
    }
    if (failure.kind === 'network') {
      toast.error(t('admin.tenant.toastNetwork'))
      return
    }
    if (failure.kind === 'invalid_body') {
      toast.error(t('admin.tenant.toastInvalidBody'))
      return
    }
    if (failure.kind === 'missing_env') {
      toast.error(t('admin.tenant.toastMissingEnv'))
      return
    }
    if (failure.serverCode) {
      const label = failure.serverCode.replace(/^([a-z0-9_]+):.*/i, '$1')
      toast.error(`${fallback} · ${label}`)
      return
    }
    toast.error(fallback)
  }

  const saveTenant = useMutation({
    mutationFn: async () => {
      const res = await manageTenantViaEdge({
        action: 'update_tenant',
        cafeId: cafeId!,
        name: editName.trim(),
        slug: editSlug.trim().toLowerCase(),
        timezone: editTimezone.trim(),
        currencyCode: editCurrency.trim().toUpperCase().slice(0, 3),
        status: cafeQuery.data!.status as CafeStatus,
      })
      if (!res.ok) throw res
      return res
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-tenant'] })
      await qc.invalidateQueries({ queryKey: ['admin-cafes'] })
      toast.success(t('admin.tenant.toastEditOk'))
    },
    onError: (e: ManageTenantFailure | Error) => {
      if ((e as ManageTenantFailure).ok === false) {
        failureToToast(e as ManageTenantFailure, t('admin.tenant.toastEditFail'))
      } else {
        toast.error(t('admin.tenant.toastEditFail'))
      }
    },
  })

  const saveOwner = useMutation({
    mutationFn: async () => {
      const res = await manageTenantViaEdge({
        action: 'update_owner',
        cafeId: cafeId!,
        ownerEmail: ownerEmail.trim() || undefined,
        ownerPassword: ownerPassword.trim() || undefined,
      })
      if (!res.ok) throw res
      return res
    },
    onSuccess: () => {
      setOwnerPassword('')
      toast.success(t('admin.tenant.toastOwnerOk'))
    },
    onError: (e: ManageTenantFailure | Error) => {
      if ((e as ManageTenantFailure).ok === false) {
        failureToToast(e as ManageTenantFailure, t('admin.tenant.toastOwnerFail'))
      } else {
        toast.error(t('admin.tenant.toastOwnerFail'))
      }
    },
  })

  const deleteTenant = useMutation({
    mutationFn: async () => {
      const res = await manageTenantViaEdge({
        action: 'delete_tenant',
        cafeId: cafeId!,
        confirmSlug: deleteConfirm.trim().toLowerCase(),
      })
      if (!res.ok) throw res
      return res
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-cafes'] })
      toast.success(t('admin.tenant.toastDeleteOk'))
      setDeleteOpen(false)
      window.location.assign('/admin/tenants')
    },
    onError: (e: ManageTenantFailure | Error) => {
      if ((e as ManageTenantFailure).ok === false) {
        failureToToast(e as ManageTenantFailure, t('admin.tenant.toastDeleteFail'))
      } else {
        toast.error(t('admin.tenant.toastDeleteFail'))
      }
    },
  })

  const saveSub = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('super_admin_set_subscription', {
        p_cafe_id: cafeId!,
        p_plan_name: selectedTier,
        p_status: subStatus,
      })
      if (error) throw error
      return data as { ok?: boolean; plan_tier?: string }
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        toast.error(t('admin.tenant.toastSubFail'))
        return
      }
      void qc.invalidateQueries({ queryKey: ['admin-tenant-sub'] })
      toast.success(t('admin.tenant.toastSubOk'))
      setCommitOpen(false)
    },
    onError: () => toast.error(t('admin.tenant.toastSubFail')),
  })

  if (pLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'super_admin') {
    return <Navigate to="/login" replace />
  }

  if (cafeQuery.isFetched && !cafeQuery.data) {
    return <Navigate to="/admin/tenants" replace />
  }

  const cafe = cafeQuery.data
  if (!cafe) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <Link
          to="/admin/tenants"
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'inline-flex text-white/70')}
        >
          <ArrowLeft className="size-4" />
          <span className="ms-2">{t('admin.tenant.back')}</span>
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Building2 className="size-6 text-white/70" aria-hidden />
          </div>
          <div>
            <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('admin.tenant.kicker')}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">{cafe.name}</h1>
            <p dir="ltr" className="text-muted-foreground mt-1 text-left font-mono text-sm">
              {cafe.slug}
            </p>
          </div>
        </div>
        <Badge
          variant="secondary"
          className={
            cafe.status === 'active'
              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100'
              : cafe.status === 'suspended'
                ? 'border-amber-500/30 bg-amber-500/15 text-amber-100'
                : 'border-white/15 bg-white/5 text-white/60'
          }
        >
          {cafe.status}
        </Badge>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid gap-4 sm:grid-cols-3"
      >
        {[
          { label: t('admin.tenant.stat.branches'), value: statsQuery.data?.branches ?? '—' },
          { label: t('admin.tenant.stat.customers'), value: statsQuery.data?.customers ?? '—' },
          { label: t('admin.tenant.stat.visits'), value: statsQuery.data?.visits ?? '—' },
        ].map((s) => (
          <Card key={s.label} className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
            <CardHeader className="pb-2">
              <CardDescription className="text-white/45">{s.label}</CardDescription>
              <CardTitle className="text-2xl text-white">{s.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-base text-white">{t('admin.tenant.opsTitle')}</CardTitle>
            <CardDescription className="text-white/50">{t('admin.tenant.opsBody')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={setStatus.isPending || cafe.status === 'active'}
              onClick={() => {
                if (window.confirm(t('admin.tenant.confirmActivate'))) void setStatus.mutateAsync('active')
              }}
            >
              {t('admin.tenant.activate')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={setStatus.isPending || cafe.status === 'suspended'}
              onClick={() => {
                if (window.confirm(t('admin.tenant.confirmSuspend'))) void setStatus.mutateAsync('suspended')
              }}
            >
              {t('admin.tenant.suspend')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-white/15 text-white/80"
              disabled={setStatus.isPending || cafe.status === 'archived'}
              onClick={() => {
                if (window.confirm(t('admin.tenant.confirmArchive'))) void setStatus.mutateAsync('archived')
              }}
            >
              {t('admin.tenant.archive')}
            </Button>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-white/10 bg-zinc-950/70 backdrop-blur-md">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{
              background:
                'radial-gradient(900px 280px at 20% -20%, rgba(244,63,94,0.35), transparent), radial-gradient(700px 240px at 100% 0%, rgba(139,92,246,0.25), transparent)',
            }}
            aria-hidden
          />
          <CardHeader className="relative">
            <CardTitle className="text-base text-white">{t('admin.tenant.subTitle')}</CardTitle>
            <CardDescription className="text-white/50">{t('admin.tenant.subBody')}</CardDescription>
            {subQuery.data?.plan_tier ? (
              <div className="pt-2">
                <Badge variant="outline" className="border-white/20 bg-black/30 font-mono text-[11px] text-white/70">
                  {t('admin.tenant.tier.current')}: {subQuery.data.plan_tier}
                </Badge>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="relative space-y-5">
            <div>
              <Label className="text-white/80">{t('admin.tenant.tier.pick')}</Label>
              <p className="text-muted-foreground mt-1 text-xs">{t('admin.tenant.tier.pickHint')}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <AnimatePresence initial={false}>
                  {(planTiersQuery.data ?? []).map((tier) => {
                    const active = tier.code === selectedTier
                    return (
                      <motion.button
                        key={tier.code}
                        type="button"
                        layout
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        onClick={() => setSelectedTier(tier.code)}
                        className={cn(
                          'relative overflow-hidden rounded-2xl border p-4 text-start transition-shadow',
                          active ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_24px_80px_-40px_rgba(244,63,94,0.45)]' : 'hover:border-white/20',
                          'border-white/10 bg-black/35',
                        )}
                      >
                        <div
                          className={cn(
                            'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90',
                            tierAccent(tier.code),
                          )}
                          aria-hidden
                        />
                        <div className="relative flex items-start gap-3">
                          <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/40">
                            <TierIcon code={tier.code} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white">{tier.display_name}</p>
                            <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
                              {summarizeLimits((tier.limits ?? {}) as Record<string, unknown>, t)}
                            </p>
                          </div>
                          {active ? (
                            <motion.span layoutId="tier-check" className="grid size-7 place-items-center rounded-full bg-white text-black">
                              <Check className="size-3.5" aria-hidden />
                            </motion.span>
                          ) : null}
                        </div>
                      </motion.button>
                    )
                  })}
                </AnimatePresence>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.tenant.subStatus')}</Label>
              <select
                className="border-input bg-background/80 h-11 w-full rounded-xl border px-3 text-sm text-white"
                value={subStatus}
                onChange={(e) => setSubStatus(e.target.value as SubscriptionStatus)}
              >
                <option value="trialing">trialing</option>
                <option value="active">active</option>
                <option value="past_due">past_due</option>
                <option value="canceled">canceled</option>
              </select>
            </div>

            <Button
              type="button"
              disabled={saveSub.isPending || !selectedTierMeta}
              onClick={() => setCommitOpen(true)}
              className="w-full bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black sm:w-auto"
            >
              {t('admin.tenant.tier.openCommit')}
            </Button>
            {subQuery.data?.provider ? (
              <p className="text-muted-foreground text-xs">
                {t('admin.tenant.provider')}: {subQuery.data.provider}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-base text-white">{t('admin.tenant.editTitle')}</CardTitle>
            <CardDescription className="text-white/50">{t('admin.tenant.editBody')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.col.name')}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="border-white/10 bg-black/40 text-white" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-white/80">{t('admin.col.slug')}</Label>
                <Input
                  dir="ltr"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
                  className="border-white/10 bg-black/40 text-left font-mono text-white"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-white/80">{t('admin.col.currency')}</Label>
                <Input
                  dir="ltr"
                  value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  className="border-white/10 bg-black/40 text-left font-mono text-white"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.col.timezone')}</Label>
              <Input
                dir="ltr"
                value={editTimezone}
                onChange={(e) => setEditTimezone(e.target.value)}
                className="border-white/10 bg-black/40 text-left font-mono text-white"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={saveTenant.isPending} onClick={() => void saveTenant.mutateAsync()}>
                {saveTenant.isPending ? t('common.loading') : t('admin.tenant.saveEdit')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const direct = `${window.location.origin}/hq/${editSlug || cafe.slug}`
                  void navigator.clipboard.writeText(direct).then(
                    () => toast.success(t('admin.tenant.toastHqLinkCopied')),
                    () => toast.error(t('hq.api.copyFail')),
                  )
                }}
              >
                {t('admin.tenant.copyHqLink')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-base text-white">{t('admin.tenant.ownerTitle')}</CardTitle>
            <CardDescription className="text-white/50">{t('admin.tenant.ownerBody')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.provision.ownerEmail')}</Label>
              <Input
                dir="ltr"
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="border-white/10 bg-black/40 text-left text-white"
                placeholder="owner@brand.com"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.provision.ownerPassword')}</Label>
              <Input
                dir="ltr"
                type="password"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                className="border-white/10 bg-black/40 text-left font-mono text-white"
                placeholder="********"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={saveOwner.isPending || (!ownerEmail.trim() && !ownerPassword.trim())}
                onClick={() => void saveOwner.mutateAsync()}
              >
                {saveOwner.isPending ? t('common.loading') : t('admin.tenant.ownerSave')}
              </Button>
              <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('admin.tenant.delete')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-zinc-950/50">
        <CardHeader>
          <CardTitle className="text-sm text-white/80">{t('admin.tenant.metaTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-white/60 sm:grid-cols-2">
          <p dir="ltr" className="text-left">
            <span className="text-white/40">{t('admin.col.timezone')}: </span>
            {cafe.timezone}
          </p>
          <p dir="ltr" className="text-left">
            <span className="text-white/40">{t('admin.col.currency')}: </span>
            {cafe.currency_code}
          </p>
          <p dir="ltr" className="sm:col-span-2 text-left">
            <span className="text-white/40">{t('admin.tenant.created')}: </span>
            {new Date(cafe.created_at).toLocaleString()}
          </p>
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md border-red-500/30 bg-zinc-950 text-white sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle className="text-red-200">{t('admin.tenant.deleteTitle')}</DialogTitle>
            <DialogDescription className="text-white/60">{t('admin.tenant.deleteBody')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-white/70">
              {t('admin.tenant.deleteConfirmHint').replace('{slug}', cafe.slug)}
            </p>
            <Input
              dir="ltr"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="border-white/10 bg-black/40 text-left font-mono text-white"
              placeholder={cafe.slug}
            />
          </div>
          <DialogFooter className="sm:justify-end">
            <Button type="button" variant="ghost" className="text-white/70" onClick={() => setDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteTenant.isPending || deleteConfirm.trim().toLowerCase() !== cafe.slug}
              onClick={() => void deleteTenant.mutateAsync()}
            >
              {deleteTenant.isPending ? t('common.loading') : t('admin.tenant.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent className="max-w-md border-white/10 bg-zinc-950 text-white sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle className="text-white">{t('admin.tenant.tier.dialogTitle')}</DialogTitle>
            <DialogDescription className="text-white/55">{t('admin.tenant.tier.dialogBody')}</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-sm">
            <p className="font-medium text-white">{cafe.name}</p>
            <p className="text-muted-foreground mt-2 text-xs">
              {t('admin.tenant.tier.dialogTier')}:{' '}
              <span className="font-mono text-white/90">{selectedTierMeta?.display_name ?? selectedTier}</span>
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('admin.tenant.subStatus')}: <span className="font-mono text-white/90">{subStatus}</span>
            </p>
            {selectedTierMeta ? (
              <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
                {summarizeLimits((selectedTierMeta.limits ?? {}) as Record<string, unknown>, t)}
              </p>
            ) : null}
          </div>
          <DialogFooter className="border-white/10 sm:justify-end">
            <Button type="button" variant="ghost" className="text-white/70" onClick={() => setCommitOpen(false)}>
              {t('admin.tenant.tier.cancel')}
            </Button>
            <Button
              type="button"
              disabled={saveSub.isPending}
              className="bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black"
              onClick={() => void saveSub.mutateAsync()}
            >
              {saveSub.isPending ? t('admin.tenant.savingSub') : t('admin.tenant.tier.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
