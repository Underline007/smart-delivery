// Shared by the web app (src/lib/vn/phone.ts) and the Edge Functions.
// Keep this file free of browser- or Deno-specific APIs.

/**
 * Normalizes a Vietnamese mobile number to `0xxxxxxxxx`.
 * Accepts spaces, dots, dashes and the +84 / 84 prefix. Returns null when invalid.
 */
export function normalizeVnMobile(input: string | null | undefined): string | null {
  let digits = (input ?? '').replace(/\D/g, '')
  if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`
  return /^0[35789]\d{8}$/.test(digits) ? digits : null
}

/** `0912345678` → `0912 345 678` (other strings are returned unchanged). */
export function formatVnPhone(phone: string): string {
  return /^\d{10}$/.test(phone) ? `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}` : phone
}

/**
 * Accounts sign in with phone + password. Supabase Auth needs an email, so each
 * phone number maps to an internal address that never receives mail.
 */
export function phoneToLoginEmail(phone: string, domain: string): string {
  return `${phone}@${domain}`
}

export const MIN_PASSWORD_LENGTH = 8
