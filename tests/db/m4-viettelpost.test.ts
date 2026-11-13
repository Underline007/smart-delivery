import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAccount, createTestDb, dropTestDb, expectPgError, rpc, sql, type Db } from './helpers'

let db: Db
let admin: string
let owner1: string
let owner2: string
let shipper: string
let shop1: string
let shop2: string
let variant: string

const SHIP = { name: 'Nguyễn Thị Lan', phone: '0912345678', detail: '12 Lê Lợi', province_code: '79' }

async function order(method: 'vtp' | 'self' | 'pickup', confirm = true, shop = shop1, actor = owner1) {
  const [row] = await rpc<{ save_order: string }>(db, actor, 'save_order', {
    p_shop_id: shop,
    p_order: {
      delivery_method: method,
      confirm,
      ship: SHIP,
      items: [{ variant_id: variant, qty: 1 }],
    },
  })
  return row.save_order
}

async function status(id: string) {
  return (await db.query('select status, vtp_batch_id, vtp_tracking_code, code from public.orders where id = $1', [id])).rows[0] as {
    status: string
    vtp_batch_id: string | null
    vtp_tracking_code: string | null
    code: string
  }
}

async function batch(actor: string, shop: string, ids: string[], name = 'VTP_test.xlsx') {
  const [row] = await rpc<{ create_vtp_batch: string }>(db, actor, 'create_vtp_batch', {
    p_shop_id: shop,
    p_order_ids: ids,
    p_file_name: name,
    p_template_version: 'v1',
  })
  return row.create_vtp_batch
}

beforeAll(async () => {
  db = await createTestDb()
  admin = await createAccount(db, 'admin', 'Quản Trị M4')
  owner1 = await createAccount(db, 'owner', 'Chủ Một M4')
  owner2 = await createAccount(db, 'owner', 'Chủ Hai M4')
  shipper = await createAccount(db, 'shipper', 'Shipper M4')
  const mk = async (name: string, prefix: string, owner: string) => {
    const [row] = await rpc<{ admin_create_shop: string }>(db, admin, 'admin_create_shop', { p_name: name, p_order_prefix: prefix })
    await rpc(db, admin, 'admin_set_shop_owner', { p_shop_id: row.admin_create_shop, p_user_id: owner })
    return row.admin_create_shop
  }
  shop1 = await mk('Shop M4-A', 'VA', owner1)
  shop2 = await mk('Shop M4-B', 'VB', owner2)
  await rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: shipper })

  const [saved] = await rpc<{ save_product: string }>(db, owner1, 'save_product', {
    p_shop_id: shop1,
    p_product: { name: 'Áo', option_names: [], variants: [{ sku: 'A1', option_values: [], price: 100000, cost: 50000, weight_g: 200 }] },
  })
  const [list] = await rpc<{ list_products: { id: string; variants: { id: string }[] }[] }>(db, owner1, 'list_products', { p_shop_id: shop1 })
  variant = list.list_products.find((p) => p.id === saved.save_product)!.variants[0].id
  await rpc(db, owner1, 'receive_stock', { p_shop_id: shop1, p_payload: { items: [{ variant_id: variant, qty: 100, unit_cost: 50000 }] } })
})

afterAll(async () => {
  await dropTestDb(db)
})

describe('template', () => {
  const mapping = { sheet: null, headerRow: 1, firstDataRow: 2, columns: [{ col: 'A', field: 'receiver_name' }] }

  it('only the admin can save it, and it is readable by shop owners', async () => {
    await expectPgError(rpc(db, owner1, 'admin_save_vtp_template', { p_name: 'x', p_b64: 'AAAA', p_mapping: mapping }), '42501')
    const [row] = await rpc<{ admin_save_vtp_template: string }>(db, admin, 'admin_save_vtp_template', {
      p_name: 'mau.xlsx',
      p_b64: 'AAAA',
      p_mapping: mapping,
    })
    expect(row.admin_save_vtp_template).toMatch(/^\d{14}$/)
    const [s] = await sql<{ vtp_template_name: string; vtp_template_b64: string }>(
      db,
      owner1,
      'select vtp_template_name, vtp_template_b64 from public.system_settings',
    )
    expect(s).toEqual({ vtp_template_name: 'mau.xlsx', vtp_template_b64: 'AAAA' })
  })

  it('rejects an invalid mapping and an oversized file', async () => {
    await expectPgError(rpc(db, admin, 'admin_save_vtp_template', { p_name: 'x', p_b64: null, p_mapping: { columns: 'no' } }), '22023')
    await expectPgError(
      rpc(db, admin, 'admin_save_vtp_template', { p_name: 'x', p_b64: 'A'.repeat(3_000_001), p_mapping: mapping }),
      '22023',
    )
  })

  it('clearing the template resets the version', async () => {
    await rpc(db, admin, 'admin_save_vtp_template', { p_name: null, p_b64: null, p_mapping: null })
    const [s] = await sql<{ vtp_template_version: string | null }>(db, admin, 'select vtp_template_version from public.system_settings')
    expect(s.vtp_template_version).toBeNull()
  })
})

describe('export batches', () => {
  it('moves the orders to "exported" and records the batch', async () => {
    const a = await order('vtp')
    const b = await order('vtp')
    const id = await batch(owner1, shop1, [a, b], 'VTP_20261113_2don.xlsx')

    for (const o of [a, b]) {
      const s = await status(o)
      expect(s.status).toBe('vtp_exported')
      expect(s.vtp_batch_id).toBe(id)
    }
    const [row] = await sql<{ order_count: number; file_name: string; template_version: string }>(
      db,
      owner1,
      'select order_count, file_name, template_version from public.vtp_export_batches where id = $1',
      [id],
    )
    expect(row).toEqual({ order_count: 2, file_name: 'VTP_20261113_2don.xlsx', template_version: 'v1' })
    const events = await db.query(`select note from public.order_events where order_id = $1 and to_status = 'vtp_exported'`, [a])
    expect(events.rows[0].note).toContain('VTP_20261113_2don.xlsx')
  })

  it('refuses to export an order twice, naming the earlier file', async () => {
    const a = await order('vtp')
    await batch(owner1, shop1, [a], 'first.xlsx')
    const error = await expectPgError(batch(owner1, shop1, [a], 'second.xlsx'), '55000')
    expect(error.message).toContain('first.xlsx')
  })

  it('is all-or-nothing: one bad order stops the whole batch', async () => {
    const good = await order('vtp')
    const bad = await order('self')
    await expectPgError(batch(owner1, shop1, [good, bad]), '55000')
    expect((await status(good)).status).toBe('confirmed')
    expect((await status(good)).vtp_batch_id).toBeNull()
    const draft = await order('vtp', false)
    await expectPgError(batch(owner1, shop1, [good, draft]), '55000')
    expect((await status(good)).status).toBe('confirmed')
  })

  it('validates the input', async () => {
    await expectPgError(batch(owner1, shop1, []), '22023')
  })

  it('cancelling the batch puts the orders back to confirmed', async () => {
    const a = await order('vtp')
    const b = await order('vtp')
    const id = await batch(owner1, shop1, [a, b])
    const [row] = await rpc<{ cancel_vtp_batch: number }>(db, owner1, 'cancel_vtp_batch', { p_shop_id: shop1, p_batch_id: id })
    expect(row.cancel_vtp_batch).toBe(2)
    for (const o of [a, b]) {
      const s = await status(o)
      expect(s.status).toBe('confirmed')
      expect(s.vtp_batch_id).toBeNull()
    }
    // …and they can be exported again.
    await batch(owner1, shop1, [a, b], 'again.xlsx')
  })

  it('orders that already got a tracking code are not pulled back', async () => {
    const a = await order('vtp')
    const b = await order('vtp')
    const id = await batch(owner1, shop1, [a, b])
    await rpc(db, owner1, 'apply_vtp_tracking', { p_shop_id: shop1, p_rows: [{ order_code: (await status(a)).code, tracking_code: 'VTP111' }] })
    const [row] = await rpc<{ cancel_vtp_batch: number }>(db, owner1, 'cancel_vtp_batch', { p_shop_id: shop1, p_batch_id: id })
    expect(row.cancel_vtp_batch).toBe(1)
    expect((await status(a)).status).toBe('shipping')
    expect((await status(b)).status).toBe('confirmed')
  })
})

describe('tracking codes', () => {
  it('stores the code and starts shipping, matching the order code in any case', async () => {
    const a = await order('vtp')
    await batch(owner1, shop1, [a])
    const code = (await status(a)).code
    const [row] = await rpc<{ apply_vtp_tracking: { applied: number; skipped: unknown[] } }>(db, owner1, 'apply_vtp_tracking', {
      p_shop_id: shop1,
      p_rows: [{ order_code: ` ${code.toLowerCase()} `, tracking_code: ' VTP999 ' }],
    })
    expect(row.apply_vtp_tracking).toEqual({ applied: 1, skipped: [] })
    expect(await status(a)).toMatchObject({ status: 'shipping', vtp_tracking_code: 'VTP999' })
  })

  it('also works for a confirmed order that was never exported', async () => {
    const a = await order('vtp')
    await rpc(db, owner1, 'apply_vtp_tracking', { p_shop_id: shop1, p_rows: [{ order_code: (await status(a)).code, tracking_code: 'VTP5' }] })
    expect((await status(a)).status).toBe('shipping')
  })

  it('reports why rows were skipped and still applies the good ones', async () => {
    const good = await order('vtp')
    const self = await order('self')
    const draft = await order('vtp', false)
    const [row] = await rpc<{ apply_vtp_tracking: { applied: number; skipped: { code: string; reason: string }[] } }>(
      db,
      owner1,
      'apply_vtp_tracking',
      {
        p_shop_id: shop1,
        p_rows: [
          { order_code: (await status(good)).code, tracking_code: 'OK1' },
          { order_code: (await status(self)).code, tracking_code: 'X2' },
          { order_code: (await status(draft)).code, tracking_code: 'X3' },
          { order_code: 'VA000000-999', tracking_code: 'X4' },
          { order_code: (await status(good)).code, tracking_code: '' },
        ],
      },
    )
    expect(row.apply_vtp_tracking.applied).toBe(1)
    expect(row.apply_vtp_tracking.skipped.map((s) => s.reason)).toEqual([
      'Đơn không giao bằng ViettelPost',
      'Đơn đang ở trạng thái "new"',
      'Không tìm thấy đơn',
      'Thiếu mã đơn hoặc mã vận đơn',
    ])
  })

  it('does not touch another shop’s orders', async () => {
    const a = await order('vtp')
    const [row] = await rpc<{ apply_vtp_tracking: { applied: number } }>(db, owner2, 'apply_vtp_tracking', {
      p_shop_id: shop2,
      p_rows: [{ order_code: (await status(a)).code, tracking_code: 'HACK' }],
    })
    expect(row.apply_vtp_tracking.applied).toBe(0)
    expect((await status(a)).vtp_tracking_code).toBeNull()
  })
})

describe('isolation', () => {
  it('owner 2 cannot export, cancel or read the batches of shop 1', async () => {
    const a = await order('vtp')
    const id = await batch(owner1, shop1, [a])
    await expectPgError(batch(owner2, shop1, [a]), '42501')
    await expectPgError(rpc(db, owner2, 'cancel_vtp_batch', { p_shop_id: shop1, p_batch_id: id }), '42501')
    await expectPgError(rpc(db, owner2, 'cancel_vtp_batch', { p_shop_id: shop2, p_batch_id: id }), 'P0002')
    await expectPgError(batch(owner2, shop2, [a]), 'P0002')
    expect(await sql(db, owner2, 'select 1 from public.vtp_export_batches')).toEqual([])
  })

  it('shippers and anonymous users have no access; writes are blocked', async () => {
    expect(await sql(db, shipper, 'select 1 from public.vtp_export_batches')).toEqual([])
    await expectPgError(batch(shipper, shop1, []), '42501')
    await expectPgError(sql(db, null, 'select 1 from public.vtp_export_batches'), '42501')
    await expectPgError(sql(db, owner1, `update public.vtp_export_batches set order_count = 99`), '42501')
  })
})
