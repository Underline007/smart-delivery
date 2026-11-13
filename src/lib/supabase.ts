import { createClient } from '@supabase/supabase-js'
import { env } from './env'

// When the app is not configured yet, a placeholder client is created so that
// imports do not crash; the UI shows the setup screen instead of using it.
export const supabase = createClient(
  env.supabaseUrl ?? 'http://localhost:54321',
  env.supabaseKey ?? 'not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'smart-delivery-auth',
    },
  },
)
