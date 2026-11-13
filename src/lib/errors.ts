import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'

const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, 'Sai số điện thoại hoặc mật khẩu'],
  [/user is banned/i, 'Tài khoản đã bị khoá. Liên hệ admin.'],
  [/should be different from the old password/i, 'Mật khẩu mới phải khác mật khẩu cũ'],
  [/password should be at least/i, 'Mật khẩu quá ngắn'],
  [/weak password/i, 'Mật khẩu quá yếu, hãy chọn mật khẩu khác'],
  [/jwt expired|invalid jwt|refresh token/i, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại'],
  [/failed to fetch|networkerror|load failed/i, 'Không có kết nối mạng, vui lòng thử lại'],
  [/rate limit/i, 'Thao tác quá nhanh, vui lòng thử lại sau ít phút'],
]

/** Turns any error from Supabase (auth, PostgREST, functions) into a Vietnamese message. */
export async function toMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string }
      if (body?.error) return body.error
    } catch {
      // fall through
    }
    return 'Máy chủ báo lỗi, vui lòng thử lại'
  }
  if (error instanceof FunctionsFetchError) return 'Không có kết nối mạng, vui lòng thử lại'

  const { message, code } = (error ?? {}) as { message?: string; code?: string }
  if (!message) return 'Đã có lỗi xảy ra'

  for (const [pattern, text] of AUTH_MESSAGES) {
    if (pattern.test(message)) return text
  }
  if (code === '42501' && /permission denied/i.test(message)) {
    return 'Bạn không có quyền thực hiện thao tác này'
  }
  return message
}

/** Throws the Supabase error (if any) so React Query can handle it, otherwise returns data. */
export function unwrap<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error
  return result.data
}
