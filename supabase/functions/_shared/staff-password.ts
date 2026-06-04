const HUMAN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function humanStaffPassword(prefix = 'Branch'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += HUMAN_ALPHABET[bytes[i]! % HUMAN_ALPHABET.length]!
  }
  return `${prefix}_${suffix}`
}

export function isDuplicateAuthEmailError(message: string | undefined): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes('already been registered') ||
    m.includes('already registered') ||
    m.includes('duplicate') ||
    m.includes('user already exists')
  )
}
