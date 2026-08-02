import type { RecordVisitIdempotentInput } from '@/core/streak/visit-ingestion'

const STORAGE_PREFIX = 'streakup.cashier.visitQueue.v2:'
const LEGACY_STORAGE_KEY = 'streakup.cashier.visitQueue.v1'

export type QueuedVisit = {
  id: string
  createdAt: number
  input: RecordVisitIdempotentInput
}

function storageKey(branchId: string) {
  return `${STORAGE_PREFIX}${branchId}`
}

function readQueue(branchId: string): QueuedVisit[] {
  try {
    const raw = localStorage.getItem(storageKey(branchId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as QueuedVisit[]
  } catch {
    return []
  }
}

function writeQueue(branchId: string, items: QueuedVisit[]) {
  localStorage.setItem(storageKey(branchId), JSON.stringify(items))
}

/** Migrate legacy global queue entries into the branch-scoped key (once). */
function migrateLegacyIfNeeded(branchId: string) {
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!legacy) return
    const parsed = JSON.parse(legacy) as unknown
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return
    }
    const mine = (parsed as QueuedVisit[]).filter((q) => q?.input?.branchId === branchId)
    if (mine.length > 0) {
      writeQueue(branchId, [...readQueue(branchId), ...mine])
    }
    const remaining = (parsed as QueuedVisit[]).filter((q) => q?.input?.branchId !== branchId)
    if (remaining.length === 0) localStorage.removeItem(LEGACY_STORAGE_KEY)
    else localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(remaining))
  } catch {
    /* ignore */
  }
}

export function enqueueOfflineVisit(input: RecordVisitIdempotentInput) {
  if (!input.branchId) throw new Error('missing_branch_id')
  migrateLegacyIfNeeded(input.branchId)
  const item: QueuedVisit = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    input,
  }
  writeQueue(input.branchId, [...readQueue(input.branchId), item])
  return item
}

export function listQueuedVisits(branchId?: string): QueuedVisit[] {
  if (!branchId) return []
  migrateLegacyIfNeeded(branchId)
  return readQueue(branchId)
}

export function removeQueuedVisit(branchId: string, id: string) {
  writeQueue(
    branchId,
    readQueue(branchId).filter((q) => q.id !== id),
  )
}

export function clearQueuedVisits(branchId?: string) {
  if (branchId) {
    localStorage.removeItem(storageKey(branchId))
    return
  }
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}
