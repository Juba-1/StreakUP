import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { applyBrandingVars, parseCafeBranding, type CafeBranding } from '@/lib/branding'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

const BRAND_SESSION_KEY = 'streakup.cafe-brand.v1'

/**
 * Branding scope policy
 * ---------------------
 * Only the customer-facing portal (`/my-streak/:slug`) inherits the tenant's
 * configured brand colors and logo. All staff surfaces — Super Admin, HQ,
 * Branch Manager, and Cashier — keep the platform's default sleek theme so
 * operators always recognize the workspace shell, regardless of which
 * tenant they happen to be looking at.
 */

function readBrandCache(pathname: string): CafeBranding | null {
  try {
    const raw = sessionStorage.getItem(BRAND_SESSION_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as { path?: string; brand?: CafeBranding }
    if (o.path !== pathname || !o.brand) return null
    return o.brand
  } catch {
    return null
  }
}

function writeBrandCache(pathname: string, brand: CafeBranding) {
  try {
    sessionStorage.setItem(BRAND_SESSION_KEY, JSON.stringify({ path: pathname, brand }))
  } catch {
    /* ignore quota */
  }
}

function extractCustomerSlug(pathname: string): string | null {
  const m = pathname.match(/^\/my-streak\/([^/]+)/)
  return m?.[1] ?? null
}

export function BrandingHost() {
  const location = useLocation()
  const pathname = location.pathname
  const slug = useMemo(() => extractCustomerSlug(pathname), [pathname])
  const hostRef = useRef<HTMLDivElement>(null)
  const [primedBrand, setPrimedBrand] = useState<CafeBranding | null>(() => readBrandCache(pathname))

  useEffect(() => {
    setPrimedBrand(readBrandCache(pathname))
  }, [pathname])

  const customerBrandingQuery = useQuery({
    queryKey: ['cafe-public', slug],
    enabled: Boolean(slug && supabaseBrowserClient),
    queryFn: async (): Promise<CafeBranding | null> => {
      if (!slug || !supabaseBrowserClient) return null
      const { data, error } = await supabaseBrowserClient.rpc('get_cafe_public_profile', {
        p_slug: slug,
      })
      if (error) throw error
      return parseCafeBranding(data)
    },
  })

  const activeBranding = customerBrandingQuery.data ?? null
  const merged = slug ? activeBranding ?? primedBrand : null

  useLayoutEffect(() => {
    applyBrandingVars(hostRef.current, merged ?? null)
  }, [merged])

  useEffect(() => {
    if (activeBranding && slug) {
      writeBrandCache(pathname, activeBranding)
    }
  }, [activeBranding, pathname, slug])

  return (
    <div
      ref={hostRef}
      className="flex min-h-dvh flex-col [--brand-primary:#a78bfa] [--brand-secondary:#fb923c] [--brand-accent:#fb923c] [--brand-background:#09090b] [--brand-glow:rgba(167,139,250,0.55)]"
    >
      <Outlet />
    </div>
  )
}
