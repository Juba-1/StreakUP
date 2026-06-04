import { useQuery } from '@tanstack/react-query'

import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export type PlanLimits = {
  maxBranches: number
  maxApiKeys: number
  maxWebhooks: number
  fullWhiteLabel: boolean
  canIntegrations: boolean
  canBulkBranches: boolean
  isStarter: boolean
}

function parseLimits(raw: unknown): PlanLimits {
  const o = (raw ?? {}) as Record<string, unknown>
  const maxBranches = Number(o.max_branches ?? 1)
  const maxApiKeys = Number(o.max_api_keys ?? 0)
  const maxWebhooks = Number(o.max_outbound_webhooks ?? 0)
  const unlimited = (n: number) => n < 0

  return {
    maxBranches,
    maxApiKeys,
    maxWebhooks,
    fullWhiteLabel: Boolean(o.full_white_label),
    canIntegrations: unlimited(maxApiKeys) || unlimited(maxWebhooks) || maxApiKeys > 0 || maxWebhooks > 0,
    canBulkBranches: unlimited(maxBranches) || maxBranches > 1,
    isStarter: maxBranches <= 1 && maxApiKeys === 0 && maxWebhooks === 0,
  }
}

export function usePlanLimits(cafeId: string | null | undefined) {
  return useQuery({
    queryKey: ['hq-plan-limits', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('streakup_plan_limits_for_cafe', {
        p_cafe_id: cafeId!,
      })
      if (error) throw error
      return parseLimits(data)
    },
    staleTime: 120_000,
  })
}
