import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import ar from './messages/ar.json'
import en from './messages/en.json'
import type { LocaleCode, Messages } from './types'
import { supabaseBrowserClient } from '@/lib/supabase/browser-client'

type SetLocaleOptions = { userPicked?: boolean }

type I18nContextValue = {
  locale: LocaleCode
  setLocale: (next: LocaleCode, opts?: SetLocaleOptions) => void
  t: (key: string) => string
}

const STORAGE_KEY = 'streakup.locale'
const USER_LOCKED_KEY = 'streakup.locale.userLocked'

const catalogs: Record<LocaleCode, Messages> = {
  en: en as Messages,
  ar: ar as Messages,
}

const I18nContext = createContext<I18nContextValue | null>(null)

function readStoredLocale(): LocaleCode | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === 'ar' || raw === 'en') return raw
  return null
}

function parsePlatformLocale(raw: unknown): LocaleCode {
  if (raw === 'ar' || raw === 'en') return raw
  if (typeof raw === 'string') {
    const stripped = raw.replace(/^"|"$/g, '')
    if (stripped === 'ar' || stripped === 'en') return stripped
  }
  return 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => readStoredLocale() ?? 'en')

  useEffect(() => {
    if (readStoredLocale()) return
    if (typeof window !== 'undefined' && localStorage.getItem(USER_LOCKED_KEY) === '1') return
    if (!supabaseBrowserClient) return

    void (async () => {
      const { data, error } = await supabaseBrowserClient
        .from('platform_public_config')
        .select('value')
        .eq('key', 'default_locale')
        .maybeSingle()
      if (error) return
      const next = parsePlatformLocale(data?.value)
      setLocaleState((cur) => {
        if (readStoredLocale()) return cur
        if (typeof window !== 'undefined' && localStorage.getItem(USER_LOCKED_KEY) === '1') return cur
        return next
      })
    })()
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale)
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
  }, [locale])

  const setLocale = useCallback((next: LocaleCode, opts?: SetLocaleOptions) => {
    if (opts?.userPicked && typeof window !== 'undefined') {
      localStorage.setItem(USER_LOCKED_KEY, '1')
    }
    setLocaleState(next)
  }, [])

  const t = useCallback(
    (key: string) => {
      const table = catalogs[locale] ?? catalogs.en
      return table[key] ?? catalogs.en[key] ?? key
    },
    [locale],
  )

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return ctx
}
