// Admin-only account management: create, update, reset password, lock/unlock.
//
// Needs the service role key, so it runs here instead of in the browser.
// The caller must send its own access token (supabase.functions.invoke does)
// and must be an active admin.
//
// Env (set automatically by Supabase unless noted):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   LOGIN_EMAIL_DOMAIN (optional secret, must match VITE_LOGIN_EMAIL_DOMAIN)

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  MIN_PASSWORD_LENGTH,
  normalizeVnMobile,
  phoneToLoginEmail,
} from '../_shared/vn-phone.ts'

const ACCOUNT_TYPES = ['admin', 'owner', 'shipper'] as const
type AccountType = (typeof ACCOUNT_TYPES)[number]

const LOGIN_EMAIL_DOMAIN = Deno.env.get('LOGIN_EMAIL_DOMAIN') ?? 'phone.smart-delivery.invalid'
// About 100 years: Supabase has no "disable user" flag, a long ban does the job.
const LOCK_DURATION = '876000h'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `Thiếu thông tin: ${field}`)
  }
  return value.trim()
}

function requireFullName(value: unknown): string {
  const name = requireString(value, 'họ tên')
  if (name.length > 100) throw new HttpError(400, 'Họ tên tối đa 100 ký tự')
  return name
}

function requirePhone(value: unknown): string {
  const phone = normalizeVnMobile(requireString(value, 'số điện thoại'))
  if (!phone) throw new HttpError(400, 'Số điện thoại di động không hợp lệ')
  return phone
}

function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`)
  }
  return value
}

function requireUuid(value: unknown): string {
  const id = requireString(value, 'user_id')
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'user_id không hợp lệ')
  return id
}

async function requireAdmin(db: SupabaseClient, req: Request): Promise<string> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Bạn cần đăng nhập')

  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn')

  const { data: profile } = await db
    .from('profiles')
    .select('id, account_type, active')
    .eq('id', data.user.id)
    .maybeSingle()
  if (!profile || profile.account_type !== 'admin' || !profile.active) {
    throw new HttpError(403, 'Chỉ admin được quản lý tài khoản')
  }
  return profile.id
}

async function ensurePhoneFree(db: SupabaseClient, phone: string, exceptId?: string) {
  let query = db.from('profiles').select('id').eq('phone', phone)
  if (exceptId) query = query.neq('id', exceptId)
  const { data } = await query.maybeSingle()
  if (data) throw new HttpError(409, 'Số điện thoại này đã có tài khoản')
}

async function getProfile(db: SupabaseClient, userId: string) {
  const { data } = await db
    .from('profiles')
    .select('id, full_name, phone, account_type, active')
    .eq('id', userId)
    .maybeSingle()
  if (!data) throw new HttpError(404, 'Không tìm thấy tài khoản')
  return data
}

async function audit(
  db: SupabaseClient,
  actorId: string,
  action: string,
  targetId: string,
  data: Record<string, unknown> = {},
) {
  await db.from('audit_logs').insert({
    actor_id: actorId,
    action,
    target_type: 'profile',
    target_id: targetId,
    data,
  })
}

async function createAccount(db: SupabaseClient, actorId: string, body: Record<string, unknown>) {
  const fullName = requireFullName(body.full_name)
  const phone = requirePhone(body.phone)
  const password = requirePassword(body.password)
  const accountType = body.account_type as AccountType
  if (!ACCOUNT_TYPES.includes(accountType)) throw new HttpError(400, 'Loại tài khoản không hợp lệ')

  await ensurePhoneFree(db, phone)

  const { data, error } = await db.auth.admin.createUser({
    email: phoneToLoginEmail(phone, LOGIN_EMAIL_DOMAIN),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error || !data.user) {
    throw new HttpError(400, `Không tạo được tài khoản: ${error?.message ?? 'lỗi không rõ'}`)
  }

  const { error: profileError } = await db.from('profiles').insert({
    id: data.user.id,
    full_name: fullName,
    phone,
    account_type: accountType,
    must_change_password: true,
  })
  if (profileError) {
    // Do not leave an auth user without a profile behind.
    await db.auth.admin.deleteUser(data.user.id)
    throw new HttpError(500, `Không tạo được hồ sơ: ${profileError.message}`)
  }

  await audit(db, actorId, 'account.create', data.user.id, { account_type: accountType, phone })
  return { id: data.user.id }
}

async function updateAccount(db: SupabaseClient, actorId: string, body: Record<string, unknown>) {
  const userId = requireUuid(body.user_id)
  const fullName = requireFullName(body.full_name)
  const phone = requirePhone(body.phone)
  const current = await getProfile(db, userId)

  if (phone !== current.phone) {
    await ensurePhoneFree(db, phone, userId)
    const { error } = await db.auth.admin.updateUserById(userId, {
      email: phoneToLoginEmail(phone, LOGIN_EMAIL_DOMAIN),
      email_confirm: true,
    })
    if (error) throw new HttpError(400, `Không đổi được số điện thoại: ${error.message}`)
  }

  const { error } = await db
    .from('profiles')
    .update({ full_name: fullName, phone })
    .eq('id', userId)
  if (error) throw new HttpError(500, `Không lưu được: ${error.message}`)

  await audit(db, actorId, 'account.update', userId, { full_name: fullName, phone })
  return { id: userId }
}

async function resetPassword(db: SupabaseClient, actorId: string, body: Record<string, unknown>) {
  const userId = requireUuid(body.user_id)
  const password = requirePassword(body.password)
  await getProfile(db, userId)

  const { error } = await db.auth.admin.updateUserById(userId, { password })
  if (error) throw new HttpError(400, `Không đặt lại được mật khẩu: ${error.message}`)

  await db.from('profiles').update({ must_change_password: true }).eq('id', userId)
  await audit(db, actorId, 'account.reset_password', userId)
  return { id: userId }
}

async function setActive(db: SupabaseClient, actorId: string, body: Record<string, unknown>) {
  const userId = requireUuid(body.user_id)
  if (typeof body.active !== 'boolean') throw new HttpError(400, 'Thiếu trạng thái khoá/mở')
  const active = body.active
  if (!active && userId === actorId) throw new HttpError(400, 'Không thể tự khoá tài khoản của mình')
  await getProfile(db, userId)

  const { error } = await db.auth.admin.updateUserById(userId, {
    ban_duration: active ? 'none' : LOCK_DURATION,
  })
  if (error) throw new HttpError(400, `Không đổi được trạng thái: ${error.message}`)

  await db.from('profiles').update({ active }).eq('id', userId)
  await audit(db, actorId, active ? 'account.unlock' : 'account.lock', userId)
  return { id: userId }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  try {
    const actorId = await requireAdmin(db, req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    switch (body.action) {
      case 'create':
        return json(await createAccount(db, actorId, body))
      case 'update':
        return json(await updateAccount(db, actorId, body))
      case 'reset_password':
        return json(await resetPassword(db, actorId, body))
      case 'set_active':
        return json(await setActive(db, actorId, body))
      default:
        throw new HttpError(400, 'Hành động không hợp lệ')
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error(error)
    return json({ error: 'Lỗi máy chủ, vui lòng thử lại' }, 500)
  }
})
