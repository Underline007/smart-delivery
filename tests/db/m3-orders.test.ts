import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAccount,
  createTestDb,
  dropTestDb,
  expectPgError,
  openAnotherConnection,
  rpc,
  sql,
  type Db,
} from './helpers'

interface Order {
  id: string
  code: string
  status: string
  customer_id: string | null
  subtotal: string
  shipping_fee: string
  discount: string
  total: string
  paid_amount: string
  cod_amount: string
  weight_g: number
  stock_deducted: boolean
  ship_name: string | null
  ship_phone: string | null
  ship_full_text: string | null
  confirmed_at: string | null
  delivered_at: string | null
}

let db: Db
let admin: string
let owner1: string
let owner2: string
let shipper: string
let shop1: string
let shop2: string
let tee: { red: string; blue: string; teeId: string } // variants of one product
let single: string // variant of a product without options

const SHIP = {
  name: 'Nguyễn Thị Lan',
  phone: '0912 345 678',
  detail: '12 Lê Lợi',
  province_code: '79',
  ward_code: '26734',
}

const num = (v: string | number) => Number(v)

async function variantInput(sku: string, values: string[], price: number, weight: number, cost = 50_000) {
  return { sku, option_values: values, price, cost, weight_g: weight, low_stock_threshold: 0 }
}

async function newProduct(shop: string, name: string, options: string[], variants: Record<string, unknown>[]) {
  const [row] = await rpc<{ save_product: string }>(db, owner1, 'save_product', {
    p_shop_id: shop,
    p_product: { name, option_names: options, variants },
  })
  const list = await rpc<{ list_products: { id: string; variants: { id: string; sku: string }[] }[] }>(
    db,
    owner1,
    'list_products',
    { p_shop_id: shop, p_filter: 'all' },
  )
  return list[0].list_products.find((p) => p.id === row.save_product)!
}

async function stock(variantId: string): Promise<number> {
  const res = await db.query('select stock_qty from public.product_variants where id = $1', [variantId])
  return res.rows[0].stock_qty
}

async function receive(variantId: string, qty: number) {
  await rpc(db, owner1, 'receive_stock', {
    p_shop_id: shop1,
    p_payload: { items: [{ variant_id: variantId, qty, unit_cost: 50_000 }] },
  })
}

async function saveOrder(actor: string, shop: string, order: Record<string, unknown>) {
  const [row] = await rpc<{ save_order: string }>(db, actor, 'save_order', { p_shop_id: shop, p_order: order })
  return row.save_order
}

async function getOrder(id: string): Promise<Order> {
  return (await db.query('select * from public.orders where id = $1', [id])).rows[0] as Order
}

const setStatus = (actor: string, shop: string, id: string, to: string, note?: string) =>
  rpc(db, actor, 'set_order_status', { p_shop_id: shop, p_order_id: id, p_to: to, p_note: note ?? null })

function basicOrder(extra: Record<string, unknown> = {}) {
  return {
    delivery_method: 'self',
    ship: SHIP,
    items: [
      { variant_id: tee.red, qty: 2 },
      { variant_id: tee.blue, qty: 1, unit_price: 140_000 },
    ],
    shipping_fee: 30_000,
    discount: 10_000,
    paid_amount: 50_000,
    ...extra,
  }
}

beforeAll(async () => {
  db = await createTestDb()
  admin = await createAccount(db, 'admin', 'Quản Trị M3')
  owner1 = await createAccount(db, 'owner', 'Chủ Một M3')
  owner2 = await createAccount(db, 'owner', 'Chủ Hai M3')
  shipper = await createAccount(db, 'shipper', 'Shipper M3')

  const mk = async (name: string, prefix: string, owner: string) => {
    const [row] = await rpc<{ admin_create_shop: string }>(db, admin, 'admin_create_shop', {
      p_name: name,
      p_order_prefix: prefix,
    })
    await rpc(db, admin, 'admin_set_shop_owner', { p_shop_id: row.admin_create_shop, p_user_id: owner })
    return row.admin_create_shop
  }
  shop1 = await mk('Shop M3-A', 'OA', owner1)
  shop2 = await mk('Shop M3-B', 'OB', owner2)
  await rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: shipper })
  await rpc(db, admin, 'admin_upsert_wards', {
    p_rows: [{ code: '26734', province_code: '79', name: 'Phường Bến Thành' }],
  })

  const shirt = await newProduct(shop1, 'Áo thun', ['Màu'], [
    await variantInput('AT-DO', ['Đỏ'], 150_000, 250, 80_000),
    await variantInput('AT-XANH', ['Xanh'], 150_000, 300, 80_000),
  ])
  tee = {
    red: shirt.variants.find((v) => v.sku === 'AT-DO')!.id,
    blue: shirt.variants.find((v) => v.sku === 'AT-XANH')!.id,
    teeId: shirt.id,
  }
  const cap = await newProduct(shop1, 'Nón', [], [await variantInput('NON', [], 90_000, 120, 40_000)])
  single = cap.variants[0].id

  await receive(tee.red, 10)
  await receive(tee.blue, 10)
  await receive(single, 5)
})

afterAll(async () => {
  await dropTestDb(db)
})

describe('save_order · create', () => {
  it('computes totals, COD and weight on the server and snapshots the lines', async () => {
    const id = await saveOrder(owner1, shop1, basicOrder())
    const o = await getOrder(id)
    // 2 × 150.000 + 1 × 140.000 = 440.000; + 30.000 ship − 10.000 discount = 460.000
    expect(num(o.subtotal)).toBe(440_000)
    expect(num(o.total)).toBe(460_000)
    expect(num(o.paid_amount)).toBe(50_000)
    expect(num(o.cod_amount)).toBe(410_000)
    // Cost is the moving average of the receipts (50.000), not the cost typed on the product.
    // 2 × 250 + 300 = 800 g + 100 g packaging (default)
    expect(o.weight_g).toBe(900)
    expect(o.status).toBe('new')
    expect(o.stock_deducted).toBe(false)
    expect(o.code).toMatch(/^OA\d{6}-001$/)
    expect(o.ship_phone).toBe('0912345678')
    expect(o.ship_full_text).toBe('12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh')

    const items = await db.query(
      'select product_name, variant_label, sku, unit_cost, qty, unit_price from public.order_items where order_id = $1 order by sku',
      [id],
    )
    expect(items.rows).toEqual([
      { product_name: 'Áo thun', variant_label: 'Đỏ', sku: 'AT-DO', unit_cost: '50000', qty: 2, unit_price: '150000' },
      { product_name: 'Áo thun', variant_label: 'Xanh', sku: 'AT-XANH', unit_cost: '50000', qty: 1, unit_price: '140000' },
    ])
    const events = await db.query('select from_status, to_status from public.order_events where order_id = $1', [id])
    expect(events.rows).toEqual([{ from_status: null, to_status: 'new' }])
  })

  it('numbers orders per day and shop', async () => {
    const a = await getOrder(await saveOrder(owner1, shop1, basicOrder()))
    const b = await getOrder(await saveOrder(owner1, shop1, basicOrder()))
    expect(Number(b.code.slice(-3))).toBe(Number(a.code.slice(-3)) + 1)
  })

  it('merges duplicate lines and honours a manual weight', async () => {
    const id = await saveOrder(owner1, shop1, {
      delivery_method: 'self',
      ship: SHIP,
      items: [
        { variant_id: tee.red, qty: 1 },
        { variant_id: tee.red, qty: 2 },
      ],
      weight_g: 1234,
    })
    const o = await getOrder(id)
    expect(num(o.subtotal)).toBe(450_000)
    expect(o.weight_g).toBe(1234)
    const lines = await db.query('select qty from public.order_items where order_id = $1', [id])
    expect(lines.rows).toEqual([{ qty: 3 }])
  })

  it('finds or creates the customer by phone and remembers the address once', async () => {
    const first = await getOrder(await saveOrder(owner1, shop1, basicOrder({ save_address: true })))
    expect(first.customer_id).not.toBeNull()
    const second = await getOrder(await saveOrder(owner1, shop1, basicOrder({ save_address: true })))
    expect(second.customer_id).toBe(first.customer_id)

    const customers = await db.query(`select name from public.customers where shop_id = $1 and phone = '0912345678'`, [shop1])
    expect(customers.rows).toEqual([{ name: 'Nguyễn Thị Lan' }])
    const addresses = await db.query(
      'select full_text, is_default from public.customer_addresses where customer_id = $1',
      [first.customer_id],
    )
    expect(addresses.rows).toEqual([{ full_text: '12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh', is_default: true }])
  })

  it('does not need an address for store pickup', async () => {
    const id = await saveOrder(owner1, shop1, {
      delivery_method: 'pickup',
      items: [{ variant_id: single, qty: 1 }],
    })
    expect((await getOrder(id)).ship_name).toBeNull()
  })

  it('validates input', async () => {
    await expectPgError(saveOrder(owner1, shop1, { ...basicOrder(), items: [] }), '22023')
    await expectPgError(saveOrder(owner1, shop1, basicOrder({ ship: { ...SHIP, detail: '' } })), '22023')
    await expectPgError(saveOrder(owner1, shop1, basicOrder({ ship: { ...SHIP, phone: '123' } })), '22023')
    await expectPgError(saveOrder(owner1, shop1, basicOrder({ ship: { ...SHIP, province_code: null, ward_code: null } })), '22023')
    await expectPgError(saveOrder(owner1, shop1, basicOrder({ discount: 9_999_999 })), '22023')
    await expectPgError(saveOrder(owner1, shop1, basicOrder({ paid_amount: 9_999_999 })), '22023')
    await expectPgError(saveOrder(owner1, shop1, basicOrder({ delivery_method: 'drone' })), '22023')
    await expectPgError(
      saveOrder(owner1, shop1, basicOrder({ items: [{ variant_id: tee.red, qty: 0 }] })),
      '22023',
    )
  })

  it('refuses variants that are inactive or belong to another shop', async () => {
    const hidden = await newProduct(shop1, 'Hàng ẩn', [], [{ ...(await variantInput('HIDE', [], 1000, 10)), active: false }])
    await expectPgError(
      saveOrder(owner1, shop1, basicOrder({ items: [{ variant_id: hidden.variants[0].id, qty: 1 }] })),
      '22023',
    )
    await expectPgError(
      saveOrder(owner2, shop2, basicOrder({ items: [{ variant_id: tee.red, qty: 1 }] })),
      'P0002',
    )
  })
})

describe('confirming, cancelling, re-opening', () => {
  it('confirming deducts stock and writes the ledger', async () => {
    const before = await stock(tee.red)
    const id = await saveOrder(owner1, shop1, basicOrder())
    await setStatus(owner1, shop1, id, 'confirmed')
    const o = await getOrder(id)
    expect(o.status).toBe('confirmed')
    expect(o.stock_deducted).toBe(true)
    expect(o.confirmed_at).not.toBeNull()
    expect(await stock(tee.red)).toBe(before - 2)

    const ledger = await db.query(
      `select qty_change, type, stock_after from public.stock_movements where ref_id = $1`,
      [id],
    )
    expect(ledger.rows).toContainEqual({ qty_change: -2, type: 'order_out', stock_after: before - 2 })
  })

  it('creating with confirm=true confirms in one step', async () => {
    const before = await stock(single)
    const id = await saveOrder(owner1, shop1, { delivery_method: 'pickup', confirm: true, items: [{ variant_id: single, qty: 2 }] })
    expect((await getOrder(id)).status).toBe('confirmed')
    expect(await stock(single)).toBe(before - 2)
  })

  it('refuses to confirm when stock is short and changes nothing', async () => {
    const before = await stock(single)
    const id = await saveOrder(owner1, shop1, { delivery_method: 'pickup', items: [{ variant_id: single, qty: before + 5 }] })
    const error = await expectPgError(setStatus(owner1, shop1, id, 'confirmed'), '23514')
    expect(error.message).toContain('Nón')
    expect((await getOrder(id)).status).toBe('new')
    expect(await stock(single)).toBe(before)
  })

  it('a multi-line order is all-or-nothing', async () => {
    const redBefore = await stock(tee.red)
    const capBefore = await stock(single)
    const id = await saveOrder(owner1, shop1, {
      delivery_method: 'pickup',
      items: [
        { variant_id: tee.red, qty: 1 },
        { variant_id: single, qty: capBefore + 1 },
      ],
    })
    await expectPgError(setStatus(owner1, shop1, id, 'confirmed'), '23514')
    expect(await stock(tee.red)).toBe(redBefore)
    expect(await stock(single)).toBe(capBefore)
  })

  it('allows negative stock when the shop setting is on', async () => {
    await rpc(db, owner1, 'save_shop_settings', { p_shop_id: shop1, p_settings: { allow_negative_stock: true } })
    const before = await stock(single)
    const id = await saveOrder(owner1, shop1, { delivery_method: 'pickup', confirm: true, items: [{ variant_id: single, qty: before + 3 }] })
    expect(await stock(single)).toBe(-3)
    // give it back for the next tests
    await setStatus(owner1, shop1, id, 'cancelled')
    await rpc(db, owner1, 'save_shop_settings', { p_shop_id: shop1, p_settings: { allow_negative_stock: false } })
    expect(await stock(single)).toBe(before)
  })

  it('cancelling a confirmed order gives the stock back; cancelling a new one does not touch it', async () => {
    const before = await stock(tee.blue)
    const confirmed = await saveOrder(owner1, shop1, basicOrder({ confirm: true }))
    expect(await stock(tee.blue)).toBe(before - 1)
    await setStatus(owner1, shop1, confirmed, 'cancelled', 'Khách đổi ý')
    expect(await stock(tee.blue)).toBe(before)
    const o = await getOrder(confirmed)
    expect(o.status).toBe('cancelled')
    expect(o.stock_deducted).toBe(false)

    const fresh = await saveOrder(owner1, shop1, basicOrder())
    await setStatus(owner1, shop1, fresh, 'cancelled')
    expect(await stock(tee.blue)).toBe(before)
  })

  it('a cancelled order cannot be changed again (no double restore)', async () => {
    const id = await saveOrder(owner1, shop1, basicOrder({ confirm: true }))
    await setStatus(owner1, shop1, id, 'cancelled')
    const before = await stock(tee.red)
    await expectPgError(setStatus(owner1, shop1, id, 'cancelled'), '55000')
    await expectPgError(setStatus(owner1, shop1, id, 'confirmed'), '55000')
    expect(await stock(tee.red)).toBe(before)
  })

  it('re-opening restores stock and allows editing, then re-confirming deducts again', async () => {
    const start = await stock(tee.red)
    const id = await saveOrder(owner1, shop1, basicOrder({ confirm: true }))
    expect(await stock(tee.red)).toBe(start - 2)

    // A confirmed order cannot be edited…
    await expectPgError(saveOrder(owner1, shop1, { ...basicOrder(), id }), '55000')
    // …until it is re-opened.
    await setStatus(owner1, shop1, id, 'new')
    expect(await stock(tee.red)).toBe(start)
    expect((await getOrder(id)).confirmed_at).toBeNull()

    await saveOrder(owner1, shop1, { ...basicOrder({ items: [{ variant_id: tee.red, qty: 4 }] }), id })
    const o = await getOrder(id)
    expect(num(o.subtotal)).toBe(600_000)
    const lines = await db.query('select qty from public.order_items where order_id = $1', [id])
    expect(lines.rows).toEqual([{ qty: 4 }])

    await setStatus(owner1, shop1, id, 'confirmed')
    expect(await stock(tee.red)).toBe(start - 4)
  })

  it('logs every change in the order history and the audit log for cancel / reopen', async () => {
    const id = await saveOrder(owner1, shop1, basicOrder({ confirm: true }))
    await setStatus(owner1, shop1, id, 'new', 'Sửa lại')
    await setStatus(owner1, shop1, id, 'cancelled')
    const events = await db.query('select from_status, to_status, note from public.order_events where order_id = $1 order by id', [id])
    expect(events.rows).toEqual([
      { from_status: null, to_status: 'new', note: null },
      { from_status: 'new', to_status: 'confirmed', note: null },
      { from_status: 'confirmed', to_status: 'new', note: 'Sửa lại' },
      { from_status: 'new', to_status: 'cancelled', note: null },
    ])
    const audit = await db.query(`select action from public.audit_logs where target_id = $1 order by id`, [id])
    expect(audit.rows.map((r) => r.action)).toEqual(['order.reopen', 'order.cancel'])
  })
})

describe('delivery outcomes', () => {
  it('delivered: sets the date and updates customer stats', async () => {
    const id = await saveOrder(owner1, shop1, basicOrder({ confirm: true }))
    const customer = (await getOrder(id)).customer_id!
    const before = (await db.query('select delivered_count, total_spent from public.customers where id = $1', [customer])).rows[0]

    await setStatus(owner1, shop1, id, 'shipping')
    await setStatus(owner1, shop1, id, 'delivered')
    const o = await getOrder(id)
    expect(o.status).toBe('delivered')
    expect(o.delivered_at).not.toBeNull()

    const after = (await db.query('select delivered_count, total_spent from public.customers where id = $1', [customer])).rows[0]
    expect(after.delivered_count).toBe(before.delivered_count + 1)
    expect(num(after.total_spent)).toBe(num(before.total_spent) + 460_000)
  })

  it('failed → returning → returned gives the stock back and counts a return', async () => {
    const start = await stock(tee.red)
    const id = await saveOrder(owner1, shop1, basicOrder({ confirm: true }))
    const customer = (await getOrder(id)).customer_id!
    const returnsBefore = (await db.query('select returned_count from public.customers where id = $1', [customer])).rows[0].returned_count

    await setStatus(owner1, shop1, id, 'shipping')
    await setStatus(owner1, shop1, id, 'failed', 'Không nghe máy')
    await setStatus(owner1, shop1, id, 'returning')
    expect(await stock(tee.red)).toBe(start - 2) // goods are still on the road
    expect((await db.query('select returned_count from public.customers where id = $1', [customer])).rows[0].returned_count).toBe(returnsBefore + 1)

    await setStatus(owner1, shop1, id, 'returned')
    expect(await stock(tee.red)).toBe(start)
    const ledger = await db.query(`select type from public.stock_movements where ref_id = $1 order by id`, [id])
    // two lines (red, blue): each is taken out and later returned
    expect(ledger.rows.map((r) => r.type)).toEqual(['order_out', 'order_out', 'return', 'return'])
  })

  it('enforces the allowed transitions', async () => {
    const id = await saveOrder(owner1, shop1, basicOrder())
    await expectPgError(setStatus(owner1, shop1, id, 'delivered'), '55000') // new → delivered
    await expectPgError(setStatus(owner1, shop1, id, 'returned'), '55000')
    await expectPgError(setStatus(owner1, shop1, id, 'vtp_exported'), '22023')
    await setStatus(owner1, shop1, id, 'confirmed')
    await setStatus(owner1, shop1, id, 'delivered')
    await expectPgError(setStatus(owner1, shop1, id, 'cancelled'), '55000') // delivered is final
  })

  it('store pickup goes from confirmed straight to delivered', async () => {
    const id = await saveOrder(owner1, shop1, { delivery_method: 'pickup', confirm: true, items: [{ variant_id: single, qty: 1 }] })
    await setStatus(owner1, shop1, id, 'delivered')
    expect((await getOrder(id)).status).toBe('delivered')
  })
})

describe('concurrency', () => {
  it('two people confirming the same order deduct the stock once', async () => {
    const other = await openAnotherConnection(db)
    try {
      const start = await stock(tee.blue)
      const id = await saveOrder(owner1, shop1, { delivery_method: 'pickup', items: [{ variant_id: tee.blue, qty: 1 }] })
      const confirm = (conn: Db) =>
        rpc(conn, owner1, 'set_order_status', { p_shop_id: shop1, p_order_id: id, p_to: 'confirmed', p_note: null })
      const results = await Promise.allSettled([confirm(db), confirm(other)])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await stock(tee.blue)).toBe(start - 1)
    } finally {
      await other.end()
    }
  })

  it('two orders competing for the last unit: exactly one wins', async () => {
    const other = await openAnotherConnection(db)
    try {
      const last = (
        await newProduct(shop1, 'Hàng cuối', [], [await variantInput('LAST', [], 10_000, 10)])
      ).variants[0].id
      await receive(last, 1)
      const a = await saveOrder(owner1, shop1, { delivery_method: 'pickup', items: [{ variant_id: last, qty: 1 }] })
      const b = await saveOrder(owner1, shop1, { delivery_method: 'pickup', items: [{ variant_id: last, qty: 1 }] })
      const confirm = (conn: Db, id: string) =>
        rpc(conn, owner1, 'set_order_status', { p_shop_id: shop1, p_order_id: id, p_to: 'confirmed', p_note: null })
      const results = await Promise.allSettled([confirm(db, a), confirm(other, b)])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await stock(last)).toBe(0)
    } finally {
      await other.end()
    }
  })
})

describe('listing helpers', () => {
  it('counts orders per status', async () => {
    const [row] = await rpc<{ order_status_counts: Record<string, number> }>(db, owner1, 'order_status_counts', {
      p_shop_id: shop1,
    })
    const counts = row.order_status_counts
    const real = await db.query(`select status, count(*)::int as n from public.orders where shop_id = $1 group by status`, [shop1])
    for (const r of real.rows) expect(counts[r.status]).toBe(r.n)
  })

  it('finds orders by name, phone or code without diacritics', async () => {
    const byName = await sql(db, owner1, `select 1 from public.orders where ship_search like '%nguyen thi lan%'`)
    const byPhone = await sql(db, owner1, `select 1 from public.orders where ship_search like '%0912345678%'`)
    const byCode = await sql(db, owner1, `select 1 from public.orders where ship_search like '%oa%'`)
    expect(byName.length).toBeGreaterThan(0)
    expect(byPhone.length).toBe(byName.length)
    expect(byCode.length).toBeGreaterThan(0)
  })

  it('keeps customer counters equal to the real orders', async () => {
    const rows = await db.query(`
      select c.order_count, c.delivered_count, c.returned_count, c.total_spent,
             (select count(*) from public.orders o where o.customer_id = c.id and o.status <> 'cancelled')::int as orders,
             (select count(*) from public.orders o where o.customer_id = c.id and o.status = 'delivered')::int as delivered,
             (select count(*) from public.orders o where o.customer_id = c.id and o.status in ('returning','returned'))::int as returned,
             coalesce((select sum(total) from public.orders o where o.customer_id = c.id and o.status = 'delivered'), 0) as spent
      from public.customers c where c.shop_id = $1`, [shop1])
    for (const r of rows.rows) {
      expect(r.order_count).toBe(r.orders)
      expect(r.delivered_count).toBe(r.delivered)
      expect(r.returned_count).toBe(r.returned)
      expect(num(r.total_spent)).toBe(num(r.spent))
    }
  })
})

describe('isolation', () => {
  let order1: string

  beforeAll(async () => {
    order1 = await saveOrder(owner1, shop1, basicOrder())
  })

  it('owner 2 cannot read, create, edit or change orders of shop 1', async () => {
    expect(await sql(db, owner2, 'select 1 from public.orders where shop_id = $1', [shop1])).toEqual([])
    expect(await sql(db, owner2, 'select 1 from public.order_items where shop_id = $1', [shop1])).toEqual([])
    expect(await sql(db, owner2, 'select 1 from public.order_events where shop_id = $1', [shop1])).toEqual([])
    await expectPgError(saveOrder(owner2, shop1, basicOrder()), '42501')
    await expectPgError(setStatus(owner2, shop1, order1, 'cancelled'), '42501')
    // Own shop id with another shop's order id.
    await expectPgError(setStatus(owner2, shop2, order1, 'cancelled'), 'P0002')
    await expectPgError(saveOrder(owner2, shop2, { ...basicOrder({ items: [{ variant_id: single, qty: 1 }] }), id: order1 }), 'P0002')
    await expectPgError(rpc(db, owner2, 'order_status_counts', { p_shop_id: shop1 }), '42501')
  })

  it('shippers and anonymous users cannot read orders', async () => {
    expect(await sql(db, shipper, 'select 1 from public.orders')).toEqual([])
    await expectPgError(saveOrder(shipper, shop1, basicOrder()), '42501')
    await expectPgError(sql(db, null, 'select 1 from public.orders'), '42501')
  })

  it('blocks direct writes and internal helpers', async () => {
    await expectPgError(sql(db, owner1, `update public.orders set status = 'delivered' where id = $1`, [order1]), '42501')
    await expectPgError(sql(db, owner1, `delete from public.order_items where order_id = $1`, [order1]), '42501')
    await expectPgError(
      sql(db, owner1, `select public._apply_order_status($1, $2, 'cancelled', null)`, [shop1, order1]),
      '42501',
    )
  })

  it('the admin can work in any shop', async () => {
    await receive(tee.red, 20)
    await receive(tee.blue, 20)
    await setStatus(admin, shop1, order1, 'confirmed')
    expect((await getOrder(order1)).status).toBe('confirmed')
  })
})
