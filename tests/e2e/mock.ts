import type { Page, Route } from '@playwright/test'

export type Handler = (body: unknown, url: URL) => unknown | Promise<unknown>

export interface MockOptions {
  /** RPC name → response body (or function of the request body). */
  rpc?: Record<string, unknown | Handler>
  /** Table name → response body for GET /rest/v1/<table>. */
  tables?: Record<string, unknown | Handler>
}

export const USER_ID = '11111111-1111-4111-8111-111111111111'

function fakeJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', exp })}.sig`
}

/** Signs in without a network round trip by writing the session supabase-js stores. */
export async function signedIn(page: Page) {
  const session = {
    access_token: fakeJwt(),
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'x@y.z' },
  }
  await page.addInitScript((value) => {
    window.localStorage.setItem('smart-delivery-auth', JSON.stringify(value))
  }, session)
}

async function respond(route: Route, value: unknown, body: unknown, url: URL) {
  const data = typeof value === 'function' ? await (value as Handler)(body, url) : value
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(data),
  })
}

/** Mocks the Supabase REST API. Unknown RPCs and tables answer 404 so tests fail loudly. */
export async function mockSupabase(page: Page, options: MockOptions = {}) {
  await page.route('http://supabase.test/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      })
    }

    let body: unknown = null
    try {
      body = request.postDataJSON()
    } catch {
      // no JSON body
    }

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/)?.[1]
    if (rpc && options.rpc && rpc in options.rpc) {
      return respond(route, options.rpc[rpc], body, url)
    }
    const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1]
    if (table && options.tables && table in options.tables) {
      return respond(route, options.tables[table], body, url)
    }

    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ message: `Unmocked: ${request.method()} ${url.pathname}` }),
    })
  })
}

export function context(
  accountType: 'admin' | 'owner' | 'shipper',
  shops: { id: string; name: string; order_prefix: string; role: 'owner' | 'shipper' }[] = [],
  profile: Record<string, unknown> = {},
) {
  return {
    profile: {
      id: USER_ID,
      full_name: 'Nguyễn Văn An',
      phone: '0912345678',
      account_type: accountType,
      active: true,
      must_change_password: false,
      ...profile,
    },
    shops,
  }
}
