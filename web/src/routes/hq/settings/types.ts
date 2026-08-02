export type SettingsTab =
  | 'general'
  | 'brand'
  | 'branches'
  | 'team'
  | 'billing'
  | 'notifications'
  | 'integrations'
  | 'security'
  | 'danger'

export const SETTINGS_TABS: SettingsTab[] = [
  'general',
  'brand',
  'branches',
  'team',
  'billing',
  'notifications',
  'integrations',
  'security',
  'danger',
]

export function isSettingsTab(v: string | null | undefined): v is SettingsTab {
  return Boolean(v && (SETTINGS_TABS as string[]).includes(v))
}

/** Logical grouping for the Settings sidebar — mirrors how a cafe owner thinks about configuration. */
export type SettingsGroup = 'workspace' | 'organization' | 'finance' | 'developerSecurity'

export type SettingsNavItem = {
  id: SettingsTab
  group: SettingsGroup
  titleKey: string
  bodyKey: string
  searchKeys: string[]
}
