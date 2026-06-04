import { useEffect } from 'react'

import type { LocaleCode } from '@/core/i18n/types'

export function useDocumentDirection(locale: LocaleCode) {
  useEffect(() => {
    const dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale])
}
