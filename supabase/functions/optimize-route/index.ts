// Optional route optimisation with OpenRouteService (VROOM engine, real roads).
//
// The app always has its own offline optimiser; this function only improves the
// result when an API key is configured:
//   supabase secrets set ORS_API_KEY=...   (free key from openrouteservice.org, no card needed)
//
// Request:  { start: {lat,lng}, stops: [{lat,lng}...], end_mode: "return" | "last" }
// Response: { order: number[], distance_m: number|null, duration_s: number|null }
//   order = indexes into `stops`, in visiting order.
// Errors:   501 when no key is set, 429 when the free quota is used up.

import { createClient } from '@supabase/supabase-js'

const MAX_STOPS = 50
const ORS_URL = 'https://api.openrouteservice.org/optimization'

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

interface Point {
  lat: number
  lng: number
}

function asPoint(value: unknown): Point | null {
  const v = value as Partial<Point> | null
  if (!v || typeof v.lat !== 'number' || typeof v.lng !== 'number') return null
  if (Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) return null
  return { lat: v.lat, lng: v.lng }
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
  const { data: auth, error: authError } = await db.auth.getUser(token)
  if (authError || !auth.user) return json({ error: 'Bạn cần đăng nhập' }, 401)

  // Only shop owners and admins plan trips.
  const { data: profile } = await db
    .from('profiles')
    .select('account_type, active')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (!profile?.active || !['admin', 'owner'].includes(profile.account_type)) {
    return json({ error: 'Không có quyền' }, 403)
  }

  const key = Deno.env.get('ORS_API_KEY')
  if (!key) return json({ error: 'not_configured' }, 501)

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const start = asPoint(body.start)
  const stops = Array.isArray(body.stops) ? body.stops.map(asPoint) : []
  if (!start || stops.length === 0 || stops.some((s) => s === null)) {
    return json({ error: 'Thiếu điểm xuất phát hoặc điểm giao hợp lệ' }, 400)
  }
  if (stops.length > MAX_STOPS) return json({ error: `Tối đa ${MAX_STOPS} điểm giao mỗi chuyến` }, 400)
  const roundTrip = body.end_mode !== 'last'

  const vehicle: Record<string, unknown> = {
    id: 1,
    profile: 'driving-car',
    start: [start.lng, start.lat],
  }
  if (roundTrip) vehicle.end = [start.lng, start.lat]

  const response = await fetch(ORS_URL, {
    method: 'POST',
    headers: { Authorization: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: (stops as Point[]).map((s, i) => ({ id: i, location: [s.lng, s.lat] })),
      vehicles: [vehicle],
    }),
  })

  if (response.status === 429 || response.status === 403) {
    return json({ error: 'Đã hết lượt tối ưu miễn phí hôm nay' }, 429)
  }
  if (!response.ok) return json({ error: 'Dịch vụ tối ưu tuyến báo lỗi' }, 502)

  const result = (await response.json()) as {
    routes?: { steps?: { type: string; id?: number }[]; distance?: number; duration?: number }[]
  }
  const route = result.routes?.[0]
  const order = (route?.steps ?? []).filter((s) => s.type === 'job').map((s) => s.id as number)
  if (order.length !== stops.length) return json({ error: 'Không tối ưu được tuyến này' }, 502)

  return json({
    order,
    distance_m: typeof route?.distance === 'number' ? Math.round(route.distance) : null,
    duration_s: typeof route?.duration === 'number' ? Math.round(route.duration) : null,
  })
})
