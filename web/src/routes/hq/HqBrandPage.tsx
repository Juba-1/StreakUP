import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ImagePlus, Palette } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import { sanitizeLogoUrl } from '@/lib/branding'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { brandPaletteSchema } from '@/lib/validation/schemas'

const COLOR_PRESETS = ['#7c3aed', '#f97316', '#22d3ee', '#0ea5e9', '#14b8a6', '#f43f5e', '#09090b', '#fafafa']

function ColorField({
  label,
  value,
  set,
}: {
  label: string
  value: string
  set: (next: string) => void
}) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#a78bfa'
  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/25 p-3">
      <Label className="text-white/80">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          className="h-10 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent p-1"
          value={safe}
          onChange={(e) => set(e.target.value)}
        />
        <Input
          value={safe}
          readOnly
          dir="ltr"
          className="border-white/10 bg-black/40 text-left font-mono text-xs text-white/80"
        />
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {COLOR_PRESETS.map((preset) => (
          <button
            key={`${label}:${preset}`}
            type="button"
            onClick={() => set(preset)}
            className="size-5 rounded-md border border-white/15 transition hover:scale-110"
            style={{ backgroundColor: preset }}
            aria-label={`${label}: ${preset}`}
          />
        ))}
      </div>
    </div>
  )
}

export function HqBrandPage() {
  const { slug } = useParams()
  const { t } = useI18n()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: profile, isLoading: pLoading } = useProfile()

  const cafeQuery = useQuery({
    queryKey: ['hq-cafe-brand', profile?.cafe_id],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'hq_owner' && profile.cafe_id),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select(
          'id, slug, name, status, logo_url, primary_color, secondary_color, accent_color, background_color',
        )
        .eq('id', profile!.cafe_id!)
        .single()
      if (error) throw error
      return data
    },
  })

  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [accent, setAccent] = useState('')
  const [background, setBackground] = useState('')

  const cafe = cafeQuery.data
  const slugOk = Boolean(slug && cafe && cafe.slug === slug)

  useEffect(() => {
    if (!cafe) return
    setPrimary(cafe.primary_color ?? '')
    setSecondary(cafe.secondary_color ?? '')
    setAccent(cafe.accent_color ?? '')
    setBackground(cafe.background_color ?? '')
  }, [cafe])

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      if (!supabaseBrowserClient || !cafe?.id) throw new Error('no_cafe')
      // Defence-in-depth: storage RLS is the source of truth, but we reject
      // obviously-wrong uploads client-side to avoid confused-deputy mistakes.
      const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
      if (!ALLOWED.has(file.type || 'image/png')) throw new Error('logo_type')
      if (file.size > 2 * 1024 * 1024) throw new Error('logo_size')
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 80)
      const path = `${cafe.id}/logo-${Date.now()}-${safe}`
      const { error: upErr } = await supabaseBrowserClient.storage.from('logos').upload(path, file, {
        upsert: true,
        contentType: file.type || 'image/png',
      })
      if (upErr) throw upErr
      const { data: pub } = supabaseBrowserClient.storage.from('logos').getPublicUrl(path)
      const { error: dbErr } = await supabaseBrowserClient
        .from('cafes')
        .update({ logo_url: pub.publicUrl, updated_at: new Date().toISOString() })
        .eq('id', cafe.id)
      if (dbErr) throw dbErr
      return pub.publicUrl
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hq-cafe-brand'] })
      void qc.invalidateQueries({ queryKey: ['cafe-public'] })
      toast.success(t('hq.brand.toastLogo'))
    },
    onError: () => toast.error(t('hq.brand.toastLogoFail')),
  })

  const saveColors = useMutation({
    mutationFn: async () => {
      if (!supabaseBrowserClient || !cafe?.id) throw new Error('no_cafe')
      const parsed = brandPaletteSchema.safeParse({
        primary: primary.trim(),
        secondary: secondary.trim(),
        accent: accent.trim(),
        background: background.trim(),
      })
      if (!parsed.success) throw new Error('invalid_palette')
      const { error } = await supabaseBrowserClient
        .from('cafes')
        .update({
          primary_color: parsed.data.primary ?? null,
          secondary_color: parsed.data.secondary ?? null,
          accent_color: parsed.data.accent ?? null,
          background_color: parsed.data.background ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cafe.id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hq-cafe-brand'] })
      void qc.invalidateQueries({ queryKey: ['cafe-public'] })
      toast.success(t('hq.brand.toastPalette'))
    },
    onError: () => toast.error(t('hq.brand.toastPaletteFail')),
  })

  if (pLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'hq_owner') {
    return <Navigate to="/login" replace />
  }

  if (cafeQuery.isFetched && !slugOk) {
    return <Navigate to="/login" replace />
  }

  if (!cafe) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (cafe.status !== 'active') {
    return <Navigate to={`/hq/${slug}`} replace />
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('hq.brand.kicker')}</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">{t('hq.brand.title')}</h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{t('hq.brand.subtitle')}</p>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <ImagePlus className="size-4 text-sky-300" aria-hidden />
              {t('hq.brand.logoTitle')}
            </CardTitle>
            <CardDescription className="text-white/55">{t('hq.brand.logoHint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void uploadLogo.mutateAsync(f)
              }}
            />
            <div className="flex flex-wrap items-center gap-4">
              <div
                className="size-20 shrink-0 rounded-2xl border border-white/10 bg-cover bg-center"
                style={
                  sanitizeLogoUrl(cafe.logo_url)
                    ? { backgroundImage: `url("${encodeURI(sanitizeLogoUrl(cafe.logo_url)!)}")` }
                    : { background: 'color-mix(in oklab, white 8%, transparent)' }
                }
                role="img"
                aria-label={t('hq.brand.logoTitle')}
              />
              <Button type="button" variant="secondary" disabled={uploadLogo.isPending} onClick={() => fileRef.current?.click()}>
                {uploadLogo.isPending ? t('hq.brand.uploading') : t('hq.brand.uploadCta')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Palette className="size-4 text-[var(--brand-accent)]" aria-hidden />
            {t('hq.brand.paletteTitle')}
          </CardTitle>
          <CardDescription className="text-white/55">{t('hq.brand.paletteHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <ColorField label={t('hq.brand.primary')} value={primary} set={setPrimary} />
          <ColorField label={t('hq.brand.secondary')} value={secondary} set={setSecondary} />
          <ColorField label={t('hq.brand.accent')} value={accent} set={setAccent} />
          <ColorField label={t('hq.brand.background')} value={background} set={setBackground} />

          <div className="md:col-span-2 grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="space-y-3">
              <p className="text-xs text-white/60">{t('hq.brand.previewHint')}</p>
              <div
                className="h-16 rounded-xl border border-white/10"
                style={{ backgroundImage: `linear-gradient(135deg, ${primary || '#7c3aed'}, ${secondary || '#f97316'})` }}
              />
              <div
                className="h-12 rounded-xl border border-white/10"
                style={{ backgroundColor: background || '#09090b', boxShadow: `inset 0 0 0 1px ${accent || '#22d3ee'}66` }}
              />
              <Button
                type="button"
                disabled={saveColors.isPending}
                onClick={() => void saveColors.mutateAsync()}
                className="bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black"
              >
                {saveColors.isPending ? t('hq.brand.saving') : t('hq.brand.savePalette')}
              </Button>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto w-[220px] rounded-[2rem] border border-white/15 bg-black p-3 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]"
            >
              <div
                className="overflow-hidden rounded-[1.5rem] border border-white/10"
                style={{ backgroundColor: background || '#09090b' }}
              >
                <div
                  className="h-24 p-3"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${primary || '#7c3aed'}, ${secondary || '#f97316'})`,
                  }}
                >
                  <div className="flex items-center justify-between text-white">
                    <span className="text-[10px] font-semibold tracking-[0.2em]">MY STREAK</span>
                    <div
                      className="size-8 rounded-xl border border-white/30 bg-center bg-cover"
                      style={
                        sanitizeLogoUrl(cafe.logo_url)
                          ? { backgroundImage: `url("${encodeURI(sanitizeLogoUrl(cafe.logo_url)!)}")` }
                          : { backgroundColor: 'rgba(255,255,255,0.2)' }
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2 p-3">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <p className="text-[10px] text-white/55">Current streak</p>
                    <p className="text-sm font-semibold text-white">12 days</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg p-2 text-center" style={{ backgroundColor: `${accent || '#22d3ee'}22` }}>
                      <p className="text-[10px] text-white/60">Shield</p>
                      <p className="text-xs font-semibold text-white">2</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 p-2 text-center">
                      <p className="text-[10px] text-white/60">Reward</p>
                      <p className="text-xs font-semibold text-white">Ready</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
