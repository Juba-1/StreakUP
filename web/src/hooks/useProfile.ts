import { useQuery } from '@tanstack/react-query'

import { useAuth } from '@/features/auth/AuthProvider'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export type ProfileRow = {
  user_id: string
  role: 'super_admin' | 'hq_owner' | 'branch_manager' | 'cashier' | 'customer'
  cafe_id: string | null
  branch_id: string | null
  display_name: string | null
}

export function useProfile() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user && supabaseBrowserClient),
    queryFn: async (): Promise<ProfileRow | null> => {
      if (!user || !supabaseBrowserClient) return null
      const { data, error } = await supabaseBrowserClient
        .from('profiles')
        .select('user_id, role, cafe_id, branch_id, display_name')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) throw error
      return data as ProfileRow | null
    },
  })
}
