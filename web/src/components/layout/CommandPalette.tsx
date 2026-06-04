import { Command } from 'cmdk'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useI18n } from '@/core/i18n/I18nProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useProfile } from '@/hooks/useProfile'
import { useStaffDashboardPath } from '@/hooks/useStaffDashboardPath'
import { cn } from '@/lib/utils'

export function CommandPalette() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { data: profile } = useProfile()
  const { data: workspacePath } = useStaffDashboardPath()
  const [open, setOpen] = useState(false)

  const hqSlug = useMemo(() => {
    if (!workspacePath?.startsWith('/hq/')) return null
    const parts = workspacePath.split('/').filter(Boolean)
    return parts[1] ?? null
  }, [workspacePath])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea') return
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function go(path: string) {
    navigate(path)
    setOpen(false)
  }

  if (!open) return null

  const canWorkspace =
    Boolean(session) && workspacePath && workspacePath !== '/login'

  const isSuperAdmin = profile?.role === 'super_admin'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 pt-[min(18vh,8rem)] backdrop-blur-md"
      role="dialog"
      aria-modal
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <Command
        className={cn(
          'w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 text-white shadow-[0_40px_120px_-40px_var(--brand-glow,rgba(139,92,246,0.45))]',
        )}
        label="Command palette"
      >
        <div className="border-b border-white/10 px-3 py-2 text-[10px] font-medium tracking-widest text-white/45">
          {t('shell.cmd.hint')}
        </div>
        <Command.Input
          autoFocus
          placeholder={t('shell.cmd.placeholder')}
          className="w-full border-0 bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
        />
        <Command.List className="max-h-72 overflow-y-auto px-1 pb-2">
          <Command.Empty className="px-4 py-6 text-center text-sm text-white/50">
            {t('shell.cmd.empty')}
          </Command.Empty>
          <Command.Group heading={t('shell.cmd.group.nav')} className="px-2 py-1 text-[11px] text-white/40">
            <Command.Item
              className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/90 aria-selected:bg-white/10"
              onSelect={() => go('/login')}
            >
              {t('cmd.nav.corporatePortal')}
            </Command.Item>
            {canWorkspace ? (
              <Command.Item
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/90 aria-selected:bg-white/10"
                onSelect={() => go(workspacePath!)}
              >
                {t('cmd.nav.myWorkspace')}
              </Command.Item>
            ) : null}
          </Command.Group>
          {profile?.role === 'hq_owner' && hqSlug ? (
            <Command.Group heading={t('tier.hq.title')} className="px-2 py-1 text-[11px] text-white/40">
              <Command.Item
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/90 aria-selected:bg-white/10"
                onSelect={() => go(`/hq/${hqSlug}/brand`)}
              >
                {t('hq.nav.brand')}
              </Command.Item>
              <Command.Item
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/90 aria-selected:bg-white/10"
                onSelect={() => go(`/hq/${hqSlug}/api`)}
              >
                {t('hq.nav.integrations')}
              </Command.Item>
              <Command.Item
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/90 aria-selected:bg-white/10"
                onSelect={() => go(`/hq/${hqSlug}/billing`)}
              >
                {t('hq.nav.billing')}
              </Command.Item>
            </Command.Group>
          ) : null}
          {isSuperAdmin ? (
            <Command.Group heading={t('cmd.nav.adminGroup')} className="px-2 py-1 text-[11px] text-white/40">
              <Command.Item
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/90 aria-selected:bg-white/10"
                onSelect={() => go('/admin/overview')}
              >
                {t('cmd.nav.adminOverview')}
              </Command.Item>
              <Command.Item
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/90 aria-selected:bg-white/10"
                onSelect={() => go('/admin/tenants')}
              >
                {t('cmd.nav.adminTenants')}
              </Command.Item>
              <Command.Item
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/90 aria-selected:bg-white/10"
                onSelect={() => go('/admin/audit')}
              >
                {t('cmd.nav.adminAudit')}
              </Command.Item>
              <Command.Item
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-white/90 aria-selected:bg-white/10"
                onSelect={() => go('/admin/settings')}
              >
                {t('cmd.nav.adminSettings')}
              </Command.Item>
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </div>
  )
}
