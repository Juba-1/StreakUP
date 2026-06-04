import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Filter, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useI18n } from '@/core/i18n/I18nProvider'
import { formatAuditSummary, resolveAuditIp } from '@/lib/admin/format-audit'
import { useProfile } from '@/hooks/useProfile'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

type AuditRowRpc = {
  id: number
  created_at: string
  action: string
  action_summary: string
  entity_type: string
  entity_label: string
  cafe_name: string | null
  cafe_slug: string | null
  actor_label: string
  actor_role: string
  ip_address: string
  payload?: Record<string, unknown>
}

type CafeEmbed = { name: string; slug: string }

type AuditRowLegacy = {
  id: number
  created_at: string
  action: string
  entity_type: string
  entity_id: string | null
  actor_type: string
  actor_user_id: string | null
  ip_address?: string | null
  payload: Record<string, unknown>
  cafes: CafeEmbed | CafeEmbed[] | null
}

function resolveCafeEmbed(c: AuditRowLegacy['cafes']): CafeEmbed | null {
  if (!c) return null
  return Array.isArray(c) ? (c[0] ?? null) : c
}

async function fetchAuditRows(filters: {
  actionPattern: string | null
  cafeId: string | null
}): Promise<AuditRowRpc[]> {
  const client = supabaseBrowserClient!

  const { data: rpcData, error: rpcErr } = await client.rpc('admin_list_audit_secure', {
    p_cafe_id: filters.cafeId,
    p_action_ilike: filters.actionPattern,
    p_limit: 150,
  })

  if (!rpcErr && rpcData && typeof rpcData === 'object') {
    const o = rpcData as { ok?: boolean; rows?: AuditRowRpc[] }
    if (o.ok && Array.isArray(o.rows)) return o.rows
  }

  let q = client
    .from('audit_log')
    .select(
      `
      id,
      created_at,
      action,
      entity_type,
      entity_id,
      actor_type,
      actor_user_id,
      ip_address,
      payload,
      cafes ( name, slug )
    `,
    )
    .order('created_at', { ascending: false })
    .limit(150)

  if (filters.cafeId) q = q.eq('cafe_id', filters.cafeId)
  if (filters.actionPattern) q = q.ilike('action', filters.actionPattern)

  const { data, error } = await q
  if (error) throw error

  return ((data ?? []) as AuditRowLegacy[]).map((row) => {
    const cafe = resolveCafeEmbed(row.cafes)
    const payload = (row.payload ?? {}) as Record<string, unknown>
    return {
      id: row.id,
      created_at: row.created_at,
      action: row.action,
      action_summary: formatAuditSummary(row.action, payload),
      entity_type: row.entity_type,
      entity_label: row.entity_type,
      cafe_name: cafe?.name ?? null,
      cafe_slug: cafe?.slug ?? null,
      actor_label: row.actor_type,
      actor_role: row.actor_type,
      ip_address: resolveAuditIp(payload, row.ip_address),
      payload,
    }
  })
}

export function AdminAuditPage() {
  const { t } = useI18n()
  const { data: profile, isLoading: pLoading } = useProfile()
  const [actionQ, setActionQ] = useState('')
  const [cafeId, setCafeId] = useState('')

  const cafes = useQuery({
    queryKey: ['admin-cafes-list'],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'super_admin'),
    queryFn: async () => {
      const { data, error } = await supabaseBrowserClient!
        .from('cafes')
        .select('id, name, slug')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const filters = useMemo(
    () => ({
      actionPattern: actionQ.trim() ? `%${actionQ.trim()}%` : null,
      cafeId: cafeId || null,
    }),
    [actionQ, cafeId],
  )

  const audit = useQuery({
    queryKey: ['admin-audit', filters.actionPattern, filters.cafeId],
    enabled: Boolean(supabaseBrowserClient && profile?.role === 'super_admin'),
    queryFn: () => fetchAuditRows(filters),
  })

  if (pLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (!profile || profile.role !== 'super_admin') {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40">{t('admin.audit.kicker')}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">{t('admin.audit.title')}</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{t('admin.audit.subtitle')}</p>
      </div>

      <Card className="border-white/10 bg-zinc-950/60 backdrop-blur-md">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-2 text-white/80">
            <Filter className="size-4" aria-hidden />
            <CardTitle className="text-base">{t('admin.audit.filters')}</CardTitle>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="border-white/10"
            onClick={() => void audit.refetch()}
          >
            <RefreshCw className="size-3.5" />
            <span className="ms-2">{t('admin.audit.refresh')}</span>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 border-t border-white/5 pt-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-white/70">{t('admin.audit.actionFilter')}</Label>
            <Input
              value={actionQ}
              onChange={(e) => setActionQ(e.target.value)}
              placeholder="customer.override"
              dir="ltr"
              className="border-white/10 bg-black/40 text-left font-mono text-xs text-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-white/70">{t('admin.audit.cafeFilter')}</Label>
            <select
              value={cafeId}
              onChange={(e) => setCafeId(e.target.value)}
              className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">{t('admin.audit.allCafes')}</option>
              {(cafes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.slug})
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="border-white/10 bg-zinc-950/70 backdrop-blur-md">
          <CardContent className="p-0">
            {audit.isLoading ? (
              <div className="p-6">
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.audit.col.when')}</TableHead>
                      <TableHead>{t('admin.audit.col.summary')}</TableHead>
                      <TableHead>{t('admin.audit.col.cafe')}</TableHead>
                      <TableHead>{t('admin.audit.col.actor')}</TableHead>
                      <TableHead>{t('admin.audit.col.ip')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(audit.data ?? []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap font-mono text-[11px] text-white/70">
                          {new Date(row.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="max-w-[min(100%,22rem)]">
                          <p className="text-sm leading-snug font-medium text-white">{row.action_summary}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-white/35">{row.action}</p>
                        </TableCell>
                        <TableCell className="text-xs text-white/80">
                          {row.cafe_name ?? '—'}
                          {row.cafe_slug ? (
                            <span className="text-muted-foreground block font-mono text-[10px]">{row.cafe_slug}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          <p className="font-medium text-white/85">{row.actor_label}</p>
                          <Badge variant="outline" className="mt-1 border-white/12 bg-black/25 text-[9px]">
                            {row.actor_role}
                          </Badge>
                        </TableCell>
                        <TableCell dir="ltr" className="font-mono text-[11px] text-white/65">
                          {row.ip_address}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
