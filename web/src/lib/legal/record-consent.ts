import type { SupabaseClient } from '@supabase/supabase-js'

export type RecordConsentResult = {
  ok: boolean
  reason?: string
}

export async function recordLegalConsent(client: SupabaseClient): Promise<RecordConsentResult> {
  const { data, error } = await client.rpc('record_legal_consent_secure')
  if (error) {
    return { ok: false, reason: error.message }
  }
  const o = data as { ok?: boolean; reason?: string }
  return { ok: Boolean(o?.ok), reason: o?.reason }
}
