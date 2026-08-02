import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { sanitizeLogoUrl } from '@/lib/branding'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { brandPaletteSchema } from '@/lib/validation/schemas'
import { ComingSoonCard } from '@/routes/hq/settings/ComingSoonCard'
import { SectionShell } from '@/routes/hq/settings/SectionShell'

const PRESETS = ['#7c3aed', '#f97316', '#22d3ee', '#0ea5e9', '#14b8a6', '#f43f5e', '#09090b', '#fafafa']

type Props = {
  cafeId: string
  onDirtyChange: (dirty: boolean) => void
}

/** Reuses the same React Query key as HqBrandPage — no duplicate network when both are warm. */
export function BrandSection({ cafeId, onDirtyChange }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const cafeQuery = useQuery({
    queryKey: ['hq-cafe-brand', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select(
          'id, slug, name, logo_url, primary_color, secondary_color, accent_color, background_color',
        )
        .eq('id', cafeId)
        .single()
      if (error) throw error
      return data
    },
  })

  const cafe = cafeQuery.data
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [accent, setAccent] = useState('')
  const [background, setBackground] = useState('')

  useEffect(() => {
    if (!cafe) return
    setPrimary(cafe.primary_color ?? '')
    setSecondary(cafe.secondary_color ?? '')
    setAccent(cafe.accent_color ?? '')
    setBackground(cafe.background_color ?? '')
  }, [cafe])

  const dirty =
    Boolean(cafe) &&
    (primary !== (cafe?.primary_color ?? '') ||
      secondary !== (cafe?.secondary_color ?? '') ||
      accent !== (cafe?.accent_color ?? '') ||
      background !== (cafe?.background_color ?? ''))

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  const reset = () => {
    if (!cafe) return
    setPrimary(cafe.primary_color ?? '')
    setSecondary(cafe.secondary_color ?? '')
    setAccent(cafe.accent_color ?? '')
    setBackground(cafe.background_color ?? '')
  }

  const saveColors = useMutation({
    mutationFn: async () => {
      const parsed = brandPaletteSchema.safeParse({ primary, secondary, accent, background })
      if (!parsed.success) throw new Error('invalid_palette')
      const { error } = await supabaseBrowserClient!
        .from('cafes')
        .update({
          primary_color: parsed.data.primary,
          secondary_color: parsed.data.secondary,
          accent_color: parsed.data.accent,
          background_color: parsed.data.background,
        })
        .eq('id', cafeId)
      if (error) throw error
    },
    onSuccess: async () => {
      toast.success(t('hq.brand.toastPalette'))
      await qc.invalidateQueries({ queryKey: ['hq-cafe-brand', cafeId] })
    },
    onError: () => toast.error(t('hq.brand.toastPaletteFail')),
  })

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const path = `${cafeId}/logo-${Date.now()}`
      const { error: upErr } = await supabaseBrowserClient!.storage.from('logos').upload(path, file, {
        upsert: true,
      })
      if (upErr) throw upErr
      const { data } = supabaseBrowserClient!.storage.from('logos').getPublicUrl(path)
      const { error } = await supabaseBrowserClient!
        .from('cafes')
        .update({ logo_url: data.publicUrl })
        .eq('id', cafeId)
      if (error) throw error
    },
    onSuccess: async () => {
      toast.success(t('hq.brand.toastLogo'))
      await qc.invalidateQueries({ queryKey: ['hq-cafe-brand', cafeId] })
      await qc.invalidateQueries({ queryKey: ['hq-settings-cafe', cafeId] })
    },
    onError: () => toast.error(t('hq.brand.toastLogoFail')),
  })

  if (cafeQuery.isLoading) {
    return <Skeleton className="h-72 w-full rounded-2xl bg-white/10" />
  }

  const logo = sanitizeLogoUrl(cafe?.logo_url)

  return (
    <SectionShell titleKey="hq.settingsHub.brand.title" bodyKey="hq.settingsHub.brand.body">
      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div className="space-y-4 rounded-2xl border border-white/8 bg-black/25 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid size-16 place-items-center overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
              {logo ? <img src={logo} alt="" className="size-full object-cover" /> : <ImagePlus className="size-5 text-white/30" />}
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadLogo.mutateAsync(f)
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={uploadLogo.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {t('hq.brand.uploadCta')}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField label={t('hq.brand.primary')} value={primary} set={setPrimary} />
            <ColorField label={t('hq.brand.secondary')} value={secondary} set={setSecondary} />
            <ColorField label={t('hq.brand.accent')} value={accent} set={setAccent} />
            <ColorField label={t('hq.brand.background')} value={background} set={setBackground} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={!dirty} onClick={reset}>
              {t('hq.settingsHub.reset')}
            </Button>
            <Button
              type="button"
              disabled={!dirty || saveColors.isPending}
              className="bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] font-semibold text-black"
              onClick={() => void saveColors.mutateAsync()}
            >
              {t('hq.settingsHub.save')}
            </Button>
          </div>
        </div>

        <div
          className="rounded-2xl border border-white/10 p-4"
          style={{
            background: `linear-gradient(145deg, ${background || '#09090b'}, #000)`,
          }}
        >
          <p className="text-[10px] font-semibold tracking-wide text-white/40 uppercase">
            {t('hq.settingsHub.brand.preview')}
          </p>
          <div className="mt-4 space-y-2">
            <div className="h-3 w-2/3 rounded-full" style={{ background: primary || 'var(--brand-primary)' }} />
            <div className="h-2 w-1/2 rounded-full" style={{ background: secondary || 'var(--brand-secondary)' }} />
            <div className="mt-4 inline-flex rounded-lg px-3 py-1.5 text-xs font-semibold text-black" style={{ background: accent || 'var(--brand-accent)' }}>
              CTA
            </div>
          </div>
        </div>
      </div>

      <ComingSoonCard title={t('hq.settingsHub.brand.coverTitle')} body={t('hq.settingsHub.brand.coverBody')} />
    </SectionShell>
  )
}

function ColorField({
  label,
  value,
  set,
}: {
  label: string
  value: string
  set: (v: string) => void
}) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#a78bfa'
  return (
    <div className="space-y-2 rounded-xl border border-white/8 bg-zinc-950/50 p-3">
      <Label className="text-white/70">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          className="h-9 w-11 cursor-pointer rounded-lg border border-white/10 bg-transparent p-1"
          value={safe}
          onChange={(e) => set(e.target.value)}
        />
        <Input value={safe} readOnly dir="ltr" className="border-white/10 bg-black/40 font-mono text-xs" />
      </div>
      <div className="grid grid-cols-8 gap-1">
        {PRESETS.map((p) => (
          <button
            key={`${label}-${p}`}
            type="button"
            className="size-4 rounded border border-white/15"
            style={{ backgroundColor: p }}
            onClick={() => set(p)}
            aria-label={`${label} ${p}`}
          />
        ))}
      </div>
    </div>
  )
}
