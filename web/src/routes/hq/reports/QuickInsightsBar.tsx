import { Sparkles } from 'lucide-react'

import { useI18n } from '@/core/i18n/I18nProvider'

type Fact = { id: string; textKey: string; name?: string; n?: number }

type Props = {
  facts: Fact[]
  periodLabel: string
}

const DOW_KEYS = [
  'hq.reports.dow.0',
  'hq.reports.dow.1',
  'hq.reports.dow.2',
  'hq.reports.dow.3',
  'hq.reports.dow.4',
  'hq.reports.dow.5',
  'hq.reports.dow.6',
] as const

export function QuickInsightsBar({ facts, periodLabel }: Props) {
  const { t } = useI18n()

  if (facts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 px-5 py-6 text-center text-sm text-white/40">
        {t('hq.reports.quickEmpty')}
      </div>
    )
  }

  return (
    <section
      aria-label={t('hq.reports.quickAria')}
      className="rounded-2xl border border-white/10 bg-zinc-950/55 p-4 backdrop-blur-xl"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-violet-300" aria-hidden />
          <h2 className="text-sm font-semibold text-white">{t('hq.reports.quickTitle')}</h2>
        </div>
        <p className="text-[11px] text-white/35">{periodLabel}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {facts.map((fact) => {
          let text = t(fact.textKey)
            .replace('{name}', fact.name ?? '')
            .replace('{n}', String(fact.n ?? ''))
          if (fact.id === 'dow' && typeof fact.n === 'number' && DOW_KEYS[fact.n]) {
            text = t(fact.textKey)
              .replace('{name}', t(DOW_KEYS[fact.n]!))
              .replace('{n}', fact.name ?? '')
          }
          return (
            <div
              key={fact.id}
              className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-xs leading-relaxed text-white/70"
            >
              {text}
            </div>
          )
        })}
      </div>
    </section>
  )
}
