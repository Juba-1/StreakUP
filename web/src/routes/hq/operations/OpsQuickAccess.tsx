import { motion, useReducedMotion } from 'framer-motion'
import { Copy, Download, Link2, Monitor, QrCode } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { CustomerPortalQrCode } from '@/components/qr/CustomerPortalQrCode'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cashierPortalPath, cashierPortalUrl } from '@/lib/branch-portal-url'
import { cn } from '@/lib/utils'
import type { OpsBranch } from '@/routes/hq/operations/useHqOperations'

type Props = {
  slug: string
  primaryBranch: OpsBranch | null
  otherBranchCount: number
  onViewBranches: () => void
}

type AccentTone = 'violet' | 'emerald' | 'amber'

const toneClasses: Record<AccentTone, { chip: string; ring: string }> = {
  violet: {
    chip: 'bg-violet-500/15 text-violet-300',
    ring: 'group-hover:shadow-[0_0_32px_-16px_rgba(167,139,250,0.55)]',
  },
  emerald: {
    chip: 'bg-emerald-500/15 text-emerald-300',
    ring: 'group-hover:shadow-[0_0_32px_-16px_rgba(52,211,153,0.5)]',
  },
  amber: {
    chip: 'bg-amber-500/15 text-amber-300',
    ring: 'group-hover:shadow-[0_0_32px_-16px_rgba(251,191,36,0.5)]',
  },
}

function QuickCard({
  tone,
  icon,
  title,
  body,
  children,
}: {
  tone: AccentTone
  icon: React.ReactNode
  title: string
  body: string
  children: React.ReactNode
}) {
  const toneCls = toneClasses[tone]
  return (
    <div
      className={cn(
        'group flex flex-col rounded-2xl border border-white/10 bg-zinc-950/60 p-4 backdrop-blur-xl transition-shadow duration-300',
        toneCls.ring,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', toneCls.chip)}>
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-white/45">{body}</p>
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </div>
  )
}

export function OpsQuickAccess({ slug, primaryBranch, otherBranchCount, onViewBranches }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()
  const [previewOpen, setPreviewOpen] = useState(false)
  const qrWrapRef = useRef<HTMLDivElement>(null)

  const customerUrl = `${window.location.origin}/my-streak/${slug}`
  const cashierUrl = primaryBranch ? cashierPortalPath(slug, primaryBranch.branch_code) : null
  const cashierAbsUrl = primaryBranch
    ? cashierPortalUrl(slug, primaryBranch.branch_code)
    : null

  const copyToClipboard = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => toast.success(t('hq.links.copied')),
      () => toast.error(t('hq.api.copyFail')),
    )
  }

  const downloadQr = () => {
    const svg = qrWrapRef.current?.querySelector('svg')
    if (!svg) {
      toast.error(t('hq.opsPage.qrDownloadFail'))
      return
    }
    const source = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `streakup-${slug}-customer-qr.svg`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('hq.opsPage.qrDownloaded'))
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <QuickCard
        tone="violet"
        icon={<QrCode className="size-4" aria-hidden />}
        title={t('hq.opsPage.qrCardTitle')}
        body={t('hq.opsPage.qrCardBody')}
      >
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div ref={qrWrapRef}>
            <CustomerPortalQrCode value={customerUrl} className="size-32!" />
          </div>
          <div className="flex w-full gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-8 flex-1 gap-1.5 rounded-lg bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-xs font-semibold text-black"
              onClick={downloadQr}
            >
              <Download className="size-3.5" aria-hidden />
              {t('hq.opsPage.downloadQr')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 gap-1.5 border border-white/10 bg-black/35 text-xs text-white"
              onClick={() => setPreviewOpen(true)}
            >
              {t('hq.opsPage.previewQr')}
            </Button>
          </div>
        </div>
      </QuickCard>

      <QuickCard
        tone="emerald"
        icon={<Link2 className="size-4" aria-hidden />}
        title={t('hq.opsPage.linkCardTitle')}
        body={t('hq.opsPage.linkCardBody')}
      >
        <div className="flex flex-1 flex-col justify-end gap-2">
          <Input
            dir="ltr"
            readOnly
            value={customerUrl}
            className="h-9 border-white/10 bg-black/40 font-mono text-[11px] text-white/80"
            aria-label={t('hq.links.customer')}
          />
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-8 flex-1 gap-1.5 rounded-lg bg-emerald-500 text-xs font-semibold text-emerald-950 hover:bg-emerald-400"
              onClick={() => copyToClipboard(customerUrl)}
            >
              <Copy className="size-3.5" aria-hidden />
              {t('hq.opsPage.copyLink')}
            </Button>
            <a
              href={customerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 shrink-0 items-center rounded-lg border border-white/10 bg-black/35 px-3 text-xs font-medium text-white transition hover:border-white/18 hover:bg-white/6"
            >
              {t('hq.opsPage.openPortal')}
            </a>
          </div>
        </div>
      </QuickCard>

      <QuickCard
        tone="amber"
        icon={<Monitor className="size-4" aria-hidden />}
        title={t('hq.opsPage.cashierCardTitle')}
        body={t('hq.opsPage.cashierCardBody')}
      >
        {primaryBranch && cashierUrl && cashierAbsUrl ? (
          <div className="flex flex-1 flex-col justify-end gap-2">
            <div className="rounded-lg border border-white/8 bg-black/30 px-2.5 py-1.5">
              <p className="truncate text-xs font-medium text-white">{primaryBranch.name}</p>
              <p dir="ltr" className="truncate font-mono text-[10px] text-white/40">
                {cashierAbsUrl}
              </p>
            </div>
            <div className="flex gap-1.5">
              <a
                href={cashierUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 text-xs font-semibold text-amber-950 transition hover:bg-amber-400"
              >
                <Monitor className="size-3.5" aria-hidden />
                {t('hq.ops.openCashier')}
              </a>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 shrink-0 gap-1.5 border border-white/10 bg-black/35 text-xs text-white"
                onClick={() => copyToClipboard(cashierAbsUrl)}
              >
                <Copy className="size-3.5" aria-hidden />
              </Button>
            </div>
            {otherBranchCount > 0 ? (
              <button
                type="button"
                onClick={onViewBranches}
                className="text-start text-[11px] text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
              >
                {t('hq.opsPage.cashierCardOthers').replace('{n}', String(otherBranchCount))}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-2 text-center">
            <p className="text-xs text-white/45">{t('hq.opsPage.cashierCardEmpty')}</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 border border-white/10 bg-black/35 text-xs text-white"
              onClick={onViewBranches}
            >
              {t('hq.opsPage.addBranch')}
            </Button>
          </div>
        )}
      </QuickCard>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="border-white/12 bg-zinc-950 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('hq.links.qrTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            <CustomerPortalQrCode value={customerUrl} className="size-56!" />
            <p dir="ltr" className="break-all text-center font-mono text-[11px] text-white/45">
              {customerUrl}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
