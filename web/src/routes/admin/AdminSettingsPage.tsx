import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ChevronDown, Cpu, KeyRound, Lock, Megaphone, Server, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

type PlatformRow = { key: string; value: unknown; updated_at?: string }

type AnnouncementShape = {
  enabled?: boolean
  title?: string
  body?: string
  severity?: string
}

function parseBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  return false
}

function parseLocale(v: unknown): 'en' | 'ar' {
  if (v === 'en' || v === 'ar') return v
  return 'en'
}

function parseAnnouncement(v: unknown): AnnouncementShape {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return v as AnnouncementShape
}

function readSecret(map: Record<string, unknown>, key: string): string {
  const v = map[key]
  return typeof v === 'string' ? v : ''
}

export function AdminSettingsPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { data: profile, isLoading } = useProfile()

  const [maintenance, setMaintenance] = useState(false)
  const [defaultLocale, setDefaultLocale] = useState<'en' | 'ar'>('en')
  const [annEnabled, setAnnEnabled] = useState(false)
  const [annTitle, setAnnTitle] = useState('')
  const [annBody, setAnnBody] = useState('')
  const [annSeverity, setAnnSeverity] = useState('info')
  const [stripeKey, setStripeKey] = useState('')
  const [smsKey, setSmsKey] = useState('')
  const [smsQuotaPct, setSmsQuotaPct] = useState('68')

  const cfg = useQuery({
    queryKey: ['platform-config'],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'super_admin'),
    queryFn: async () => {
      const [pub, sec] = await Promise.all([
        supabaseBrowserClient!.from('platform_public_config').select('key, value, updated_at'),
        supabaseBrowserClient!.from('platform_config').select('key, value, updated_at'),
      ])
      if (pub.error && sec.error) throw pub.error
      const rows = [...(pub.data ?? []), ...(sec.data ?? [])] as PlatformRow[]
      return rows
    },
  })

  useEffect(() => {
    const map = Object.fromEntries((cfg.data ?? []).map((r) => [r.key, r.value]))
    setMaintenance(parseBool(map.maintenance_mode))
    setDefaultLocale(parseLocale(map.default_locale))
    const a = parseAnnouncement(map.global_announcement)
    setAnnEnabled(Boolean(a.enabled))
    setAnnTitle(typeof a.title === 'string' ? a.title : '')
    setAnnBody(typeof a.body === 'string' ? a.body : '')
    setAnnSeverity(typeof a.severity === 'string' ? a.severity : 'info')
    setStripeKey(readSecret(map, 'stripe_api_key'))
    setSmsKey(readSecret(map, 'sms_gateway_key'))
    const smsPct = map.sms_quota_used_pct
    if (typeof smsPct === 'number') setSmsQuotaPct(String(smsPct))
    else if (typeof smsPct === 'string') setSmsQuotaPct(smsPct)
  }, [cfg.data])

  const upsertPublic = useMutation({
    mutationFn: async (row: { key: string; value: unknown }) => {
      const { error } = await supabaseBrowserClient!.from('platform_public_config').upsert(
        {
          key: row.key,
          value: row.value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      )
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-config'] })
      void qc.invalidateQueries({ queryKey: ['platform-public-config-banner'] })
      void qc.invalidateQueries({ queryKey: ['admin-platform-metrics'] })
    },
  })

  const upsertSecret = useMutation({
    mutationFn: async (row: { key: string; value: unknown }) => {
      const { error } = await supabaseBrowserClient!.from('platform_config').upsert(
        {
          key: row.key,
          value: row.value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      )
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform-config'] })
      void qc.invalidateQueries({ queryKey: ['admin-platform-metrics'] })
    },
  })

  const upsertPending = upsertPublic.isPending || upsertSecret.isPending

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'super_admin') {
    return <Navigate to="/login" replace />
  }

  const tiles = [
    { key: 'security', icon: Lock, title: t('admin.settings.securityTitle'), body: t('admin.settings.securityBody') },
    { key: 'edge', icon: Server, title: t('admin.settings.edgeTitle'), body: t('admin.settings.edgeBody') },
    { key: 'compute', icon: Cpu, title: t('admin.settings.computeTitle'), body: t('admin.settings.computeBody') },
  ] as const

  async function saveMaintenance(next: boolean) {
    try {
      await upsertPublic.mutateAsync({ key: 'maintenance_mode', value: next })
      setMaintenance(next)
      toast.success(t('admin.settings.toast.saved'))
    } catch {
      toast.error(t('admin.settings.toast.fail'))
    }
  }

  async function saveLocale() {
    try {
      await upsertPublic.mutateAsync({ key: 'default_locale', value: defaultLocale })
      toast.success(t('admin.settings.toast.saved'))
    } catch {
      toast.error(t('admin.settings.toast.fail'))
    }
  }

  async function saveAnnouncement() {
    try {
      await upsertPublic.mutateAsync({
        key: 'global_announcement',
        value: {
          enabled: annEnabled,
          title: annTitle.trim(),
          body: annBody.trim(),
          severity: annSeverity.trim() || 'info',
        },
      })
      toast.success(t('admin.settings.toast.saved'))
    } catch {
      toast.error(t('admin.settings.toast.fail'))
    }
  }

  async function saveIntegrations() {
    const pct = Math.min(100, Math.max(0, Number(smsQuotaPct) || 0))
    try {
      await upsertSecret.mutateAsync({ key: 'stripe_api_key', value: stripeKey.trim() })
      await upsertSecret.mutateAsync({ key: 'sms_gateway_key', value: smsKey.trim() })
      await upsertSecret.mutateAsync({ key: 'sms_quota_used_pct', value: pct })
      toast.success(t('admin.settings.toast.saved'))
    } catch {
      toast.error(t('admin.settings.toast.fail'))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('admin.settings.kicker')}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">{t('admin.settings.title')}</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{t('admin.settings.subtitleLive')}</p>
        </div>
        <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-100">{t('admin.settings.liveBadge')}</Badge>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-white/10 bg-zinc-950/75 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Wrench className="size-4 text-amber-200" aria-hidden />
              {t('admin.settings.controlTitle')}
            </CardTitle>
            <CardDescription className="text-white/50">{t('admin.settings.controlBody')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/25 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-white">{t('admin.settings.maintenanceLabel')}</p>
                <p className="text-muted-foreground mt-1 max-w-xl text-xs leading-relaxed">
                  {t('admin.settings.maintenanceHint')}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={maintenance ? 'destructive' : 'secondary'}
                disabled={upsertPending || cfg.isPending}
                onClick={() => void saveMaintenance(!maintenance)}
              >
                {maintenance ? t('admin.settings.maintenanceOn') : t('admin.settings.maintenanceOff')}
              </Button>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-5">
                <Label className="flex items-center gap-2 text-white/85">
                  <Megaphone className="size-3.5 opacity-70" aria-hidden />
                  {t('admin.settings.announcementTitle')}
                </Label>
                <p className="text-muted-foreground text-xs">{t('admin.settings.announcementHint')}</p>
                <label className="flex items-center gap-2 text-sm text-white/80">
                  <input
                    type="checkbox"
                    checked={annEnabled}
                    onChange={(e) => setAnnEnabled(e.target.checked)}
                    className="size-4 rounded border-white/20 accent-violet-500"
                  />
                  {t('admin.settings.announcementEnabled')}
                </label>
                <Input
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  placeholder={t('admin.settings.announcementTitlePh')}
                  className="rounded-xl border-white/10 bg-black/40 text-white"
                />
                <Textarea
                  value={annBody}
                  onChange={(e) => setAnnBody(e.target.value)}
                  placeholder={t('admin.settings.announcementBodyPh')}
                  className="rounded-xl border-white/10 bg-black/40 text-white"
                  rows={3}
                />
                <select
                  className="border-input bg-background/80 h-11 w-full rounded-xl border px-3 text-sm text-white"
                  value={annSeverity}
                  onChange={(e) => setAnnSeverity(e.target.value)}
                >
                  <option value="info">info</option>
                  <option value="warning">warning</option>
                  <option value="critical">critical</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  className="bg-[linear-gradient(135deg,#7c3aed,#c026d3)] text-white"
                  disabled={upsertPending}
                  onClick={() => void saveAnnouncement()}
                >
                  {t('admin.settings.saveAnnouncement')}
                </Button>
              </div>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-5">
                <Label className="text-white/85">{t('admin.settings.defaultLocale')}</Label>
                <p className="text-muted-foreground text-xs">{t('admin.settings.defaultLocaleHint')}</p>
                <select
                  className="border-input bg-background/80 h-11 w-full rounded-xl border px-3 text-sm text-white"
                  value={defaultLocale}
                  onChange={(e) => setDefaultLocale(e.target.value as 'en' | 'ar')}
                  disabled={cfg.isPending}
                >
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={upsertPending}
                  onClick={() => void saveLocale()}
                >
                  {t('admin.settings.saveLocale')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <details className="group rounded-2xl border border-white/8 bg-zinc-950/50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:content-none">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-white/40" aria-hidden />
            <div>
              <p className="text-sm font-medium text-white/70">{t('admin.settings.integrationsFoldTitle')}</p>
              <p className="text-xs text-white/40">{t('admin.settings.integrationsFoldHint')}</p>
            </div>
          </div>
          <ChevronDown className="size-4 text-white/40 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="border-t border-white/8 px-5 pb-5 pt-2"
        >
          <Card className="border-violet-500/15 bg-black/30">
            <CardContent className="grid gap-5 pt-6 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Badge variant="outline" className="border-white/15 text-white/50">
                  {t('admin.settings.integrationsMvpBadge')}
                </Badge>
              </div>
              <div className="space-y-2">
                <Label className="text-white/80">{t('admin.settings.stripeKey')}</Label>
                <Input
                  type="password"
                  value={stripeKey}
                  onChange={(e) => setStripeKey(e.target.value)}
                  placeholder="sk_live_…"
                  dir="ltr"
                  className="rounded-xl border-white/10 bg-black/40 font-mono text-sm text-white"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-white/80">{t('admin.settings.smsKey')}</Label>
                <Input
                  type="password"
                  value={smsKey}
                  onChange={(e) => setSmsKey(e.target.value)}
                  placeholder="sms_…"
                  dir="ltr"
                  className="rounded-xl border-white/10 bg-black/40 font-mono text-sm text-white"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="text-white/80">{t('admin.settings.smsQuotaLabel')}</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={smsQuotaPct}
                    onChange={(e) => setSmsQuotaPct(e.target.value)}
                    className="max-w-[8rem] rounded-xl border-white/10 bg-black/40 text-white"
                  />
                  <span className="text-xs text-white/45">{t('admin.settings.smsQuotaHint')}</span>
                </div>
              </div>
              <div className="md:col-span-2">
                <Button
                  type="button"
                  disabled={upsertPending}
                  variant="secondary"
                  className="rounded-xl"
                  onClick={() => void saveIntegrations()}
                >
                  {t('admin.settings.saveIntegrations')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </details>

      <div>
        <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wide">{t('admin.settings.referenceKicker')}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {tiles.map((tile, i) => (
            <motion.div
              key={tile.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
            >
              <Card className="h-full border-white/10 bg-zinc-950/70 backdrop-blur-md">
                <CardHeader>
                  <div className="mb-2 grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                    <tile.icon className="size-5 text-white/70" aria-hidden />
                  </div>
                  <CardTitle className="text-base text-white">{tile.title}</CardTitle>
                  <CardDescription className="text-white/50">{tile.body}</CardDescription>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
