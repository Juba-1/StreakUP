import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ShieldAlert, Sparkles } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { provisionTenantViaEdge } from '@/core/admin/provision-tenant'
import { useI18n } from '@/core/i18n/I18nProvider'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { provisionTenantSchema } from '@/lib/validation/schemas'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
}

type ProvisionLifecycle = 'trial' | 'active' | 'suspended'

const TECH_INPUT_CLASS = 'border-white/10 bg-black/40 font-mono text-sm text-white text-left'

const LIFECYCLE_STYLES: Record<ProvisionLifecycle, { ring: string; chip: string; dot: string }> = {
  trial: {
    ring: 'border-cyan-400/40 bg-cyan-500/10',
    chip: 'bg-cyan-500/15 text-cyan-100 border-cyan-300/30',
    dot: 'bg-cyan-300',
  },
  active: {
    ring: 'border-emerald-400/40 bg-emerald-500/10',
    chip: 'bg-emerald-500/15 text-emerald-100 border-emerald-300/30',
    dot: 'bg-emerald-300',
  },
  suspended: {
    ring: 'border-rose-400/50 bg-rose-500/10',
    chip: 'bg-rose-500/15 text-rose-100 border-rose-300/30',
    dot: 'bg-rose-300',
  },
}

const COLOR_PRESETS = ['#7c3aed', '#f97316', '#22d3ee', '#0ea5e9', '#14b8a6', '#f43f5e', '#09090b', '#fafafa']

function slugify(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function ColorPickerField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  const safe = /^#(?:[0-9a-fA-F]{6})$/.test(value.trim()) ? value.trim() : '#7c3aed'

  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium tracking-wide text-white/80">{label}</Label>
        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-white/70">
          {value || safe}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 cursor-pointer border-white/20 bg-transparent p-1"
          aria-label={label}
        />
        <div className="grid grid-cols-4 gap-1.5">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={`${label}:${preset}`}
              type="button"
              onClick={() => onChange(preset)}
              className="size-5 rounded-md border border-white/20 transition hover:scale-110"
              style={{ backgroundColor: preset }}
              aria-label={`${label}: ${preset}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function AdminProvisionTenantModal({ open, onOpenChange }: Props) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [lifecycle, setLifecycle] = useState<ProvisionLifecycle>('trial')
  const [timezone, setTimezone] = useState('Asia/Riyadh')
  const [currencyCode, setCurrencyCode] = useState('SAR')
  const [primaryColor, setPrimaryColor] = useState('#7c3aed')
  const [secondaryColor, setSecondaryColor] = useState('#f97316')
  const [accentColor, setAccentColor] = useState('#22d3ee')
  const [backgroundColor, setBackgroundColor] = useState('#09090b')
  const [logoFile, setLogoFile] = useState<File | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setSlug('')
    setOwnerEmail('')
    setOwnerPassword('')
    setLifecycle('trial')
    setTimezone('Asia/Riyadh')
    setCurrencyCode('SAR')
    setPrimaryColor('#7c3aed')
    setSecondaryColor('#f97316')
    setAccentColor('#22d3ee')
    setBackgroundColor('#09090b')
    setLogoFile(null)
  }, [open])

  const lifecycleStyle = LIFECYCLE_STYLES[lifecycle]
  const slugPreview = useMemo(() => slugify(slug || name), [slug, name])

  const provision = useMutation({
    mutationFn: async () => {
      let logoUrl: string | null = null
      if (logoFile && supabaseBrowserClient) {
        const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
        if (!ALLOWED.has(logoFile.type || 'image/png')) throw new Error('logo_type')
        if (logoFile.size > 2 * 1024 * 1024) throw new Error('logo_size')
        const path = `staging/${crypto.randomUUID()}-${slugify(slug || name || 'logo')}`
        const { error: upErr } = await supabaseBrowserClient.storage.from('logos').upload(path, logoFile, {
          upsert: true,
          contentType: logoFile.type || 'image/png',
        })
        if (upErr) throw upErr
        const { data: pub } = supabaseBrowserClient.storage.from('logos').getPublicUrl(path)
        logoUrl = pub.publicUrl
      }

      const candidate = {
        name: name.trim(),
        slug: slugify(slug || name),
        ownerEmail: ownerEmail.trim(),
        ownerPassword,
        lifecycle,
        timezone: timezone.trim() || 'UTC',
        currencyCode: (currencyCode || 'USD').toUpperCase().slice(0, 3),
        primaryColor: primaryColor.trim() || null,
        secondaryColor: secondaryColor.trim() || null,
        accentColor: accentColor.trim() || null,
        backgroundColor: backgroundColor.trim() || null,
        logoUrl,
      }

      const parsed = provisionTenantSchema.safeParse(candidate)
      if (!parsed.success) throw new Error('invalid_input')

      const res = await provisionTenantViaEdge(parsed.data)
      if (!res.ok) throw new Error(res.error ?? 'failed')
      return res
    },
    onSuccess: async () => {
      toast.success(t('admin.provision.toastOk'))
      await qc.invalidateQueries({ queryKey: ['admin-tenant-pulse'] })
      await qc.invalidateQueries({ queryKey: ['admin-platform-metrics'] })
      await qc.invalidateQueries({ queryKey: ['admin-audit'] })
      onOpenChange(false)
    },
    onError: (e: Error) => {
      if (e.message === 'logo_type') toast.error(t('admin.provision.logoType'))
      else if (e.message === 'logo_size') toast.error(t('admin.provision.logoSize'))
      else if (e.message === 'invalid_input') toast.error(t('admin.provision.invalidInput'))
      else if (e.message.includes('Failed to send a request to the Edge Function')) {
        toast.error(t('admin.provision.edgeConnectionFail'))
      }
      else toast.error(e.message || t('admin.provision.toastFail'))
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void provision.mutateAsync()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92dvh,800px)] overflow-y-auto border-white/10 bg-zinc-950/95 shadow-[0_0_120px_-30px_rgba(244,63,94,0.35)] sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl border border-rose-500/30 bg-rose-500/10">
              <Sparkles className="size-4 text-rose-200" aria-hidden />
            </div>
            <div>
              <DialogTitle className="text-lg text-white">{t('admin.provision.title')}</DialogTitle>
              <DialogDescription className="text-white/55">{t('admin.provision.subtitle')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <section className={`space-y-3 rounded-2xl border p-4 ${lifecycleStyle.ring}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-wide text-white/70">{t('admin.provision.lifecycle')}</p>
                <p className="text-[11px] text-white/55">{t('admin.provision.lifecycleHint')}</p>
              </div>
              <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${lifecycleStyle.chip}`}>
                <span className={`size-1.5 rounded-full ${lifecycleStyle.dot}`} />
                {t(`admin.provision.lifecycle.${lifecycle}`)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-white/70" aria-hidden />
              <select
                value={lifecycle}
                onChange={(e) => setLifecycle(e.target.value as ProvisionLifecycle)}
                className="h-9 flex-1 rounded-lg border border-white/15 bg-black/45 px-3 text-sm text-white outline-none ring-0 transition focus:border-rose-300/40"
              >
                <option value="trial">{t('admin.provision.lifecycle.trial')}</option>
                <option value="active">{t('admin.provision.lifecycle.active')}</option>
                <option value="suspended">{t('admin.provision.lifecycle.suspended')}</option>
              </select>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-white/80">{t('admin.provision.name')}</Label>
              <Input
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (!slug) setSlug(slugify(e.target.value))
                }}
                className="border-white/10 bg-black/40 text-white"
                placeholder={t('admin.provision.namePh')}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.provision.slug')}</Label>
              <Input
                required
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                className={TECH_INPUT_CLASS}
                dir="ltr"
                placeholder="acme-roasters"
              />
              <p dir="ltr" className="text-[11px] text-left text-white/55">
                streakup.app/{slugPreview || 'your-slug'}
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.provision.ownerEmail')}</Label>
              <Input
                required
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className={TECH_INPUT_CLASS}
                dir="ltr"
                placeholder="owner@brand.com"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.provision.ownerPassword')}</Label>
              <Input
                required
                type="password"
                minLength={8}
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                className={TECH_INPUT_CLASS}
                dir="ltr"
                placeholder="••••••••"
              />
              <p className="text-muted-foreground text-[11px]">{t('admin.provision.passwordHint')}</p>
            </div>

            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.provision.timezone')}</Label>
              <Input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className={TECH_INPUT_CLASS}
                dir="ltr"
                placeholder="Asia/Riyadh"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-white/80">{t('admin.provision.currency')}</Label>
              <Input
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
                className={TECH_INPUT_CLASS}
                dir="ltr"
                maxLength={3}
                placeholder="SAR"
              />
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
            <div>
              <p className="text-sm font-medium text-white">{t('admin.provision.branding')}</p>
              <p className="text-[11px] text-white/55">{t('admin.provision.brandingHint')}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ColorPickerField label={t('admin.provision.primary')} value={primaryColor} onChange={setPrimaryColor} />
              <ColorPickerField label={t('admin.provision.secondary')} value={secondaryColor} onChange={setSecondaryColor} />
              <ColorPickerField label={t('admin.provision.accent')} value={accentColor} onChange={setAccentColor} />
              <ColorPickerField label={t('admin.provision.background')} value={backgroundColor} onChange={setBackgroundColor} />
            </div>

            <div className="rounded-xl border border-white/10 p-3">
              <p className="text-xs text-white/70">{t('admin.provision.preview')}</p>
              <div
                className="mt-2 h-14 rounded-lg border border-white/10"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                }}
              />
              <div
                className="mt-2 h-9 rounded-lg border border-white/10"
                style={{
                  backgroundColor,
                  boxShadow: `inset 0 0 0 1px ${accentColor}55`,
                }}
              />
            </div>
          </section>

          <div className="space-y-1">
            <Label className="text-white/80">{t('admin.provision.logo')}</Label>
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="border-white/10 bg-black/40 text-sm text-white file:me-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-white"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-muted-foreground text-[11px]">{t('admin.provision.logoHint')}</p>
          </div>

          <AnimatePresence>
            {provision.isPending ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden rounded-xl border border-white/10 bg-white/3 px-3 py-2 text-center text-xs text-white/60"
              >
                {t('admin.provision.working')}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={provision.isPending}
              className="bg-[linear-gradient(135deg,#f43f5e,#8b5cf6)] text-white shadow-lg"
            >
              {t('admin.provision.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
