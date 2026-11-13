// Single source of truth shared with the Edge Functions.
export {
  formatVnPhone,
  MIN_PASSWORD_LENGTH,
  normalizeVnMobile,
  phoneToLoginEmail,
} from '../../../supabase/functions/_shared/vn-phone.ts'

/** Link that opens a chat with this number in Zalo. */
export function zaloLink(phone: string): string {
  return `https://zalo.me/${phone}`
}
