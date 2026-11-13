import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAccount, createTestDb, dropTestDb, expectPgError, rpc, sql, type Db } from './helpers'

interface Address {
  id: string
  detail: string
  full_text: string
  is_default: boolean
  province_code: string | null
  ward_code: string | null
  lat: number | null
}

let db: Db
let admin: string
let owner1: string
let owner2: string
let shipper: string
let shop1: string
let shop2: string

async function saveCustomer(actor: string, shop: string, customer: Record<string, unknown>) {
  const [row] = await rpc<{ save_customer: string }>(db, actor, 'save_customer', {
    p_shop_id: shop,
    p_customer: customer,
  })
  return row.save_customer
}

async function saveAddress(
  actor: string,
  shop: string,
  customer: string,
  address: Record<string, unknown>,
) {
  const [row] = await rpc<{ save_customer_address: string }>(db, actor, 'save_customer_address', {
    p_shop_id: shop,
    p_customer_id: customer,
    p_address: address,
  })
  return row.save_customer_address
}

async function addresses(actor: string, customer: string) {
  return sql<Address>(
    db,
    actor,
    'select * from public.customer_addresses where customer_id = $1 order by created_at',
    [customer],
  )
}

beforeAll(async () => {
  db = await createTestDb()
  admin = await createAccount(db, 'admin', 'Quản Trị M2')
  owner1 = await createAccount(db, 'owner', 'Chủ Một M2')
  owner2 = await createAccount(db, 'owner', 'Chủ Hai M2')
  shipper = await createAccount(db, 'shipper', 'Shipper M2')

  const mk = async (name: string, prefix: string, owner: string) => {
    const [row] = await rpc<{ admin_create_shop: string }>(db, admin, 'admin_create_shop', {
      p_name: name,
      p_order_prefix: prefix,
    })
    await rpc(db, admin, 'admin_set_shop_owner', { p_shop_id: row.admin_create_shop, p_user_id: owner })
    return row.admin_create_shop
  }
  shop1 = await mk('Shop M2-A', 'CA', owner1)
  shop2 = await mk('Shop M2-B', 'CB', owner2)
  await rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: shipper })

  // A tiny ward catalogue for the tests.
  await rpc(db, admin, 'admin_upsert_wards', {
    p_rows: [
      { code: '26734', province_code: '79', name: 'Phường Bến Thành' },
      { code: '26737', province_code: '79', name: 'Phường Sài Gòn' },
      { code: '00001', province_code: '01', name: 'Phường Hoàn Kiếm' },
    ],
  })
})

afterAll(async () => {
  await dropTestDb(db)
})

describe('catalogue', () => {
  it('seeds the 34 provinces and old-name aliases', async () => {
    const provinces = await sql<{ n: string }>(db, owner1, 'select count(*) as n from public.provinces')
    expect(Number(provinces[0].n)).toBe(34)
    const alias = await sql<{ province_code: string }>(
      db,
      owner1,
      `select province_code from public.province_aliases where alias_search = 'binh duong'`,
    )
    expect(alias[0].province_code).toBe('79')
  })

  it('every alias points to an existing province', async () => {
    const rows = await sql(
      db,
      owner1,
      `select 1 from public.province_aliases a
       where not exists (select 1 from public.provinces p where p.code = a.province_code)`,
    )
    expect(rows).toHaveLength(0)
  })

  it('computes search keys without prefixes', async () => {
    const [w] = await sql<{ name_search: string; short_search: string }>(
      db,
      owner1,
      `select name_search, short_search from public.wards where code = '26734'`,
    )
    expect(w).toEqual({ name_search: 'phuong ben thanh', short_search: 'ben thanh' })
  })

  it('only the admin can change it', async () => {
    await expectPgError(
      rpc(db, owner1, 'admin_upsert_wards', { p_rows: [{ code: 'x', province_code: '79', name: 'X' }] }),
      '42501',
    )
    await expectPgError(
      sql(db, owner1, `insert into public.wards (code, province_code, name) values ('z', '79', 'Z')`),
      '42501',
    )
    await expectPgError(
      rpc(db, admin, 'admin_upsert_wards', { p_rows: [{ code: 'x', province_code: 'nope', name: 'X' }] }),
      '22023',
    )
  })

  it('upserts wards and aliases', async () => {
    await rpc(db, admin, 'admin_upsert_wards', {
      p_rows: [{ code: '26734', province_code: '79', name: 'Phường Bến Thành (mới)' }],
    })
    const [w] = await sql<{ name: string }>(db, owner1, `select name from public.wards where code = '26734'`)
    expect(w.name).toBe('Phường Bến Thành (mới)')
    await rpc(db, admin, 'admin_upsert_wards', {
      p_rows: [{ code: '26734', province_code: '79', name: 'Phường Bến Thành' }],
    })

    const [n] = await rpc<{ admin_upsert_aliases: number }>(db, admin, 'admin_upsert_aliases', {
      p_rows: [
        { alias: 'Quận 1', ward_code: '26734' },
        { alias: 'Thủ Dầu Một', province_code: '79' },
      ],
    })
    expect(n.admin_upsert_aliases).toBe(2)
  })
})

describe('save_customer', () => {
  it('normalizes the phone number and stores tags', async () => {
    const id = await saveCustomer(owner1, shop1, {
      name: ' Nguyễn Thị Lan ',
      phone: '+84 912.345.678',
      tags: ['VIP', 'VIP', ' ', 'Khách sỉ'],
      note: 'Hay đặt sáng',
    })
    const [c] = await sql<{ name: string; phone: string; tags: string[] }>(
      db,
      owner1,
      'select name, phone, tags from public.customers where id = $1',
      [id],
    )
    expect(c.name).toBe('Nguyễn Thị Lan')
    expect(c.phone).toBe('0912345678')
    expect([...c.tags].sort()).toEqual(['Khách sỉ', 'VIP'])
  })

  it('rejects an invalid phone or an empty name', async () => {
    await expectPgError(saveCustomer(owner1, shop1, { name: 'A', phone: '12345' }), '22023')
    await expectPgError(saveCustomer(owner1, shop1, { name: '  ', phone: '0987654321' }), '22023')
    await expectPgError(
      saveCustomer(owner1, shop1, { name: 'A', phone: '0987654321', phone2: 'abc' }),
      '22023',
    )
  })

  it('points to the existing customer when the phone is taken', async () => {
    const error = await expectPgError(
      saveCustomer(owner1, shop1, { name: 'Trùng', phone: '0912 345 678' }),
      '23505',
    )
    expect(error.message).toContain('Nguyễn Thị Lan')
    expect(error.hint).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('allows the same phone in another shop', async () => {
    await saveCustomer(owner2, shop2, { name: 'Khách shop 2', phone: '0912345678' })
  })

  it('updates a customer without tripping on its own phone', async () => {
    const id = await saveCustomer(owner1, shop1, { name: 'Cập Nhật', phone: '0933000111' })
    await saveCustomer(owner1, shop1, { id, name: 'Cập Nhật 2', phone: '0933000111' })
    const [c] = await sql<{ name: string }>(db, owner1, 'select name from public.customers where id = $1', [id])
    expect(c.name).toBe('Cập Nhật 2')
  })
})

describe('addresses', () => {
  let customer: string

  beforeAll(async () => {
    customer = await saveCustomer(owner1, shop1, { name: 'Có Địa Chỉ', phone: '0944000222' })
  })

  it('builds the full text and makes the first address the default', async () => {
    const id = await saveAddress(owner1, shop1, customer, {
      detail: '12 Lê Lợi',
      province_code: '79',
      ward_code: '26734',
      lat: 10.77,
      lng: 106.69,
      geo_source: 'link',
    })
    const [a] = await addresses(owner1, customer)
    expect(a.id).toBe(id)
    expect(a.full_text).toBe('12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh')
    expect(a.is_default).toBe(true)
    expect(a.lat).toBeCloseTo(10.77)
  })

  it('falls back to free-text ward when the catalogue has none', async () => {
    const id = await saveAddress(owner1, shop1, customer, {
      detail: '5 Trần Phú',
      province_code: '48',
      ward_text: 'Phường Hải Châu',
    })
    const row = (await addresses(owner1, customer)).find((a) => a.id === id)!
    expect(row.full_text).toBe('5 Trần Phú, Phường Hải Châu, Đà Nẵng')
    expect(row.is_default).toBe(false)
  })

  it('moves the default flag when another address becomes default', async () => {
    const id = await saveAddress(owner1, shop1, customer, {
      detail: '99 Nguyễn Huệ',
      province_code: '79',
      is_default: true,
    })
    const rows = await addresses(owner1, customer)
    expect(rows.filter((a) => a.is_default).map((a) => a.id)).toEqual([id])
  })

  it('promotes another address when the default one is deleted', async () => {
    const before = await addresses(owner1, customer)
    const def = before.find((a) => a.is_default)!
    await rpc(db, owner1, 'delete_customer_address', { p_shop_id: shop1, p_address_id: def.id })
    const after = await addresses(owner1, customer)
    expect(after).toHaveLength(before.length - 1)
    expect(after.filter((a) => a.is_default)).toHaveLength(1)
  })

  it('validates input', async () => {
    await expectPgError(saveAddress(owner1, shop1, customer, { detail: '  ', province_code: '79' }), '22023')
    await expectPgError(saveAddress(owner1, shop1, customer, { detail: 'x', province_code: 'zz' }), '22023')
    await expectPgError(
      saveAddress(owner1, shop1, customer, { detail: 'x', province_code: '01', ward_code: '26734' }),
      '22023',
    )
    await expectPgError(
      saveAddress(owner1, shop1, customer, { detail: 'x', province_code: '79', lat: 10.7 }),
      '22023',
    )
  })
})

describe('isolation', () => {
  let customer1: string

  beforeAll(async () => {
    customer1 = await saveCustomer(owner1, shop1, { name: 'Khách Riêng', phone: '0955000333' })
    await saveAddress(owner1, shop1, customer1, { detail: '1 Riêng', province_code: '79' })
  })

  it('owner 2 cannot read shop 1 customers or addresses', async () => {
    expect(await sql(db, owner2, 'select 1 from public.customers where shop_id = $1', [shop1])).toEqual([])
    expect(
      await sql(db, owner2, 'select 1 from public.customer_addresses where shop_id = $1', [shop1]),
    ).toEqual([])
  })

  it('owner 2 cannot write into shop 1', async () => {
    await expectPgError(saveCustomer(owner2, shop1, { name: 'X', phone: '0966000444' }), '42501')
    await expectPgError(saveAddress(owner2, shop1, customer1, { detail: 'x', province_code: '79' }), '42501')
    // Passing own shop but another shop's customer must not work either.
    await expectPgError(saveAddress(owner2, shop2, customer1, { detail: 'x', province_code: '79' }), 'P0002')
    await expectPgError(
      saveCustomer(owner2, shop2, { id: customer1, name: 'Hack', phone: '0966000444' }),
      'P0002',
    )
  })

  it('shippers cannot read customers', async () => {
    expect(await sql(db, shipper, 'select 1 from public.customers')).toEqual([])
    expect(await sql(db, shipper, 'select 1 from public.customer_addresses')).toEqual([])
  })

  it('the catalogue is readable by everyone signed in but not by anon', async () => {
    expect((await sql(db, shipper, 'select 1 from public.provinces')).length).toBe(34)
    await expectPgError(sql(db, null, 'select 1 from public.provinces'), '42501')
  })

  it('blocks direct writes', async () => {
    await expectPgError(
      sql(db, owner1, `update public.customers set name = 'x' where id = $1`, [customer1]),
      '42501',
    )
    await expectPgError(
      sql(db, owner1, `delete from public.customer_addresses where customer_id = $1`, [customer1]),
      '42501',
    )
  })
})
