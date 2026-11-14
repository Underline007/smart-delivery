export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
  loginEmailDomain:
    (import.meta.env.VITE_LOGIN_EMAIL_DOMAIN as string | undefined) || 'phone.smart-delivery.invalid',
}

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseKey)
