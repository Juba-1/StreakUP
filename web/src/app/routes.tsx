import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, createBrowserRouter } from 'react-router-dom'

import { RouteFallback } from '@/components/layout/RouteFallback'
import { AppShell } from '@/components/layout/AppShell'
import { BrandingHost } from '@/components/layout/BrandingHost'
import { RequireAuth } from '@/features/auth/RequireAuth'

const LoginPage = lazy(() =>
  import('@/routes/auth/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const AdminLayout = lazy(() =>
  import('@/routes/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
)
const AdminOverviewPage = lazy(() =>
  import('@/routes/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })),
)
const AdminTenantsPage = lazy(() =>
  import('@/routes/admin/AdminTenantsPage').then((m) => ({ default: m.AdminTenantsPage })),
)
const AdminTenantDetailPage = lazy(() =>
  import('@/routes/admin/AdminTenantDetailPage').then((m) => ({ default: m.AdminTenantDetailPage })),
)
const AdminAuditPage = lazy(() =>
  import('@/routes/admin/AdminAuditPage').then((m) => ({ default: m.AdminAuditPage })),
)
const AdminSettingsPage = lazy(() =>
  import('@/routes/admin/AdminSettingsPage').then((m) => ({ default: m.AdminSettingsPage })),
)
const AdminAnalyticsPage = lazy(() =>
  import('@/routes/admin/AdminAnalyticsPage').then((m) => ({ default: m.AdminAnalyticsPage })),
)
const HqShell = lazy(() => import('@/routes/hq/HqShell').then((m) => ({ default: m.HqShell })))
const HqHomePage = lazy(() =>
  import('@/routes/hq/HqHomePage').then((m) => ({ default: m.HqHomePage })),
)
const HqDevelopersPage = lazy(() =>
  import('@/routes/hq/HqDevelopersPage').then((m) => ({ default: m.HqDevelopersPage })),
)
const HqBrandPage = lazy(() => import('@/routes/hq/HqBrandPage').then((m) => ({ default: m.HqBrandPage })))
const HqRewardsPage = lazy(() =>
  import('@/routes/hq/HqRewardsPage').then((m) => ({ default: m.HqRewardsPage })),
)
const HqBillingPage = lazy(() => import('@/routes/hq/HqBillingPage').then((m) => ({ default: m.HqBillingPage })))
const HqCustomersPage = lazy(() =>
  import('@/routes/hq/HqCustomersPage').then((m) => ({ default: m.HqCustomersPage })),
)
const HqCustomerDetailPage = lazy(() =>
  import('@/routes/hq/HqCustomerDetailPage').then((m) => ({ default: m.HqCustomerDetailPage })),
)
const HqAnalyticsPage = lazy(() =>
  import('@/routes/hq/HqAnalyticsPage').then((m) => ({ default: m.HqAnalyticsPage })),
)
const HqSettingsPage = lazy(() =>
  import('@/routes/hq/HqSettingsPage').then((m) => ({ default: m.HqSettingsPage })),
)
const HqBranchConsolePage = lazy(() =>
  import('@/routes/hq/HqBranchConsolePage').then((m) => ({ default: m.HqBranchConsolePage })),
)
const BranchShell = lazy(() =>
  import('@/routes/branch/BranchShell').then((m) => ({ default: m.BranchShell })),
)
const BranchHomePage = lazy(() =>
  import('@/routes/branch/BranchHomePage').then((m) => ({ default: m.BranchHomePage })),
)
const CashierPage = lazy(() =>
  import('@/routes/cashier/CashierPage').then((m) => ({ default: m.CashierPage })),
)
const MyStreakHomePage = lazy(() =>
  import('@/routes/my-streak/MyStreakHomePage').then((m) => ({ default: m.MyStreakHomePage })),
)
const NotFoundPage = lazy(() =>
  import('@/routes/system/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
)
const LegalDocumentPage = lazy(() =>
  import('@/routes/legal/LegalDocumentPage').then((m) => ({ default: m.LegalDocumentPage })),
)
const MarketingLayout = lazy(() =>
  import('@/components/marketing/MarketingLayout').then((m) => ({ default: m.MarketingLayout })),
)
const LandingPage = lazy(() =>
  import('@/routes/marketing/LandingPage').then((m) => ({ default: m.LandingPage })),
)

function SuspenseWrap({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

export const appRouter = createBrowserRouter([
  {
    element: <BrandingHost />,
    children: [
      {
        path: '/',
        element: (
          <SuspenseWrap>
            <MarketingLayout />
          </SuspenseWrap>
        ),
        children: [
          { index: true, element: <SuspenseWrap><LandingPage /></SuspenseWrap> },
          {
            path: 'terms',
            element: (
              <SuspenseWrap>
                <LegalDocumentPage documentId="terms" />
              </SuspenseWrap>
            ),
          },
          {
            path: 'privacy',
            element: (
              <SuspenseWrap>
                <LegalDocumentPage documentId="privacy" />
              </SuspenseWrap>
            ),
          },
        ],
      },
      {
        element: <AppShell />,
        children: [
          { path: '/login', element: <SuspenseWrap><LoginPage /></SuspenseWrap> },

          {
            path: '/admin',
            element: (
              <RequireAuth>
                <SuspenseWrap>
                  <AdminLayout />
                </SuspenseWrap>
              </RequireAuth>
            ),
            children: [
              { index: true, element: <Navigate to="overview" replace /> },
              {
                path: 'overview',
                element: (
                  <SuspenseWrap>
                    <AdminOverviewPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'tenants',
                element: (
                  <SuspenseWrap>
                    <AdminTenantsPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'tenants/:tenantSlug',
                element: (
                  <SuspenseWrap>
                    <AdminTenantDetailPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'tenants/:tenantSlug/edit',
                element: (
                  <SuspenseWrap>
                    <AdminTenantDetailPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'analytics',
                element: (
                  <SuspenseWrap>
                    <AdminAnalyticsPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'audit',
                element: (
                  <SuspenseWrap>
                    <AdminAuditPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'settings',
                element: (
                  <SuspenseWrap>
                    <AdminSettingsPage />
                  </SuspenseWrap>
                ),
              },
            ],
          },

          {
            path: '/hq/:slug',
            element: (
              <RequireAuth>
                <SuspenseWrap>
                  <HqShell />
                </SuspenseWrap>
              </RequireAuth>
            ),
            children: [
              {
                index: true,
                element: (
                  <SuspenseWrap>
                    <HqHomePage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'api',
                element: (
                  <SuspenseWrap>
                    <HqDevelopersPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'brand',
                element: (
                  <SuspenseWrap>
                    <HqBrandPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'rewards',
                element: (
                  <SuspenseWrap>
                    <HqRewardsPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'customers',
                element: (
                  <SuspenseWrap>
                    <HqCustomersPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'customers/:customerId',
                element: (
                  <SuspenseWrap>
                    <HqCustomerDetailPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'analytics',
                element: (
                  <SuspenseWrap>
                    <HqAnalyticsPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'settings',
                element: (
                  <SuspenseWrap>
                    <HqSettingsPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'billing',
                element: (
                  <SuspenseWrap>
                    <HqBillingPage />
                  </SuspenseWrap>
                ),
              },
              {
                path: 'branches/:branchCode',
                element: (
                  <SuspenseWrap>
                    <HqBranchConsolePage />
                  </SuspenseWrap>
                ),
              },
            ],
          },

          {
            path: '/branch/:branchCode',
            element: (
              <RequireAuth>
                <SuspenseWrap>
                  <BranchShell />
                </SuspenseWrap>
              </RequireAuth>
            ),
            children: [
              {
                index: true,
                element: (
                  <SuspenseWrap>
                    <BranchHomePage />
                  </SuspenseWrap>
                ),
              },
            ],
          },

          {
            path: '/cashier/:branchCode',
            element: (
              <SuspenseWrap>
                <CashierPage />
              </SuspenseWrap>
            ),
          },

          { path: '/my-streak/:slug', element: <SuspenseWrap><MyStreakHomePage /></SuspenseWrap> },

          { path: '/legacy', element: <Navigate to="/login" replace /> },

          { path: '*', element: <SuspenseWrap><NotFoundPage /></SuspenseWrap> },
        ],
      },
    ],
  },
])
