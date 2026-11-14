#!/usr/bin/env node
// Deletes delivery proof photos older than N days (default 30) from Storage and
// clears their path in delivery_stops, so the free 1 GB of file storage lasts.
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-proofs.mjs [days]
//
// Runs daily from .github/workflows/cleanup.yml.

import { createClient } from '@supabase/supabase-js'

const days = Number(process.argv[2] ?? 30)
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!Number.isFinite(days) || days < 1) {
  console.error('Days must be a number of at least 1.')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
const BATCH = 200

let removed = 0
for (;;) {
  const { data, error } = await db
    .from('delivery_stops')
    .select('id, proof_photo_path')
    .not('proof_photo_path', 'is', null)
    .lt('done_at', cutoff)
    .limit(BATCH)
  if (error) {
    console.error(`Could not list photos: ${error.message}`)
    process.exit(1)
  }
  if (!data || data.length === 0) break

  const paths = data.map((row) => row.proof_photo_path)
  const { error: removeError } = await db.storage.from('delivery-proofs').remove(paths)
  if (removeError) {
    console.error(`Could not delete files: ${removeError.message}`)
    process.exit(1)
  }
  const { error: updateError } = await db
    .from('delivery_stops')
    .update({ proof_photo_path: null })
    .in('id', data.map((row) => row.id))
  if (updateError) {
    console.error(`Could not update stops: ${updateError.message}`)
    process.exit(1)
  }
  removed += data.length
  if (data.length < BATCH) break
}

console.log(`Deleted ${removed} photo(s) older than ${days} days.`)
