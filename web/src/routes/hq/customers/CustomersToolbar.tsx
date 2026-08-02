import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { useI18n } from '@/core/i18n/I18nProvider'
import { PRIMARY_FILTERS } from '@/routes/hq/customers/customerStatus'
import type { CustomerFilter } from '@/routes/hq/customers/types'
import { cn } from '@/lib/utils'

type Props = {
  search: string
  onSearch: (v: string) => void
  filter: CustomerFilter
  onFilter: (f: CustomerFilter) => void
  counts: Partial<Record<CustomerFilter, number>>
}

const FILTER_LABEL: Record<CustomerFilter, string> = {
  all: 'hq.customers.filterAll',
  active: 'hq.customers.filterActive',
  near_reward: 'hq.customers.filterNear',
  lost_streak: 'hq.customers.filterLost',
  has_shield: 'hq.customers.filterShield',
  ready_reward: 'hq.customers.filterReady',
  high_streak: 'hq.customers.filterHigh',
  inactive: 'hq.customers.filterInactive',
  visited_today: 'hq.customers.filterVisited',
  returning: 'hq.customers.filterReturning',
  new: 'hq.customers.filterNew',
}

const FILTER_TONE: Partial<Record<CustomerFilter, string>> = {
  all: 'border-white/20 bg-white/10 text-white',
  active: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100',
  near_reward: 'border-amber-500/35 bg-amber-500/15 text-amber-100',
  lost_streak: 'border-rose-500/35 bg-rose-500/15 text-rose-100',
  has_shield: 'border-sky-500/35 bg-sky-500/15 text-sky-100',
  ready_reward: 'border-violet-500/35 bg-violet-500/15 text-violet-100',
}

export function CustomersToolbar({ search, onSearch, filter, onFilter, counts }: Props) {
  const { t } = useI18n()

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label={t('hq.customers.filtersAria')}
      >
        {PRIMARY_FILTERS.map((id) => {
          const active = filter === id
          const count = counts[id]
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFilter(id)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                active
                  ? (FILTER_TONE[id] ?? 'border-white/20 bg-white/10 text-white')
                  : 'border-transparent bg-white/3 text-white/45 hover:bg-white/6 hover:text-white/70',
              )}
            >
              {t(FILTER_LABEL[id])}
              {typeof count === 'number' && id !== 'all' ? (
                <span className="ms-1.5 tabular-nums opacity-70">{count}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-white/35"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('hq.customers.searchPlaceholder')}
            className="h-11 rounded-xl border-white/10 bg-black/40 ps-11 text-sm text-white placeholder:text-white/30"
            aria-label={t('hq.customers.searchPlaceholder')}
          />
        </div>
      </div>
    </div>
  )
}
