import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

export function NotFoundPage() {
  const { t } = useI18n()

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
      <Link className={cn(buttonVariants({ variant: 'secondary' }))} to="/login">
        {t('notFound.back')}
      </Link>
    </div>
  )
}
