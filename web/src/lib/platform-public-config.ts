/** Keys stored in `platform_public_config` (safe for all authenticated roles + anon). */
export const PLATFORM_PUBLIC_CONFIG_KEYS = [
  'maintenance_mode',
  'default_locale',
  'global_announcement',
] as const

export type PlatformPublicConfigKey = (typeof PLATFORM_PUBLIC_CONFIG_KEYS)[number]

export function rowsToConfigMap(rows: Array<{ key: string; value: unknown }>): Record<string, unknown> {
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
