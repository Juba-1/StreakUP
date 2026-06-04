import { useMutation, useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { invokeAiRouter } from '@/core/ai/router'
import { useI18n } from '@/core/i18n/I18nProvider'
import { usePlanLimits } from '@/hooks/usePlanLimits'
import { useProfile } from '@/hooks/useProfile'
import { HqBranchDeskList } from '@/components/hq/HqBranchDeskList'
import { CustomerPortalQrCode } from '@/components/qr/CustomerPortalQrCode'
import { HqAnalyticsCharts } from '@/routes/hq/HqAnalyticsCharts'
import { HqBranchUploadWizard } from '@/routes/hq/HqBranchUploadWizard'
import { HqPulseBanner } from '@/routes/hq/HqPulseBanner'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type BranchRow = {
  id: string
  name: string
  branch_code: string
  manager_password: string
  cashier_pin: string
}

type ChatMessage = { role: 'user' | 'assistant'; text: string }

function secureDigits4() {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(1000 + (a[0]! % 9000))
}

function branchCodeFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

export function HqHomePage() {
  const { slug } = useParams()
  const { t } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()
  const plan = usePlanLimits(profile?.cafe_id)
  const [aiText, setAiText] = useState<string | null>(null)
  const [chatPrompt, setChatPrompt] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [newBranchName, setNewBranchName] = useState('')
  const [branchDrafts, setBranchDrafts] = useState<Record<string, { name: string; branch_code: string }>>({})
  const [cashierReveal, setCashierReveal] = useState<Record<string, boolean>>({})
  const [cashierDraft, setCashierDraft] = useState<Record<string, string>>({})
  const cafeQuery = useQuery({
    queryKey: ['hq-cafe', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'hq_owner' && profile.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('id, slug, name, primary_color, secondary_color')
        .eq('id', profile!.cafe_id!)
        .single()
      if (error) throw error
      return data
    },
  })

  const stats = useQuery({
    queryKey: ['hq-stats', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.cafe_id && profile.role === 'hq_owner'),
    queryFn: async () => {
      const cafeId = profile!.cafe_id!
      const [{ count: branches }, { count: customers }, visits] = await Promise.all([
        supabaseBrowserClient!.from('branches').select('id', { count: 'exact', head: true }).eq('cafe_id', cafeId),
        supabaseBrowserClient!.from('customers').select('id', { count: 'exact', head: true }).eq('cafe_id', cafeId),
        supabaseBrowserClient!
          .from('visits')
          .select('id', { count: 'exact', head: true })
          .eq('cafe_id', cafeId),
      ])
      return {
        branches: branches ?? 0,
        customers: customers ?? 0,
        visits: visits.count ?? 0,
      }
    },
  })

  const branches = useQuery({
    queryKey: ['hq-branches-admin', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.cafe_id && profile.role === 'hq_owner'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('branches')
        .select('id, name, branch_code, manager_password, cashier_pin')
        .eq('cafe_id', profile!.cafe_id!)
        .order('created_at', { ascending: true })
        .limit(100)
      if (error) throw error
      return (data ?? []) as BranchRow[]
    },
  })

  const loneBranch = useQuery({
    queryKey: ['hq-branches-list', profile?.cafe_id],
    enabled: Boolean(
      supabaseBrowserClient &&
        profile?.cafe_id &&
        profile.role === 'hq_owner' &&
        stats.isSuccess &&
        stats.data?.branches === 1,
    ),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('branches')
        .select('id, name, branch_code')
        .eq('cafe_id', profile!.cafe_id!)
        .order('created_at', { ascending: true })
        .limit(1)
      if (error) throw error
      return data?.[0] ?? null
    },
  })

  const saveBranch = useMutation({
    mutationFn: async (row: BranchRow) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const draft = branchDrafts[row.id] ?? { name: row.name, branch_code: row.branch_code }
      const nextCode = draft.branch_code.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
      const { error } = await supabaseBrowserClient
        .from('branches')
        .update({ name: draft.name.trim(), branch_code: nextCode, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        branches.refetch(),
        stats.refetch(),
      ])
      toast.success(t('hq.branchCrud.toastSaveOk'))
    },
    onError: () => toast.error(t('hq.branchCrud.toastSaveFail')),
  })

  const resetPins = useMutation({
    mutationFn: async (row: BranchRow) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const { error } = await supabaseBrowserClient
        .from('branches')
        .update({
          manager_password: secureDigits4(),
          cashier_pin: secureDigits4(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await branches.refetch()
      toast.success(t('hq.branchCrud.toastResetOk'))
    },
    onError: () => toast.error(t('hq.branchCrud.toastResetFail')),
  })

  const rotateCashierPinOnly = useMutation({
    mutationFn: async (row: BranchRow) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const pin = secureDigits4()
      const { error } = await supabaseBrowserClient
        .from('branches')
        .update({ cashier_pin: pin, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await branches.refetch()
      toast.success(t('hq.ops.cashierRotated'))
    },
    onError: () => toast.error(t('hq.ops.cashierSaveFail')),
  })

  const commitCashierPin = useMutation({
    mutationFn: async ({ row, pin }: { row: BranchRow; pin: string }) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const clean = pin.replace(/\D/g, '').slice(0, 8)
      if (!/^[0-9]{4,8}$/.test(clean)) throw new Error('pin_shape')
      const { error } = await supabaseBrowserClient
        .from('branches')
        .update({ cashier_pin: clean, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await branches.refetch()
      toast.success(t('hq.ops.cashierSaved'))
    },
    onError: (e: Error) =>
      toast.error(e.message === 'pin_shape' ? t('hq.ops.cashierPinInvalid') : t('hq.ops.cashierSaveFail')),
  })

  const deleteBranch = useMutation({
    mutationFn: async (row: BranchRow) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const { error } = await supabaseBrowserClient.from('branches').delete().eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        branches.refetch(),
        stats.refetch(),
      ])
      toast.success(t('hq.branchCrud.toastDeleteOk'))
    },
    onError: () => toast.error(t('hq.branchCrud.toastDeleteFail')),
  })

  const slugOk = useMemo(() => {
    if (!slug || !cafeQuery.data) return false
    return cafeQuery.data.slug === slug
  }, [slug, cafeQuery.data])

  const insights = useMutation({
    mutationFn: async () => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const res = await invokeAiRouter(supabaseBrowserClient, {
        intent: 'hq_dashboard_insights',
      })
      if (res.error) throw res.error
      return res.data as { narrative?: string }
    },
    onSuccess: (d) => {
      const narrative = typeof d?.narrative === 'string' ? d.narrative : JSON.stringify(d)
      setAiText(narrative)
      toast.success(t('hq.toast.insightsReady'))
    },
    onError: () => toast.error(t('hq.toast.insightsFail')),
  })

  const manualAddBranch = useMutation({
    mutationFn: async () => {
      if (!supabaseBrowserClient || !profile?.cafe_id) throw new Error('no_client')
      const name = newBranchName.trim()
      if (name.length < 2) throw new Error('invalid_input')
      const existingCodes = new Set((branches.data ?? []).map((b) => b.branch_code))
      const baseCode = branchCodeFromName(name) || `branch-${secureDigits4()}`
      let branch_code = baseCode
      let suffix = 2
      while (existingCodes.has(branch_code)) {
        branch_code = `${baseCode}-${suffix++}`
        if (suffix > 50) break
      }
      const manager_password = secureDigits4().repeat(2).slice(0, 6)
      const cashier_pin = secureDigits4()
      const { error } = await supabaseBrowserClient.from('branches').insert({
        cafe_id: profile.cafe_id,
        name,
        branch_code,
        manager_password,
        cashier_pin,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setNewBranchName('')
      await Promise.all([branches.refetch(), stats.refetch()])
      toast.success(t('hq.manualBranch.toastOk'))
    },
    onError: (err: unknown) => {
      const raw =
        (err as { message?: string } | null)?.message ??
        (typeof err === 'string' ? err : '')
      if (raw.includes('plan_branch_limit')) {
        toast.error(t('hq.manualBranch.errPlanLimit'))
      } else if (raw.includes('plan_branch_forbidden')) {
        toast.error(t('hq.manualBranch.errPlanForbidden'))
      } else if (raw.includes('branches_cafe_code_uidx') || raw.includes('duplicate key')) {
        toast.error(t('hq.manualBranch.errDuplicate'))
      } else if (raw === 'invalid_input') {
        toast.error(t('hq.manualBranch.errInvalidName'))
      } else {
        toast.error(t('hq.manualBranch.toastFail'))
      }
    },
  })

  const askAi = useMutation({
    mutationFn: async () => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const prompt = chatPrompt.trim()
      if (prompt.length < 2) throw new Error('invalid_prompt')
      const res = await invokeAiRouter(supabaseBrowserClient, {
        intent: 'hq_owner_chat',
        prompt,
      })
      if (res.error) throw res.error
      return {
        prompt,
        answer: String((res.data as { answer?: unknown })?.answer ?? ''),
      }
    },
    onSuccess: ({ prompt, answer }) => {
      setChatMessages((prev) => [...prev, { role: 'user', text: prompt }, { role: 'assistant', text: answer }])
      setChatPrompt('')
    },
    onError: () => toast.error(t('hq.toast.insightsFail')),
  })

  useEffect(() => {
    if (!branches.data) return
    setBranchDrafts((prev) => {
      const next: Record<string, { name: string; branch_code: string }> = {}
      for (const b of branches.data) {
        next[b.id] = prev[b.id] ?? { name: b.name, branch_code: b.branch_code }
      }
      return next
    })
  }, [branches.data])

  useEffect(() => {
    if (!branches.data) return
    setCashierDraft((prev) => {
      const next = { ...prev }
      for (const b of branches.data) {
        if (next[b.id] === undefined) next[b.id] = String(b.cashier_pin ?? '')
      }
      return next
    })
  }, [branches.data])

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

  if (cafeQuery.isFetched && !slugOk) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">{t('hq.title')}</h2>
        </div>
      </div>

      <HqPulseBanner enabled={Boolean(stats.data && stats.data.branches > 0)} />

      {stats.isFetched && stats.data?.branches === 1 && loneBranch.data?.branch_code && slug ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-6"
        >
          <h3 className="text-lg font-semibold text-white">{t('hq.singleBranch.title')}</h3>
          <Link
            to={`/hq/${slug}/branches/${loneBranch.data.branch_code}`}
            className={cn(
              buttonVariants({ variant: 'default', size: 'sm' }),
              'mt-4 inline-flex bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black',
            )}
          >
            {t('hq.singleBranch.cta')}
          </Link>
        </motion.div>
      ) : null}

      {stats.isFetched && stats.data?.branches === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className="relative overflow-hidden rounded-3xl border border-dashed border-white/15 bg-gradient-to-br from-zinc-950/90 via-black/60 to-zinc-950/80 p-8 text-center shadow-[0_0_80px_-30px_var(--brand-glow)]"
        >
          <h3 className="relative text-xl font-semibold text-white">{t('hq.empty.branchesTitle')}</h3>
          <Button
            type="button"
            className="relative mt-6 rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-6 text-black"
            onClick={() => document.getElementById('hq-branch-quick')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            {t('hq.empty.branchesCta')}
          </Button>
        </motion.div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: t('hq.stat.branches'), v: stats.data?.branches ?? '—' },
          { label: t('hq.stat.customers'), v: stats.data?.customers ?? '—' },
          { label: t('hq.stat.visits'), v: stats.data?.visits ?? '—' },
        ].map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
          >
            <Card className="border-white/10 bg-gradient-to-b from-zinc-950 to-black/80 p-5 shadow-[0_30px_120px_-70px_var(--brand-glow)]">
              <p className="text-muted-foreground text-xs font-semibold tracking-widest">{c.label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-white">{c.v}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      {slug ? (
        <div className="grid gap-4 lg:grid-cols-[1.75fr_1fr]">
          <Card className="border-white/14 bg-linear-to-br from-zinc-950/95 via-black/85 to-zinc-950/90 backdrop-blur-md">
            <CardHeader className="space-y-0">
              <CardTitle className="text-white">{t('hq.ops.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="text-white/70">{t('hq.ops.loyalty')}</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    dir="ltr"
                    readOnly
                    value={`${window.location.origin}/my-streak/${slug}`}
                    className="min-w-[12rem] flex-1 border-white/12 bg-black/45 font-mono text-xs text-white"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="gap-2"
                    onClick={() => {
                      const loyaltyUrl = `${window.location.origin}/my-streak/${slug}`
                      void navigator.clipboard.writeText(loyaltyUrl).then(
                        () => toast.success(t('hq.links.copied')),
                        () => toast.error(t('hq.api.copyFail')),
                      )
                    }}
                  >
                    <Copy className="size-4" aria-hidden />
                    {t('hq.links.copy')}
                  </Button>
                </div>
              </div>

              <div className="space-y-4 border-t border-white/10 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-white/70">{t('hq.ops.cashierDesks')}</Label>
                  {(branches.data?.length ?? 0) > 0 ? (
                    <span className="text-muted-foreground text-[11px] tabular-nums">
                      {t('hq.ops.cashierDeskCount').replace('{n}', String(branches.data?.length ?? 0))}
                    </span>
                  ) : null}
                </div>
                {branches.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : (branches.data?.length ?? 0) === 0 ? (
                  <div
                    className="relative overflow-hidden rounded-2xl border border-dashed border-white/15 bg-black/25 px-5 py-6 text-center"
                  >
                    <div
                      className="pointer-events-none absolute inset-0 opacity-60"
                      style={{
                        background:
                          'radial-gradient(60% 60% at 50% 0%, rgba(167,139,250,0.18), transparent 60%)',
                      }}
                      aria-hidden
                    />
                    <div className="relative space-y-2">
                      <p className="text-[10px] font-semibold tracking-[0.4em] text-white/45">
                        {t('hq.ops.cashierEmptyKicker')}
                      </p>
                      <p className="text-sm font-medium text-white">{t('hq.ops.cashierEmptyTitle')}</p>
                      <p className="text-muted-foreground mx-auto max-w-md text-xs leading-relaxed">
                        {t('hq.ops.cashierEmptyBody')}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="mt-3 gap-1.5 border border-white/15 bg-black/40"
                        onClick={() => {
                          const node = document.getElementById('hq-branch-quick')
                          if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }}
                      >
                        {t('hq.ops.cashierEmptyCta')}
                      </Button>
                    </div>
                  </div>
                ) : null}
                <HqBranchDeskList
                  cafeId={profile!.cafe_id!}
                  branches={branches.data ?? []}
                  isLoading={branches.isLoading}
                  cashierReveal={cashierReveal}
                  onToggleReveal={(id) =>
                    setCashierReveal((prev) => ({ ...prev, [id]: !prev[id] }))
                  }
                  cashierDraft={cashierDraft}
                  onDraftChange={(id, value) =>
                    setCashierDraft((prev) => ({ ...prev, [id]: value }))
                  }
                  onRotatePin={(row) => void rotateCashierPinOnly.mutateAsync(row as BranchRow)}
                  onSavePin={(row, pin) =>
                    void commitCashierPin.mutateAsync({ row: row as BranchRow, pin })
                  }
                  rotatePending={rotateCashierPinOnly.isPending}
                  savePending={commitCashierPin.isPending}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-zinc-950/65 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="text-white">{t('hq.links.qrTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-2">
              <CustomerPortalQrCode
                value={`${window.location.origin}/my-streak/${slug}`}
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card className="border-white/10 bg-zinc-950/65 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-white">{t('hq.branchCrud.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(branches.data ?? []).length === 0 ? (
            <p className="text-sm text-white/60">{t('hq.branchCrud.empty')}</p>
          ) : (
            (branches.data ?? []).map((b) => {
              const draft = branchDrafts[b.id] ?? { name: b.name, branch_code: b.branch_code }
              return (
                <div key={b.id} className="grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 lg:grid-cols-[1.1fr_1fr_auto]">
                  <Input
                    value={draft.name}
                    onChange={(e) => setBranchDrafts((prev) => ({ ...prev, [b.id]: { ...draft, name: e.target.value } }))}
                    className="border-white/10 bg-black/40 text-white"
                  />
                  <Input
                    dir="ltr"
                    value={draft.branch_code}
                    onChange={(e) =>
                      setBranchDrafts((prev) => ({ ...prev, [b.id]: { ...draft, branch_code: e.target.value.toLowerCase() } }))
                    }
                    className="border-white/10 bg-black/40 text-left font-mono text-white"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => void saveBranch.mutateAsync(b)}>
                      {t('hq.branchCrud.save')}
                    </Button>
                    <Button type="button" size="sm" onClick={() => void resetPins.mutateAsync(b)}>
                      {t('hq.branchCrud.resetPins')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        if (window.confirm(t('hq.branchCrud.confirmDelete').replace('{code}', b.branch_code))) {
                          void deleteBranch.mutateAsync(b)
                        }
                      }}
                    >
                      {t('hq.branchCrud.delete')}
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Card id="hq-branch-quick" className="border-white/10 bg-gradient-to-br from-zinc-950/80 to-zinc-900/40 backdrop-blur-md">
        <CardHeader className="space-y-1.5">
          <CardTitle className="text-white">{t('hq.manualBranch.title')}</CardTitle>
          <p className="text-xs text-white/55">{t('hq.manualBranch.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value.slice(0, 60))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newBranchName.trim().length >= 2 && !manualAddBranch.isPending) {
                  e.preventDefault()
                  void manualAddBranch.mutateAsync()
                }
              }}
              placeholder={t('hq.manualBranch.namePlaceholder')}
              className="border-white/10 bg-black/40 text-white"
            />
            <Button
              type="button"
              disabled={manualAddBranch.isPending || newBranchName.trim().length < 2}
              onClick={() => void manualAddBranch.mutateAsync()}
              className="sm:w-44"
            >
              {manualAddBranch.isPending ? t('common.loading') : t('hq.manualBranch.submit')}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-white/45">
            {t('hq.manualBranch.helper')}
          </p>
        </CardContent>
      </Card>

      <HqAnalyticsCharts />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-white/10 bg-zinc-950/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-white">{t('hq.ai.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button disabled={insights.isPending} onClick={() => void insights.mutateAsync()}>
                {insights.isPending ? t('hq.ai.thinking') : t('hq.ai.cta')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setChatMessages([])}>
                {t('hq.ai.clear')}
              </Button>
            </div>
            <ScrollArea className="h-64 rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/80">
              {aiText ? <p className="mb-3 whitespace-pre-wrap">{aiText}</p> : null}
              {chatMessages.length === 0 ? (
                <p>{t('hq.ai.placeholder')}</p>
              ) : (
                <div className="space-y-2">
                  {chatMessages.map((m, idx) => (
                    <div
                      key={`chat:${idx}`}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-xs',
                        m.role === 'user' ? 'border-white/20 bg-white/5 text-white' : 'border-violet-500/25 bg-violet-500/10 text-white/85',
                      )}
                    >
                      <p className="mb-1 text-[10px] uppercase tracking-widest text-white/45">
                        {m.role === 'user' ? t('hq.ai.you') : t('hq.ai.assistant')}
                      </p>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
            <div className="flex gap-2">
              <Input
                value={chatPrompt}
                onChange={(e) => setChatPrompt(e.target.value)}
                placeholder={t('hq.ai.chatPlaceholder')}
                className="border-white/10 bg-black/40 text-white"
              />
              <Button
                type="button"
                disabled={askAi.isPending || chatPrompt.trim().length < 2}
                onClick={() => void askAi.mutateAsync()}
              >
                {askAi.isPending ? t('hq.ai.thinking') : t('hq.ai.send')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {profile.cafe_id && plan.data?.canBulkBranches ? (
          <HqBranchUploadWizard cafeId={profile.cafe_id} />
        ) : null}
      </div>
    </div>
  )
}
