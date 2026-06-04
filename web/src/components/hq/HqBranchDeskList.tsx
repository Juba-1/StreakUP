import { motion } from 'framer-motion'
import { ArrowUpRight, Copy, Eye, EyeOff, Monitor, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { HqBranchManagerInvite } from '@/components/hq/HqBranchManagerInvite'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

export type HqBranchDeskRow = {
  id: string
  name: string
  branch_code: string
  cashier_pin: string
  manager_password?: string
}

type Props = {
  cafeId: string
  branches: HqBranchDeskRow[]
  isLoading?: boolean
  cashierReveal: Record<string, boolean>
  onToggleReveal: (branchId: string) => void
  cashierDraft: Record<string, string>
  onDraftChange: (branchId: string, value: string) => void
  onRotatePin: (row: HqBranchDeskRow) => void
  onSavePin: (row: HqBranchDeskRow, pin: string) => void
  rotatePending?: boolean
  savePending?: boolean
}

export function HqBranchDeskList({
  cafeId,
  branches,
  isLoading,
  cashierReveal,
  onToggleReveal,
  cashierDraft,
  onDraftChange,
  onRotatePin,
  onSavePin,
  rotatePending,
  savePending,
}: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return branches
    return branches.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.branch_code.toLowerCase().includes(q),
    )
  }, [branches, query])

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  if (branches.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-white/40"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('hq.ops.deskSearch')}
          className="h-10 border-white/12 bg-black/45 ps-9 text-sm text-white placeholder:text-white/35"
        />
        {query.trim() ? (
          <span className="text-muted-foreground absolute end-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums">
            {t('hq.ops.deskSearchCount')
              .replace('{shown}', String(filtered.length))
              .replace('{total}', String(branches.length))}
          </span>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/12 bg-black/25 px-4 py-8 text-center text-sm text-white/55">
          {t('hq.ops.deskSearchEmpty')}
        </p>
      ) : (
        <div
          className={cn(
            'hq-desk-scroll max-h-96 min-h-0 overflow-y-auto overscroll-y-contain',
            'rounded-2xl border border-white/10 bg-black/20',
            'pe-1 [scrollbar-gutter:stable]',
          )}
        >
          <div className="space-y-3 p-2 pb-3">
            {filtered.map((b, index) => {
              const cashierUrl = `/cashier/${b.branch_code}`
              const cashierAbs = `${window.location.origin}${cashierUrl}`
              const showPin = cashierReveal[b.id]
              const draftPin = cashierDraft[b.id] ?? ''

              return (
                <motion.div
                  key={b.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.04, 0.2) }}
                  whileHover={{ scale: 1.005 }}
                  className={cn(
                    'space-y-4 rounded-2xl border border-white/10 bg-black/35 p-4',
                    'transition-shadow hover:border-white/18 hover:shadow-[0_20px_60px_-40px_var(--brand-glow)]',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-white">{b.name}</p>
                      <p dir="ltr" className="font-mono text-xs text-white/55">
                        /cashier/{b.branch_code}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="gap-1.5 border border-white/10 bg-black/40 text-white"
                      onClick={() => {
                        void navigator.clipboard.writeText(cashierAbs).then(
                          () => toast.success(t('hq.links.copied')),
                          () => toast.error(t('hq.api.copyFail')),
                        )
                      }}
                    >
                      <Copy className="size-3.5" aria-hidden />
                      {t('hq.ops.copyLink')}
                    </Button>
                  </div>

                  <Link
                    to={cashierUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative block overflow-hidden rounded-2xl border border-white/15 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] p-4 text-black shadow-[0_24px_60px_-28px_var(--brand-glow)] transition hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <div className="relative flex items-center gap-3">
                      <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-black/15 ring-1 ring-black/10">
                        <Monitor className="size-6" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-black/65">
                          {t('hq.ops.posKicker')}
                        </p>
                        <p className="truncate text-lg font-bold">{t('hq.ops.openCashier')}</p>
                      </div>
                      <ArrowUpRight className="size-5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </div>
                  </Link>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="grow space-y-2">
                      <Label className="text-white/65">{t('hq.ops.cashierPin')}</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <span dir="ltr" className="font-mono text-lg tabular-nums text-white">
                          {showPin ? b.cashier_pin : '••••'}
                        </span>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="secondary"
                          className="border border-white/10"
                          onClick={() => onToggleReveal(b.id)}
                        >
                          {showPin ? (
                            <EyeOff className="size-4" aria-hidden />
                          ) : (
                            <Eye className="size-4" aria-hidden />
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={rotatePending}
                          onClick={() => onRotatePin(b)}
                        >
                          {t('hq.ops.rotatePin')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-white/85"
                          onClick={() =>
                            void navigator.clipboard.writeText(String(b.cashier_pin ?? '')).then(
                              () => toast.success(t('hq.ops.pinCopied')),
                              () => toast.error(t('hq.api.copyFail')),
                            )
                          }
                        >
                          <Copy className="me-1 inline size-3.5" aria-hidden />
                          {t('hq.ops.copyPin')}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:w-40">
                      <Label className="text-white/65">{t('hq.ops.setPin')}</Label>
                      <Input
                        dir="ltr"
                        inputMode="numeric"
                        maxLength={8}
                        placeholder={t('hq.ops.pinPlaceholder')}
                        className="h-10 border-white/12 bg-black/40 font-mono text-sm text-white"
                        value={draftPin}
                        onChange={(e) =>
                          onDraftChange(b.id, e.target.value.replace(/\D/g, '').slice(0, 8))
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-white/20"
                        disabled={savePending}
                        onClick={() => onSavePin(b, draftPin)}
                      >
                        {t('hq.ops.savePin')}
                      </Button>
                    </div>
                  </div>

                  <HqBranchManagerInvite
                    cafeId={cafeId}
                    branchId={b.id}
                    branchCode={b.branch_code}
                    branchName={b.name}
                  />
                </motion.div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
