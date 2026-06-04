-- =============================================================================
-- Phase 24 fix — refresh PostgREST schema cache after RPC deploy
-- Run if customer_register_push_subscription returns 404 (PGRST202).
-- =============================================================================

notify pgrst, 'reload schema';
