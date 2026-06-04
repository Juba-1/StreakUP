// deno-lint-ignore-file no-explicit-any
import { z, type ZodTypeAny } from 'https://esm.sh/zod@3.23.8'

import { corsHeaders } from './cors.ts'

/**
 * Max bytes we accept for any Edge Function payload. Prevents resource-exhaustion
 * (OWASP A05 — Security Misconfiguration / DoS via unbounded input).
 */
export const MAX_JSON_BODY_BYTES = 256 * 1024 // 256 KiB

export function jsonError(
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function jsonOk(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Read a JSON body with a hard cap, parse, then validate against the given Zod schema.
 * On any failure this returns a ready-to-ship Response so callers never have to branch.
 */
export async function readValidatedJson<T extends ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<
  | { ok: true; data: z.infer<T> }
  | { ok: false; response: Response }
> {
  const cl = req.headers.get('content-length')
  if (cl && Number(cl) > MAX_JSON_BODY_BYTES) {
    return { ok: false, response: jsonError('payload_too_large', 413) }
  }

  let text: string
  try {
    // Read as text first so we can enforce the byte cap even when Content-Length lies.
    text = await req.text()
  } catch (_e) {
    return { ok: false, response: jsonError('invalid_body', 400) }
  }

  if (text.length > MAX_JSON_BODY_BYTES) {
    return { ok: false, response: jsonError('payload_too_large', 413) }
  }

  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch (_e) {
    return { ok: false, response: jsonError('invalid_json', 400) }
  }

  const check = schema.safeParse(parsed)
  if (!check.success) {
    return {
      ok: false,
      response: jsonError('invalid_body', 400, {
        issues: check.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      }),
    }
  }

  return { ok: true, data: check.data }
}

// ---------------------------------------------------------------------------
// Common primitives reused across Edge Functions.
// ---------------------------------------------------------------------------

export const zUuid = z.string().uuid()
export const zSha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, 'sha256_hex')

export const zSlug = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug_shape')

export const zEmail = z.string().email().max(254)

/** Staff-provided passwords (policy: low friction — match product requirements). */
export const zStrongPassword = z.string().min(4).max(512)

export const zTimezone = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z_+\-0-9]+(?:\/[A-Za-z_+\-0-9]+){0,2}$/, 'timezone_shape')

export const zCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'iso_4217')

export const zHexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'hex_color')

export const zLogoUrl = z
  .string()
  .url()
  .max(2048)
  .refine((s) => /^https:\/\//i.test(s), { message: 'https_required' })

export const zIdempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._~:\-]+$/, 'idem_shape')

export const zPhone = z
  .string()
  .min(4)
  .max(32)
  .regex(/^[+0-9\s\-()]+$/, 'phone_shape')

export const zPin = z
  .string()
  .regex(/^[0-9]{4,8}$/, 'pin_shape')

export { z }
