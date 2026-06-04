import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Coffee,
  Flame,
  Gift,
  Pencil,
  Plus,
  RefreshCcw,
  Shield,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useProfile } from '@/hooks/useProfile'
import {
  MILESTONE_ICON_META,
  MILESTONE_ICON_TYPES,
  MilestoneIconGlyph,
  normalizeIconType,
  type MilestoneIconType,
} from '@/lib/milestone-icons'
import { GraceDaysPicker } from '@/components/hq/GraceDaysPicker'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'
import { cn } from '@/lib/utils'

type FulfillmentType = 'physical' | 'digital_shield'

type ClaimLimit = 'once_per_lifetime' | 'every_streak_cycle'

type MilestoneRow = {
  id: string
  cafe_id: string
  name: string
  days_required: number
  reward_label: string | null
  shield_grant_amount: number
  icon_type: string
  discount_percentage: number | null
  fulfillment_type: FulfillmentType
  claim_limit: ClaimLimit
  reactivate_after_inactivity_days?: number | null
  sort_order: number
  active: boolean
}

type DraftMilestone = {
  id?: string
  name: string
  days_required: number
  reward_label: string
  shield_grant_amount: number
  icon_type: MilestoneIconType
  discount_percentage: number | null
  claim_limit: ClaimLimit
  reactivate_after_inactivity_days?: number | null
  active: boolean
}

function defaultClaimLimit(days: number): ClaimLimit {
  return days <= 14 ? 'once_per_lifetime' : 'every_streak_cycle'
}

const SHIELD_GRANT_OPTIONS = [0, 1, 2, 3, 5] as const

function clampShieldGrant(n: number) {
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(10, Math.round(n))
}

function clampDiscount(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null
  const v = Math.round(n)
  if (v < 1 || v > 100) return null
  return v
}

function resolveFulfillment(icon_type: MilestoneIconType): FulfillmentType {
  return icon_type === 'shield' ? 'digital_shield' : 'physical'
}

function gamificationPayload(icon_type: MilestoneIconType, discount_percentage: number | null) {
  return {
    icon_type,
    discount_percentage:
      icon_type === 'discount' ? clampDiscount(discount_percentage) : null,
    fulfillment_type: resolveFulfillment(icon_type),
  }
}

const MIN_DAYS = 1
const MAX_DAYS = 365
const MAX_NAME = 40
const MAX_REWARD = 80

const QUICK_TEMPLATES: Array<{
  name: string
  days: number
  reward: string
  icon: typeof Coffee
  icon_type: MilestoneIconType
  discount_percentage: number | null
}> = [
  { name: 'Warm-Up', days: 3, reward: 'Free shot upgrade', icon: Coffee, icon_type: 'coffee', discount_percentage: null },
  { name: 'Regular', days: 7, reward: 'Free pastry of the day', icon: Gift, icon_type: 'pastry', discount_percentage: null },
  { name: 'Streak Hero', days: 14, reward: '15% off today', icon: Flame, icon_type: 'discount', discount_percentage: 15 },
  { name: 'VIP', days: 30, reward: 'Signature combo + perk', icon: Sparkles, icon_type: 'crown', discount_percentage: null },
]

function clampDays(n: number) {
  if (!Number.isFinite(n)) return MIN_DAYS
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(n)))
}

function sanitizeName(n: string) {
  return n.trim().slice(0, MAX_NAME)
}

function sanitizeReward(n: string) {
  return n.trim().slice(0, MAX_REWARD)
}

export function HqRewardsPage() {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()
  const { data: profile, isLoading: pLoading } = useProfile()
  const qc = useQueryClient()

  const cafeId = profile?.cafe_id ?? null

  const graceQuery = useQuery({
    queryKey: ['hq-cafe-grace', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId && profile?.role === 'hq_owner'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('grace_days, off_days')
        .eq('id', cafeId!)
        .single()
      if (error) throw error
      const grace = (data?.grace_days as number[] | null) ?? []
      const legacy = (data?.off_days as number[] | null) ?? []
      return grace.length > 0 ? grace : legacy
    },
  })

  const milestonesQuery = useQuery({
    queryKey: ['hq-milestones', cafeId],
    enabled: Boolean(supabaseBrowserClient && cafeId && profile?.role === 'hq_owner'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('reward_milestones')
        .select(
          'id, cafe_id, name, days_required, reward_label, shield_grant_amount, icon_type, discount_percentage, fulfillment_type, claim_limit, reactivate_after_inactivity_days, sort_order, active',
        )
        .eq('cafe_id', cafeId!)
        .order('days_required', { ascending: true })
      if (error) throw error
      return (data ?? []) as MilestoneRow[]
    },
  })

  const milestones = milestonesQuery.data ?? []

  const sorted = useMemo(
    () => [...milestones].sort((a, b) => a.days_required - b.days_required),
    [milestones],
  )
  const longestDay = sorted.length > 0 ? sorted[sorted.length - 1]!.days_required : 0
  const activeCount = sorted.filter((m) => m.active).length

  const [draft, setDraft] = useState<DraftMilestone>({
    name: '',
    days_required: 7,
    reward_label: '',
    shield_grant_amount: 0,
    icon_type: 'gift',
    discount_percentage: null,
    claim_limit: 'once_per_lifetime',
    reactivate_after_inactivity_days: null,
    active: true,
  })

  const [editing, setEditing] = useState<Record<string, DraftMilestone>>({})

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['hq-milestones', cafeId] })
  }

  const addMutation = useMutation({
    mutationFn: async (input: DraftMilestone) => {
      if (!supabaseBrowserClient || !cafeId) throw new Error('no_client')
      const name = sanitizeName(input.name)
      if (name.length < 2) throw new Error('invalid_name')
      const days = clampDays(input.days_required)
      const reward = sanitizeReward(input.reward_label) || null
      const shields = clampShieldGrant(input.shield_grant_amount)
      const nextOrder =
        sorted.length > 0
          ? Math.max(...sorted.map((m) => m.sort_order ?? 0)) + 10
          : 10
      const { error } = await supabaseBrowserClient.from('reward_milestones').insert({
        cafe_id: cafeId,
        name,
        days_required: days,
        reward_label: reward,
        shield_grant_amount: shields,
        ...gamificationPayload(input.icon_type, input.discount_percentage),
        claim_limit: input.claim_limit ?? defaultClaimLimit(days),
        reactivate_after_inactivity_days:
          input.claim_limit === 'once_per_lifetime'
            ? (input.reactivate_after_inactivity_days ?? null)
            : null,
        sort_order: nextOrder,
        active: input.active,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setDraft({
        name: '',
        days_required: 7,
        reward_label: '',
        shield_grant_amount: 0,
        icon_type: 'gift',
        discount_percentage: null,
        claim_limit: 'once_per_lifetime',
        reactivate_after_inactivity_days: null,
        active: true,
      })
      await invalidate()
      toast.success(t('hq.rewards.toast.added'))
    },
    onError: (err: unknown) => {
      const raw = (err as { message?: string } | null)?.message ?? ''
      if (raw === 'invalid_name') toast.error(t('hq.rewards.toast.errInvalidName'))
      else if (raw.includes('reward_milestones_cafe_name_uidx') || raw.includes('duplicate key'))
        toast.error(t('hq.rewards.toast.errDuplicate'))
      else if (raw.includes('reward_milestones_days_chk')) toast.error(t('hq.rewards.toast.errDays'))
      else toast.error(t('hq.rewards.toast.errGeneric'))
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (input: MilestoneRow & DraftMilestone) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const name = sanitizeName(input.name)
      if (name.length < 2) throw new Error('invalid_name')
      const days = clampDays(input.days_required)
      const reward = sanitizeReward(input.reward_label) || null
      const shields = clampShieldGrant(input.shield_grant_amount)
      const { error } = await supabaseBrowserClient
        .from('reward_milestones')
        .update({
          name,
          days_required: days,
          reward_label: reward,
          shield_grant_amount: shields,
          ...gamificationPayload(input.icon_type, input.discount_percentage),
          claim_limit: input.claim_limit ?? defaultClaimLimit(days),
          reactivate_after_inactivity_days:
            input.claim_limit === 'once_per_lifetime'
              ? (input.reactivate_after_inactivity_days ?? null)
              : null,
          active: input.active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: async (_data, vars) => {
      setEditing((prev) => {
        const next = { ...prev }
        delete next[vars.id]
        return next
      })
      await invalidate()
      toast.success(t('hq.rewards.toast.saved'))
    },
    onError: (err: unknown) => {
      const raw = (err as { message?: string } | null)?.message ?? ''
      if (raw === 'invalid_name') toast.error(t('hq.rewards.toast.errInvalidName'))
      else if (raw.includes('reward_milestones_cafe_name_uidx') || raw.includes('duplicate key'))
        toast.error(t('hq.rewards.toast.errDuplicate'))
      else if (raw.includes('reward_milestones_days_chk')) toast.error(t('hq.rewards.toast.errDays'))
      else toast.error(t('hq.rewards.toast.errGeneric'))
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const { error } = await supabaseBrowserClient
        .from('reward_milestones')
        .update({ active: next, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
    },
    onError: () => toast.error(t('hq.rewards.toast.errGeneric')),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const { error } = await supabaseBrowserClient.from('reward_milestones').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      toast.success(t('hq.rewards.toast.deleted'))
    },
    onError: () => toast.error(t('hq.rewards.toast.errGeneric')),
  })

  const swapOrderMutation = useMutation({
    mutationFn: async ({ a, b }: { a: MilestoneRow; b: MilestoneRow }) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const [aOrder, bOrder] = [a.sort_order, b.sort_order]
      const { error: e1 } = await supabaseBrowserClient
        .from('reward_milestones')
        .update({ sort_order: bOrder, updated_at: new Date().toISOString() })
        .eq('id', a.id)
      if (e1) throw e1
      const { error: e2 } = await supabaseBrowserClient
        .from('reward_milestones')
        .update({ sort_order: aOrder, updated_at: new Date().toISOString() })
        .eq('id', b.id)
      if (e2) throw e2
    },
    onSuccess: async () => {
      await invalidate()
    },
    onError: () => toast.error(t('hq.rewards.toast.errGeneric')),
  })

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!supabaseBrowserClient || !cafeId) throw new Error('no_client')
      const { error } = await supabaseBrowserClient.rpc('seed_default_reward_milestones', {
        p_cafe_id: cafeId,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await invalidate()
      toast.success(t('hq.rewards.toast.resetOk'))
    },
    onError: () => toast.error(t('hq.rewards.toast.errGeneric')),
  })

  if (pLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-3xl" />
        <Skeleton className="h-72 w-full rounded-3xl" />
      </div>
    )
  }

  if (!profile || profile.role !== 'hq_owner' || !cafeId) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="space-y-6">
      {/* Hero ---------------------------------------------------------- */}
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 26 }}
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/70 p-6 shadow-[0_30px_120px_-65px_var(--brand-glow)] backdrop-blur-xl"
      >
        <div
          className="pointer-events-none absolute -top-24 right-0 size-72 rounded-full opacity-60 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, color-mix(in oklab, var(--brand-primary) 65%, transparent), transparent 70%)',
          }}
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-white/45">
              {t('hq.rewards.kicker')}
            </p>
            <h2 className="text-2xl font-semibold text-white">{t('hq.rewards.title')}</h2>
            <p className="max-w-xl text-sm text-white/65">{t('hq.rewards.subtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 border-white/10 bg-black/40">
              <Sparkles className="size-3" />
              {String(activeCount)} {t('hq.rewards.activeBadge')}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 border-white/10 bg-black/40">
              <Flame className="size-3 text-(--brand-secondary)" />
              {String(longestDay)}{t('hq.rewards.daysShort')}
            </Badge>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1.5 border border-white/10 bg-black/40 text-white"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              title={t('hq.rewards.resetTitle')}
            >
              <RefreshCcw className="size-3.5" />
              {t('hq.rewards.resetCta')}
            </Button>
          </div>
        </div>
      </motion.section>

      {cafeId ? <GraceDaysPicker cafeId={cafeId} initialGraceDays={graceQuery.data ?? []} /> : null}

      {/* Live preview ribbon ------------------------------------------- */}
      <Card className="border-white/10 bg-zinc-950/65 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Flame className="size-4 text-(--brand-secondary)" />
            {t('hq.rewards.preview.title')}
          </CardTitle>
          <p className="text-xs text-white/55">{t('hq.rewards.preview.body')}</p>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/30 p-6 text-center">
              <p className="text-sm text-white/75">{t('hq.rewards.preview.empty')}</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute inset-x-4 top-7 h-px bg-linear-to-r from-transparent via-white/15 to-transparent" />
              <ol className="relative flex gap-3 overflow-x-auto pb-2 pt-1 [scrollbar-width:thin]">
                {sorted.map((m, idx) => {
                  const inactive = !m.active
                  return (
                    <motion.li
                      key={m.id}
                      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04, type: 'spring', stiffness: 320, damping: 28 }}
                      className={cn(
                        'group relative flex w-44 shrink-0 flex-col items-center gap-2 rounded-2xl border bg-black/40 p-3 text-center backdrop-blur-md',
                        inactive
                          ? 'border-white/5 opacity-50'
                          : 'border-white/10 shadow-[0_18px_60px_-45px_var(--brand-glow)]',
                      )}
                    >
                      <div
                        className={cn(
                          'relative grid size-12 place-items-center rounded-2xl border border-white/10 bg-linear-to-br from-zinc-900 to-zinc-950',
                          !inactive && 'shadow-[0_0_30px_-12px_var(--brand-glow)]',
                        )}
                      >
                        <MilestoneIconGlyph
                          iconType={normalizeIconType(m.icon_type)}
                          discountPercentage={m.discount_percentage}
                          className="text-(--brand-primary)"
                        />
                      </div>
                      <p className="line-clamp-1 text-sm font-medium text-white">{m.name}</p>
                      {m.reward_label ? (
                        <p className="line-clamp-2 text-[11px] leading-tight text-white/55">
                          {m.reward_label}
                        </p>
                      ) : null}
                      {inactive ? (
                        <span className="absolute right-2 top-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/55">
                          {t('hq.rewards.preview.off')}
                        </span>
                      ) : null}
                    </motion.li>
                  )
                })}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add new ------------------------------------------------------- */}
      <Card className="border-white/10 bg-gradient-to-br from-zinc-950/80 to-zinc-900/40 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Plus className="size-4" />
            {t('hq.rewards.add.title')}
          </CardTitle>
          <p className="text-xs text-white/55">{t('hq.rewards.add.body')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-12">
            <div className="space-y-1.5 sm:col-span-4">
              <Label className="text-[11px] text-white/70">{t('hq.rewards.field.name')}</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value.slice(0, MAX_NAME) })}
                placeholder={t('hq.rewards.placeholder.name')}
                className="border-white/10 bg-black/40 text-white"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] text-white/70">{t('hq.rewards.field.days')}</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={MIN_DAYS}
                max={MAX_DAYS}
                value={draft.days_required}
                onChange={(e) =>
                  setDraft({ ...draft, days_required: clampDays(Number(e.target.value)) })
                }
                className="border-white/10 bg-black/40 text-center font-mono text-white"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label className="text-[11px] text-white/70">{t('hq.rewards.field.reward')}</Label>
              <Input
                value={draft.reward_label}
                onChange={(e) =>
                  setDraft({ ...draft, reward_label: e.target.value.slice(0, MAX_REWARD) })
                }
                placeholder={t('hq.rewards.placeholder.reward')}
                className="border-white/10 bg-black/40 text-white"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="flex items-center gap-1.5 text-[11px] text-white/70">
                <Shield className="size-3 text-sky-300" aria-hidden />
                {t('hq.rewards.field.shields')}
              </Label>
              <ShieldGrantSelect
                value={draft.shield_grant_amount}
                onChange={(shield_grant_amount) => setDraft({ ...draft, shield_grant_amount })}
                t={t}
              />
            </div>
            <div className="flex items-end sm:col-span-1">
              <Button
                type="button"
                onClick={() => addMutation.mutate(draft)}
                disabled={addMutation.isPending || draft.name.trim().length < 2}
                className="w-full bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black"
                title={t('hq.rewards.add.submit')}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-4">
            <Label className="text-[11px] text-white/70">{t('hq.rewards.field.icon')}</Label>
            <IconThemePicker
              value={draft.icon_type}
              discountPercentage={draft.discount_percentage}
              onChange={(icon_type, discount_percentage) =>
                setDraft({ ...draft, icon_type, discount_percentage })
              }
              t={t}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] text-white/70">{t('hq.rewards.field.claimLimit')}</Label>
            <select
              className="border-input bg-background/80 h-11 w-full rounded-xl border px-3 text-sm text-white"
              value={draft.claim_limit}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  claim_limit: e.target.value as ClaimLimit,
                  reactivate_after_inactivity_days:
                    e.target.value === 'once_per_lifetime'
                      ? draft.reactivate_after_inactivity_days
                      : null,
                })
              }
            >
              <option value="once_per_lifetime">{t('hq.rewards.claimLimit.lifetime')}</option>
              <option value="every_streak_cycle">{t('hq.rewards.claimLimit.cycle')}</option>
            </select>
            <p className="text-[10px] text-white/40">{t('hq.rewards.field.claimLimitHint')}</p>
          </div>

          {draft.claim_limit === 'once_per_lifetime' ? (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-white/70">{t('hq.rewards.field.winBack')}</Label>
              <Input
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                value={draft.reactivate_after_inactivity_days ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    reactivate_after_inactivity_days: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder="30"
                className="h-11 border-white/10 bg-black/40 font-mono text-sm text-white"
              />
              <p className="text-[10px] text-white/40">{t('hq.rewards.field.winBackHint')}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] uppercase tracking-wider text-white/45">
              {t('hq.rewards.add.templates')}
            </span>
            {QUICK_TEMPLATES.map((tpl) => {
              const Icon = tpl.icon
              return (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() =>
                    setDraft({
                      name: tpl.name,
                      days_required: tpl.days,
                      reward_label: tpl.reward,
                      shield_grant_amount: tpl.days >= 10 ? 1 : 0,
                      icon_type: tpl.icon_type,
                      discount_percentage: tpl.discount_percentage,
                      claim_limit: defaultClaimLimit(tpl.days),
                      active: true,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11px] text-white/70 transition hover:border-white/25 hover:text-white"
                >
                  <Icon className="size-3" />
                  {tpl.name} · {tpl.days}d
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Builder rows -------------------------------------------------- */}
      <Card className="border-white/10 bg-zinc-950/65 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Pencil className="size-4" />
            {t('hq.rewards.builder.title')}
          </CardTitle>
          <p className="text-xs text-white/55">{t('hq.rewards.builder.body')}</p>
        </CardHeader>
        <CardContent>
          {milestonesQuery.isPending ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/30 p-8 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/45">
                {t('hq.rewards.builder.emptyKicker')}
              </p>
              <p className="mt-2 text-base font-semibold text-white">
                {t('hq.rewards.builder.emptyTitle')}
              </p>
              <p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-xs leading-relaxed">
                {t('hq.rewards.builder.emptyBody')}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-4 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black"
                onClick={() => resetMutation.mutate()}
                disabled={resetMutation.isPending}
              >
                {t('hq.rewards.builder.emptyCta')}
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {sorted.map((m, idx) => {
                  const isEditing = Boolean(editing[m.id])
                  const draftRow = editing[m.id] ?? {
                    name: m.name,
                    days_required: m.days_required,
                    reward_label: m.reward_label ?? '',
                    shield_grant_amount: m.shield_grant_amount ?? 0,
                    icon_type: normalizeIconType(m.icon_type),
                    discount_percentage: m.discount_percentage,
                    claim_limit: m.claim_limit ?? defaultClaimLimit(m.days_required),
                    reactivate_after_inactivity_days: m.reactivate_after_inactivity_days ?? null,
                    active: m.active,
                  }
                  const canMoveUp = idx > 0
                  const canMoveDown = idx < sorted.length - 1

                  return (
                    <motion.li
                      key={m.id}
                      layout
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}
                      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                      className={cn(
                        'group relative rounded-2xl border bg-black/35 p-4 backdrop-blur-md transition',
                        m.active
                          ? 'border-white/10 shadow-[0_18px_60px_-50px_var(--brand-glow)]'
                          : 'border-white/5 opacity-70',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex flex-col items-center gap-1">
                          <button
                            type="button"
                            disabled={!canMoveUp || swapOrderMutation.isPending}
                            onClick={() =>
                              swapOrderMutation.mutate({ a: sorted[idx - 1]!, b: m })
                            }
                            className="rounded-md border border-white/5 bg-white/[0.04] p-1 text-white/55 transition hover:border-white/15 hover:text-white disabled:opacity-30"
                            title={t('hq.rewards.row.up')}
                            aria-label={t('hq.rewards.row.up')}
                          >
                            <ArrowUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            disabled={!canMoveDown || swapOrderMutation.isPending}
                            onClick={() =>
                              swapOrderMutation.mutate({ a: m, b: sorted[idx + 1]! })
                            }
                            className="rounded-md border border-white/5 bg-white/[0.04] p-1 text-white/55 transition hover:border-white/15 hover:text-white disabled:opacity-30"
                            title={t('hq.rewards.row.down')}
                            aria-label={t('hq.rewards.row.down')}
                          >
                            <ArrowDown className="size-3" />
                          </button>
                        </div>

                        <div
                          className={cn(
                            'grid size-12 place-items-center rounded-2xl border border-white/10 bg-linear-to-br from-zinc-900 to-zinc-950',
                            m.active && 'shadow-[0_0_28px_-14px_var(--brand-glow)]',
                          )}
                        >
                          <MilestoneIconGlyph
                            iconType={normalizeIconType(isEditing ? draftRow.icon_type : m.icon_type)}
                            discountPercentage={
                              isEditing ? draftRow.discount_percentage : m.discount_percentage
                            }
                            className="text-(--brand-primary)"
                          />
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                          {isEditing ? (
                            <>
                              <Input
                                value={draftRow.name}
                                onChange={(e) =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [m.id]: { ...draftRow, name: e.target.value.slice(0, MAX_NAME) },
                                  }))
                                }
                                className="h-9 flex-1 border-white/10 bg-black/40 text-sm text-white"
                              />
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={MIN_DAYS}
                                max={MAX_DAYS}
                                value={draftRow.days_required}
                                onChange={(e) =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [m.id]: {
                                      ...draftRow,
                                      days_required: clampDays(Number(e.target.value)),
                                    },
                                  }))
                                }
                                className="h-9 w-20 border-white/10 bg-black/40 text-center font-mono text-sm text-white"
                              />
                              <Input
                                value={draftRow.reward_label}
                                onChange={(e) =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [m.id]: {
                                      ...draftRow,
                                      reward_label: e.target.value.slice(0, MAX_REWARD),
                                    },
                                  }))
                                }
                                placeholder={t('hq.rewards.placeholder.reward')}
                                className="h-9 flex-1 border-white/10 bg-black/40 text-sm text-white"
                              />
                              {draftRow.claim_limit === 'once_per_lifetime' ? (
                                <Input
                                  type="number"
                                  inputMode="numeric"
                                  min={1}
                                  max={365}
                                  value={draftRow.reactivate_after_inactivity_days ?? ''}
                                  onChange={(e) =>
                                    setEditing((prev) => ({
                                      ...prev,
                                      [m.id]: {
                                        ...draftRow,
                                        reactivate_after_inactivity_days: e.target.value ? Number(e.target.value) : null,
                                      },
                                    }))
                                  }
                                  placeholder="30"
                                  className="h-9 w-24 border-white/10 bg-black/40 text-center font-mono text-sm text-white"
                                  title={t('hq.rewards.field.winBack')}
                                />
                              ) : null}
                              <ShieldGrantSelect
                                compact
                                value={draftRow.shield_grant_amount}
                                onChange={(shield_grant_amount) =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [m.id]: { ...draftRow, shield_grant_amount },
                                  }))
                                }
                                t={t}
                              />
                              <div className="col-span-full mt-2 space-y-2">
                                <Label className="text-[10px] text-white/55">
                                  {t('hq.rewards.field.icon')}
                                </Label>
                                <IconThemePicker
                                  compact
                                  value={draftRow.icon_type}
                                  discountPercentage={draftRow.discount_percentage}
                                  onChange={(icon_type, discount_percentage) =>
                                    setEditing((prev) => ({
                                      ...prev,
                                      [m.id]: { ...draftRow, icon_type, discount_percentage },
                                    }))
                                  }
                                  t={t}
                                />
                              </div>
                            </>
                          ) : (
                            <div className="flex min-w-0 flex-1 flex-col">
                              <p className="truncate text-sm font-medium text-white">{m.name}</p>
                              <p className="truncate text-xs text-white/55">
                                {m.reward_label ?? t('hq.rewards.noReward')}
                              </p>
                              {m.shield_grant_amount > 0 ? (
                                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-sky-300/90">
                                  <Shield className="size-3" aria-hidden />
                                  {t('hq.rewards.shieldsBadge').replace(
                                    '{n}',
                                    String(m.shield_grant_amount),
                                  )}
                                </p>
                              ) : null}
                              <Badge
                                variant="outline"
                                className="mt-1 w-fit border-violet-500/25 bg-violet-500/10 text-[10px] text-violet-100"
                              >
                                {m.claim_limit === 'once_per_lifetime'
                                  ? t('hq.rewards.claimLimit.lifetime')
                                  : t('hq.rewards.claimLimit.cycle')}
                              </Badge>
                              {m.claim_limit === 'once_per_lifetime' && m.reactivate_after_inactivity_days ? (
                                <p className="mt-1 text-[10px] font-medium text-emerald-200/80">
                                  {t('hq.rewards.winBack.badge').replace('{days}', String(m.reactivate_after_inactivity_days))}
                                </p>
                              ) : null}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={m.active}
                            aria-label={t('hq.rewards.row.active')}
                            disabled={toggleActiveMutation.isPending}
                            onClick={() =>
                              toggleActiveMutation.mutate({ id: m.id, next: !m.active })
                            }
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] uppercase tracking-wider transition',
                              m.active
                                ? 'border-(--brand-primary)/40 bg-[color-mix(in_oklab,var(--brand-primary)_18%,transparent)] text-white'
                                : 'border-white/10 bg-black/40 text-white/50 hover:text-white/75',
                            )}
                          >
                            <span
                              className={cn(
                                'relative inline-block h-3 w-6 rounded-full transition-colors',
                                m.active ? 'bg-(--brand-primary)/80' : 'bg-white/15',
                              )}
                            >
                              <span
                                className={cn(
                                  'absolute top-0.5 size-2 rounded-full bg-white shadow transition-all',
                                  m.active ? 'left-3.5' : 'left-0.5',
                                )}
                              />
                            </span>
                            {m.active ? t('hq.rewards.row.on') : t('hq.rewards.row.off')}
                          </button>

                          {isEditing ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                className="gap-1.5 bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black"
                                disabled={updateMutation.isPending || draftRow.name.trim().length < 2}
                                onClick={() =>
                                  updateMutation.mutate({
                                    ...m,
                                    name: draftRow.name,
                                    days_required: draftRow.days_required,
                                    reward_label: draftRow.reward_label,
                                    shield_grant_amount: draftRow.shield_grant_amount,
                                    icon_type: draftRow.icon_type,
                                    discount_percentage: draftRow.discount_percentage,
                                    claim_limit: draftRow.claim_limit,
                                    reactivate_after_inactivity_days: draftRow.reactivate_after_inactivity_days ?? null,
                                    active: m.active,
                                  })
                                }
                              >
                                <CheckCircle2 className="size-3.5" />
                                {t('hq.rewards.row.save')}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-white/70 hover:text-white"
                                onClick={() =>
                                  setEditing((prev) => {
                                    const next = { ...prev }
                                    delete next[m.id]
                                    return next
                                  })
                                }
                              >
                                {t('hq.rewards.row.cancel')}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="gap-1.5 border border-white/10 bg-black/40 text-white"
                                onClick={() =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [m.id]: {
                                      name: m.name,
                                      days_required: m.days_required,
                                      reward_label: m.reward_label ?? '',
                                      shield_grant_amount: m.shield_grant_amount ?? 0,
                                      icon_type: normalizeIconType(m.icon_type),
                                      discount_percentage: m.discount_percentage,
                                      claim_limit: m.claim_limit ?? defaultClaimLimit(m.days_required),
                                      active: m.active,
                                    },
                                  }))
                                }
                              >
                                <Pencil className="size-3.5" />
                                {t('hq.rewards.row.edit')}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="gap-1.5 text-red-300/80 hover:bg-red-500/10 hover:text-red-200"
                                onClick={() => {
                                  if (window.confirm(t('hq.rewards.row.confirmDelete'))) {
                                    deleteMutation.mutate(m.id)
                                  }
                                }}
                                disabled={deleteMutation.isPending}
                                aria-label={t('hq.rewards.row.delete')}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function IconThemePicker({
  value,
  discountPercentage,
  onChange,
  t,
  compact = false,
}: {
  value: MilestoneIconType
  discountPercentage: number | null
  onChange: (icon: MilestoneIconType, discount: number | null) => void
  t: (k: string) => string
  compact?: boolean
}) {
  return (
    <div className="space-y-3">
      <div
        className={cn(
          'grid gap-2',
          compact ? 'grid-cols-4' : 'grid-cols-4 sm:grid-cols-8',
        )}
      >
        {MILESTONE_ICON_TYPES.map((key) => {
          const { Icon } = MILESTONE_ICON_META[key]
          const selected = value === key
          return (
            <button
              key={key}
              type="button"
              onClick={() =>
                onChange(
                  key,
                  key === 'discount' ? discountPercentage ?? 10 : null,
                )
              }
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition',
                selected
                  ? 'border-(--brand-primary)/50 bg-[color-mix(in_oklab,var(--brand-primary)_18%,transparent)] text-white shadow-[0_0_20px_-8px_var(--brand-glow)]'
                  : 'border-white/10 bg-black/40 text-white/55 hover:border-white/25 hover:text-white',
              )}
              title={t(MILESTONE_ICON_META[key].labelKey)}
            >
              {key === 'discount' ? (
                <span className="text-sm font-bold tabular-nums">%</span>
              ) : (
                <Icon className="size-5" aria-hidden />
              )}
              <span className="max-w-full truncate text-[9px] font-medium uppercase tracking-wide">
                {t(MILESTONE_ICON_META[key].labelKey)}
              </span>
            </button>
          )
        })}
      </div>
      {value === 'discount' ? (
        <div className="flex items-center gap-3 rounded-xl border border-(--brand-primary)/25 bg-[color-mix(in_oklab,var(--brand-primary)_10%,transparent)] px-3 py-2">
          <Label className="shrink-0 text-[11px] text-white/70">{t('hq.rewards.field.discount')}</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={discountPercentage ?? ''}
            onChange={(e) =>
              onChange(value, clampDiscount(Number(e.target.value)))
            }
            className="h-9 w-24 border-white/10 bg-black/50 text-center font-mono text-lg font-bold text-white"
          />
          <span className="text-sm font-semibold text-(--brand-primary)">%</span>
        </div>
      ) : null}
    </div>
  )
}

function ShieldGrantSelect({
  value,
  onChange,
  t,
  compact = false,
}: {
  value: number
  onChange: (n: number) => void
  t: (k: string) => string
  compact?: boolean
}) {
  return (
    <select
      value={clampShieldGrant(value)}
      onChange={(e) => onChange(clampShieldGrant(Number(e.target.value)))}
      className={cn(
        'w-full rounded-xl border border-white/10 bg-black/40 text-white focus:border-(--brand-primary)/40 focus:outline-none focus:ring-2 focus:ring-(--brand-primary)/20',
        compact ? 'h-9 px-2 text-sm' : 'h-11 px-3 text-sm',
      )}
      aria-label={t('hq.rewards.field.shields')}
    >
      {SHIELD_GRANT_OPTIONS.map((n) => (
        <option key={n} value={n}>
          {n === 0 ? t('hq.rewards.shields.none') : t('hq.rewards.shields.count').replace('{n}', String(n))}
        </option>
      ))}
    </select>
  )
}
