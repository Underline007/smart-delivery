// Second, independent keep-alive for Supabase, running on Cloudflare Workers (free plan).
// A Cron Trigger calls public.keepalive() so the free project is not paused for inactivity.
//
// Deploy (see docs/SETUP.md, section "Giữ Supabase không bị tạm dừng"):
//   cd workers/keepalive
//   npx wrangler secret put SUPABASE_URL
//   npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
//   npx wrangler deploy
//
// If the call fails the scheduled run throws, which shows up as an error in the
// Cloudflare dashboard (Workers → keepalive → Logs / Metrics).

async function ping(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY secrets are not set')
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/keepalive`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  if (!response.ok) {
    throw new Error(`keepalive() failed: HTTP ${response.status} ${await response.text()}`)
  }
  return response.json()
}

export default {
  // Runs on the cron schedule in wrangler.toml.
  async scheduled(_event, env) {
    const result = await ping(env)
    console.log('keepalive ok', JSON.stringify(result))
  },

  // Opening the worker's URL in a browser runs one ping, handy to test the setup.
  async fetch(_request, env) {
    try {
      return Response.json({ ok: true, heartbeat: await ping(env) })
    } catch (error) {
      return Response.json({ ok: false, error: String(error) }, { status: 502 })
    }
  },
}
