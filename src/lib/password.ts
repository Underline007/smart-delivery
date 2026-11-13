// No 0/O, 1/l/I: temporary passwords are read aloud or typed from a screen.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Readable random password such as `kT7m-q4Xp-Wd`, used as a temporary password. */
export function generateTempPassword(): string {
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`
}
