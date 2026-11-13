#!/usr/bin/env node
// Creates the very first admin account (later accounts are created in the app).
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/create-admin.mjs --phone 0912345678 --name "Nguyễn Văn A"
//
// Optional: LOGIN_EMAIL_DOMAIN (must match VITE_LOGIN_EMAIL_DOMAIN).
// A random temporary password is printed; it must be changed at first sign-in.

import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const { values } = parseArgs({
  options: { phone: { type: 'string' }, name: { type: 'string' } },
})

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const domain = process.env.LOGIN_EMAIL_DOMAIN ?? 'phone.smart-delivery.invalid'

function normalizeVnMobile(input) {
  let digits = (input ?? '').replace(/\D/g, '')
  if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`
  return /^0[35789]\d{8}$/.test(digits) ? digits : null
}

const phone = normalizeVnMobile(values.phone)
const fullName = values.name?.trim()

if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.')
  process.exit(1)
}
if (!phone || !fullName) {
  console.error('Usage: node scripts/create-admin.mjs --phone 0912345678 --name "Họ tên"')
  process.exit(1)
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const password = randomBytes(9).toString('base64url')

const { data, error } = await db.auth.admin.createUser({
  email: `${phone}@${domain}`,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
})
if (error || !data.user) {
  console.error(`Could not create the auth user: ${error?.message}`)
  process.exit(1)
}

const { error: profileError } = await db.from('profiles').insert({
  id: data.user.id,
  full_name: fullName,
  phone,
  account_type: 'admin',
  must_change_password: true,
})
if (profileError) {
  await db.auth.admin.deleteUser(data.user.id)
  console.error(`Could not create the profile: ${profileError.message}`)
  process.exit(1)
}

console.log('Admin account created.')
console.log(`  Phone:              ${phone}`)
console.log(`  Temporary password: ${password}`)
console.log('Sign in with these, then choose a new password.')
