import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { BarChart3, Copy, KeyRound, Radio, ShieldAlert, Trash2, Webhook } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { outboundWebhookSchema } from '@/lib/validation/schemas'

type IssueKeyResult = {
  ok?: boolean
  id?: string
  api_key?: string
  public_prefix?: string
  error?: string
  reason?: string
}

type CreateHookResult = { ok?: boolean; id?: string; error?: string; reason?: string }

function quotaPercent(used: number, max: number): number {
  if (max < 0) return 0
  if (max === 0) return 100
  return Math.min(100, Math.round((used / max) * 100))
}

/** Developers hub: API keys + outbound webhooks (route `/hq/:slug/api`). */
export function HqDevelopersPage() {
  const { slug } = useParams()
  const { t } = useI18n()
  const qc = useQueryClient()
  const { data: profile, isLoading: pLoading } = useProfile()
  const [label, setLabel] = useState('default')
  const [lastMinted, setLastMinted] = useState<string | null>(null)

  const [hookUrl, setHookUrl] = useState('https://')
  const [hookLabel, setHookLabel] = useState('pos-bridge')
  const [evVisit, setEvVisit] = useState(true)
  const [evReward, setEvReward] = useState(true)
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null)
  const [deleteHookTarget, setDeleteHookTarget] = useState<string | null>(null)

  const cafeQuery = useQuery({
    queryKey: ['hq-cafe', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'hq_owner' && profile.cafe_id),
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('id, slug, name, status, subscriptions(status)')
        .eq('id', profile!.cafe_id!)
        .single()
      if (error) throw error
      return data
    },
  })

  const limits = useQuery({
    queryKey: ['hq-plan-limits', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.cafe_id && profile.role === 'hq_owner'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('streakup_plan_limits_for_cafe', {
        p_cafe_id: profile!.cafe_id!,
      })
      if (error) throw error
      return (data ?? {}) as Record<string, unknown>
    },
  })

  const branchCount = useQuery({
    queryKey: ['hq-branch-count', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.cafe_id && profile.role === 'hq_owner'),
    queryFn: async () => {
      const { count, error } = await supabaseBrowserClient!
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('cafe_id', profile!.cafe_id!)
      if (error) throw error
      return count ?? 0
    },
  })

  const keys = useQuery({
    queryKey: ['hq-api-keys', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'hq_owner' && profile.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('api_keys')
        .select('id, label, public_prefix, scopes, created_at, revoked_at')
        .eq('cafe_id', profile!.cafe_id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const hooks = useQuery({
    queryKey: ['hq-outbound-webhooks', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'hq_owner' && profile.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('outbound_webhooks')
        .select('id, label, url, events, is_enabled, created_at')
        .eq('cafe_id', profile!.cafe_id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const mint = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_issue_api_key', {
        p_label: label.trim() || 'default',
      })
      if (error) throw error
      return data as IssueKeyResult
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        if (d?.reason === 'api_keys_not_included' || d?.reason === 'max_api_keys') {
          toast.error(t('hq.billing.gate.apiKeys'))
        } else {
          toast.error(t('hq.api.toastMintFail'))
        }
        return
      }
      if (typeof d.api_key !== 'string') {
        toast.error(t('hq.api.toastMintFail'))
        return
      }
      setLastMinted(d.api_key)
      void qc.invalidateQueries({ queryKey: ['hq-api-keys'] })
      toast.success(t('hq.api.toastMintOk'))
    },
    onError: () => toast.error(t('hq.api.toastMintFail')),
  })

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_revoke_api_key', {
        p_key_id: id,
      })
      if (error) throw error
      return data as { ok?: boolean }
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        toast.error(t('hq.api.toastRevokeFail'))
        return
      }
      void qc.invalidateQueries({ queryKey: ['hq-api-keys'] })
      toast.success(t('hq.api.toastRevokeOk'))
    },
    onError: () => toast.error(t('hq.api.toastRevokeFail')),
  })

  const createHook = useMutation({
    mutationFn: async () => {
      const events: ('visit.recorded' | 'reward.unlocked')[] = []
      if (evVisit) events.push('visit.recorded')
      if (evReward) events.push('reward.unlocked')
      const parsed = outboundWebhookSchema.safeParse({
        url: hookUrl.trim(),
        label: hookLabel.trim() || 'integration',
        events,
      })
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        if (issue?.path[0] === 'events') throw new Error('no_events')
        if (issue?.message === 'https_required') throw new Error('https_required')
        throw new Error('invalid_hook')
      }
      const { data, error } = await supabaseBrowserClient!.rpc('hq_create_outbound_webhook', {
        p_url: parsed.data.url,
        p_label: parsed.data.label,
        p_events: parsed.data.events,
      })
      if (error) throw error
      return data as CreateHookResult
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        if (d?.reason === 'webhooks_not_included' || d?.reason === 'max_outbound_webhooks') {
          toast.error(t('hq.billing.gate.webhooks'))
        } else {
          toast.error(t('hq.webhooks.toastCreateFail'))
        }
        return
      }
      void qc.invalidateQueries({ queryKey: ['hq-outbound-webhooks'] })
      setHookUrl('https://')
      toast.success(t('hq.webhooks.toastCreateOk'))
    },
    onError: (e: Error) => {
      if (e.message === 'no_events') toast.error(t('hq.webhooks.eventsRequired'))
      else if (e.message === 'https_required') toast.error(t('hq.webhooks.httpsRequired'))
      else if (e.message === 'invalid_hook') toast.error(t('hq.webhooks.invalidHook'))
      else toast.error(t('hq.webhooks.toastCreateFail'))
    },
  })

  const deleteHook = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_delete_outbound_webhook', {
        p_hook_id: id,
      })
      if (error) throw error
      return data as { ok?: boolean }
    },
    onSuccess: (d) => {
      if (!d?.ok) {
        toast.error(t('hq.webhooks.toastDeleteFail'))
        return
      }
      void qc.invalidateQueries({ queryKey: ['hq-outbound-webhooks'] })
      toast.success(t('hq.webhooks.toastDeleteOk'))
    },
    onError: () => toast.error(t('hq.webhooks.toastDeleteFail')),
  })

  const maxKeys = useMemo(() => Number((limits.data as { max_api_keys?: number } | undefined)?.max_api_keys ?? -1), [limits.data])
  const maxHooks = useMemo(
    () => Number((limits.data as { max_outbound_webhooks?: number } | undefined)?.max_outbound_webhooks ?? -1),
    [limits.data],
  )
  const maxBranches = useMemo(
    () => Number((limits.data as { max_branches?: number } | undefined)?.max_branches ?? -1),
    [limits.data],
  )

  const activeKeyCount = useMemo(() => (keys.data ?? []).filter((k) => !k.revoked_at).length, [keys.data])
  const hookCount = useMemo(() => (hooks.data ?? []).length, [hooks.data])
  const branchesUsed = branchCount.data ?? 0

  const keysLocked = maxKeys === 0
  const hooksLocked = maxHooks === 0
  const integrationsLocked = keysLocked && hooksLocked

  if (pLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'hq_owner') {
    return <Navigate to="/login" replace />
  }

  if (cafeQuery.isFetched && cafeQuery.data && cafeQuery.data.slug !== slug) {
    return <Navigate to="/login" replace />
  }

  const sub = Array.isArray(cafeQuery.data?.subscriptions)
    ? cafeQuery.data?.subscriptions[0]
    : cafeQuery.data?.subscriptions
  const subStatus = String(sub?.status ?? '')
  const isSuspended = cafeQuery.data?.status === 'suspended' || cafeQuery.data?.status === 'archived'
  const isSubscriptionBlocked = subStatus === 'past_due' || subStatus === 'canceled'
  const isInactive = isSuspended || isSubscriptionBlocked

  if (integrationsLocked && slug) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[1.75rem] border border-violet-500/25 bg-gradient-to-br from-violet-950/50 to-zinc-950 p-10 text-center"
      >
        <ShieldAlert className="mx-auto size-12 text-violet-300" aria-hidden />
        <h2 className="mt-4 text-2xl font-semibold text-white">{t('hq.tier.integrationsLockedTitle')}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/55">{t('hq.tier.integrationsLockedBody')}</p>
        <Link
          to={`/hq/${slug}/billing`}
          className={cn(buttonVariants({ variant: 'default' }), 'mt-6 bg-violet-600 hover:bg-violet-500')}
        >
          {t('hq.tier.upgradeCta')}
        </Link>
      </motion.div>
    )
  }

  if (isInactive) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/10 p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="size-5 text-amber-200" />
          <p className="text-sm text-amber-100">{t('hq.api.cafeInactive')}</p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('hq.dev.kicker')}</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">{t('hq.dev.title')}</h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{t('hq.dev.subtitle')}</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      >
        <Card className="border-white/10 bg-gradient-to-br from-zinc-950/90 via-black/60 to-violet-950/25 backdrop-blur-md">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <BarChart3 className="size-4 text-violet-200" aria-hidden />
              {t('hq.dev.capacity.title')}
            </CardTitle>
            <CardDescription className="text-white/50">{t('hq.dev.capacity.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-3">
            {[
              {
                label: t('hq.dev.capacity.branches'),
                used: branchesUsed,
                max: maxBranches,
              },
              {
                label: t('hq.dev.capacity.keys'),
                used: activeKeyCount,
                max: maxKeys,
              },
              {
                label: t('hq.dev.capacity.webhooks'),
                used: hookCount,
                max: maxHooks,
              },
            ].map((row) => (
              <div key={row.label} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium tracking-wide text-white/75">{row.label}</span>
                  <span className="tabular-nums text-white/45">
                    {row.max < 0 ? (
                      <span className="text-emerald-200/90">{t('hq.dev.capacity.unlimited')}</span>
                    ) : (
                      <>
                        {row.used} / {row.max}
                      </>
                    )}
                  </span>
                </div>
                {row.max < 0 ? (
                  <div className="h-1 rounded-full bg-emerald-500/20" aria-hidden />
                ) : (
                  <Progress
                    value={quotaPercent(row.used, row.max)}
                    aria-label={row.label}
                    className="[&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-white/10 [&_[data-slot=progress-indicator]]:bg-[linear-gradient(90deg,var(--brand-primary),var(--brand-secondary))]"
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      <Tabs defaultValue="keys" className="space-y-6">
        <TabsList className="border border-white/10 bg-black/30 p-1">
          <TabsTrigger value="keys" className="gap-2 data-active:bg-white/10">
            <KeyRound className="size-3.5" aria-hidden />
            {t('hq.dev.tab.keys')}
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-2 data-active:bg-white/10">
            <Webhook className="size-3.5" aria-hidden />
            {t('hq.dev.tab.webhooks')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="space-y-8">
          {keysLocked ? (
            <Card className="border-violet-500/30 bg-gradient-to-br from-violet-950/60 to-black/60 p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{t('hq.billing.gate.title')}</p>
                  <p className="text-muted-foreground mt-1 max-w-xl text-xs leading-relaxed">{t('hq.billing.gate.apiKeys')}</p>
                </div>
                <Link
                  to={`/hq/${slug}/billing`}
                  className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'inline-flex')}
                >
                  {t('hq.billing.cta')}
                </Link>
              </div>
            </Card>
          ) : null}

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <KeyRound className="size-4 text-[var(--brand-secondary)]" aria-hidden />
                  {t('hq.api.mintTitle')}
                </CardTitle>
                <CardDescription className="text-white/55">{t('hq.api.mintHint')}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-white/80">{t('hq.api.labelField')}</Label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    dir="ltr"
                    className="border-white/10 bg-black/40 text-left text-white"
                    placeholder="production-pos"
                    disabled={keysLocked}
                  />
                </div>
                <Button
                  type="button"
                  disabled={mint.isPending || keysLocked}
                  onClick={() => void mint.mutateAsync()}
                  className="bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black"
                >
                  {mint.isPending ? t('hq.api.minting') : t('hq.api.mintCta')}
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {lastMinted ? (
            <Card className="border-emerald-500/30 bg-emerald-500/10">
              <CardHeader>
                <CardTitle className="text-base text-emerald-100">{t('hq.api.onceTitle')}</CardTitle>
                <CardDescription className="text-emerald-100/80">{t('hq.api.onceBody')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    dir="ltr"
                    className="max-w-full flex-1 overflow-x-auto rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-left font-mono text-[11px] text-white/90"
                  >
                    {lastMinted}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(lastMinted).then(
                        () => toast.success(t('hq.api.copied')),
                        () => toast.error(t('hq.api.copyFail')),
                      )
                    }}
                  >
                    <Copy className="size-3.5" />
                    <span className="ms-1">{t('hq.api.copy')}</span>
                  </Button>
                </div>
                <Button type="button" variant="ghost" size="sm" className="text-white/60" onClick={() => setLastMinted(null)}>
                  {t('hq.api.dismissSecret')}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-white/10 bg-zinc-950/60 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="text-base text-white">{t('hq.api.tableTitle')}</CardTitle>
              {maxKeys > 0 ? (
                <CardDescription className="text-white/45">
                  {t('hq.dev.usage.keys').replace('{n}', String((keys.data ?? []).filter((k) => !k.revoked_at).length)).replace('{m}', String(maxKeys))}
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('hq.api.col.label')}</TableHead>
                      <TableHead>{t('hq.api.col.prefix')}</TableHead>
                      <TableHead>{t('hq.api.col.scopes')}</TableHead>
                      <TableHead>{t('hq.api.col.created')}</TableHead>
                      <TableHead>{t('hq.api.col.status')}</TableHead>
                      <TableHead className="text-end">{t('hq.api.col.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(keys.data ?? []).map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="font-medium text-white">{k.label}</TableCell>
                        <TableCell dir="ltr" className="text-left font-mono text-xs text-white/70">
                          {k.public_prefix}
                        </TableCell>
                        <TableCell className="text-xs text-white/60">{(k.scopes ?? []).join(', ')}</TableCell>
                        <TableCell dir="ltr" className="whitespace-nowrap text-left font-mono text-[11px] text-white/55">
                          {new Date(k.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {k.revoked_at ? (
                            <Badge variant="outline" className="border-white/15 text-white/50">
                              {t('hq.api.revoked')}
                            </Badge>
                          ) : (
                            <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-100">
                              {t('hq.api.active')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          {!k.revoked_at ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={revoke.isPending || keysLocked}
                              onClick={() => setRevokeTarget(k.id)}
                            >
                              <Trash2 className="size-3.5" />
                              <span className="ms-1">{t('hq.api.revoke')}</span>
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-8">
          {hooksLocked ? (
            <Card className="border-violet-500/30 bg-gradient-to-br from-violet-950/60 to-black/60 p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{t('hq.billing.gate.title')}</p>
                  <p className="text-muted-foreground mt-1 max-w-xl text-xs leading-relaxed">{t('hq.billing.gate.webhooks')}</p>
                </div>
                <Link
                  to={`/hq/${slug}/billing`}
                  className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'inline-flex')}
                >
                  {t('hq.billing.cta')}
                </Link>
              </div>
            </Card>
          ) : null}

          <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Radio className="size-4 text-sky-300" aria-hidden />
                {t('hq.webhooks.registerTitle')}
              </CardTitle>
              <CardDescription className="text-white/55">{t('hq.webhooks.registerHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-white/80">{t('hq.webhooks.url')}</Label>
                  <Input
                    value={hookUrl}
                    onChange={(e) => setHookUrl(e.target.value)}
                    dir="ltr"
                    className="border-white/10 bg-black/40 text-left font-mono text-sm text-white"
                    disabled={hooksLocked}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-white/80">{t('hq.webhooks.label')}</Label>
                  <Input
                    value={hookLabel}
                    onChange={(e) => setHookLabel(e.target.value)}
                    dir="ltr"
                    className="border-white/10 bg-black/40 text-left text-white"
                    disabled={hooksLocked}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-white/80">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={evVisit} onChange={(e) => setEvVisit(e.target.checked)} disabled={hooksLocked} />
                  {t('hq.webhooks.ev.visit')}
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={evReward} onChange={(e) => setEvReward(e.target.checked)} disabled={hooksLocked} />
                  {t('hq.webhooks.ev.reward')}
                </label>
              </div>
              <Button
                type="button"
                disabled={createHook.isPending || hooksLocked}
                onClick={() => void createHook.mutateAsync()}
                className="bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-accent))] text-black"
              >
                {createHook.isPending ? t('hq.webhooks.saving') : t('hq.webhooks.registerCta')}
              </Button>
              <p className="text-muted-foreground text-xs leading-relaxed">{t('hq.webhooks.dispatchHint')}</p>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-zinc-950/60 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="text-base text-white">{t('hq.webhooks.tableTitle')}</CardTitle>
              {maxHooks > 0 ? (
                <CardDescription className="text-white/45">
                  {t('hq.dev.usage.hooks')
                    .replace('{n}', String((hooks.data ?? []).length))
                    .replace('{m}', String(maxHooks))}
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="p-0 sm:p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('hq.webhooks.col.label')}</TableHead>
                      <TableHead>{t('hq.webhooks.col.url')}</TableHead>
                      <TableHead>{t('hq.webhooks.col.events')}</TableHead>
                      <TableHead className="text-end">{t('hq.api.col.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(hooks.data ?? []).map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="font-medium text-white">{h.label}</TableCell>
                        <TableCell dir="ltr" className="max-w-[200px] truncate text-left font-mono text-xs text-white/70">
                          {h.url}
                        </TableCell>
                        <TableCell className="text-xs text-white/60">{(h.events ?? []).join(', ')}</TableCell>
                        <TableCell className="text-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={deleteHook.isPending || hooksLocked}
                            onClick={() => setDeleteHookTarget(h.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        tone="danger"
        title={t('common.confirmTitle')}
        description={t('hq.api.revokeConfirm')}
        pending={revoke.isPending}
        onConfirm={async () => {
          if (!revokeTarget) return
          await revoke.mutateAsync(revokeTarget)
          setRevokeTarget(null)
        }}
      />

      <ConfirmDialog
        open={deleteHookTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteHookTarget(null)
        }}
        tone="danger"
        title={t('common.confirmTitle')}
        description={t('hq.webhooks.deleteConfirm')}
        pending={deleteHook.isPending}
        onConfirm={async () => {
          if (!deleteHookTarget) return
          await deleteHook.mutateAsync(deleteHookTarget)
          setDeleteHookTarget(null)
        }}
      />
    </div>
  )
}

/** @deprecated Use `HqDevelopersPage`; kept for backwards-compatible imports. */
export const HqApiKeysPage = HqDevelopersPage
