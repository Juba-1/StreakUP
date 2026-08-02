import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

type Daily = { d: string; c: number }
type BranchRow = {
  branch_id: string
  branch_code: string
  name: string
  visits: number
  unique_customers: number
}
type Retention = { active_customers_window: number; total_customers: number }

export function HqAnalyticsCharts() {
  const { t } = useI18n()
  const { data: profile } = useProfile()
  const cafeId = profile?.cafe_id ?? null

  const q = useQuery({
    queryKey: ['hq-analytics-series', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!.rpc('hq_analytics_series', {
        p_days: 30,
      })
      if (error) throw error
      const raw = data as unknown
      const parsed =
        typeof raw === 'string'
          ? (JSON.parse(raw) as {
              daily_visits: Daily[]
              branch_totals: BranchRow[]
              retention: Retention
            })
          : (raw as {
              daily_visits: Daily[]
              branch_totals: BranchRow[]
              retention: Retention
            })
      return parsed
    },
  })

  const daily = (q.data?.daily_visits ?? []).map((x) => ({
    day: x.d.slice(5),
    visits: Number(x.c),
  }))

  const branches = (q.data?.branch_totals ?? []).map((b) => ({
    name: b.branch_code,
    visits: Number(b.visits),
    people: Number(b.unique_customers),
  }))

  const ret = q.data?.retention
  const ratio =
    ret && ret.total_customers > 0
      ? Math.round((100 * ret.active_customers_window) / ret.total_customers)
      : 0

  return (
    <Card className="border-white/10 bg-zinc-950/60 backdrop-blur-md">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-white">{t('hq.analytics.title')}</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">{t('hq.analytics.subtitle')}</p>
        </div>
        <Button size="sm" variant="secondary" disabled={q.isFetching} onClick={() => void q.refetch()}>
          {q.isFetching ? t('common.loading') : t('hq.analytics.load')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-8">
        {q.isError ? <p className="text-destructive text-sm">{t('hq.analytics.migrationHint')}</p> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-64 rounded-2xl border border-white/10 bg-black/25 p-2">
            <p className="px-2 pb-2 text-[11px] font-semibold tracking-widest text-white/45">
              {t('hq.analytics.visitsTrend')}
            </p>
            <ResponsiveContainer width="100%" height="88%">
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{
                    background: '#0a0a0a',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="visits"
                  stroke="var(--brand-primary, #a78bfa)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="h-64 rounded-2xl border border-white/10 bg-black/25 p-2">
            <p className="px-2 pb-2 text-[11px] font-semibold tracking-widest text-white/45">
              {t('hq.analytics.branchBars')}
            </p>
            <ResponsiveContainer width="100%" height="88%">
              <BarChart data={branches}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{
                    background: '#0a0a0a',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="visits" fill="var(--brand-secondary, #fb923c)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
          <p className="text-[11px] font-semibold tracking-widest text-white/45">
            {t('hq.analytics.retention')}
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-3xl font-semibold tabular-nums text-white">{ratio}%</p>
              <p className="text-muted-foreground text-xs">
                {ret?.active_customers_window ?? 0} / {ret?.total_customers ?? 0}{' '}
                <span className="text-white/50">{t('hq.analytics.activeInWindow')}</span>
              </p>
            </div>
            <div className="min-w-[200px] flex-1">
              <Progress value={ratio} className="h-2" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
