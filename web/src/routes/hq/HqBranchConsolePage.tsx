import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { maskPhone } from '@/lib/pii'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type VisitWithCustomer = {
  id: string
  visit_date: string
  streak_after: number
  created_at: string
  customer_id: string
  customers: { phone: string } | { phone: string }[] | null
}

function visitCustomerPhone(v: VisitWithCustomer): string | null {
  const c = v.customers
  if (!c) return null
  if (Array.isArray(c)) return c[0]?.phone ?? null
  return c.phone
}

/** HQ owner view of a single branch (same data as branch manager, scoped by café). */
export function HqBranchConsolePage() {
  const { slug, branchCode } = useParams()
  const { t } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()

  const branchQuery = useQuery({
    queryKey: ['hq-branch-console', branchCode, profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.cafe_id && branchCode && profile.role === 'hq_owner'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('branches')
        .select('id, name, branch_code, cafe_id')
        .eq('cafe_id', profile!.cafe_id!)
        .eq('branch_code', branchCode!.toLowerCase())
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const visits = useQuery({
    queryKey: ['hq-branch-visits', profile?.cafe_id, branchQuery.data?.id],
    enabled: Boolean(supabaseBrowserClient && branchQuery.data?.id && profile?.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('visits')
        .select('id, visit_date, streak_after, created_at, customer_id, customers(phone)')
        .eq('cafe_id', profile!.cafe_id!)
        .eq('branch_id', branchQuery.data!.id)
        .order('created_at', { ascending: false })
        .limit(40)
      if (error) throw error
      return (data ?? []) as unknown as VisitWithCustomer[]
    },
  })

  const branch = branchQuery.data
  const ok = Boolean(profile && branch && profile.role === 'hq_owner' && branch.cafe_id === profile.cafe_id)

  if (pLoading || branchQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'hq_owner') {
    return <Navigate to="/login" replace />
  }

  if (branchQuery.isFetched && !branch) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">{t('branch.notFound')}</p>
        <Link className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'inline-flex')} to={`/hq/${slug}`}>
          {t('hq.branchConsole.back')}
        </Link>
      </div>
    )
  }

  if (!ok) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('hq.branchConsole.kicker')}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">{branch?.name}</h2>
          <p className="text-muted-foreground text-sm">
            <span className="font-mono">{branchCode}</span> · {t('hq.branchConsole.ownerHint')}
          </p>
        </div>
        <Badge variant="secondary" className="border-white/10 bg-black/40">
          {t('hq.branchConsole.badge')}
        </Badge>
      </div>

      <Link
        to={`/hq/${slug}`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'inline-flex text-white/70')}
      >
        {t('hq.branchConsole.back')}
      </Link>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-base text-white">{t('branch.table.visits')}</CardTitle>
          </CardHeader>
          <CardContent>
            {visits.isFetched && (visits.data ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <p className="text-base font-medium text-white">{t('branch.empty.visitsTitle')}</p>
                <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">{t('branch.empty.visitsBody')}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('branch.col.when')}</TableHead>
                    <TableHead>{t('branch.col.customer')}</TableHead>
                    <TableHead>{t('branch.col.streak')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(visits.data ?? []).map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="text-xs text-white/80">
                        {String(v.visit_date)} · {new Date(v.created_at).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-white/80">{maskPhone(visitCustomerPhone(v))}</TableCell>
                      <TableCell className="tabular-nums text-white">{v.streak_after}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
