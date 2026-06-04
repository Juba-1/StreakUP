/**
 * Saudi mobile: canonical storage E.164 is +9665xxxxxxxx (national display `05xxxxxxxx`).
 *
 * Covers: pasted `+966…`, plain `966…`, duplicated national `96605…→9665…`,
 * optional `00` international trunk, ASCII + Arabic‑Indic digits.
 */

const EASTERN_AR = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'

function latinDigit(ch: string): string {
  const east = EASTERN_AR.indexOf(ch)
  if (east >= 0) return String(east)
  const p = '٠١٢٣٤٥٦٧٨٩'.indexOf(ch)
  if (p >= 0) return String(p)
  return ch
}

function latinizeDigits(raw: string): string {
  if (!/[٠-٩\u0660-\u0669]/.test(raw)) return raw
  return [...raw].map(latinDigit).join('')
}

function digitsOnly(raw: string): string {
  return latinizeDigits(raw.replace(/[\s\u00a0()+.-]/g, '')).replace(/\D/g, '')
}

function strip00(digits: string): string {
  let x = digits
  while (x.startsWith('00')) x = x.slice(2)
  return x
}

/** National mobile subscriber part: nine digits matching `5xxxxxxxx`. */
export function extractSaudiNineDigits(digits: string): string | null {
  const ten = /^05(\d{8})$/.exec(digits.slice(0, 10))
  if (ten) return `5${ten[1]}`
  const naked = /^5(\d{8})$/.exec(digits.slice(0, 9))
  if (naked) return `5${naked[1]}`
  return null
}

/**
 * After country code digits `966`, extract subscriber nine starting with `5`.
 * Accepts erroneous `96605xxxxxxxx` paste (drops one `0`).
 */
export function nationalNineAfterCountry966(rest: string): string | null {
  const trimmed = strip00(rest.trim())
  let nine = extractSaudiNineDigits(trimmed)
  if (nine) return nine

  nine = extractSaudiNineDigits(trimmed.replace(/^0/, ''))
  if (nine) return nine

  return extractSaudiNineDigits(`0${trimmed}`)
}

/**
 * Digit-only string (`966…`, `05…`, or naked `5…`) → E.164.
 */
export function normalizeSaudiDigitsToE164(digits: string): string | null {
  const clean = strip00(digits)
  if (!clean.length) return null

  let tail = clean
  if (tail.startsWith('966')) {
    const nine = nationalNineAfterCountry966(tail.slice(3))
    return nine ? `+966${nine}` : null
  }

  const nine = extractSaudiNineDigits(clean)
  return nine ? `+966${nine}` : null
}

/**
 * Free-form UI input → `+9665xxxxxxxx` or null.
 */
export function normalizeSaudiMobileToE164(raw: string): string | null {
  const s = latinizeDigits(raw.trim())
  if (!s.length) return null

  const d = digitsOnly(s.startsWith('+') ? s.slice(1) : s)
  return normalizeSaudiDigitsToE164(d)
}

/** Coerce live typing toward `05` + 8 digits (10 characters). */
export function constrainSaudiFiveDisplay(rawInput: string): string {
  const canned = normalizeSaudiMobileToE164(rawInput)
  if (canned?.startsWith('+966') && canned.length === 13) return `0${canned.slice(4)}`

  let d = digitsOnly(rawInput)
  if (!d.length) return ''

  d = strip00(d)
  if (d.startsWith('966')) {
    const inner = normalizeSaudiDigitsToE164(d)
    if (inner?.length === 13) return `0${inner.slice(4)}`
    d = d.slice(3)
    d = d.replace(/^0/, '')
  }

  let x = d.slice(0, 10)
  if (!x.startsWith('0')) x = `${x.startsWith('5') ? '0' : '05'}${x}`.replace(/\D/g, '').slice(0, 10)
  if (x.length >= 2 && x[1] !== '5') x = `05${x.slice(2)}`.slice(0, 10)

  return x.slice(0, 10)
}
