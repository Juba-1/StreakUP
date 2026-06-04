import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Toaster } from 'sonner'

import App from './App.tsx'
import { AppErrorBoundary } from '@/components/system/AppErrorBoundary'
import { I18nProvider } from '@/core/i18n/I18nProvider'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { QueryProvider } from '@/providers/QueryProvider'
import './index.css'

if (import.meta.env.PROD) {
  const noop = () => {}
  console.log = noop
  console.debug = noop
  console.info = noop
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { type: 'classic', scope: '/' }).catch(() => {
      /* non-fatal */
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <I18nProvider>
        <AuthProvider>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
          <Toaster richColors theme="dark" position="top-center" />
        </AuthProvider>
      </I18nProvider>
    </QueryProvider>
  </StrictMode>,
)
