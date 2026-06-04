import type { SupabaseClient } from '@supabase/supabase-js'

export type AiIntent =
  | 'parse_branches_csv'
  | 'hq_dashboard_insights'
  | 'hq_live_pulse'
  | 'hq_owner_chat'
  | 'hq_roi_copilot'

export type ParseBranchesCsvRequest = {
  intent: 'parse_branches_csv'
  csvText: string
}

export type HqDashboardInsightsRequest = {
  intent: 'hq_dashboard_insights'
}

export type HqLivePulseRequest = {
  intent: 'hq_live_pulse'
  locale?: 'en' | 'ar'
}

export type HqOwnerChatRequest = {
  intent: 'hq_owner_chat'
  prompt: string
  locale?: 'en' | 'ar'
}

export type HqRoiCopilotRequest = {
  intent: 'hq_roi_copilot'
  prompt: string
  locale?: 'en' | 'ar'
}

export type AiRouterRequest =
  | ParseBranchesCsvRequest
  | HqDashboardInsightsRequest
  | HqLivePulseRequest
  | HqOwnerChatRequest
  | HqRoiCopilotRequest

export async function invokeAiRouter(supabase: SupabaseClient, body: AiRouterRequest) {
  return supabase.functions.invoke('ai-router', { body })
}
