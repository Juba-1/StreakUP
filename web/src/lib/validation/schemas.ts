import { z } from 'zod'

import { normalizeSaudiMobileToE164 } from '@/lib/phone/saudi-mobile'

/**
 * Shared Zod schemas. We keep parity with the server-side schemas in
 * `supabase/functions/_shared/validation.ts` so a request that the frontend
 * rejects can never sneak past the edge either — and vice versa.
 */

export const zEmail = z.string().trim().toLowerCase().email().max(254)

export const zPassword = z
  .string()
  .min(4, { message: 'password_min' })
  .max(512, { message: 'password_max' })

export const zSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug_shape' })

export const zTimezone = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z_+\-0-9]+(?:\/[A-Za-z_+\-0-9]+){0,2}$/, { message: 'timezone_shape' })

export const zCurrency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, { message: 'iso_4217' })

export const zHexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, { message: 'hex_color' })

export const zOptionalHexColor = zHexColor.or(z.literal('').transform(() => null))

export const zHttpsUrl = z
  .string()
  .trim()
  .url({ message: 'url' })
  .max(2048)
  .refine((s) => /^https:\/\//i.test(s), { message: 'https_required' })

export const zPhone = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .regex(/^[+0-9\s\-()]+$/, { message: 'phone_shape' })

export const zPin = z.string().trim().regex(/^[0-9]{4,8}$/, { message: 'pin_shape' })
export const zProvisionLifecycle = z.enum(['trial', 'active', 'suspended'])

export const loginSchema = z.object({
  email: zEmail,
  password: zPassword,
})

export const provisionTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: zSlug,
  ownerEmail: zEmail,
  ownerPassword: zPassword,
  lifecycle: zProvisionLifecycle.default('trial'),
  timezone: zTimezone,
  currencyCode: zCurrency,
  primaryColor: zHexColor.nullable().optional(),
  secondaryColor: zHexColor.nullable().optional(),
  accentColor: zHexColor.nullable().optional(),
  backgroundColor: zHexColor.nullable().optional(),
  logoUrl: zHttpsUrl.nullable().optional(),
})

export const brandPaletteSchema = z.object({
  primary: zOptionalHexColor.nullable().optional(),
  secondary: zOptionalHexColor.nullable().optional(),
  accent: zOptionalHexColor.nullable().optional(),
  background: zOptionalHexColor.nullable().optional(),
})

export const outboundWebhookSchema = z.object({
  url: zHttpsUrl,
  label: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9 _.\-]+$/, { message: 'label_shape' }),
  events: z.array(z.enum(['visit.recorded', 'reward.unlocked'])).min(1),
})

export const portalLoginSchema = z.object({
  phone: zPhone,
  pin: zPin,
})

/** National `05XXXXXXXX` or international +966 — output is E.164 for RPC. */
export const zPortalSaudiFiveMobile = z
  .string()
  .trim()
  .superRefine((val, ctx) => {
    if (!normalizeSaudiMobileToE164(val)) ctx.addIssue({ code: 'custom', message: 'invalid_sa_mobile' })
  })
  .transform((val) => normalizeSaudiMobileToE164(val)!)

export const portalPhoneOnlySchema = z.object({
  phone: zPortalSaudiFiveMobile,
})

/** Phone + display name — second step of frictionless onboarding. */
export const portalNameStepSchema = z.object({
  phone: zPortalSaudiFiveMobile,
  name: z.string().trim().min(2).max(120),
})

export const portalStartSchema = z.object({
  phone: zPortalSaudiFiveMobile,
  name: z.string().trim().min(2).max(120).optional(),
})

export const platformConfigEntrySchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, { message: 'key_shape' }),
  value: z.unknown(),
})

export type LoginInput = z.infer<typeof loginSchema>
export type ProvisionTenantInput = z.infer<typeof provisionTenantSchema>
export type BrandPaletteInput = z.infer<typeof brandPaletteSchema>
export type OutboundWebhookInput = z.infer<typeof outboundWebhookSchema>
export type PortalLoginInput = z.infer<typeof portalLoginSchema>
export type PortalPhoneOnlyInput = z.infer<typeof portalPhoneOnlySchema>
export type PortalNameStepInput = z.infer<typeof portalNameStepSchema>
export type PortalStartInput = z.infer<typeof portalStartSchema>
