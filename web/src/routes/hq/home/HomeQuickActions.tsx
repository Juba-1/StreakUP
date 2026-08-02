import { motion, useReducedMotion } from 'framer-motion'
import { MonitorSmartphone, Sparkles, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

type Props = {
  slug: string
  cashierPath: string | null
}

export function HomeQuickActions({ slug, cashierPath }: Props) {
  const { t } = useI18n()
  const reduce = useReducedMotion()

  const openCashier = () => {
    if (!cashierPath) {
      toast.message(t('hq.home.noCashierYet'))
      return
    }
    window.open(cashierPath, '_blank', 'noopener,noreferrer')
  }

  const actions = [
    {
      id: 'cashier',
      label: t('hq.home.actionCashier'),
      hint: t('hq.home.actionCashierHint'),
      Icon: MonitorSmartphone,
      onClick: openCashier,
      to: null as string | null,
    },
    {
      id: 'customers',
      label: t('hq.home.actionAddCustomer'),
      hint: t('hq.home.actionAddCustomerHint'),
      Icon: Users,
      onClick: null as (() => void) | null,
      to: `/hq/${slug}/customers`,
    },
    {
      id: 'loyalty',
      label: t('hq.home.actionLoyalty'),
      hint: t('hq.home.actionLoyaltyHint'),
      Icon: Sparkles,
      onClick: null as (() => void) | null,
      to: `/hq/${slug}/rewards`,
    },
  ]

  return (
    <section className="space-y-3" aria-label={t('hq.home.actionsAria')}>
      <h3 className="text-[11px] font-semibold tracking-[0.2em] text-white/40 uppercase">
        {t('hq.home.actionsHeading')}
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {actions.map((action, i) => {
          const inner = (
            <>
              <div className="grid size-10 place-items-center rounded-xl bg-[linear-gradient(135deg,var(--brand-primary),var(--brand-secondary))] text-black">
                <action.Icon className="size-4" aria-hidden />
              </div>
              <div className="min-w-0 text-start">
                <p className="text-sm font-semibold text-white">{action.label}</p>
                <p className="mt-0.5 text-[11px] text-white/45">{action.hint}</p>
              </div>
            </>
          )

          const className = cn(
            buttonVariants({ variant: 'secondary' }),
            'flex h-auto min-h-[64px] w-full items-center gap-3 rounded-2xl border border-white/10 bg-zinc-950/60 px-4 py-3 text-left transition-transform duration-200 hover:scale-[1.02] hover:bg-white/[0.06]',
          )

          return (
            <motion.div
              key={action.id}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.03 }}
            >
              {action.to ? (
                <Link to={action.to} className={className} aria-label={action.label}>
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  className={className}
                  onClick={action.onClick ?? undefined}
                  aria-label={action.label}
                >
                  {inner}
                </button>
              )}
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}
