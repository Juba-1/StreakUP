import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { BarChart3, Settings2 } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export function HqSettingsPage() {
  const { slug } = useParams()
  const { t } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()

  const cafeQuery = useQuery({
    queryKey: ['hq-cafe-settings', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'hq_owner' && profile.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('id, slug, name, currency_code, timezone')
        .eq('id', profile!.cafe_id!)
        .single()
      if (error) throw error
      return data as { id: string; slug: string; name: string; currency_code: string; timezone: string }
    },
  })

  if (pLoading || cafeQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'hq_owner') {
    return <Navigate to="/login" replace />
  }

  const cafe = cafeQuery.data
  if (cafeQuery.isFetched && (!cafe || cafe.slug !== slug)) {
    return <Navigate to="/login" replace />
  }

  if (!cafe) return null

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Badge variant="secondary" className="border-white/10 bg-black/40">
            {t('hq.settings.badge')}
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight text-white">{t('hq.settings.title')}</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-white/55">{t('hq.settings.subtitleBehavioral')}</p>
        </div>
        <Settings2 className="size-8 text-(--brand-primary) opacity-70" aria-hidden />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <Card className="relative overflow-hidden border-white/12 bg-zinc-950/65 backdrop-blur-xl">
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background:
                'radial-gradient(70% 50% at 0% 0%, color-mix(in oklab, var(--brand-primary) 16%, transparent), transparent 55%)',
            }}
            aria-hidden
          />
          <CardHeader className="relative">
            <CardTitle className="flex items-center gap-2 text-lg text-white">
              <BarChart3 className="size-5 text-(--brand-primary)" aria-hidden />
              {t('hq.settings.analyticsCard.title')}
            </CardTitle>
            <CardDescription className="text-white/50">{t('hq.settings.analyticsCard.body')}</CardDescription>
          </CardHeader>
          <CardContent className="relative space-y-4">
            <p className="text-sm text-white/60">
              {t('hq.settings.analyticsCard.hint').replace('{timezone}', cafe.timezone ?? 'UTC')}
            </p>
            <Link
              to={`/hq/${slug}/analytics`}
              className="inline-flex h-10 items-center justify-center rounded-md bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] px-4 text-sm font-medium text-black hover:opacity-90"
            >
              {t('hq.settings.analyticsCard.cta')}
            </Link>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
