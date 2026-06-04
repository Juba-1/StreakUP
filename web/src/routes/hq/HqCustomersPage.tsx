import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Flame,
  Loader2,
  Search,
  Shield,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { hapticError, hapticSuccess } from '@/lib/haptics'
import {
  classifyOverrideFailure,
  type OverrideFailure,
} from '@/lib/supabase/rpc-errors'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type CustomerRow = {
  id: string
  full_name: string
  pin_code: string
  current_streak: number
  longest_streak: number
  shields: number
  created_at: string
  updated_at: string
  last_visit_date: string | null
}

type ListResult = {
  ok: boolean
  total: number
  limit: number
  offset: number
  rows: CustomerRow[]
  reason?: string
}

type OverrideResult = {
  ok: boolean
  customer?: {
    id: string
    current_streak: number
    longest_streak: number
    shields: number
    full_name: string
  }
  reason?: string
}

const PAGE_SIZE = 40

function normalizeCustomerRow(raw: unknown): CustomerRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  return {
    id: r.id,
    full_name: typeof r.full_name === 'string' ? r.full_name : '',
    pin_code: String(r.pin_code ?? ''),
    current_streak: Number(r.current_streak ?? 0),
    longest_streak: Number(r.longest_streak ?? 0),
    shields: Number(r.shields ?? 0),
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
    last_visit_date:
      r.last_visit_date == null || r.last_visit_date === ''
        ? null
        : String(r.last_visit_date),
  }
}

function parseListResult(data: unknown): ListResult {
  if (!data || typeof data !== 'object') {
    return { ok: false, total: 0, limit: PAGE_SIZE, offset: 0, rows: [], reason: 'invalid_response' }
  }

  const o = data as Record<string, unknown>
  let rows = o.rows
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows) as unknown
    } catch {
      rows = []
    }
  }

  const flat: unknown[] = []
  if (Array.isArray(rows)) {
    for (const item of rows) {
      if (Array.isArray(item)) flat.push(...item)
      else flat.push(item)
    }
  }

  const parsedRows = flat
    .map(normalizeCustomerRow)
    .filter((row): row is CustomerRow => row !== null)

  return {
    ok: o.ok === true,
    total: Number(o.total ?? parsedRows.length),
    limit: Number(o.limit ?? PAGE_SIZE),
    offset: Number(o.offset ?? 0),
    rows: parsedRows,
    reason: typeof o.reason === 'string' ? o.reason : undefined,
  }
}

export function HqCustomersPage() {
  const { t } = useI18n()
  const { slug } = useParams()
  const qc = useQueryClient()
  const { data: profile } = useProfile()

  const [search, setSearch] = useState('')
  const [deferredSearch, setDeferredSearch] = useState('')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<CustomerRow | null>(null)
  const debounceRef = useRef<number | null>(null)

  // Debounce search
  useEffect(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      setDeferredSearch(search)
      setPage(0)
    }, 320)
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [search])

  const cafeId = profile?.cafe_id ?? null
  const canList =
    profile?.role === 'hq_owner' ||
    (profile?.role === 'super_admin' && Boolean(cafeId || slug))

  const listQuery = useQuery<ListResult>({
    queryKey: ['hq-customers', cafeId, slug, deferredSearch, page],
    enabled: Boolean(supabaseBrowserClient && canList),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_list_customers_secure', {
        p_cafe_id: cafeId,
        p_slug: slug ?? '',
        p_search: deferredSearch || '',
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      })
      if (error) throw error
      return parseListResult(data)
    },
    staleTime: 30_000,
  })

  const result = listQuery.data
  const rows: CustomerRow[] = result?.ok ? result.rows : []
  const total = result?.ok ? result.total : 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  useEffect(() => {
    if (listQuery.isSuccess && result && !result.ok && result.reason) {
      toast.error(t('hq.customers.loadError'))
    }
  }, [listQuery.isSuccess, result, t])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.45em] text-white/45">
            {t('hq.customers.kicker')}
          </p>
          <h2 className="text-2xl font-semibold text-white">{t('hq.customers.title')}</h2>
          <p className="text-sm text-white/55">{t('hq.customers.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/70">
          <Users className="size-3.5" aria-hidden />
          {listQuery.isSuccess ? (
            <span>{t('hq.customers.totalChip').replace('{n}', String(total))}</span>
          ) : (
            <span className="h-3.5 w-12 animate-pulse rounded bg-white/10" />
          )}
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/35"
          aria-hidden
        />
        <input
          type="text"
          placeholder={t('hq.customers.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-12 w-full rounded-2xl border border-white/10 bg-black/40 pl-11 pr-4 text-sm text-white placeholder:text-white/30 backdrop-blur-md focus:border-(--brand-primary)/40 focus:outline-none focus:ring-2 focus:ring-(--brand-primary)/20 transition"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/55 backdrop-blur-xl">
        {listQuery.isLoading ? (
          <div className="space-y-px p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : listQuery.isError ? (
          <div className="flex flex-col items-center gap-3 py-16 text-white/40">
            <AlertTriangle className="size-10 text-amber-300/70" aria-hidden />
            <p className="text-sm font-medium">{t('hq.customers.loadError')}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-white/40">
            <Users className="size-10 opacity-40" aria-hidden />
            <p className="text-sm font-medium">
              {deferredSearch ? t('hq.customers.noResults') : t('hq.customers.empty')}
            </p>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 border-b border-white/8 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/35 sm:grid">
              <span>{t('hq.customers.col.name')}</span>
              <span>{t('hq.customers.col.streak')}</span>
              <span>{t('hq.customers.col.shields')}</span>
              <span>{t('hq.customers.col.pin')}</span>
              <span>{t('hq.customers.col.lastVisit')}</span>
              <span />
            </div>

            <ul className="divide-y divide-white/5">
              {rows.map((row) => (
                <CustomerRowItem
                  key={row.id}
                  row={row}
                  slug={slug ?? ''}
                  onEdit={() => setEditing(row)}
                  t={t}
                />
              ))}
            </ul>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-white/8 px-5 py-3 text-xs text-white/55">
                <span>
                  {t('hq.customers.page')
                    .replace('{page}', String(page + 1))
                    .replace('{total}', String(totalPages))}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded-lg border border-white/10 bg-white/[0.04] p-1.5 transition hover:bg-white/[0.08] disabled:opacity-40"
                    aria-label={t('hq.customers.prevPage')}
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-lg border border-white/10 bg-white/[0.04] p-1.5 transition hover:bg-white/[0.08] disabled:opacity-40"
                    aria-label={t('hq.customers.nextPage')}
                  >
                    <ChevronRight className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Override modal */}
      <AnimatePresence>
        {editing && (
          <OverrideModal
            customer={editing}
            cafeId={cafeId}
            slug={slug ?? ''}
            onClose={() => setEditing(null)}
            onSuccess={(updated) => {
              qc.setQueryData<ListResult>(
                ['hq-customers', cafeId, slug, deferredSearch, page],
                (prev) => {
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
                },
              )
              setEditing(null)
            }}
            t={t}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Customer row                                                        */
/* ------------------------------------------------------------------ */

function CustomerRowItem({
  row,
  slug,
  onEdit,
  t,
}: {
  row: CustomerRow
  slug: string
  onEdit: () => void
  t: (k: string) => string
}) {
  const lastVisit = row.last_visit_date ? new Date(row.last_visit_date).toLocaleDateString() : '—'

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3.5 transition hover:bg-white/[0.03] sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
      {/* Name + PIN */}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">
          {row.full_name || <span className="italic text-white/35">{t('hq.customers.unnamed')}</span>}
        </p>
        <p className="font-mono text-[11px] text-white/40" dir="ltr">
          PIN: {row.pin_code}
        </p>
      </div>

      {/* Streak */}
      <div className="hidden items-center gap-1.5 sm:flex">
        <Flame className="size-3.5 text-orange-300" aria-hidden />
        <span className="text-sm font-semibold tabular-nums text-white">{row.current_streak}</span>
        <span className="text-[11px] text-white/35">/{row.longest_streak}</span>
      </div>

      {/* Shields */}
      <div className="hidden items-center gap-1.5 sm:flex">
        <Shield className="size-3.5 text-sky-300" aria-hidden />
        <span className="text-sm font-semibold tabular-nums text-white">{row.shields}</span>
      </div>

      {/* PIN (compact on mobile) */}
      <div className="hidden font-mono text-xs text-white/55 sm:block" dir="ltr">
        {row.pin_code}
      </div>

      {/* Last visit */}
      <div className="hidden text-xs text-white/55 sm:block">{lastVisit}</div>

      <div className="flex items-center gap-1.5">
        <Link
          to={`/hq/${slug}/customers/${row.id}`}
          className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[10px] font-semibold text-white/70 transition hover:border-violet-500/35 hover:text-violet-100"
        >
          {t('hq.customers.profile')}
        </Link>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-xl border border-white/10 bg-white/[0.04] p-2 transition hover:border-(--brand-primary)/35 hover:bg-[color-mix(in_oklab,var(--brand-primary)_12%,transparent)]"
          aria-label={t('hq.customers.edit')}
        >
          <Edit3 className="size-4 text-white/70" aria-hidden />
        </button>
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Override modal                                                      */
/* ------------------------------------------------------------------ */

type UpdatedCustomer = {
  id: string
  current_streak: number
  longest_streak: number
  shields: number
  full_name: string
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

function OverrideModal({
  customer,
  cafeId,
  slug,
  onClose,
  onSuccess,
  t,
}: {
  customer: CustomerRow
  cafeId: string | null
  slug: string
  onClose: () => void
  onSuccess: (c: UpdatedCustomer) => void
  t: (k: string) => string
}) {
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
        p_full_name: p_full_name,
        p_cafe_id: cafeId,
        p_slug: slug || null,
      })

      const failure = classifyOverrideFailure(
        error,
        data,
        t('hq.customers.override.error'),
      )
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
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background: `
              radial-gradient(65% 55% at 100% 0%, color-mix(in oklab, var(--brand-primary) 22%, transparent), transparent 58%),
              radial-gradient(50% 45% at 0% 100%, color-mix(in oklab, var(--brand-secondary) 16%, transparent), transparent 55%)
            `,
          }}
        />

        <div className="relative p-7 sm:p-8">
          <button
            type="button"
            onClick={onClose}
            disabled={override.isPending}
            className="absolute right-5 top-5 rounded-xl border border-white/10 bg-white/5 p-1.5 text-white/55 transition hover:text-white disabled:opacity-40"
            aria-label={t('hq.customers.override.close')}
          >
            <X className="size-4" aria-hidden />
          </button>

          <div className="space-y-2 pr-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.42em] text-white/45">
              {t('hq.customers.override.kicker')}
            </p>
            <h3 id={`${formId}-title`} className="text-2xl font-semibold text-white">
              {customer.full_name || t('hq.customers.unnamed')}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-white/50" dir="ltr">
                PIN {customer.pin_code}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/4 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/55">
                <Flame className="size-3 text-orange-300" aria-hidden />
                {customer.current_streak}d
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/4 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/55">
                <Shield className="size-3 text-sky-300" aria-hidden />
                {customer.shields}
              </span>
            </div>
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
            <OverrideField
              label={t('hq.customers.override.nameLabel')}
              type="text"
              value={name}
              onChange={(v) => {
                setInlineError(null)
                setName(v)
              }}
              placeholder={t('hq.customers.override.namePlaceholder')}
              disabled={override.isPending}
            />

            <div className="grid grid-cols-2 gap-4">
              <OverrideField
                label={t('hq.customers.override.streakLabel')}
                type="number"
                value={streak}
                onChange={(v) => {
                  setInlineError(null)
                  setStreak(v)
                }}
                min={0}
                hint={t('hq.customers.override.streakHint')}
                icon={<Flame className="size-3.5 text-orange-300" aria-hidden />}
                disabled={override.isPending}
              />
              <OverrideField
                label={t('hq.customers.override.shieldsLabel')}
                type="number"
                value={shields}
                onChange={(v) => {
                  setInlineError(null)
                  setShields(v)
                }}
                min={0}
                hint={t('hq.customers.override.shieldsHint')}
                icon={<Shield className="size-3.5 text-sky-300" aria-hidden />}
                disabled={override.isPending}
              />
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
                'relative flex-1 overflow-hidden rounded-2xl py-3.5 text-sm font-semibold transition',
                'bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black',
                'shadow-[0_24px_70px_-24px_var(--brand-glow)]',
                'disabled:cursor-not-allowed disabled:opacity-55',
              )}
            >
              {override.isPending ? (
                <>
                  <motion.span
                    className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(115deg,transparent_30%,rgba(255,255,255,0.65)_50%,transparent_70%)]"
                    animate={{ x: ['-120%', '140%'] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                    aria-hidden
                  />
                  <span className="relative flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {t('hq.customers.override.saving')}
                  </span>
                </>
              ) : (
                <span className="relative flex items-center justify-center gap-2">
                  <Sparkles className="size-4" aria-hidden />
                  {t('hq.customers.override.save')}
                </span>
              )}
            </button>
          </div>

          {!isDirty ? (
            <p className="mt-3 text-center text-[11px] text-white/35">{t('hq.customers.override.noChangesHint')}</p>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  )
}

function OverrideField({
  label,
  type,
  value,
  onChange,
  placeholder,
  min,
  hint,
  icon,
  disabled,
}: {
  label: string
  type: 'text' | 'number'
  value: string
  onChange: (v: string) => void
  placeholder?: string
  min?: number
  hint?: string
  icon?: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-white/55">
        {icon}
        {label}
      </label>
      <input
        type={type}
        value={value}
        min={min}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-12 w-full rounded-xl border border-white/10 bg-black/55 px-4 text-sm text-white placeholder:text-white/30',
          'focus:border-(--brand-primary)/45 focus:outline-none focus:ring-2 focus:ring-(--brand-primary)/25 transition',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      />
      {hint ? <p className="text-[11px] text-white/35">{hint}</p> : null}
    </div>
  )
}
