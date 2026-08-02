import type { QueryClient } from '@tanstack/react-query'
import { del } from 'idb-keyval'

/** IndexedDB key used by PersistQueryClientProvider */
export const QUERY_PERSIST_KEY = 'streakup.rq.v1'

/**
 * Clears in-memory React Query cache + persisted tenant-sensitive IDB snapshot.
 * Call on sign-out (and before accepting a new staff login) to prevent cross-HQ leaks.
 */
export async function clearTenantQueryCaches(client: QueryClient): Promise<void> {
  client.clear()
  try {
    await del(QUERY_PERSIST_KEY)
  } catch {
    /* non-fatal */
  }
}
