import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAccount, createTestDb, dropTestDb, expectPgError, rpc, sql, type Db } from './helpers'

type Context = {
  profile: { id: string; account_type: string; must_change_password: boolean }
  shops: { id: string; name: string; role: string }[]
}

let db: Db
let admin: string
let owner1: string
let owner2: string
let shipperBoth: string
let shipperFree: string
let shop1: string
let shop2: string

async function context(actor: string): Promise<Context | null> {
  const [row] = await rpc<{ my_context: Context | null }>(db, actor, 'my_context')
  return row.my_context
}

beforeAll(async () => {
  db = await createTestDb()

  admin = await createAccount(db, 'admin', 'Quản Trị')
  owner1 = await createAccount(db, 'owner', 'Chủ Shop Một')
  owner2 = await createAccount(db, 'owner', 'Chủ Shop Hai')
  shipperBoth = await createAccount(db, 'shipper', 'Đặng Văn Giao')
  shipperFree = await createAccount(db, 'shipper', 'Lê Thị Nhanh')

  shop1 = (
    await rpc<{ admin_create_shop: string }>(db, admin, 'admin_create_shop', {
      p_name: 'Shop Một',
      p_order_prefix: 'm1',
    })
  )[0].admin_create_shop
  shop2 = (
    await rpc<{ admin_create_shop: string }>(db, admin, 'admin_create_shop', {
      p_name: 'Shop Hai',
      p_order_prefix: 'M2',
    })
  )[0].admin_create_shop

  await rpc(db, admin, 'admin_set_shop_owner', { p_shop_id: shop1, p_user_id: owner1 })
  await rpc(db, admin, 'admin_set_shop_owner', { p_shop_id: shop2, p_user_id: owner2 })
  await rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: shipperBoth })
  await rpc(db, owner2, 'add_shop_shipper', { p_shop_id: shop2, p_user_id: shipperBoth })
})

afterAll(async () => {
  await dropTestDb(db)
})

describe('text helpers', () => {
  it('builds Vietnamese search keys without diacritics', async () => {
    const [authed] = await sql<{ k: string }>(
      db,
      admin,
      `select public.vn_search_key('Đặng Thị Ánh Tuyết') as k`,
    )
    expect(authed.k).toBe('dang thi anh tuyet')
  })

  it('normalizes Vietnamese mobile numbers', async () => {
    const rows = await sql<{ a: string; b: string; c: string | null; d: string | null }>(
      db,
      admin,
      `select public.normalize_vn_mobile('+84 912.345.678') as a,
              public.normalize_vn_mobile('0987-654-321') as b,
              public.normalize_vn_mobile('0212345678') as c,
              public.normalize_vn_mobile('12345') as d`,
    )
    expect(rows[0]).toEqual({ a: '0912345678', b: '0987654321', c: null, d: null })
  })
})

describe('anonymous access', () => {
  it('cannot read any table', async () => {
    for (const table of ['profiles', 'shops', 'shop_members', 'audit_logs', 'system_settings']) {
      await expectPgError(sql(db, null, `select * from public.${table}`), '42501')
    }
  })

  it('cannot call RPCs', async () => {
    await expectPgError(rpc(db, null, 'my_context'), '42501')
    await expectPgError(
      rpc(db, null, 'admin_create_shop', { p_name: 'X', p_order_prefix: 'X' }),
      '42501',
    )
  })
})

describe('keepalive', () => {
  it('can be called without signing in and returns only the time', async () => {
    const [row] = await rpc<{ keepalive: Date }>(db, null, 'keepalive')
    expect(Math.abs(row.keepalive.getTime() - Date.now())).toBeLessThan(60_000)
  })

  it('is the only function anonymous users can call', async () => {
    const rows = await sql<{ proname: string }>(
      db,
      admin,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and has_function_privilege('anon', p.oid, 'execute')`,
    )
    expect(rows.map((r) => r.proname)).toEqual(['keepalive'])
  })

  it('internal helpers and triggers stay out of reach of signed-in users', async () => {
    const rows = await sql<{ proname: string }>(
      db,
      admin,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and (starts_with(p.proname, '_') or starts_with(p.proname, 'tg_'))
         and has_function_privilege('authenticated', p.oid, 'execute')`,
    )
    expect(rows).toEqual([])
  })
})

describe('my_context', () => {
  it('returns the profile and active shops with the role', async () => {
    const ctx = await context(shipperBoth)
    expect(ctx?.profile.account_type).toBe('shipper')
    expect(ctx?.shops.map((s) => [s.name, s.role])).toEqual([
      ['Shop Hai', 'shipper'],
      ['Shop Một', 'shipper'],
    ])
  })

  it('stores the order prefix in upper case', async () => {
    const rows = await sql<{ order_prefix: string }>(
      db,
      admin,
      'select order_prefix from public.shops where id = $1',
      [shop1],
    )
    expect(rows[0].order_prefix).toBe('M1')
  })

  it('clears the must-change-password flag', async () => {
    await db.query('update public.profiles set must_change_password = true where id = $1', [
      owner2,
    ])
    expect((await context(owner2))?.profile.must_change_password).toBe(true)
    await rpc(db, owner2, 'mark_password_changed')
    expect((await context(owner2))?.profile.must_change_password).toBe(false)
  })
})

describe('shop isolation', () => {
  it('owners only see their own shop', async () => {
    const rows = await sql<{ id: string }>(db, owner1, 'select id from public.shops')
    expect(rows.map((r) => r.id)).toEqual([shop1])
  })

  it('owners only see profiles of people in their shop', async () => {
    const rows = await sql<{ id: string }>(db, owner1, 'select id from public.profiles')
    expect(rows.map((r) => r.id).sort()).toEqual([owner1, shipperBoth].sort())
  })

  it('owners only see memberships of their shop', async () => {
    const rows = await sql<{ shop_id: string }>(db, owner1, 'select shop_id from public.shop_members')
    expect(new Set(rows.map((r) => r.shop_id))).toEqual(new Set([shop1]))
  })

  it('owners cannot manage another shop', async () => {
    await expectPgError(rpc(db, owner1, 'list_shop_members', { p_shop_id: shop2 }), '42501')
    await expectPgError(
      rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop2, p_user_id: shipperFree }),
      '42501',
    )
    await expectPgError(
      rpc(db, owner1, 'update_shop_info', {
        p_shop_id: shop2,
        p_name: 'Hacked',
        p_phone: null,
        p_address: null,
      }),
      '42501',
    )
  })

  it('owners cannot use admin functions', async () => {
    await expectPgError(
      rpc(db, owner1, 'admin_create_shop', { p_name: 'X', p_order_prefix: 'XX' }),
      '42501',
    )
    await expectPgError(
      rpc(db, owner1, 'admin_set_shop_owner', { p_shop_id: shop1, p_user_id: owner2 }),
      '42501',
    )
    await expectPgError(rpc(db, owner1, 'admin_list_accounts'), '42501')
    await expectPgError(rpc(db, owner1, 'admin_db_usage'), '42501')
  })

  it('audit logs are scoped to the shop', async () => {
    const rows = await sql<{ shop_id: string }>(db, owner1, 'select shop_id from public.audit_logs')
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((r) => r.shop_id))).toEqual(new Set([shop1]))
  })

  it('a locked shop disappears for its members but not for the admin', async () => {
    await rpc(db, admin, 'admin_update_shop', {
      p_shop_id: shop2,
      p_name: 'Shop Hai',
      p_order_prefix: 'M2',
      p_phone: null,
      p_address: null,
      p_active: false,
    })
    expect(await sql(db, owner2, 'select id from public.shops')).toHaveLength(0)
    expect((await context(shipperBoth))?.shops.map((s) => s.name)).toEqual(['Shop Một'])
    await expectPgError(rpc(db, owner2, 'list_shop_members', { p_shop_id: shop2 }), '42501')
    expect(await sql(db, admin, 'select id from public.shops')).toHaveLength(2)

    await rpc(db, admin, 'admin_update_shop', {
      p_shop_id: shop2,
      p_name: 'Shop Hai',
      p_order_prefix: 'M2',
      p_phone: null,
      p_address: null,
      p_active: true,
    })
    expect((await context(owner2))?.shops).toHaveLength(1)
  })
})

describe('owner picks shippers', () => {
  it('searches the shared pool of shippers only, without diacritics', async () => {
    const all = await rpc<{ id: string; is_member: boolean }>(db, owner1, 'search_shippers', {
      p_shop_id: shop1,
    })
    expect(all.map((r) => r.id).sort()).toEqual([shipperBoth, shipperFree].sort())
    expect(all.find((r) => r.id === shipperBoth)?.is_member).toBe(true)

    const found = await rpc<{ id: string }>(db, owner1, 'search_shippers', {
      p_shop_id: shop1,
      p_query: 'le thi',
    })
    expect(found.map((r) => r.id)).toEqual([shipperFree])
  })

  it('adds and removes a shipper', async () => {
    await rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: shipperFree })
    expect((await context(shipperFree))?.shops.map((s) => s.name)).toEqual(['Shop Một'])

    await rpc(db, owner1, 'remove_shop_shipper', { p_shop_id: shop1, p_user_id: shipperFree })
    expect((await context(shipperFree))?.shops).toEqual([])

    // History is kept as an inactive membership.
    const members = await rpc<{ user_id: string; active: boolean }>(
      db,
      owner1,
      'list_shop_members',
      { p_shop_id: shop1 },
    )
    expect(members.find((m) => m.user_id === shipperFree)?.active).toBe(false)
  })

  it('refuses to add an account that is not a shipper', async () => {
    await expectPgError(
      rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: owner2 }),
      'P0002',
    )
  })

  it('refuses to remove someone who is not a shipper of the shop', async () => {
    await expectPgError(
      rpc(db, owner1, 'remove_shop_shipper', { p_shop_id: shop1, p_user_id: owner1 }),
      'P0002',
    )
  })
})

describe('shipper access', () => {
  it('sees only its own memberships and cannot manage shops', async () => {
    const rows = await sql<{ user_id: string }>(db, shipperBoth, 'select user_id from public.shop_members')
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([shipperBoth]))
    await expectPgError(rpc(db, shipperBoth, 'search_shippers', { p_shop_id: shop1 }), '42501')
    await expectPgError(rpc(db, shipperBoth, 'list_shop_members', { p_shop_id: shop1 }), '42501')
  })

  it('sees only its own profile', async () => {
    const rows = await sql<{ id: string }>(db, shipperBoth, 'select id from public.profiles')
    expect(rows.map((r) => r.id)).toEqual([shipperBoth])
  })
})

describe('direct writes are blocked', () => {
  it('cannot insert memberships directly', async () => {
    await expectPgError(
      sql(
        db,
        owner1,
        `insert into public.shop_members (shop_id, user_id, role) values ($1, $2, 'shipper')`,
        [shop1, shipperFree],
      ),
      '42501',
    )
  })

  it('cannot promote itself to admin', async () => {
    await expectPgError(
      sql(db, owner1, `update public.profiles set account_type = 'admin' where id = $1`, [owner1]),
      '42501',
    )
    const [ctx] = await rpc<{ my_context: Context }>(db, owner1, 'my_context')
    expect(ctx.my_context.profile.account_type).toBe('owner')
  })

  it('cannot call internal helpers', async () => {
    await expectPgError(
      rpc(db, owner1, '_write_audit', {
        p_shop_id: shop1,
        p_action: 'fake',
        p_target_type: null,
        p_target_id: null,
      }),
      '42501',
    )
    await expectPgError(rpc(db, admin, '_apply_grants'), '42501')
  })

  it('cannot create shops directly', async () => {
    await expectPgError(
      sql(db, owner1, `insert into public.shops (name, order_prefix) values ('X', 'ZZ')`),
      '42501',
    )
  })
})

describe('data rules', () => {
  it('rejects a duplicate order prefix with a readable message', async () => {
    const error = await expectPgError(
      rpc(db, admin, 'admin_create_shop', { p_name: 'Trùng', p_order_prefix: 'M1' }),
      '23505',
    )
    expect(error.message).toContain('M1')
  })

  it('rejects a membership whose role does not match the account type', async () => {
    await expectPgError(
      db.query(`insert into public.shop_members (shop_id, user_id, role) values ($1, $2, 'owner')`, [
        shop1,
        shipperFree,
      ]),
      '22023',
    )
  })

  it('only lets an owner account become a shop owner', async () => {
    await expectPgError(
      rpc(db, admin, 'admin_set_shop_owner', { p_shop_id: shop1, p_user_id: shipperFree }),
      '22023',
    )
  })

  it('lists accounts for the admin with search and shops', async () => {
    const rows = await rpc<{ id: string; shops: { name: string }[] }>(
      db,
      admin,
      'admin_list_accounts',
      { p_account_type: 'shipper', p_query: 'dang van' },
    )
    expect(rows.map((r) => r.id)).toEqual([shipperBoth])
    expect(rows[0].shops.map((s) => s.name).sort()).toEqual(['Shop Hai', 'Shop Một'])
  })

  it('reports the database size to the admin', async () => {
    const [row] = await rpc<{ admin_db_usage: string }>(db, admin, 'admin_db_usage')
    expect(Number(row.admin_db_usage)).toBeGreaterThan(1_000_000)
  })

  it('lists shops for the admin with owners and shipper count', async () => {
    const rows = await rpc<{ id: string; owners: { id: string }[]; shipper_count: string }>(
      db,
      admin,
      'admin_list_shops',
    )
    const one = rows.find((r) => r.id === shop1)
    expect(one?.owners.map((o) => o.id)).toEqual([owner1])
    expect(Number(one?.shipper_count)).toBe(1)
  })
})
