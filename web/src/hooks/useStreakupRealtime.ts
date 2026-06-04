import { useEffect } from 'react'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * StreakUp realtime helper.
 *
 * This hook exists to keep realtime wiring consistent and reviewable:
 * - Centralizes channel naming
 * - Centralizes cleanup via `removeChannel`
 *
 * IMPORTANT SECURITY NOTE
 * - The Customer Portal runs as an anonymous client (no Supabase Auth session).
 * - Because of that, Postgres realtime (`postgres_changes`) on `public.visits`
 *   will not deliver events unless RLS allows anon SELECT — which we do NOT want.
 * - Instead, the Edge Function `record-visit` sends a broadcast "poke" after
 *   ingesting a visit. The portal listens to that poke and refetches via the
 *   existing `customer_portal_begin` RPC using the portal session token.
 *
 * This design preserves security while delivering instant UX.
 */
export function useStreakupPortalRealtime(params: {
  supabase: SupabaseClient | null
  customerId: string | null
  /**
   * Called when `public.rewards` updates for this customer.
   * Typically used to refetch the portal session and show claim toasts.
   */
  onRewardsUpdate: () => void
  /**
   * Called when the POS / ingestion pipeline records a visit for this customer.
   * This is usually a broadcast "poke" (not a DB change event) so the portal can refetch.
   */
  onVisitPoke: () => void
}) {
  const { supabase, customerId, onRewardsUpdate, onVisitPoke } = params

  useEffect(() => {
    if (!supabase || !customerId) return

    const channel = supabase
      .channel(`portal-rewards-${customerId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rewards',
          filter: `customer_id=eq.${customerId}`,
        },
        () => onRewardsUpdate(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [customerId, onRewardsUpdate, supabase])

  useEffect(() => {
    if (!supabase || !customerId) return

    const channel = supabase
      .channel(`portal-visits-${customerId}`)
      .on('broadcast', { event: 'visit' }, () => onVisitPoke())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [customerId, onVisitPoke, supabase])
}

