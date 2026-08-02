import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useI18n } from '@/core/i18n/I18nProvider'
import { normalizeCashierPin, secureDigits4 } from '@/lib/secure-pin'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cafeLocalDateString } from '@/routes/hq/home/cafeLocalDate'

export type OpsBranchStatus = 'running' | 'no_visits' | 'attention'

export type OpsBranch = {
  id: string
  name: string
  branch_code: string
  manager_password: string
  cashier_pin: string
  lastActivityAt: string | null
  visitsToday: number
  status: OpsBranchStatus
}

export type OpsSystemPulse = {
  overall: 'ok' | 'attention' | 'unknown'
  lastVisitAt: string | null
  lastRewardAt: string | null
  /** No backend sync timestamp exists yet — always null until a field is wired. */
  lastSyncAt: null
}

function branchCodeFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

function deriveStatus(visitsToday: number, lastActivityAt: string | null, pin: string): OpsBranchStatus {
  const pinOk = /^[0-9]{4,8}$/.test(String(pin ?? ''))
  if (!pinOk || lastActivityAt == null) return 'attention'
  if (visitsToday > 0) return 'running'
  return 'no_visits'
}

export function useHqOperations(cafeId: string | null | undefined, enabled: boolean) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [cashierDraft, setCashierDraft] = useState<Record<string, string>>({})
  const [branchDrafts, setBranchDrafts] = useState<
    Record<string, { name: string; branch_code: string }>
  >({})
  const [checking, setChecking] = useState(false)

  const cafeQuery = useQuery({
    queryKey: ['hq-cafe', cafeId],
    enabled: Boolean(supabaseBrowserClient && enabled && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('id, slug, name, timezone')
        .eq('id', cafeId!)
        .single()
      if (error) throw error
      return data as { id: string; slug: string; name: string; timezone: string }
    },
  })

  const branchesQuery = useQuery({
    queryKey: ['hq-branches-admin', cafeId],
    enabled: Boolean(supabaseBrowserClient && enabled && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('branches')
        .select('id, name, branch_code, manager_password, cashier_pin')
        .eq('cafe_id', cafeId!)
        .order('created_at', { ascending: true })
        .limit(100)
      if (error) throw error
      return (data ?? []) as Omit<OpsBranch, 'lastActivityAt' | 'visitsToday' | 'status'>[]
    },
  })

  const lastVisitQuery = useQuery({
    queryKey: ['hq-ops-last-visit', cafeId],
    enabled: Boolean(supabaseBrowserClient && enabled && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('visits')
        .select('created_at, branch_id')
        .eq('cafe_id', cafeId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as { created_at: string; branch_id: string | null } | null
    },
  })

  const lastRewardQuery = useQuery({
    queryKey: ['hq-ops-last-reward', cafeId],
    enabled: Boolean(supabaseBrowserClient && enabled && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('rewards')
        .select('claimed_at')
        .eq('cafe_id', cafeId!)
        .not('claimed_at', 'is', null)
        .order('claimed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as { claimed_at: string | null } | null
    },
  })

  const branchActivityQuery = useQuery({
    queryKey: ['hq-ops-branch-activity', cafeId],
    enabled: Boolean(supabaseBrowserClient && enabled && cafeId && (branchesQuery.data?.length ?? 0) > 0),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('visits')
        .select('branch_id, created_at, visit_date')
        .eq('cafe_id', cafeId!)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as { branch_id: string | null; created_at: string; visit_date: string }[]
    },
  })

  const todayKey = useMemo(
    () => cafeLocalDateString(cafeQuery.data?.timezone ?? 'UTC'),
    [cafeQuery.data?.timezone],
  )

  const branches: OpsBranch[] = useMemo(() => {
    const rows = branchActivityQuery.data ?? []
    const lastMap = new Map<string, string>()
    const todayMap = new Map<string, number>()
    for (const row of rows) {
      const bid = row.branch_id
      if (!bid) continue
      if (!lastMap.has(bid)) lastMap.set(bid, row.created_at)
      if (row.visit_date === todayKey) {
        todayMap.set(bid, (todayMap.get(bid) ?? 0) + 1)
      }
    }
    return (branchesQuery.data ?? []).map((b) => {
      const lastActivityAt = lastMap.get(b.id) ?? null
      const visitsToday = todayMap.get(b.id) ?? 0
      return {
        ...b,
        lastActivityAt,
        visitsToday,
        status: deriveStatus(visitsToday, lastActivityAt, b.cashier_pin),
      }
    })
  }, [branchesQuery.data, branchActivityQuery.data, todayKey])

  useEffect(() => {
    if (!branchesQuery.data) return
    setBranchDrafts((prev) => {
      const next: Record<string, { name: string; branch_code: string }> = {}
      for (const b of branchesQuery.data) {
        next[b.id] = prev[b.id] ?? { name: b.name, branch_code: b.branch_code }
      }
      return next
    })
    setCashierDraft((prev) => {
      const next = { ...prev }
      for (const b of branchesQuery.data) {
        if (next[b.id] === undefined) next[b.id] = String(b.cashier_pin ?? '')
      }
      return next
    })
  }, [branchesQuery.data])

  const pulse: OpsSystemPulse = useMemo(() => {
    const lastVisitAt = lastVisitQuery.data?.created_at ?? null
    const lastRewardAt = lastRewardQuery.data?.claimed_at ?? null
    const hasBranches = branches.length > 0
    const cafeOk = cafeQuery.isSuccess && Boolean(cafeQuery.data)
    const anyAttention = branches.some((b) => b.status === 'attention')
    let overall: OpsSystemPulse['overall'] = 'unknown'
    if (cafeOk && hasBranches && !anyAttention) overall = 'ok'
    else if (cafeOk && (!hasBranches || anyAttention)) overall = 'attention'
    return { overall, lastVisitAt, lastRewardAt, lastSyncAt: null }
  }, [branches, cafeQuery.data, cafeQuery.isSuccess, lastRewardQuery.data, lastVisitQuery.data])

  const invalidateOps = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['hq-branches-admin', cafeId] }),
      qc.invalidateQueries({ queryKey: ['hq-ops-last-visit', cafeId] }),
      qc.invalidateQueries({ queryKey: ['hq-ops-last-reward', cafeId] }),
      qc.invalidateQueries({ queryKey: ['hq-ops-branch-activity', cafeId] }),
      qc.invalidateQueries({ queryKey: ['hq-cafe', cafeId] }),
    ])
  }

  const runSystemCheck = async () => {
    setChecking(true)
    try {
      await invalidateOps()
      const [b, v, r] = await Promise.all([
        branchesQuery.refetch(),
        lastVisitQuery.refetch(),
        lastRewardQuery.refetch(),
      ])
      if (b.isError || v.isError || r.isError) {
        toast.error(t('hq.opsPage.checkFail'))
        return
      }
      toast.success(t('hq.opsPage.checkOk'))
    } finally {
      setChecking(false)
    }
  }

  const rotateCashierPin = useMutation({
    mutationFn: async (row: OpsBranch) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const pin = secureDigits4()
      const { error } = await supabaseBrowserClient
        .from('branches')
        .update({ cashier_pin: pin, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await branchesQuery.refetch()
      toast.success(t('hq.ops.cashierRotated'))
    },
    onError: () => toast.error(t('hq.ops.cashierSaveFail')),
  })

  const commitCashierPin = useMutation({
    mutationFn: async ({ row, pin }: { row: OpsBranch; pin: string }) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const clean = normalizeCashierPin(pin)
      if (!clean) throw new Error('pin_shape')
      const { error } = await supabaseBrowserClient
        .from('branches')
        .update({ cashier_pin: clean, updated_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await branchesQuery.refetch()
      toast.success(t('hq.ops.cashierSaved'))
    },
    onError: (e: Error) =>
      toast.error(e.message === 'pin_shape' ? t('hq.ops.cashierPinInvalid') : t('hq.ops.cashierSaveFail')),
  })

  const saveBranch = useMutation({
    mutationFn: async (row: OpsBranch) => {
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
      await branchesQuery.refetch()
      toast.success(t('hq.branchCrud.toastSaveOk'))
    },
    onError: () => toast.error(t('hq.branchCrud.toastSaveFail')),
  })

  const deleteBranch = useMutation({
    mutationFn: async (row: OpsBranch) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const { error } = await supabaseBrowserClient.from('branches').delete().eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await branchesQuery.refetch()
      toast.success(t('hq.branchCrud.toastDeleteOk'))
    },
    onError: () => toast.error(t('hq.branchCrud.toastDeleteFail')),
  })

  const manualAddBranch = useMutation({
    mutationFn: async ({ name, city }: { name: string; city?: string }) => {
      if (!supabaseBrowserClient || !cafeId) throw new Error('no_client')
      const baseName = name.trim()
      if (baseName.length < 2) throw new Error('invalid_input')
      const cityTrim = (city ?? '').trim()
      // City is UI-only (no city column) — fold into display name when provided.
      const displayName = cityTrim ? `${baseName} — ${cityTrim}` : baseName
      const existingCodes = new Set(branches.map((b) => b.branch_code))
      const baseCode = branchCodeFromName(baseName) || `branch-${secureDigits4()}`
      let branch_code = baseCode
      let suffix = 2
      while (existingCodes.has(branch_code)) {
        branch_code = `${baseCode}-${suffix++}`
        if (suffix > 50) break
      }
      const manager_password = secureDigits4().repeat(2).slice(0, 6)
      const cashier_pin = secureDigits4()
      const { error } = await supabaseBrowserClient.from('branches').insert({
        cafe_id: cafeId,
        name: displayName,
        branch_code,
        manager_password,
        cashier_pin,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await branchesQuery.refetch()
      toast.success(t('hq.manualBranch.toastOk'))
    },
    onError: (err: unknown) => {
      const raw = (err as { message?: string } | null)?.message ?? (typeof err === 'string' ? err : '')
      if (raw.includes('plan_branch_limit')) toast.error(t('hq.manualBranch.errPlanLimit'))
      else if (raw.includes('plan_branch_forbidden')) toast.error(t('hq.manualBranch.errPlanForbidden'))
      else if (raw.includes('branches_cafe_code_uidx') || raw.includes('duplicate key'))
        toast.error(t('hq.manualBranch.errDuplicate'))
      else if (raw === 'invalid_input') toast.error(t('hq.manualBranch.errInvalidName'))
      else toast.error(t('hq.manualBranch.toastFail'))
    },
  })

  const isLoading =
    cafeQuery.isLoading ||
    branchesQuery.isLoading ||
    lastVisitQuery.isLoading ||
    lastRewardQuery.isLoading

  return {
    cafe: cafeQuery.data ?? null,
    branches,
    pulse,
    isLoading,
    isError: cafeQuery.isError || branchesQuery.isError,
    refetch: invalidateOps,
    runSystemCheck,
    checking,
    cashierDraft,
    setCashierDraftValue: (id: string, value: string) =>
      setCashierDraft((p) => ({ ...p, [id]: value })),
    branchDrafts,
    setBranchDraft: (id: string, draft: { name: string; branch_code: string }) =>
      setBranchDrafts((p) => ({ ...p, [id]: draft })),
    rotateCashierPin,
    commitCashierPin,
    saveBranch,
    deleteBranch,
    manualAddBranch,
  }
}
