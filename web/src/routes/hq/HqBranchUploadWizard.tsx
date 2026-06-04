import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { type DragEvent, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { invokeAiRouter } from '@/core/ai/router'
import { useI18n } from '@/core/i18n/I18nProvider'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

export type ParsedBranch = { name: string; branch_code: string }

type Props = {
  cafeId: string
}

function secureDigits4() {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return String(1000 + (a[0]! % 9000))
}

export function HqBranchUploadWizard({ cafeId }: Props) {
  const qc = useQueryClient()
  const { t } = useI18n()
  const [csvName, setCsvName] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedBranch[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [wizardStep, setWizardStep] = useState<'idle' | 'magic' | 'preview'>('idle')
  const reviewRows = useMemo(
    () =>
      parsedRows
        .map((r) => ({ name: r.name.trim(), branch_code: r.branch_code.trim().toLowerCase() }))
        .filter((r) => r.name.length >= 2 && /^[a-z0-9-]{2,24}$/.test(r.branch_code)),
    [parsedRows],
  )

  const parseCsvAi = useMutation({
    mutationFn: async (text: string) => {
      if (!supabaseBrowserClient) throw new Error('no_client')
      const res = await invokeAiRouter(supabaseBrowserClient, {
        intent: 'parse_branches_csv',
        csvText: text,
      })
      if (res.error) throw res.error
      return res.data as { parsed?: unknown }
    },
    onMutate: () => {
      setWizardStep('magic')
    },
    onSuccess: (d) => {
      const parsed = d?.parsed as { branches?: ParsedBranch[] } | undefined
      const rows = parsed?.branches ?? []
      setParsedRows(rows.filter((r) => r.branch_code && r.name))
      setWizardStep('preview')
      toast.success(t('hq.toast.parsed').replace('{n}', String(rows.length)))
    },
    onError: () => {
      setWizardStep('idle')
      toast.error(t('hq.toast.parseFail'))
    },
  })

  const insertBranches = useMutation({
    mutationFn: async () => {
      if (!supabaseBrowserClient) throw new Error('no')
      const rows = reviewRows.map((r) => ({
        cafe_id: cafeId,
        name: r.name,
        branch_code: r.branch_code.toLowerCase(),
        manager_password: secureDigits4(),
        cashier_pin: secureDigits4(),
      }))
      const { error } = await supabaseBrowserClient.from('branches').insert(rows)
      if (error) throw error
    },
    onSuccess: async () => {
      toast.success(t('hq.toast.branchesCreated'))
      setParsedRows([])
      setWizardStep('idle')
      setCsvName(null)
      await qc.invalidateQueries({ queryKey: ['hq-stats'] })
    },
    onError: () => toast.error(t('hq.toast.insertFail')),
  })

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    setCsvName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      void parseCsvAi.mutateAsync(text)
    }
    reader.readAsText(file)
  }

  return (
    <Card id="hq-branch-wizard" className="border-white/10 bg-zinc-950/60 backdrop-blur-md">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-white">{t('hq.wizard.title')}</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">{t('hq.wizard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {wizardStep === 'magic' ? (
            <Badge variant="secondary" className="border-[color-mix(in_oklab,var(--brand-primary)_35%,transparent)] bg-black/40">
              {t('hq.wizard.step.magic')}
            </Badge>
          ) : null}
          {wizardStep === 'preview' ? (
            <Badge className="border-white/10 bg-[color-mix(in_oklab,var(--brand-secondary)_22%,transparent)] text-white">
              {t('hq.wizard.step.preview')}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`relative overflow-hidden rounded-2xl border border-dashed p-10 text-center transition ${
            dragActive
              ? 'border-[var(--brand-primary)] bg-[color-mix(in_oklab,var(--brand-primary)_14%,transparent)]'
              : 'border-white/15 bg-black/25'
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-30"
            animate={{
              background: dragActive
                ? [
                    'radial-gradient(circle at 20% 20%, var(--brand-primary), transparent 55%)',
                    'radial-gradient(circle at 80% 30%, var(--brand-secondary), transparent 50%)',
                    'radial-gradient(circle at 20% 20%, var(--brand-primary), transparent 55%)',
                  ]
                : 'radial-gradient(circle at 50% 0%, transparent, transparent)',
            }}
            transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
          />
          <p className="relative text-sm text-white/85">{t('hq.wizard.drop')}</p>
          <p className="text-muted-foreground relative mt-2 text-xs">{csvName ?? t('hq.csv.noFile')}</p>
        </div>

        <Textarea
          placeholder={t('hq.wizard.paste')}
          className="min-h-28 border-white/10 bg-black/30 text-white"
          dir="ltr"
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v.length > 10) void parseCsvAi.mutateAsync(v)
          }}
        />

        <Separator className="bg-white/10" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            {reviewRows.length} {t('hq.wizard.rowsReady')}
          </p>
          {wizardStep === 'magic' ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/70"
            >
              <p className="font-medium text-white/85">{t('hq.wizard.magicTitle')}</p>
              <p>{t('hq.wizard.magicHint')}</p>
            </motion.div>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={reviewRows.length === 0}
              onClick={() => {
                setParsedRows([])
                setWizardStep('idle')
              }}
            >
              {t('hq.wizard.clear')}
            </Button>
            <Button
              disabled={reviewRows.length === 0 || insertBranches.isPending}
              onClick={() => void insertBranches.mutateAsync()}
            >
              {insertBranches.isPending ? t('hq.wizard.approving') : t('hq.wizard.approveInsert')}
            </Button>
          </div>
        </div>

        <ScrollArea className="h-56 rounded-xl border border-white/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hq.wizard.col.displayName')}</TableHead>
                <TableHead>{t('hq.wizard.col.secureCode')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence initial={false}>
                {reviewRows.slice(0, 80).map((r, idx) => (
                  <TableRow key={`${r.branch_code}-${r.name}-${idx}`} className="border-white/[0.06]">
                    <TableCell className="font-medium text-white">
                      <motion.span
                        layout
                        initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{
                          delay: Math.min(idx * 0.03, 0.45),
                          type: 'spring',
                          stiffness: 380,
                          damping: 28,
                        }}
                        className="inline-block"
                      >
                        {r.name}
                      </motion.span>
                    </TableCell>
                    <TableCell dir="ltr" className="text-left font-mono text-xs text-white/80">
                      <motion.span
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(idx * 0.03 + 0.04, 0.5) }}
                        className="inline-block"
                      >
                        {r.branch_code}
                      </motion.span>
                    </TableCell>
                  </TableRow>
                ))}
              </AnimatePresence>
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
