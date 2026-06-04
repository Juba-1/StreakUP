import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/features/auth/AuthProvider'
import { useI18n } from '@/core/i18n/I18nProvider'
import { cn } from '@/lib/utils'

/**
 * Shown when a signed-in user who is not branch_manager opens the branch portal.
 * No redirects — HQ owners and other roles stay on this page until they sign out.
 */
export function BranchWrongRoleScreen() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-8">
      <Card className="border-amber-500/25 bg-amber-950/20">
        <CardHeader>
          <CardTitle className="text-lg text-amber-50">{t('branch.wrongRole.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm leading-relaxed text-amber-100/90">{t('branch.wrongRole.message')}</p>
          <Button
            type="button"
            size="lg"
            className={cn('w-full gap-2')}
            onClick={() => void handleSignOut()}
          >
            <LogOut className="size-4" aria-hidden />
            {t('branch.wrongRole.signOut')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
