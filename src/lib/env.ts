export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
  loginEmailDomain:
    (import.meta.env.VITE_LOGIN_EMAIL_DOMAIN as string | undefined) || 'phone.smart-delivery.invalid',
  mapProvider: ((import.meta.env.VITE_MAP_PROVIDER as string | undefined) || 'osm') as
    | 'osm'
    | 'google',
}

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseKey)
