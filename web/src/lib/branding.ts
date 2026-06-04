export type CafeBranding = {
  id: string
  name: string
  slug: string
  logo_url: string | null
  primary_color: string | null
  secondary_color: string | null
  accent_color: string | null
  background_color: string | null
  timezone: string
  currency_code: string
  grace_days?: number[]
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * OWASP A03 — Injection. Branding values flow from tenant-controlled columns
 * into inline CSS custom properties. We reject anything that isn't a plain
 * hex color so a malicious owner can't smuggle `;` / `url()` / `expression()`
 * into another user's stylesheet.
 */
export function sanitizeHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!HEX_COLOR_RE.test(trimmed)) return null
  return trimmed
}

/**
 * Accept only https:// URLs that parse cleanly and contain no quotes or
 * parentheses — defence-in-depth against CSS `url("...")` breakouts.
 */
export function sanitizeLogoUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.length > 2048) return null
  if (/["'()<>\\\s]/.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  return parsed.toString()
}

export function parseCafeBranding(raw: unknown): CafeBranding | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.slug !== 'string' || typeof o.name !== 'string') return null
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    logo_url: sanitizeLogoUrl(o.logo_url),
    primary_color: sanitizeHexColor(o.primary_color),
    secondary_color: sanitizeHexColor(o.secondary_color),
    accent_color: sanitizeHexColor(o.accent_color),
    background_color: sanitizeHexColor(o.background_color),
    timezone: typeof o.timezone === 'string' ? o.timezone : 'UTC',
    currency_code: typeof o.currency_code === 'string' ? o.currency_code : 'USD',
    grace_days: Array.isArray(o.grace_days) ? (o.grace_days as number[]) : [],
  }
}

const DEFAULT_PRIMARY = '#a78bfa'
const DEFAULT_SECONDARY = '#f97316'
const DEFAULT_BACKGROUND = '#09090b'

export function applyBrandingVars(target: HTMLElement | null, branding: CafeBranding | null) {
  if (!target) return

  if (!branding) {
    target.style.removeProperty('--brand-primary')
    target.style.removeProperty('--brand-secondary')
    target.style.removeProperty('--brand-accent')
    target.style.removeProperty('--brand-background')
    target.style.removeProperty('--brand-surface')
    target.style.removeProperty('--brand-glow')
    target.style.removeProperty('--brand-logo-url')
    return
  }

  const primary = sanitizeHexColor(branding.primary_color) ?? DEFAULT_PRIMARY
  const secondary = sanitizeHexColor(branding.secondary_color) ?? DEFAULT_SECONDARY
  const accent = sanitizeHexColor(branding.accent_color) ?? secondary
  const background = sanitizeHexColor(branding.background_color) ?? DEFAULT_BACKGROUND

  target.style.setProperty('--brand-primary', primary)
  target.style.setProperty('--brand-secondary', secondary)
  target.style.setProperty('--brand-accent', accent)
  target.style.setProperty('--brand-background', background)
  target.style.setProperty('--brand-surface', `color-mix(in oklab, ${background} 88%, white)`)
  target.style.setProperty('--brand-glow', `${primary}cc`)

  const safeLogo = sanitizeLogoUrl(branding.logo_url)
  if (safeLogo) {
    target.style.setProperty('--brand-logo-url', `url("${encodeURI(safeLogo)}")`)
  } else {
    target.style.removeProperty('--brand-logo-url')
  }
}
