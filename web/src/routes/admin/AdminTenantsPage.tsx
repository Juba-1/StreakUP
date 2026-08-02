import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Flame, Moon, Plus, Snowflake, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { TenantActionMenu } from '@/components/admin/TenantActionMenu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useI18n } from '@/core/i18n/I18nProvider'
import { planTierLabel, resolveTenantBillingStatus } from '@/lib/admin/plan-display'
import {
  parseSuperAdminTenantPulseList,
  type TenantPulse,
  type TenantPulseRow,
} from '@/lib/admin/super-admin-metrics'
import { AdminProvisionTenantModal } from '@/routes/admin/AdminProvisionTenantModal'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

function statusBadgeClass(status: ReturnType<typeof resolveTenantBillingStatus>) {
  switch (status) {
    case 'active':
      return 'border-emerald-500/35 bg-emerald-500/12 text-emerald-100'
    case 'trial':
      return 'border-sky-500/35 bg-sky-500/12 text-sky-100'
    case 'past_due':
      return 'border-amber-500/35 bg-amber-500/12 text-amber-100'
    case 'suspended':
      return 'border-rose-500/35 bg-rose-500/12 text-rose-100'
    default:
      return 'border-white/15 bg-white/5 text-white/70'
  }
}

function pulseBadgeClass(pulse: TenantPulse) {
  switch (pulse) {
    case 'hot':
      return 'border-orange-500/40 bg-orange-500/15 text-orange-100'
    case 'warm':
      return 'border-amber-500/35 bg-amber-500/12 text-amber-100'
    case 'cool':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-100'
    default:
      return 'border-slate-500/35 bg-slate-500/12 text-slate-200'
  }
}

function TenantPulseBadge({ pulse }: { pulse: TenantPulse }) {
  const { t } = useI18n()
  const Icon =
    pulse === 'hot' ? Flame : pulse === 'warm' ? Sparkles : pulse === 'cool' ? Moon : Snowflake

  return (
    <motion.span
      layout
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', pulseBadgeClass(pulse))}
    >
      <Icon className="size-3" aria-hidden />
      {t(`admin.tenants.pulse.${pulse}`)}
    </motion.span>
  )
}

function formatLastActive(iso: string | null, locale: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AdminTenantsPage() {
  const { t, locale } = useI18n()
  const qc = useQueryClient()
  const { data: profile, isLoading: pLoading } = useProfile()
  const [provisionOpen, setProvisionOpen] = useState(false)
  const [page, setPage] = useState(0)

  const directory = useQuery({
    queryKey: ['admin-tenant-pulse', page],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'super_admin'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('super_admin_tenant_pulse_list', {
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      })
      if (error) throw error
      return parseSuperAdminTenantPulseList(data)
    },
    staleTime: 30_000,
  })

  const setLifecycle = useMutation({
    mutationFn: async ({
      cafeId,
      lifecycle,
      planTier,
    }: {
      cafeId: string
      lifecycle: 'trial' | 'active' | 'suspended'
      planTier: string | null
    }) => {
      if (!supabaseBrowserClient) throw new Error('no_client')

      if (lifecycle === 'suspended') {
        const { data, error } = await supabaseBrowserClient.rpc('super_admin_set_cafe_status', {
          p_cafe_id: cafeId,
          p_status: 'suspended',
        })
        if (error || !(data as { ok?: boolean })?.ok) throw new Error('status_fail')
        return
      }

      const { data: statusData, error: statusErr } = await supabaseBrowserClient.rpc('super_admin_set_cafe_status', {
        p_cafe_id: cafeId,
        p_status: 'active',
      })
      if (statusErr || !(statusData as { ok?: boolean })?.ok) throw new Error('status_fail')

      const { data: subData, error: subErr } = await supabaseBrowserClient.rpc('super_admin_set_subscription', {
        p_cafe_id: cafeId,
        p_plan_name: planTier ?? 'starter',
        p_status: lifecycle === 'trial' ? 'trialing' : 'active',
      })
      if (subErr || !(subData as { ok?: boolean })?.ok) throw new Error('subscription_fail')
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin-tenant-pulse'] })
      toast.success(t('admin.tenant.toastStatusOk'))
    },
    onError: () => toast.error(t('admin.tenant.toastStatusFail')),
  })

  if (pLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'super_admin') {
    return <Navigate to="/login" replace />
  }

  const rows = directory.data?.tenants ?? []
  const total = directory.data?.total ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('admin.tenants.kicker')}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">{t('admin.tenants.title')}</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{t('admin.tenants.subtitlePulse')}</p>
        </div>
        <Button
          type="button"
          onClick={() => setProvisionOpen(true)}
          className="rounded-xl bg-[linear-gradient(135deg,#7c3aed,#db2777)] px-5 text-white shadow-[0_20px_50px_-20px_rgba(124,58,237,0.55)]"
        >
          <Plus className="size-4" />
          <span className="ms-2">{t('admin.tenants.addCafe')}</span>
        </Button>
      </div>

      <AdminProvisionTenantModal open={provisionOpen} onOpenChange={setProvisionOpen} />

      {directory.error ? (
        <p className="text-destructive text-sm">{t('admin.tenants.loadError')}</p>
      ) : null}

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-white/10 bg-zinc-950/75 backdrop-blur-md">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base text-white">{t('admin.table.cafés')}</CardTitle>
            <Badge variant="secondary" className="border-white/10 bg-black/40">
              {total}
            </Badge>
          </CardHeader>
          <CardContent>
            {directory.isFetched && rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                <p className="text-base font-medium text-white">{t('admin.empty.cafesTitle')}</p>
                <p className="text-muted-foreground mx-auto max-w-md text-sm">{t('admin.empty.cafesBody')}</p>
                <Button type="button" variant="secondary" onClick={() => setProvisionOpen(true)}>
                  {t('admin.tenants.addCafe')}
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.col.name')}</TableHead>
                      <TableHead>{t('admin.col.pulse')}</TableHead>
                      <TableHead>{t('admin.col.customers')}</TableHead>
                      <TableHead>{t('admin.col.checkInsToday')}</TableHead>
                      <TableHead>{t('admin.col.lastActive')}</TableHead>
                      <TableHead>{t('admin.col.plan')}</TableHead>
                      <TableHead>{t('admin.col.billingStatus')}</TableHead>
                      <TableHead className="text-end">{t('admin.col.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {directory.isLoading
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell colSpan={8}>
                              <Skeleton className="h-10 w-full bg-white/5" />
                            </TableCell>
                          </TableRow>
                        ))
                      : rows.map((c: TenantPulseRow) => {
                          const billing = resolveTenantBillingStatus({
                            cafeStatus: c.status,
                            subStatus: c.subscription_status,
                          })
                          const planLabel = planTierLabel(c.plan_tier ?? 'starter', locale)

                          return (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium text-white">
                                <Link className="hover:text-violet-200" to={`/admin/tenants/${c.slug}`}>
                                  {c.name}
                                </Link>
                                <p dir="ltr" className="mt-0.5 font-mono text-[10px] text-white/45">
                                  {c.slug}
                                </p>
                              </TableCell>
                              <TableCell>
                                <TenantPulseBadge pulse={c.pulse} />
                              </TableCell>
                              <TableCell className="tabular-nums text-white/85">
                                {c.customer_count.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US')}
                              </TableCell>
                              <TableCell className="tabular-nums text-white/85">{c.check_ins_today}</TableCell>
                              <TableCell dir="ltr" className="text-left text-xs text-white/60">
                                {formatLastActive(c.last_active_at, locale)}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-100">
                                  {planLabel}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge className={cn('font-medium', statusBadgeClass(billing))}>
                                  {t(`admin.tenants.billing.${billing}`)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-end">
                                <TenantActionMenu
                                  cafeId={c.id}
                                  slug={c.slug}
                                  name={c.name}
                                  suspending={setLifecycle.isPending}
                                  onSuspend={() =>
                                    void setLifecycle.mutateAsync({
                                      cafeId: c.id,
                                      lifecycle: 'suspended',
                                      planTier: c.plan_tier,
                                    })
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {t('admin.tenants.prev')}
              </Button>
              <p className="text-xs text-white/60">
                {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('admin.tenants.next')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
