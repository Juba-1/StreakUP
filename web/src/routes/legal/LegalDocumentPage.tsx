import { Link } from 'react-router-dom'

import { PremiumStaticBackdrop } from '@/components/auth/PremiumStaticBackdrop'
import { useI18n } from '@/core/i18n/I18nProvider'
import { LEGAL_DOCUMENTS, type LegalDocId } from '@/lib/legal/documents'
import { cn } from '@/lib/utils'

type Props = {
  documentId: LegalDocId
}

export function LegalDocumentPage({ documentId }: Props) {
  const { locale, t } = useI18n()

  const id = documentId
  const document = LEGAL_DOCUMENTS[id][locale === 'ar' ? 'ar' : 'en']

  return (
    <div className="relative mx-auto min-h-dvh max-w-3xl px-4 py-10 pb-16">
      <PremiumStaticBackdrop />

      <div className="relative space-y-8 rounded-[1.75rem] border border-white/10 bg-zinc-950/80 p-8 backdrop-blur-xl md:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.4em] text-white/40 uppercase">StreakUp</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{document.title}</h1>
            <p className="mt-2 text-sm text-white/50">
              {t('legal.page.updated').replace('{date}', document.updated)}
            </p>
          </div>
          <Link
            to="/"
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10"
          >
            {t('legal.page.backHome')}
          </Link>
        </div>

        <p className="text-base leading-relaxed text-white/75">{document.intro}</p>

        <div className="space-y-8">
          {document.sections.map((section) => (
            <section key={section.title} className="space-y-3">
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              {section.paragraphs.map((p) => (
                <p key={p} className="text-sm leading-relaxed text-white/70">
                  {p}
                </p>
              ))}
              {section.bullets ? (
                <ul className={cn('list-disc space-y-2 ps-5 text-sm text-white/70', locale === 'ar' && 'text-end')}>
                  {section.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 border-t border-white/10 pt-6 text-sm">
          <Link to="/terms" className="text-[var(--brand-primary)] hover:underline">
            {t('legal.consent.terms')}
          </Link>
          <span className="text-white/30">·</span>
          <Link to="/privacy" className="text-[var(--brand-primary)] hover:underline">
            {t('legal.consent.privacy')}
          </Link>
        </div>
      </div>
    </div>
  )
}
