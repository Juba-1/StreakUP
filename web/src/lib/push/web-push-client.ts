const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** Must match `customer_register_push_subscription` in phase24.sql (PostgREST exact names). */
export type CustomerRegisterPushSubscriptionRpcArgs = {
  p_cafe_slug: string
  p_session_token: string
  p_endpoint: string
  p_p256dh: string
  p_auth: string
}

/**
 * ArrayBuffer → URL-safe base64 (Push API / web-push format).
 * Chunked to avoid `apply` stack limits on large buffers.
 */
export function arrayBufferToBase64Url(buffer: ArrayBuffer | null | undefined): string {
  if (!buffer || buffer.byteLength === 0) return ''

  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Extract endpoint + encryption keys from a PushSubscription without relying on toJSON() alone. */
export function extractPushSubscriptionKeys(subscription: PushSubscription): {
  endpoint: string
  p256dh: string
  auth: string
} {
  const fromBuffer = {
    p256dh: arrayBufferToBase64Url(subscription.getKey('p256dh')),
    auth: arrayBufferToBase64Url(subscription.getKey('auth')),
  }

  let fromJson: { endpoint?: string; p256dh?: string; auth?: string } = {}
  try {
    const json = subscription.toJSON() as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }
    fromJson = {
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    }
  } catch {
    /* fall through to buffer / endpoint only */
  }

  return {
    endpoint: String(subscription.endpoint ?? fromJson.endpoint ?? ''),
    p256dh: fromBuffer.p256dh || String(fromJson.p256dh ?? ''),
    auth: fromBuffer.auth || String(fromJson.auth ?? ''),
  }
}

export function buildCustomerRegisterPushSubscriptionRpcArgs(input: {
  cafeSlug: string
  sessionToken: string
  endpoint: string
  p256dh: string
  auth: string
}): CustomerRegisterPushSubscriptionRpcArgs {
  return {
    p_cafe_slug: String(input.cafeSlug ?? '').trim() || '',
    p_session_token: String(input.sessionToken ?? '').trim() || '',
    p_endpoint: String(input.endpoint ?? '').trim() || '',
    p_p256dh: String(input.p256dh ?? '').trim() || '',
    p_auth: String(input.auth ?? '').trim() || '',
  }
}

export function isWebPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Boolean(VAPID_PUBLIC?.length)
  )
}

export async function ensureServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) return null
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'classic' })
}

export async function subscribeAndRegisterPush(_args: {
  cafeSlug: string
  sessionToken: string
}) {
  // Web Push deferred — do not call customer_register_push_subscription until re-enabled.
  return { ok: false as const, reason: 'feature_disabled' }
}
