import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { CustomerFilter, CustomerSort } from '@/routes/hq/customers/types'

const FILTERS = new Set<CustomerFilter>([
  'all',
  'active',
  'near_reward',
  'lost_streak',
  'has_shield',
  'ready_reward',
  'high_streak',
  'inactive',
  'visited_today',
  'returning',
  'new',
])

const SORTS = new Set<CustomerSort>(['newest', 'streak_desc', 'streak_asc', 'last_visit'])

function parseFilter(raw: string | null): CustomerFilter {
  if (raw && FILTERS.has(raw as CustomerFilter)) return raw as CustomerFilter
  return 'all'
}

function parseSort(raw: string | null): CustomerSort {
  if (raw && SORTS.has(raw as CustomerSort)) return raw as CustomerSort
  return 'newest'
}

function parsePage(raw: string | null): number {
  const n = Number(raw ?? '1')
  if (!Number.isFinite(n) || n < 1) return 0
  return Math.floor(n) - 1
}

export function useCustomersUrlState() {
  const [params, setParams] = useSearchParams()

  const search = params.get('q') ?? ''
  const filter = parseFilter(params.get('filter'))
  const sort = parseSort(params.get('sort'))
  const page = parsePage(params.get('page'))
  const customerId = params.get('customer')

  const patch = useCallback(
    (next: {
      q?: string
      filter?: CustomerFilter
      sort?: CustomerSort
      page?: number
      customer?: string | null
    }) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next.q !== undefined) {
            if (next.q.trim()) p.set('q', next.q)
            else p.delete('q')
          }
          if (next.filter !== undefined) {
            if (next.filter === 'all') p.delete('filter')
            else p.set('filter', next.filter)
          }
          if (next.sort !== undefined) {
            if (next.sort === 'newest') p.delete('sort')
            else p.set('sort', next.sort)
          }
          if (next.page !== undefined) {
            if (next.page <= 0) p.delete('page')
            else p.set('page', String(next.page + 1))
          }
          if (next.customer !== undefined) {
            if (next.customer) p.set('customer', next.customer)
            else p.delete('customer')
          }
          return p
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return useMemo(
    () => ({
      search,
      filter,
      sort,
      page,
      customerId,
      setSearch: (q: string) => patch({ q, page: 0 }),
      setFilter: (f: CustomerFilter) => patch({ filter: f, page: 0 }),
      setSort: (s: CustomerSort) => patch({ sort: s, page: 0 }),
      setPage: (pageIndex: number) => patch({ page: pageIndex }),
      openCustomer: (id: string) => patch({ customer: id }),
      closeCustomer: () => patch({ customer: null }),
    }),
    [search, filter, sort, page, customerId, patch],
  )
}
