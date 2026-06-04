import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  CalendarClock,
  Flame,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'
import { BranchGuestToolsDialog, type BranchGuestRow } from '@/routes/branch/BranchGuestToolsDialog'
import { BranchOperationsCards } from '@/routes/branch/BranchOperationsCards'

type CustomerRow = BranchGuestRow & {
  longest_streak: number
  shields: number
  last_visit: string | null
}

const WEEK_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export function BranchHomePage() {
  const { t, locale } = useI18n()
  const { data: profile } = useProfile()
  const [search, setSearch] = useState('')
  const [toolsGuest, setToolsGuest] = useState<BranchGuestRow | null>(null)

  const stats = useQuery({
    queryKey: ['branch-manager-stats'],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'branch_manager'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('branch_manager_branch_stats_secure')
      if (error) throw error
      return data as {
        ok?: boolean
        reason?: string
        branch_name?: string
        visits_today?: number
        visits_7d?: number
        unique_customers_30d?: number
        cafe_timezone?: string
      }
    },
  })

  const customers = useQuery({
    queryKey: ['branch-manager-customers', search],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'branch_manager'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc(
        'branch_manager_list_customers_secure',
        { p_search: search, p_limit: 80, p_offset: 0 },
      )
      if (error) throw error
      const res = data as { ok?: boolean; rows?: CustomerRow[]; total?: number; reason?: string }
      if (!res?.ok) throw new Error(res.reason ?? 'list_failed')
      return { rows: (res.rows ?? []) as CustomerRow[], total: res.total ?? 0 }
    },
  })

  const weekStrip = useMemo(() => {
    const loc = locale === 'ar' ? 'ar-SA' : 'en-US'
    const anchor = new Date()
    const day = anchor.getDay()
    const diffToMonday = (day + 6) % 7
    const monday = new Date(anchor)
    monday.setDate(anchor.getDate() - diffToMonday)
    return WEEK_KEYS.map((key, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const label = d.toLocaleDateString(loc, { weekday: 'short' })
      const isToday = d.toDateString() === anchor.toDateString()
      return { key, label, isToday }
    })
  }, [locale])

  const statCards = [
    {
      label: t('branch.stat.today'),
      value: stats.data?.visits_today ?? '—',
      icon: Flame,
      accent: 'from-amber-500/20',
    },
    {
      label: t('branch.stat.week'),
      value: stats.data?.visits_7d ?? '—',
      icon: TrendingUp,
      accent: 'from-sky-500/20',
    },
    {
      label: t('branch.stat.unique30'),
      value: stats.data?.unique_customers_30d ?? '—',
      icon: Users,
      accent: 'from-violet-500/20',
    },
  ]

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid gap-3 sm:grid-cols-3"
      >
        {statCards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card
              className={cn(
                'border-white/10 bg-gradient-to-br to-transparent p-5 backdrop-blur-md',
                c.accent,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-widest">
                    {c.label}
                  </p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums text-white">{c.value}</p>
                </div>
                <c.icon className="size-5 text-white/50" aria-hidden />
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <BranchOperationsCards />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="border-white/10 bg-gradient-to-br from-zinc-950/90 via-sky-950/10 to-transparent backdrop-blur-md">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05]">
                <CalendarClock className="size-4 text-sky-200/90" aria-hidden />
              </div>
              <div>
                <CardTitle className="text-base text-white">{t('branch.schedule.title')}</CardTitle>
                <CardDescription className="text-white/50">{t('branch.schedule.subtitle')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-[11px]">{t('branch.schedule.tz')}</p>
            <p className="font-mono text-xs text-white/80">{stats.data?.cafe_timezone ?? '—'}</p>
            <div className="grid grid-cols-7 gap-1.5">
              {weekStrip.map((d) => (
                <motion.div
                  key={d.key}
                  whileHover={{ y: -2 }}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border px-0.5 py-2 text-center',
                    d.isToday
                      ? 'border-sky-400/40 bg-sky-500/15 shadow-[0_0_24px_-8px_rgba(56,189,248,0.45)]'
                      : 'border-white/10 bg-black/30',
                  )}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-white/45">
                    {d.label}
                  </span>
                  <span className="text-[10px] font-medium text-white/85">{t('branch.schedule.slot')}</span>
                </motion.div>
              ))}
            </div>
            <p className="text-muted-foreground border-t border-white/10 pt-3 text-[10px] leading-relaxed">
              {t('branch.schedule.footnote')}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base text-white">{t('branch.customers.title')}</CardTitle>
              <span className="text-muted-foreground text-[11px] tabular-nums">
                {customers.data?.total ?? 0}
              </span>
            </div>
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-white/40"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('branch.customers.search')}
                className="h-9 border-white/12 bg-black/40 ps-9 text-sm text-white"
              />
            </div>
            <CardDescription className="text-white/45">{t('branch.customers.hint')}</CardDescription>
          </CardHeader>
          <CardContent>
            {customers.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : (customers.data?.rows.length ?? 0) === 0 ? (
              <p className="py-12 text-center text-sm text-white/55">{t('branch.customers.empty')}</p>
            ) : (
              <ScrollArea className="max-h-[min(22rem,50vh)] pe-1">
                <ul className="space-y-2">
                  {(customers.data?.rows ?? []).map((c) => (
                    <motion.li
                      key={c.id}
                      layout
                      whileHover={{ scale: 1.01 }}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-3 transition hover:border-white/18"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">
                          {c.full_name?.trim() || t('branch.customers.anonymous')}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          <span dir="ltr" className="font-mono">
                            PIN {c.pin_code}
                          </span>
                          {c.last_visit ? (
                            <> · {c.last_visit}</>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-100">
                          <Sparkles className="size-3" aria-hidden />
                          {c.current_streak}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="gap-1 border-white/10"
                          onClick={() =>
                            setToolsGuest({
                              id: c.id,
                              full_name: c.full_name,
                              pin_code: c.pin_code,
                              current_streak: c.current_streak,
                            })
                          }
                        >
                          <Wrench className="size-3.5" aria-hidden />
                          {t('branch.ops.guestTools')}
                        </Button>
                      </div>
                    </motion.li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <BranchGuestToolsDialog guest={toolsGuest} onClose={() => setToolsGuest(null)} />
    </div>
  )
}
