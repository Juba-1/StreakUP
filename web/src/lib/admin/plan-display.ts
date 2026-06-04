/** Maps internal plan_tier codes to enterprise-facing labels. */
export const PLAN_TIER_LABEL: Record<string, { en: string; ar: string }> = {
  starter: { en: 'Basic', ar: 'أساسي' },
  growth: { en: 'Pro', ar: 'احترافي' },
  enterprise: { en: 'Elite', ar: 'نخبة' },
  free: { en: 'Basic', ar: 'أساسي' },
}

export function planTierLabel(code: string | null | undefined, locale: 'en' | 'ar'): string {
  if (!code) return locale === 'ar' ? '—' : '—'
  const key = code.toLowerCase()
  return PLAN_TIER_LABEL[key]?.[locale] ?? code
}

export type TenantBillingStatus = 'active' | 'suspended' | 'past_due' | 'trial'

export function resolveTenantBillingStatus(row: {
  cafeStatus?: string | null
  subStatus?: string | null
}): TenantBillingStatus {
  if (row.cafeStatus === 'suspended' || row.cafeStatus === 'archived') return 'suspended'
  if (row.subStatus === 'past_due') return 'past_due'
  if (row.subStatus === 'trialing') return 'trial'
  return 'active'
}
