import { Navigate, useLocation } from 'react-router-dom'

import { useI18n } from '@/core/i18n/I18nProvider'
import { useAuth } from '@/features/auth/AuthProvider'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const { t } = useI18n()
  const location = useLocation()

  if (loading) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        {t('requireAuth.loading')}
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}
