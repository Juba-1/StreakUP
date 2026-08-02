import { Menu } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useI18n } from '@/core/i18n/I18nProvider'
import { SETTINGS_GROUPS, SETTINGS_NAV } from '@/routes/hq/settings/nav'
import type { SettingsTab } from '@/routes/hq/settings/types'
import { cn } from '@/lib/utils'

type Props = {
  active: SettingsTab
  visible: SettingsTab[]
  onSelect: (tab: SettingsTab) => void
  query: string
}

function NavList({
  active,
  visible,
  onSelect,
  query,
  onPick,
}: Props & { onPick?: () => void }) {
  const { t } = useI18n()
  const items = SETTINGS_NAV.filter((n) => visible.includes(n.id))

  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-xs text-white/40">{t('hq.settingsHub.searchEmpty')}</p>
  }

  return (
    <nav aria-label={t('hq.settingsHub.sidebarAria')} className="space-y-4 p-2">
      {SETTINGS_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group)
        if (groupItems.length === 0) return null
        return (
          <div key={group} className="space-y-1">
            <p className="px-3 pt-1 text-[10px] font-semibold tracking-[0.15em] text-white/30 uppercase">
              {t(`hq.settingsHub.group.${group}`)}
            </p>
            {groupItems.map((item) => {
              const isActive = active === item.id
              const title = t(item.titleKey)
              const body = t(item.bodyKey)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.id)
                    onPick?.()
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-start transition',
                    isActive
                      ? 'border-[color-mix(in_oklab,var(--brand-primary)_40%,transparent)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,transparent)]'
                      : 'border-transparent hover:border-white/8 hover:bg-white/[0.03]',
                  )}
                >
                  <item.Icon
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      isActive ? 'text-[var(--brand-secondary)]' : 'text-white/40',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-white">
                      <Highlight text={title} query={query} />
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-white/40">
                      <Highlight text={body} query={query} />
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-[color-mix(in_oklab,var(--brand-primary)_35%,transparent)] text-inherit">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  )
}

export function SettingsSidebar(props: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="lg:hidden">
        <Button
          type="button"
          variant="secondary"
          className="h-11 w-full justify-start gap-2 border border-white/10 bg-white/[0.04]"
          onClick={() => setOpen(true)}
        >
          <Menu className="size-4" />
          {t('hq.settingsHub.openMenu')}
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="left"
            className="w-[min(100%,320px)] border-white/10 bg-zinc-950 p-0 text-white"
          >
            <SheetHeader className="border-b border-white/8 px-4 py-3 text-start">
              <SheetTitle className="text-white">{t('hq.settingsHub.menuTitle')}</SheetTitle>
            </SheetHeader>
            <NavList {...props} onPick={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>

      <aside className="hidden max-h-[calc(100vh-12rem)] overflow-y-auto rounded-2xl border border-white/8 bg-zinc-950/45 lg:block">
        <NavList {...props} />
      </aside>
    </>
  )
}
