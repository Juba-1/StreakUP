import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Building2, LogOut } from 'lucide-react'
import { Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/hooks/useProfile'
import { branchManagerPortalUrl } from '@/lib/branch-portal-url'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

import { BranchWrongRoleScreen } from '@/routes/branch/BranchWrongRoleScreen'

/**
 * Isolated branch-manager shell — no HQ nav. Wrong roles see an in-place message (no bounce to HQ).
 */
export function BranchShell() {
  const { branchCode } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { session, signOut } = useAuth()
  const { data: profile, isLoading: profileLoading } = useProfile()

  const branchQuery = useQuery({
    queryKey: ['branch-shell', profile?.branch_id],
    enabled: Boolean(
      supabaseBrowserClient && profile?.branch_id && profile.role === 'branch_manager',
    ),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('branches')
        .select('id, name, branch_code, cafe_id')
        .eq('id', profile!.branch_id!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const branch = branchQuery.data
  const canonicalCode = branch?.branch_code?.toLowerCase() ?? ''

  if (!session) {
    return <Navigate to="/login" replace state={{ from: `/branch/${branchCode ?? ''}` }} />
  }

  if (profileLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'branch_manager') {
    return <BranchWrongRoleScreen />
  }

  if (branchQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (branchQuery.isFetched && !branch) {
    return <p className="text-muted-foreground text-sm">{t('branch.notFound')}</p>
  }

  if (branch && profile.branch_id !== branch.id) {
    return <p className="text-muted-foreground text-sm">{t('branch.notFound')}</p>
  }

  if (canonicalCode && branchCode && branchCode.toLowerCase() !== canonicalCode) {
    return <Navigate to={branchManagerPortalUrl(canonicalCode)} replace />
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-[min(70vh,100%)] flex-col gap-6">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-500/20 bg-gradient-to-r from-sky-950/40 via-black/50 to-transparent px-4 py-3 backdrop-blur-md"
      >
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl border border-sky-400/25 bg-sky-500/10">
            <Building2 className="size-5 text-sky-200" aria-hidden />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-sky-200/70">
              {t('branch.shell.kicker')}
            </p>
            <p className="text-base font-semibold text-white">{branch?.name ?? '—'}</p>
            <p dir="ltr" className="font-mono text-xs text-white/50">
              {branchManagerPortalUrl(canonicalCode || branchCode || '')}
            </p>
          </div>
        </div>
        <button
          type="button"
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'gap-1.5')}
          onClick={() => void handleSignOut()}
        >
          <LogOut className="size-3.5" aria-hidden />
          {t('shell.signOut')}
        </button>
      </motion.header>

      <Outlet />
    </div>
  )
}
