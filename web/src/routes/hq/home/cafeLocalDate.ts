/** Format a Date as YYYY-MM-DD in a café timezone (no backend changes). */
export function cafeLocalDateString(timeZone: string, date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  }
}

export function shiftCafeDate(timeZone: string, days: number, from = new Date()): string {
  const shifted = new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
  return cafeLocalDateString(timeZone, shifted)
}

export function greetingPeriod(timeZone: string): 'morning' | 'afternoon' | 'evening' {
  let hour = 12
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date())
    hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 12)
  } catch {
    hour = new Date().getUTCHours()
  }
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}
