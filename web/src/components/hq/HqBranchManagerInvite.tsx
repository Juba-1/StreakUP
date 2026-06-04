import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, KeyRound, Mail, RefreshCw, UserCog } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/core/i18n/I18nProvider'
import {
  inviteBranchManagerViaEdge,
  resetBranchManagerPasswordViaEdge,
} from '@/core/staff/invite-staff'
import { branchManagerPortalUrl } from '@/lib/branch-portal-url'
import { generateHumanStaffPassword } from '@/lib/staff-password'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { zEmail } from '@/lib/validation/schemas'

type Props = {
  cafeId: string
  branchId: string
  branchCode: string
  branchName: string
}

type InviteBundle = {
  email: string
  password: string
  dashboardUrl: string
  action: 'created' | 'updated'
}

export function HqBranchManagerInvite({ cafeId, branchId, branchCode, branchName }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [bundle, setBundle] = useState<InviteBundle | null>(null)

  const slot = useQuery({
    queryKey: ['hq-branch-manager-slot', branchId],
    enabled: Boolean(supabaseBrowserClient && branchId && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_branch_manager_slot_secure', {
        p_branch_id: branchId,
      })
      if (error) throw error
      return data as {
        ok?: boolean
        assigned?: boolean
        manager_email?: string
        manager_user_id?: string
        branch_code?: string
        reason?: string
      }
    },
  })

  const assigned = Boolean(slot.data?.assigned)
  const managerEmail = slot.data?.manager_email ?? ''
  const managerUserId = slot.data?.manager_user_id

  const portalCode = useMemo(
    () => (slot.data?.branch_code ?? branchCode).trim().toLowerCase(),
    [slot.data?.branch_code, branchCode],
  )

  const dashboardUrl = useMemo(() => branchManagerPortalUrl(portalCode), [portalCode])

  useEffect(() => {
    if (managerEmail) setEmail(managerEmail)
  }, [managerEmail])

  const runInvite = async (mode: 'create' | 'reset') => {
    const targetEmail = (assigned ? managerEmail : email).trim().toLowerCase()
    const parsed = zEmail.safeParse(targetEmail)
    if (!parsed.success) throw new Error('invalid_email')

    const pwd =
      mode === 'reset'
        ? password.trim()
        : password.trim() || generateHumanStaffPassword('Branch')
    if (pwd.length < 4) throw new Error('invalid_password')

    const payload = {
      email: parsed.data,
      password: pwd,
      cafeId,
      branchId,
      managerUserId: managerUserId ?? undefined,
    }

    const res =
      mode === 'reset'
        ? await resetBranchManagerPasswordViaEdge(payload)
        : await inviteBranchManagerViaEdge({ ...payload, intent: 'create' })

    if (!res.ok) throw new Error(res.error ?? 'invite_failed')

    return {
      email: parsed.data,
      password: pwd,
      dashboardUrl,
      action: (res.action === 'updated' ? 'updated' : 'created') as 'created' | 'updated',
    }
  }

  const invite = useMutation({
    mutationFn: () => runInvite(assigned ? 'reset' : 'create'),
    onSuccess: (next) => {
      setBundle(next)
      setPassword('')
      void qc.invalidateQueries({ queryKey: ['hq-branch-manager-slot', branchId] })
      toast.success(
        next.action === 'updated' ? t('hq.manager.resetSuccess') : t('hq.manager.inviteSuccess'),
      )
    },
    onError: (e: Error) => {
      if (e.message === 'invalid_email') {
        toast.error(t('hq.manager.invalidEmail'))
        return
      }
      if (e.message === 'invalid_password') {
        toast.error(t('hq.manager.invalidPassword'))
        return
      }
      if (
        e.message === 'email_role_mismatch' ||
        e.message === 'email_other_branch' ||
        e.message === 'email_mismatch'
      ) {
        toast.error(t('hq.manager.emailConflict'))
        return
      }
      if (e.message === 'manager_not_found') {
        toast.error(t('hq.manager.noManager'))
        return
      }
      toast.error(assigned ? t('hq.manager.resetFail') : t('hq.manager.inviteFail'))
    },
  })

  const copyDashboardLinkOnly = () => {
    void navigator.clipboard.writeText(dashboardUrl).then(
      () => toast.success(t('hq.manager.linkCopied')),
      () => toast.error(t('hq.api.copyFail')),
    )
  }

  const copyBundle = () => {
    const creds = bundle ?? {
      email: managerEmail || email,
      password: password || t('hq.manager.passwordHidden'),
      dashboardUrl,
      action: 'created' as const,
    }
    const text = t('hq.manager.copyTemplate')
      .replace('{branch}', branchName)
      .replace('{url}', creds.dashboardUrl)
      .replace('{email}', creds.email)
      .replace('{password}', bundle?.password ?? (password || t('hq.manager.passwordHidden')))

    void navigator.clipboard.writeText(text).then(
      () => toast.success(t('hq.links.copied')),
      () => toast.error(t('hq.api.copyFail')),
    )
  }

  const suggestPassword = () => {
    setPassword(generateHumanStaffPassword('Branch'))
  }

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg border border-violet-400/25 bg-violet-500/10">
            <UserCog className="size-4 text-violet-200" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{t('hq.manager.title')}</p>
            <p className="text-[11px] text-white/50">{t('hq.manager.subtitle')}</p>
          </div>
        </div>
        {assigned ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-100">
            <Check className="size-3" aria-hidden />
            {t('hq.manager.assigned')}
          </span>
        ) : (
          <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] text-white/45">
            {t('hq.manager.unassigned')}
          </span>
        )}
      </div>

      <p className="mt-3 rounded-lg border border-white/8 bg-black/25 px-3 py-2 font-mono text-[11px] text-sky-100/90" dir="ltr">
        {dashboardUrl}
      </p>

      {assigned && managerEmail ? (
        <p className="mt-2 text-xs text-white/60">
          {t('hq.manager.currentEmail')}{' '}
          <span dir="ltr" className="font-mono text-white/85">
            {managerEmail}
          </span>
        </p>
      ) : null}

      <AnimatePresence mode="wait">
        {bundle ? (
          <motion.div
            key="bundle"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-4 space-y-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] p-3"
          >
            <p className="text-xs font-medium text-emerald-100">
              {bundle.action === 'updated'
                ? t('hq.manager.resetReady')
                : t('hq.manager.credentialsReady')}
            </p>
            <div className="space-y-1.5 font-mono text-[11px] text-white/80" dir="ltr">
              <p>
                <span className="text-white/45">{t('hq.manager.labelUrl')}</span> {bundle.dashboardUrl}
              </p>
              <p>
                <span className="text-white/45">{t('hq.manager.labelEmail')}</span> {bundle.email}
              </p>
              <p>
                <span className="text-white/45">{t('hq.manager.labelPassword')}</span> {bundle.password}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={copyBundle}>
                <Copy className="size-3.5" aria-hidden />
                {t('hq.manager.copyAll')}
              </Button>
              <Button type="button" size="sm" variant="outline" className="border-white/15" onClick={copyDashboardLinkOnly}>
                <Copy className="me-1 inline size-3.5" aria-hidden />
                {t('hq.manager.copyLinkOnly')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setBundle(null)}>
                {t('hq.manager.inviteAnother')}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 space-y-3"
          >
            {!assigned ? (
              <div className="space-y-1.5">
                <Label className="text-white/65">{t('hq.manager.email')}</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-white/35" />
                  <Input
                    type="email"
                    dir="ltr"
                    autoComplete="off"
                    placeholder="manager@example.com"
                    className="h-10 border-white/12 bg-black/40 ps-9 text-sm text-white"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-white/65">{t('hq.manager.password')}</Label>
                <button
                  type="button"
                  className="text-[10px] font-medium text-violet-200/90 hover:text-violet-100"
                  onClick={suggestPassword}
                >
                  {t('hq.manager.suggestPassword')}
                </button>
              </div>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-white/35" />
                <Input
                  type="text"
                  dir="ltr"
                  autoComplete="new-password"
                  placeholder={t('hq.manager.passwordPlaceholder')}
                  className="h-10 border-white/12 bg-black/40 ps-9 font-mono text-sm tracking-wide text-white"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <p className="text-[10px] text-white/40">
                {assigned ? t('hq.manager.resetHint') : t('hq.manager.passwordHint')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={
                  invite.isPending ||
                  (!assigned && !email.trim()) ||
                  (assigned && !password.trim())
                }
                onClick={() => void invite.mutateAsync()}
              >
                {invite.isPending ? (
                  t('hq.manager.inviting')
                ) : assigned ? (
                  <>
                    <RefreshCw className="me-1 inline size-3.5" aria-hidden />
                    {t('hq.manager.resetCta')}
                  </>
                ) : (
                  t('hq.manager.inviteCta')
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-white/15"
                onClick={copyDashboardLinkOnly}
              >
                <Copy className="me-1 inline size-3.5" aria-hidden />
                {t('hq.manager.copyLinkOnly')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
