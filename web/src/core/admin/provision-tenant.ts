import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export type ProvisionTenantInput = {
  name: string
  slug: string
  ownerEmail: string
  ownerPassword: string
  lifecycle: 'trial' | 'active' | 'suspended'
  timezone: string
  currencyCode: string
  primaryColor?: string | null
  secondaryColor?: string | null
  accentColor?: string | null
  backgroundColor?: string | null
  logoUrl?: string | null
}

export type ProvisionTenantResult = {
  ok: boolean
  cafe?: { id: string; slug: string; name: string }
  ownerUserId?: string
  error?: string
}

export async function provisionTenantViaEdge(input: ProvisionTenantInput): Promise<ProvisionTenantResult> {
  if (!supabaseBrowserClient) {
    return { ok: false, error: 'no_client' }
  }

  const { data, error } = await supabaseBrowserClient.functions.invoke('admin-provision-tenant', {
    body: {
      name: input.name,
      slug: input.slug,
      ownerEmail: input.ownerEmail,
      ownerPassword: input.ownerPassword,
      lifecycle: input.lifecycle,
      timezone: input.timezone,
      currencyCode: input.currencyCode,
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      accentColor: input.accentColor,
      backgroundColor: input.backgroundColor,
      logoUrl: input.logoUrl,
    },
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  const d = data as ProvisionTenantResult & { ok?: boolean }
  if (!d?.ok) {
    return { ok: false, error: typeof d?.error === 'string' ? d.error : 'provision_failed' }
  }

  return d
}
