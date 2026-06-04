import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query'
import { del, get, set } from 'idb-keyval'
import { type ReactNode, useMemo, useState } from 'react'

const PERSIST_KEY = 'streakup.rq.v1'

const idbStorage = {
  getItem: async (key: string) => {
    const v = await get<string>(key)
    return v === undefined ? null : v
  },
  setItem: async (key: string, value: string) => {
    await set(key, value)
  },
  removeItem: async (key: string) => {
    await del(key)
  },
}

function shouldPersistQueryKey(queryKey: readonly unknown[]) {
  const head = queryKey[0]
  if (typeof head !== 'string') return false
  return (
    head === 'profile' ||
    head === 'staff-dashboard-path' ||
    head === 'branch-portal' ||
    head === 'branch-visits' ||
    head === 'cashier-branch' ||
    head === 'hq-cafe' ||
    head === 'hq-stats' ||
    head === 'cafe-public' ||
    head === 'cashier-branding'
  )
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            gcTime: 1000 * 60 * 10,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            refetchOnMount: true,
          },
        },
      }),
  )

  const persister = useMemo(
    () =>
      createAsyncStoragePersister({
        storage: typeof window === 'undefined' ? undefined : idbStorage,
        key: PERSIST_KEY,
        throttleTime: 2000,
      }),
    [],
  )

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 48,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            defaultShouldDehydrateQuery(q) && shouldPersistQueryKey(q.queryKey),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
