import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { inject } from 'vitest'

export type Db = pg.Client

export async function connect(url: string): Promise<Db> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  return client
}

const dbNames = new WeakMap<Db, string>()

/** A private database for one test file, cloned from the migrated template. */
export async function createTestDb(): Promise<Db> {
  const adminUrl = inject('adminDbUrl')
  const name = `sd_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const admin = await connect(adminUrl)
  try {
    await admin.query(`create database ${name} template ${inject('templateDb')}`)
  } finally {
    await admin.end()
  }
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const client = await connect(url.toString())
  dbNames.set(client, name)
  return client
}

export async function dropTestDb(db: Db | undefined): Promise<void> {
  if (!db) return
  const name = dbNames.get(db)
  await db.end()
  if (!name) return
  const admin = await connect(inject('adminDbUrl'))
  try {
    await admin.query(`drop database if exists ${name} with (force)`)
  } finally {
    await admin.end()
  }
}

/** Who runs the query: `null` means not signed in (anon). */
export type Actor = string | null

/**
 * Runs `fn` inside a transaction as an API client would: role anon or
 * authenticated, with the JWT "sub" claim set. Commits on success.
 */
export async function as<T>(db: Db, actor: Actor, fn: () => Promise<T>): Promise<T> {
  await db.query('begin')
  try {
    await db.query(`set local role ${actor ? 'authenticated' : 'anon'}`)
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actor ?? ''])
    const result = await fn()
    await db.query('commit')
    return result
  } catch (error) {
    await db.query('rollback')
    throw error
  }
}

/** Calls an RPC as `actor` and returns the rows. */
export async function rpc<T = Record<string, unknown>>(
  db: Db,
  actor: Actor,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T[]> {
  const names = Object.keys(args)
  const params = names.map((name, i) => `${name} => $${i + 1}`).join(', ')
  return as(db, actor, async () => {
    // node-postgres turns JS arrays into Postgres arrays; arrays of objects are JSON.
    const values = Object.values(args).map((v) =>
      Array.isArray(v) && v.some((x) => typeof x === 'object' && x !== null) ? JSON.stringify(v) : v,
    )
    const res = await db.query(`select * from public.${fn}(${params})`, values)
    return res.rows as T[]
  })
}

/** Runs arbitrary SQL as `actor` and returns the rows. */
export async function sql<T = Record<string, unknown>>(
  db: Db,
  actor: Actor,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return as(db, actor, async () => (await db.query(text, values)).rows as T[])
}

/** Creates an auth user + profile directly (what the admin-users function does). */
export async function createAccount(
  db: Db,
  accountType: 'admin' | 'owner' | 'shipper',
  fullName: string,
): Promise<string> {
  const id = randomUUID()
  // Test files share one database, so numbers come from a database sequence.
  await db.query('create sequence if not exists public.test_phone_seq')
  const seq = (await db.query(`select nextval('public.test_phone_seq') as n`)).rows[0].n
  const phone = `09${String(10_000_000 + Number(seq)).slice(-8)}`
  await db.query('insert into auth.users (id, email) values ($1, $2)', [
    id,
    `${phone}@test.invalid`,
  ])
  await db.query(
    `insert into public.profiles (id, full_name, phone, account_type, must_change_password)
     values ($1, $2, $3, $4, false)`,
    [id, fullName, phone, accountType],
  )
  return id
}

/** Expects `promise` to reject with a Postgres error, optionally with a given SQLSTATE. */
export async function expectPgError(
  promise: Promise<unknown>,
  code?: string,
): Promise<pg.DatabaseError> {
  try {
    await promise
  } catch (error) {
    if (!(error instanceof pg.DatabaseError)) throw error
    if (code && error.code !== code) {
      throw new Error(`Expected SQLSTATE ${code}, got ${error.code}: ${error.message}`, {
        cause: error,
      })
    }
    return error
  }
  throw new Error('Expected a database error, but the query succeeded')
}
