const CURRENCY_LOCALE: Record<string, string> = {
  SAR: 'ar-SA',
  AED: 'ar-AE',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
}

export function formatMoneyFromCents(cents: number, currencyCode: string): string {
  const code = (currencyCode || 'USD').toUpperCase()
  const locale = CURRENCY_LOCALE[code] ?? 'en-US'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(0)} ${code}`
  }
}

export function formatPct(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}
