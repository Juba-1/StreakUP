import { useQuery } from '@tanstack/react-query'

import { fetchStaffBootstrap } from '@/core/auth/resolveStaffDashboard'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

/**
 * Cached staff home path for command palette / post-login redirects.
 */
export function useStaffDashboardPath() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['staff-dashboard-path', user?.id],
    enabled: Boolean(user && supabaseBrowserClient),
    staleTime: 60_000,
    queryFn: async () => {
      if (!user || !supabaseBrowserClient) return '/login'
      const r = await fetchStaffBootstrap(supabaseBrowserClient)
      return r.ok ? r.path : '/login'
    },
  })
}
