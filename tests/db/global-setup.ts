import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'
import type { TestProject } from 'vitest/node'

const TEMPLATE_DB = 'smart_delivery_template'

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string of a maintenance database (used to create/drop per-file databases). */
    adminDbUrl: string
    /** Database holding the shim and all migrations; per-file databases are cloned from it. */
    templateDb: string
  }
}

/**
 * Creates a fresh database, loads the Supabase shim, then applies every
 * migration in supabase/migrations in order.
 *
 * DATABASE_URL must point to a Postgres server where the user can create
 * databases, e.g. postgres://postgres:postgres@localhost:5432/postgres
 */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.DATABASE_URL
  if (!adminUrl) {
    throw new Error(
      'DATABASE_URL is not set. Example: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db',
    )
  }

  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  await admin.query(`drop database if exists ${TEMPLATE_DB} with (force)`)
  await admin.query(`create database ${TEMPLATE_DB}`)
  await admin.end()

  const url = new URL(adminUrl)
  url.pathname = `/${TEMPLATE_DB}`
  const testDbUrl = url.toString()

  const db = new pg.Client({ connectionString: testDbUrl })
  await db.connect()
  try {
    const root = join(import.meta.dirname, '..', '..', 'supabase')
    await db.query(await readFile(join(root, 'tests', 'shim.sql'), 'utf8'))
    const migrations = (await readdir(join(root, 'migrations')))
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const file of migrations) {
      try {
        await db.query(await readFile(join(root, 'migrations', file), 'utf8'))
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error })
      }
    }
  } finally {
    await db.end()
  }

  project.provide('adminDbUrl', adminUrl)
  project.provide('templateDb', TEMPLATE_DB)
}
