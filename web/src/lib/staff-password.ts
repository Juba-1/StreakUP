const HUMAN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Short, human-typable staff password (e.g. Branch_4k9P). */
export function generateHumanStaffPassword(prefix = 'Branch'): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  let suffix = ''
  for (let i = 0; i < 4; i++) {
    suffix += HUMAN_ALPHABET[bytes[i]! % HUMAN_ALPHABET.length]!
  }
  return `${prefix}_${suffix}`
}
