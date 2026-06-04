import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/core/i18n/I18nProvider'

type Props = { children: ReactNode }

type State = { hasError: boolean; message: string | null }

function AppErrorFallback({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-zinc-950 px-6 text-center">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/2 top-[28%] size-[min(92vw,440px)] -translate-x-1/2 rounded-full bg-[color-mix(in_oklab,var(--brand-primary)_24%,transparent)] blur-3xl"
          style={{ animation: 'st-breathe 4s ease-in-out infinite' }}
        />
        <div
          className="absolute left-1/2 top-[42%] size-[min(72vw,340px)] -translate-x-1/2 rounded-full bg-[color-mix(in_oklab,var(--brand-secondary)_20%,transparent)] blur-3xl"
          style={{ animation: 'st-breathe 4.6s ease-in-out 0.35s infinite' }}
        />
        <div
          className="absolute left-1/2 top-[54%] size-[min(52vw,260px)] -translate-x-1/2 rounded-full bg-white/[0.06] blur-3xl"
          style={{ animation: 'st-breathe 5.1s ease-in-out 0.7s infinite' }}
        />
      </div>
      <div className="relative z-10 max-w-md space-y-4">
        <p className="text-[10px] font-semibold tracking-[0.45em] text-white/40">{t('app.error.kicker')}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t('app.error.title')}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{t('app.error.body')}</p>
        {message ? (
          <p className="font-mono text-[11px] text-white/35 break-all" dir="ltr">
            {message}
          </p>
        ) : null}
        <Button type="button" size="lg" className="mt-2 w-full max-w-xs" onClick={onRetry}>
          {t('app.error.retry')}
        </Button>
      </div>
    </div>
  )
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? 'unknown_error' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console -- dev-only diagnostics
      console.error('AppErrorBoundary', error, info.componentStack)
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return <AppErrorFallback message={this.state.message} onRetry={this.handleRetry} />
    }
    return this.props.children
  }
}
