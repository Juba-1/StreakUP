import { useQuery } from '@tanstack/react-query'

import { parseCafeBranding, type CafeBranding } from '@/lib/branding'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export function useCafePublicProfile(slug: string | undefined) {
  return useQuery({
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
}
