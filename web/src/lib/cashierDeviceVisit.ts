import {
  hashRecordVisitPayload,
  type RecordVisitIdempotentInput,
} from '@/core/streak/visit-ingestion'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export type DeviceVisitResult = {
  status?: string
  visit_id?: string
  visit_date?: string
  streak_after?: number
  already_visited_today?: boolean
}

export async function recordVisitByDevice(
  deviceToken: string,
  input: RecordVisitIdempotentInput,
): Promise<DeviceVisitResult> {
  if (!supabaseBrowserClient) {
    throw new Error('Supabase is not configured')
  }

  const payloadSha256 = await hashRecordVisitPayload(input)

  const { data, error } = await supabaseBrowserClient.rpc('cashier_record_visit_by_device', {
    p_device_token: deviceToken,
    p_branch_id: input.branchId,
    p_customer_id: input.customerId,
    p_idempotency_key: input.idempotencyKey,
    p_payload_sha256: payloadSha256,
    p_event_type: input.eventType ?? 'check_in',
    p_client_visit_date: input.clientVisitDate,
  })

  if (error) throw error

  const res = data as Record<string, unknown> | null
  if (res && res.ok === false) {
    const reason = String(res.reason ?? 'device_visit_failed')
    throw new Error(reason)
  }

  return {
    status: res?.status as string | undefined,
    visit_id: res?.visit_id as string | undefined,
    visit_date: res?.visit_date as string | undefined,
    streak_after: res?.streak_after as number | undefined,
    already_visited_today: Boolean(res?.already_visited_today),
  }
}
