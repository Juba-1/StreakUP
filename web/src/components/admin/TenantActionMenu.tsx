import { Link } from 'react-router-dom'
import { Gauge, MoreHorizontal, ShieldOff, UserCog } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

type Props = {
  cafeId: string
  slug: string
  name: string
  onSuspend: () => void
  suspending?: boolean
}

export function TenantActionMenu({ cafeId, slug, name, onSuspend, suspending }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="border-white/15 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]"
        aria-label={t('admin.tenants.actions.menu')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </Button>
      {open ? (
        <div
          className={cn(
            'absolute end-0 top-[calc(100%+6px)] z-50 min-w-[11.5rem] overflow-hidden rounded-xl border border-white/12',
            'bg-zinc-950/95 p-1 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl',
          )}
          role="menu"
        >
          <Link
            to={`/admin/tenants/${slug}`}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-xs font-medium text-white/85 transition hover:bg-white/[0.06]"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Gauge className="size-3.5 text-violet-300" aria-hidden />
            {t('admin.tenants.actions.editLimits')}
          </Link>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-xs font-medium text-rose-100/90 transition hover:bg-rose-500/10"
            role="menuitem"
            disabled={suspending}
            onClick={() => {
              setOpen(false)
              if (window.confirm(t('admin.tenants.actions.suspendConfirm').replace('{name}', name))) {
                onSuspend()
              }
            }}
          >
            <ShieldOff className="size-3.5" aria-hidden />
            {t('admin.tenants.actions.suspend')}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-xs font-medium text-white/85 transition hover:bg-white/[0.06]"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              toast.info(t('admin.tenants.actions.impersonateToast').replace('{name}', name))
              void navigator.clipboard?.writeText(slug)
            }}
          >
            <UserCog className="size-3.5 text-sky-300" aria-hidden />
            {t('admin.tenants.actions.impersonate')}
          </button>
          <p className="border-t border-white/8 px-3 py-2 font-mono text-[9px] text-white/30" dir="ltr">
            {cafeId.slice(0, 8)}…
          </p>
        </div>
      ) : null}
    </div>
  )
}
