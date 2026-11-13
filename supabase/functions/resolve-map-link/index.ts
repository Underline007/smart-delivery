// Resolves a shortened Google Maps link (maps.app.goo.gl/…) to the full URL so the
// app can read the coordinates. Browsers cannot follow these redirects because of CORS.
//
// Safety: only signed-in users may call it, only Google hosts are followed
// (so it cannot be used to reach other servers), and redirects are capped.

import { createClient } from '@supabase/supabase-js'

const ALLOWED_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'g.co',
  'www.google.com',
  'google.com',
  'maps.google.com',
  'www.google.com.vn',
  'maps.google.com.vn',
])
const MAX_HOPS = 6

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isAllowed(url: URL): boolean {
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return json({ error: 'Bạn cần đăng nhập' }, 401)

  const body = (await req.json().catch(() => ({}))) as { url?: unknown }
  let current: URL
  try {
    current = new URL(String(body.url ?? ''))
  } catch {
    return json({ error: 'Link không hợp lệ' }, 400)
  }
  if (!isAllowed(current)) return json({ error: 'Chỉ hỗ trợ link Google Maps' }, 400)

  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SmartDelivery/1.0)' },
      })
      const location = res.headers.get('location')
      if (res.status < 300 || res.status >= 400 || !location) break
      const next = new URL(location, current)
      if (!isAllowed(next)) break
      current = next
    }
  } catch {
    return json({ error: 'Không mở được link, thử lại sau' }, 502)
  }

  return json({ url: current.toString() })
})
