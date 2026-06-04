import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export type ManageTenantBody =
  | {
      action: 'update_tenant'
      cafeId: string
      name: string
      slug: string
      timezone: string
      currencyCode: string
      status: 'active' | 'suspended' | 'archived'
    }
  | {
      action: 'update_owner'
      cafeId: string
      ownerEmail?: string
      ownerPassword?: string
    }
  | {
      action: 'delete_tenant'
      cafeId: string
      confirmSlug: string
    }

/**
 * Structured failure category. The UI maps these to localized toasts; we
 * intentionally do not put raw English strings here so RTL/i18n stays clean.
 */
export type ManageTenantErrorKind =
  | 'no_client'
  | 'not_authenticated'
  | 'forbidden'
  | 'cafe_not_found'
  | 'owner_not_found'
  | 'confirm_slug_mismatch'
  | 'method_not_allowed'
  | 'missing_env'
  | 'rate_limited'
  | 'invalid_body'
  | 'network'
  | 'server'
  | 'unknown'

export type ManageTenantSuccess = {
  ok: true
  cafe?: { id: string; slug: string; name: string }
  ownerUserId?: string
  deleted?: boolean
}

export type ManageTenantFailure = {
  ok: false
  kind: ManageTenantErrorKind
  /** Server-provided error code (e.g. `weak_password`). Never localized. */
  serverCode?: string
  /** Free-form detail (only logged, never shown verbatim to end users). */
  detail?: string
  /** Optional retry hint (rate-limit). */
  retryMs?: number
  /** HTTP status, when available. */
  status?: number
}

export type ManageTenantResult = ManageTenantSuccess | ManageTenantFailure

/**
 * Map a server-side error code into one of our well-known failure kinds.
 * Anything we don't recognize falls back to `server` so the UI can render a
 * generic toast — never a raw error string.
 */
function classifyServerError(code: string | undefined, status: number): ManageTenantErrorKind {
  if (status === 401) return 'not_authenticated'
  if (status === 429) return 'rate_limited'
  if (code === 'forbidden') return 'forbidden'
  if (code === 'cafe_not_found') return 'cafe_not_found'
  if (code === 'owner_not_found') return 'owner_not_found'
  if (code === 'confirm_slug_mismatch') return 'confirm_slug_mismatch'
  if (code === 'method_not_allowed') return 'method_not_allowed'
  if (code === 'missing_env') return 'missing_env'
  if (code === 'invalid_body' || code === 'invalid_json') return 'invalid_body'
  if (status >= 500) return 'server'
  return 'unknown'
}

async function readErrorBody(res: Response): Promise<{ code?: string; detail?: string; retryMs?: number }> {
  const mime = res.headers.get('Content-Type') ?? ''
  try {
    if (mime.includes('application/json')) {
      const raw = (await res.clone().json()) as Record<string, unknown> | null
      if (raw && typeof raw === 'object') {
        const code = typeof raw.error === 'string' ? raw.error : undefined
        const detail = typeof raw.message === 'string' ? raw.message : undefined
        const retryMs =
          typeof raw.retry_after_ms === 'number' ? raw.retry_after_ms : undefined
        return { code, detail, retryMs }
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const text = (await res.text()).trim().slice(0, 2000)
    return { detail: text }
  } catch {
    return {}
  }
}

async function failureFromInvokeError(error: unknown): Promise<ManageTenantFailure> {
  const e = error as Error & { name?: string; context?: unknown; status?: number }
  const name = typeof e?.name === 'string' ? e.name : ''

  if (name === 'FunctionsHttpError' && e.context instanceof Response) {
    const status = e.context.status
    const body = await readErrorBody(e.context)
    return {
      ok: false,
      kind: classifyServerError(body.code, status),
      serverCode: body.code,
      detail: body.detail,
      retryMs: body.retryMs,
      status,
    }
  }

  if (name === 'FunctionsRelayError' && e.context instanceof Response) {
    const status = e.context.status
    const body = await readErrorBody(e.context)
    return { ok: false, kind: 'network', serverCode: body.code, detail: body.detail, status }
  }

  if (name === 'FunctionsFetchError') {
    return {
      ok: false,
      kind: 'network',
      detail: typeof e.message === 'string' ? e.message : 'fetch_failed',
    }
  }

  return {
    ok: false,
    kind: 'unknown',
    detail: typeof e?.message === 'string' ? e.message : 'invoke_failed',
  }
}

export async function manageTenantViaEdge(body: ManageTenantBody): Promise<ManageTenantResult> {
  if (!supabaseBrowserClient) return { ok: false, kind: 'no_client' }

  const { data: sessionData } = await supabaseBrowserClient.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) return { ok: false, kind: 'not_authenticated' }

  const { data, error } = await supabaseBrowserClient.functions.invoke<Record<string, unknown>>(
    'admin-manage-tenant',
    {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  )

  if (error) return failureFromInvokeError(error)

  if (!data || typeof data !== 'object') {
    return { ok: false, kind: 'unknown', detail: 'empty_response' }
  }

  if ((data as { ok?: unknown }).ok !== true) {
    const code = typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : undefined
    return {
      ok: false,
      kind: classifyServerError(code, 400),
      serverCode: code,
      detail: typeof (data as { message?: unknown }).message === 'string' ? (data as { message: string }).message : undefined,
    }
  }

  const ok: ManageTenantSuccess = { ok: true }
  if (typeof (data as { cafe?: unknown }).cafe === 'object') {
    ok.cafe = (data as { cafe: ManageTenantSuccess['cafe'] }).cafe
  }
  if (typeof (data as { ownerUserId?: unknown }).ownerUserId === 'string') {
    ok.ownerUserId = (data as { ownerUserId: string }).ownerUserId
  }
  if (typeof (data as { deleted?: unknown }).deleted === 'boolean') {
    ok.deleted = (data as { deleted: boolean }).deleted
  }
  return ok
}
