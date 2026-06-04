import { FunctionsHttpError } from '@supabase/supabase-js'

import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export type InviteBranchManagerInput = {
  email: string
  password: string
  cafeId: string
  branchId: string
  intent?: 'create' | 'reset_password'
  managerUserId?: string
}

export type InviteStaffResult = {
  ok: boolean
  userId?: string
  bootstrapPassword?: string | null
  action?: 'created' | 'updated'
  error?: string
}

async function extractInvokeError(
  error: unknown,
  data: unknown,
): Promise<string> {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (d.ok === false && typeof d.error === 'string') return d.error
  }

  if (error instanceof FunctionsHttpError) {
    try {
      const ctx = error.context as { json?: () => Promise<unknown> } | undefined
      if (ctx?.json) {
        const body = await ctx.json()
        if (body && typeof body === 'object' && typeof (body as { error?: string }).error === 'string') {
          return (body as { error: string }).error
        }
      }
    } catch {
      /* fall through */
    }
    return error.message
  }

  if (error instanceof Error) return error.message
  return 'invite_failed'
}

function parseInviteResponse(data: unknown): InviteStaffResult {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'invite_failed' }
  }
  const d = data as Record<string, unknown>
  if (d.ok === false) {
    return { ok: false, error: typeof d.error === 'string' ? d.error : 'invite_failed' }
  }
  return {
    ok: true,
    userId: typeof d.userId === 'string' ? d.userId : undefined,
    bootstrapPassword:
      typeof d.bootstrapPassword === 'string'
        ? d.bootstrapPassword
        : d.bootstrapPassword === null
          ? null
          : undefined,
    action: d.action === 'updated' ? 'updated' : d.action === 'created' ? 'created' : undefined,
  }
}

async function invokeInviteStaff(body: Record<string, unknown>): Promise<InviteStaffResult> {
  if (!supabaseBrowserClient) {
    return { ok: false, error: 'no_client' }
  }

  const { data, error } = await supabaseBrowserClient.functions.invoke('invite-staff', { body })

  if (error) {
    return { ok: false, error: await extractInvokeError(error, data) }
  }

  const parsed = parseInviteResponse(data)
  if (!parsed.ok) return parsed
  return parsed
}

export async function resetBranchManagerPasswordViaEdge(
  input: InviteBranchManagerInput,
): Promise<InviteStaffResult> {
  return invokeInviteStaff({
    role: 'branch_manager',
    email: input.email.trim().toLowerCase(),
    password: input.password.trim(),
    cafeId: input.cafeId,
    branchId: input.branchId,
    intent: 'reset_password',
    managerUserId: input.managerUserId,
  })
}

export async function inviteBranchManagerViaEdge(
  input: InviteBranchManagerInput,
): Promise<InviteStaffResult> {
  const body: Record<string, unknown> = {
    role: 'branch_manager',
    email: input.email.trim().toLowerCase(),
    cafeId: input.cafeId,
    branchId: input.branchId,
    intent: input.intent ?? 'create',
  }

  if (input.password?.trim()) {
    body.password = input.password.trim()
  }
  if (input.managerUserId) {
    body.managerUserId = input.managerUserId
  }

  return invokeInviteStaff(body)
}
