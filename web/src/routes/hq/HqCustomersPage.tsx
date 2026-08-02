import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { AlertTriangle, ChevronLeft, ChevronRight, Search, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { hapticSuccess } from '@/lib/haptics'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { CustomersQuickActions } from '@/routes/hq/customers/CustomersQuickActions'
import { CustomersSummary } from '@/routes/hq/customers/CustomersSummary'
import { CustomersTable } from '@/routes/hq/customers/CustomersTable'
import { CustomersToolbar } from '@/routes/hq/customers/CustomersToolbar'
import { CustomerDrawer } from '@/routes/hq/customers/CustomerDrawer'
import {
  CustomerOverrideModal,
  quickOverrideCustomer,
  type UpdatedCustomer,
} from '@/routes/hq/customers/CustomerOverrideModal'
import { isActiveCustomer, matchesFilter } from '@/routes/hq/customers/customerStatus'
import { useCustomersMeta } from '@/routes/hq/customers/useCustomersMeta'
import { useCustomersUrlState } from '@/routes/hq/customers/useCustomersUrlState'
import {
  PAGE_SIZE,
  parseListResult,
  type CustomerRow,
  type ListResult,
} from '@/routes/hq/customers/types'

export function HqCustomersPage() {
  const { t } = useI18n()
  const { slug } = useParams()
  const qc = useQueryClient()
  const { data: profile } = useProfile()
  const { search, setSearch, filter, setFilter, sort, page, setPage, customerId, openCustomer, closeCustomer } =
    useCustomersUrlState()

  const [searchInput, setSearchInput] = useState(search)
  const [editing, setEditing] = useState<CustomerRow | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<CustomerRow | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setSearchInput(search)
  }, [search])

  useEffect(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      if (searchInput !== search) setSearch(searchInput)
    }, 320)
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [searchInput, search, setSearch])

  const cafeId = profile?.cafe_id ?? null
  const canList =
    profile?.role === 'hq_owner' ||
    (profile?.role === 'super_admin' && Boolean(cafeId || slug))

  const meta = useCustomersMeta(cafeId, Boolean(canList && cafeId))

  const useServerList = filter === 'all'

  const listQuery = useQuery<ListResult>({
    queryKey: ['hq-customers', cafeId, slug, search, page],
    enabled: Boolean(supabaseBrowserClient && canList && useServerList),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_list_customers_secure', {
        p_cafe_id: cafeId,
        p_slug: slug ?? '',
        p_search: search || '',
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      })
      if (error) throw error
      return parseListResult(data)
    },
    staleTime: 30_000,
  })

  const filteredSnapshot = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = meta.snapshot.filter((row) =>
      matchesFilter(row, filter, meta.today, meta.milestones, meta.readyCustomerIds),
    )
    if (q) {
      rows = rows.filter(
        (r) =>
          r.full_name.toLowerCase().includes(q) ||
          r.pin_code.toLowerCase().includes(q) ||
          (r.phone ?? '').toLowerCase().includes(q),
      )
    }
    if (sort === 'streak_desc') {
      rows = [...rows].sort((a, b) => b.current_streak - a.current_streak)
    } else if (sort === 'streak_asc') {
      rows = [...rows].sort((a, b) => a.current_streak - b.current_streak)
    } else if (sort === 'last_visit') {
      rows = [...rows].sort((a, b) =>
        String(b.last_visit_date ?? '').localeCompare(String(a.last_visit_date ?? '')),
      )
    } else {
      rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
    return rows
  }, [meta.snapshot, meta.today, meta.milestones, meta.readyCustomerIds, filter, search, sort])

  const clientTotal = filteredSnapshot.length
  const clientRows = useMemo(() => {
    const start = page * PAGE_SIZE
    return filteredSnapshot.slice(start, start + PAGE_SIZE)
  }, [filteredSnapshot, page])

  const rows: CustomerRow[] = useServerList
    ? listQuery.data?.ok
      ? listQuery.data.rows
      : []
    : clientRows
  const total = useServerList ? (listQuery.data?.ok ? listQuery.data.total : 0) : clientTotal
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const isLoading = useServerList ? listQuery.isLoading : meta.isLoading
  const isError = useServerList ? listQuery.isError : false

  useEffect(() => {
    if (listQuery.isSuccess && listQuery.data && !listQuery.data.ok && listQuery.data.reason) {
      toast.error(t('hq.customers.loadError'))
    }
  }, [listQuery.isSuccess, listQuery.data, t])

  const filterCounts = useMemo(
    () => ({
      active: meta.snapshot.filter((r) => isActiveCustomer(r, meta.today, meta.milestones)).length,
      near_reward: meta.kpis.nearReward,
      lost_streak: meta.kpis.lostStreak,
      has_shield: meta.kpis.hasShield,
      ready_reward: meta.readyCustomerIds.size,
      visited_today: meta.kpis.visitedToday,
      high_streak: meta.kpis.highStreakCount,
      inactive: meta.kpis.inactive,
      returning: meta.kpis.returningToday,
      new: meta.kpis.newCount,
    }),
    [meta],
  )

  const selectedRow =
    rows.find((r) => r.id === selectedId) ??
    meta.snapshot.find((r) => r.id === selectedId) ??
    null

  const selectedFallback =
    rows.find((r) => r.id === customerId) ??
    meta.snapshot.find((r) => r.id === customerId) ??
    null

  const invalidateLists = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['hq-customers', cafeId] }),
      qc.invalidateQueries({ queryKey: ['hq-customers-snapshot', cafeId] }),
      qc.invalidateQueries({ queryKey: ['hq-customers-ready-rewards', cafeId] }),
    ])
  }

  const applyUpdated = (updated: UpdatedCustomer) => {
    qc.setQueryData<ListResult>(['hq-customers', cafeId, slug, search, page], (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        rows: prev.rows.map((r) =>
          r.id === updated.id
            ? {
                ...r,
                current_streak: updated.current_streak,
                longest_streak: updated.longest_streak,
                shields: updated.shields,
                full_name: updated.full_name,
              }
            : r,
        ),
      }
    })
    void qc.invalidateQueries({ queryKey: ['hq-customers-snapshot', cafeId] })
  }

  const quickMut = useMutation({
    mutationFn: quickOverrideCustomer,
    onSuccess: (updated) => {
      hapticSuccess()
      toast.success(t('hq.customers.override.success'))
      applyUpdated(updated)
    },
    onError: () => toast.error(t('hq.customers.override.error')),
  })

  const runResetStreak = (row: CustomerRow) => setResetTarget(row)

  const confirmResetStreak = async () => {
    const row = resetTarget
    if (!row) return
    await quickMut.mutateAsync({
      customer: row,
      cafeId,
      slug: slug ?? '',
      streak: 0,
    })
    setResetTarget(null)
  }

  const runGrantShield = (row: CustomerRow) => {
    void quickMut.mutateAsync({
      customer: row,
      cafeId,
      slug: slug ?? '',
      shields: row.shields + 1,
    })
  }

  const emptyKind =
    search.trim()
      ? 'search'
      : filter === 'near_reward'
        ? 'near'
        : filter === 'inactive'
          ? 'inactive'
          : filter === 'lost_streak'
            ? 'lost'
            : filter !== 'all'
              ? 'filter'
              : 'none'

  const totalLabel = useServerList ? total : meta.kpis.totalSnapshot || total

  return (
    <div className="space-y-6 pb-10">
      <header className="space-y-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {t('hq.customers.title')}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-white/45">{t('hq.customers.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-[11px] text-white/70">
            <Users className="size-3.5" aria-hidden />
            {t('hq.customers.totalChip').replace('{n}', String(totalLabel))}
          </div>
        </div>
      </header>

      <CustomersSummary
        total={meta.kpis.totalSnapshot || total}
        nearReward={meta.kpis.nearReward}
        readyRewards={meta.kpis.readyRewards}
        visitedToday={meta.kpis.visitedToday}
        lostStreak={meta.kpis.lostStreak}
        activeFilter={filter}
        onFilter={setFilter}
      />

      <CustomersToolbar
        search={searchInput}
        onSearch={setSearchInput}
        filter={filter}
        onFilter={setFilter}
        counts={filterCounts}
      />

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 space-y-3 lg:col-span-9">
          {isLoading ? (
            <div className="space-y-2 rounded-2xl border border-white/10 bg-zinc-950/55 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-white/4" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 py-16 text-white/40">
              <AlertTriangle className="size-10 text-amber-300/70" aria-hidden />
              <p className="text-sm font-medium">{t('hq.customers.loadError')}</p>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              kind={emptyKind}
              onClear={() => {
                setSearchInput('')
                setSearch('')
                setFilter('all')
              }}
            />
          ) : (
            <>
              <CustomersTable
                rows={rows}
                today={meta.today}
                milestones={meta.milestones}
                selectedId={selectedId}
                onSelect={(row) => setSelectedId(row.id)}
                onView={(row) => openCustomer(row.id)}
                onEdit={setEditing}
                onResetStreak={runResetStreak}
                onGrantShield={runGrantShield}
              />

              {totalPages > 1 ? (
                <div className="flex items-center justify-between px-1 text-xs text-white/55">
                  <span>
                    {t('hq.customers.pageRange')
                      .replace('{from}', String(page * PAGE_SIZE + 1))
                      .replace('{to}', String(Math.min((page + 1) * PAGE_SIZE, total)))
                      .replace('{total}', String(total))}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="secondary"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                      aria-label={t('hq.customers.prevPage')}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="secondary"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(page + 1)}
                      aria-label={t('hq.customers.nextPage')}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="lg:col-span-3">
          <CustomersQuickActions
            selected={selectedRow}
            onEdit={setEditing}
            onGrantShield={runGrantShield}
            onResetStreak={runResetStreak}
            onView={(row) => openCustomer(row.id)}
          />
        </div>
      </div>

      <CustomerDrawer
        open={Boolean(customerId)}
        customerId={customerId}
        cafeId={cafeId}
        slug={slug ?? ''}
        fallback={selectedFallback}
        milestones={meta.milestoneDays}
        onClose={closeCustomer}
        onEdit={(row) => {
          setEditing(row)
        }}
      />

      <ConfirmDialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null)
        }}
        tone="danger"
        title={t('common.confirmTitle')}
        description={t('hq.customers.confirmResetStreak')}
        pending={quickMut.isPending}
        onConfirm={confirmResetStreak}
      />

      <AnimatePresence>
        {editing ? (
          <CustomerOverrideModal
            customer={editing}
            cafeId={cafeId}
            slug={slug ?? ''}
            onClose={() => setEditing(null)}
            onSuccess={(updated) => {
              applyUpdated(updated)
              setEditing(null)
              void invalidateLists()
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function EmptyState({
  kind,
  onClear,
}: {
  kind: 'none' | 'search' | 'near' | 'inactive' | 'lost' | 'filter'
  onClear: () => void
}) {
  const { t } = useI18n()
  const copy =
    kind === 'search'
      ? {
          title: t('hq.customers.emptySearchTitle'),
          body: t('hq.customers.emptySearchBody'),
          cta: t('hq.customers.clearFilters'),
        }
      : kind === 'near'
        ? {
            title: t('hq.customers.emptyNearTitle'),
            body: t('hq.customers.emptyNearBody'),
            cta: t('hq.customers.clearFilters'),
          }
        : kind === 'inactive'
          ? {
              title: t('hq.customers.emptyInactiveTitle'),
              body: t('hq.customers.emptyInactiveBody'),
              cta: t('hq.customers.clearFilters'),
            }
          : kind === 'lost'
            ? {
                title: t('hq.customers.emptyLostTitle'),
                body: t('hq.customers.emptyLostBody'),
                cta: t('hq.customers.clearFilters'),
              }
            : kind === 'filter'
              ? {
                  title: t('hq.customers.emptyFilterTitle'),
                  body: t('hq.customers.emptyFilterBody'),
                  cta: t('hq.customers.clearFilters'),
                }
              : {
                  title: t('hq.customers.emptyTitle'),
                  body: t('hq.customers.emptyBody'),
                  cta: null as string | null,
                }

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/12 bg-white/2 px-6 py-16 text-center">
      {kind === 'search' ? (
        <Search className="size-8 text-white/30" aria-hidden />
      ) : (
        <Users className="size-8 text-white/30" aria-hidden />
      )}
      <p className="text-sm font-semibold text-white">{copy.title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-white/45">{copy.body}</p>
      {copy.cta ? (
        <Button type="button" size="sm" variant="secondary" onClick={onClear}>
          {copy.cta}
        </Button>
      ) : null}
    </div>
  )
}
