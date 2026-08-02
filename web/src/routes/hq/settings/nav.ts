import {
  Bell,
  Building2,
  CreditCard,
  Palette,
  Plug,
  Shield,
  TriangleAlert,
  Users,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { SettingsGroup, SettingsNavItem, SettingsTab } from '@/routes/hq/settings/types'

export const SETTINGS_GROUPS: SettingsGroup[] = ['workspace', 'organization', 'finance', 'developerSecurity']

export const SETTINGS_NAV: Array<SettingsNavItem & { Icon: LucideIcon }> = [
  {
    id: 'general',
    group: 'workspace',
    Icon: Wrench,
    titleKey: 'hq.settingsHub.nav.general',
    bodyKey: 'hq.settingsHub.nav.generalBody',
    searchKeys: ['hq.settingsHub.nav.general', 'hq.settingsHub.nav.generalBody', 'hq.settingsHub.general.name'],
  },
  {
    id: 'brand',
    group: 'workspace',
    Icon: Palette,
    titleKey: 'hq.settingsHub.nav.brand',
    bodyKey: 'hq.settingsHub.nav.brandBody',
    searchKeys: ['hq.settingsHub.nav.brand', 'hq.settingsHub.nav.brandBody', 'hq.brand.title'],
  },
  {
    id: 'branches',
    group: 'organization',
    Icon: Building2,
    titleKey: 'hq.settingsHub.nav.branches',
    bodyKey: 'hq.settingsHub.nav.branchesBody',
    searchKeys: ['hq.settingsHub.nav.branches', 'hq.settingsHub.nav.branchesBody'],
  },
  {
    id: 'team',
    group: 'organization',
    Icon: Users,
    titleKey: 'hq.settingsHub.nav.team',
    bodyKey: 'hq.settingsHub.nav.teamBody',
    searchKeys: ['hq.settingsHub.nav.team', 'hq.settingsHub.nav.teamBody'],
  },
  {
    id: 'billing',
    group: 'finance',
    Icon: CreditCard,
    titleKey: 'hq.settingsHub.nav.billing',
    bodyKey: 'hq.settingsHub.nav.billingBody',
    searchKeys: ['hq.settingsHub.nav.billing', 'hq.settingsHub.nav.billingBody', 'hq.billing.title'],
  },
  {
    id: 'notifications',
    group: 'developerSecurity',
    Icon: Bell,
    titleKey: 'hq.settingsHub.nav.notifications',
    bodyKey: 'hq.settingsHub.nav.notificationsBody',
    searchKeys: ['hq.settingsHub.nav.notifications', 'hq.settingsHub.nav.notificationsBody'],
  },
  {
    id: 'integrations',
    group: 'developerSecurity',
    Icon: Plug,
    titleKey: 'hq.settingsHub.nav.integrations',
    bodyKey: 'hq.settingsHub.nav.integrationsBody',
    searchKeys: [
      'hq.settingsHub.nav.integrations',
      'hq.settingsHub.nav.integrationsBody',
      'hq.settingsHub.nav.developer',
      'hq.nav.integrations',
    ],
  },
  {
    id: 'security',
    group: 'developerSecurity',
    Icon: Shield,
    titleKey: 'hq.settingsHub.nav.security',
    bodyKey: 'hq.settingsHub.nav.securityBody',
    searchKeys: ['hq.settingsHub.nav.security', 'hq.settingsHub.nav.securityBody'],
  },
  {
    id: 'danger',
    group: 'developerSecurity',
    Icon: TriangleAlert,
    titleKey: 'hq.settingsHub.nav.danger',
    bodyKey: 'hq.settingsHub.nav.dangerBody',
    searchKeys: ['hq.settingsHub.nav.danger', 'hq.settingsHub.nav.dangerBody'],
  },
]

export function matchNavSearch(
  t: (k: string) => string,
  query: string,
): SettingsTab[] {
  const q = query.trim().toLowerCase()
  if (!q) return SETTINGS_NAV.map((n) => n.id)
  return SETTINGS_NAV.filter((item) => {
    const hay = [t(item.titleKey), t(item.bodyKey), ...item.searchKeys.map((k) => t(k))]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  }).map((n) => n.id)
}
