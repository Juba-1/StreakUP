import type { RecordVisitIdempotentInput } from '@/core/streak/visit-ingestion'

const STORAGE_KEY = 'streakup.cashier.visitQueue.v1'

export type QueuedVisit = {
  id: string
  createdAt: number
  input: RecordVisitIdempotentInput
}

function readQueue(): QueuedVisit[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as QueuedVisit[]
  } catch {
    return []
  }
}

function writeQueue(items: QueuedVisit[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function enqueueOfflineVisit(input: RecordVisitIdempotentInput) {
  const item: QueuedVisit = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    input,
  }
  const next = [...readQueue(), item]
  writeQueue(next)
  return item
}

export function listQueuedVisits(): QueuedVisit[] {
  return readQueue()
}

export function removeQueuedVisit(id: string) {
  writeQueue(readQueue().filter((q) => q.id !== id))
}

export function clearQueuedVisits() {
  localStorage.removeItem(STORAGE_KEY)
}
