import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAccount, createTestDb, dropTestDb, expectPgError, rpc, sql, type Db } from './helpers'

interface Report {
  totals: Record<string, number>
  by_day: { day: string; orders: number; revenue: number }[]
  top_products: { name: string; qty: number; revenue: number; profit: number }[]
  top_variants: { name: string; sku: string; qty: number }[]
  top_customers: { name: string; phone: string; orders: number; spent: number }[]
  by_method: { method: string; orders: number; delivered: number; returned: number }[]
  shippers: { name: string; trips: number; delivered: number; failed: number; cod_collected: number }[]
}

let db: Db
let admin: string
let owner1: string
let owner2: string
let shipper1: string
let shipperOther: string
let shop1: string
let shop2: string
let variant: string
let today: string

async function order(items: { qty: number; price?: number }[], extra: Record<string, unknown> = {}, shop = shop1, actor = owner1, variantId = variant) {
  const [row] = await rpc<{ save_order: string }>(db, actor, 'save_order', {
    p_shop_id: shop,
    p_order: {
      delivery_method: 'self',
      confirm: true,
      ship: { name: 'Nguyễn Thị Lan', phone: '0912345678', detail: '12 Lê Lợi', province_code: '79' },
      items: items.map((i) => ({ variant_id: variantId, qty: i.qty, unit_price: i.price })),
      ...extra,
    },
  })
  return row.save_order
}

const status = (id: string, to: string, shop = shop1, actor = owner1) =>
  rpc(db, actor, 'set_order_status', { p_shop_id: shop, p_order_id: id, p_to: to })

async function report(actor: string, shop: string, from = today, to = today) {
  return (await rpc<{ sales_report: Report }>(db, actor, 'sales_report', { p_shop_id: shop, p_from: from, p_to: to }))[0].sales_report
}

beforeAll(async () => {
  db = await createTestDb()
  today = (await db.query(`select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as d`)).rows[0].d
  admin = await createAccount(db, 'admin', 'Quản Trị M6')
  owner1 = await createAccount(db, 'owner', 'Chủ Một M6')
  owner2 = await createAccount(db, 'owner', 'Chủ Hai M6')
  shipper1 = await createAccount(db, 'shipper', 'Shipper M6')
  shipperOther = await createAccount(db, 'shipper', 'Shipper Khác')

  const mk = async (name: string, prefix: string, owner: string) => {
    const [row] = await rpc<{ admin_create_shop: string }>(db, admin, 'admin_create_shop', { p_name: name, p_order_prefix: prefix })
    await rpc(db, admin, 'admin_set_shop_owner', { p_shop_id: row.admin_create_shop, p_user_id: owner })
    return row.admin_create_shop
  }
  shop1 = await mk('Shop M6-A', 'RA', owner1)
  shop2 = await mk('Shop M6-B', 'RB', owner2)
  await rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: shipper1 })
  await rpc(db, owner2, 'add_shop_shipper', { p_shop_id: shop2, p_user_id: shipperOther })

  const [saved] = await rpc<{ save_product: string }>(db, owner1, 'save_product', {
    p_shop_id: shop1,
    p_product: { name: 'Áo', option_names: [], variants: [{ sku: 'A1', option_values: [], price: 100000, cost: 50000, weight_g: 200, low_stock_threshold: 3 }] },
  })
  const [list] = await rpc<{ list_products: { id: string; variants: { id: string }[] }[] }>(db, owner1, 'list_products', { p_shop_id: shop1 })
  variant = list.list_products.find((p) => p.id === saved.save_product)!.variants[0].id
  await rpc(db, owner1, 'receive_stock', { p_shop_id: shop1, p_payload: { items: [{ variant_id: variant, qty: 50, unit_cost: 50000 }] } })
})

afterAll(async () => {
  await dropTestDb(db)
})

describe('sales_report', () => {
  let trip: string

  beforeAll(async () => {
    // delivered: 2 × 100.000 + 30.000 ship − 10.000 discount = 220.000 (goods 190.000, cost 100.000)
    const o1 = await order([{ qty: 2 }], { shipping_fee: 30000, discount: 10000 })
    await status(o1, 'shipping')
    await status(o1, 'delivered')
    // delivered: 1 × 100.000 (cost 50.000)
    const o2 = await order([{ qty: 1 }], { ship: { name: 'Trần B', phone: '0900000002', detail: '1 A', province_code: '79' } })
    await status(o2, 'shipping')
    await status(o2, 'delivered')
    // cancelled, still new, returned
    await status(await order([{ qty: 1 }]), 'cancelled')
    await order([{ qty: 1 }], { confirm: false })
    const o5 = await order([{ qty: 1 }])
    await status(o5, 'shipping')
    await status(o5, 'failed')
    await status(o5, 'returning')
    // delivered through a trip by the shipper: 1 × 100.000
    const o6 = await order([{ qty: 1 }], { ship: { name: 'Lê C', phone: '0900000003', detail: '2 B', province_code: '79' }, paid_amount: 0 })
    const [t] = await rpc<{ create_trip: string }>(db, owner1, 'create_trip', { p_shop_id: shop1, p_order_ids: [o6], p_shipper_id: shipper1, p_trip: { start: true } })
    trip = t.create_trip
    const stop = (await db.query('select id from public.delivery_stops where trip_id = $1', [trip])).rows[0].id
    await rpc(db, shipper1, 'complete_stop', { p_stop_id: stop })
  })

  it('adds up revenue, cost and gross profit of delivered orders', async () => {
    const r = await report(owner1, shop1)
    expect(r.totals).toMatchObject({
      delivered: 3,
      revenue: 220_000 + 100_000 + 100_000,
      goods_revenue: 190_000 + 100_000 + 100_000,
      cost: 100_000 + 50_000 + 50_000,
      gross_profit: 90_000 + 50_000 + 50_000,
      cancelled: 1,
      returned: 1,
      orders_created: 5, // everything except the cancelled one
    })
  })

  it('groups by day, product, variant, customer and delivery method', async () => {
    const r = await report(owner1, shop1)
    expect(r.by_day).toEqual([{ day: today, orders: 3, revenue: 420_000 }])
    expect(r.top_products).toEqual([{ name: 'Áo', qty: 4, revenue: 400_000, profit: 200_000 }])
    expect(r.top_variants[0]).toMatchObject({ sku: 'A1', qty: 4 })
    expect(r.top_customers.map((c) => c.name)).toEqual(['Nguyễn Thị Lan', 'Lê C', 'Trần B']) // ties are ordered by name
    expect(r.top_customers[0]).toMatchObject({ orders: 1, spent: 220_000 })
    expect(r.by_method).toEqual([{ method: 'self', orders: 5, delivered: 3, returned: 1 }])
  })

  it('reports shipper performance from trips', async () => {
    const r = await report(owner1, shop1)
    expect(r.shippers).toEqual([{ name: 'Shipper M6', trips: 1, delivered: 1, failed: 0, cod_collected: 100_000 }])
  })

  it('counts nothing outside the range', async () => {
    const r = await report(owner1, shop1, '2020-01-01', '2020-01-31')
    expect(r.totals).toMatchObject({ delivered: 0, revenue: 0, gross_profit: 0, orders_created: 0 })
    expect(r.by_day).toEqual([])
  })

  it('validates the range', async () => {
    await expectPgError(report(owner1, shop1, today, '2020-01-01'), '22023')
    await expectPgError(report(owner1, shop1, '2020-01-01', today), '22023') // more than a year
  })

  it('is private to the shop (and the admin)', async () => {
    await expectPgError(report(owner2, shop1), '42501')
    await expectPgError(report(shipper1, shop1), '42501')
    await expectPgError(rpc(db, null, 'sales_report', { p_shop_id: shop1, p_from: today, p_to: today }), '42501')
    expect((await report(admin, shop1)).totals.delivered).toBe(3)
    expect((await report(owner2, shop2)).totals.delivered).toBe(0)
  })
})

describe('dashboard_summary', () => {
  it('counts what needs attention', async () => {
    const [row] = await rpc<{ dashboard_summary: Record<string, number | string> }>(db, owner1, 'dashboard_summary', { p_shop_id: shop1 })
    const d = row.dashboard_summary
    expect(d.today).toBe(today)
    expect(d.delivered_today).toBe(3)
    expect(Number(d.revenue_delivered_today)).toBe(420_000)
    expect(d.new_orders).toBe(1)
    expect(d.to_process).toBe(1)
    expect(d.returning).toBe(1)
    expect(d.orders_created).toBe(5)
    expect(d.active_trips).toBe(0)
    // stock: 50 − 7 sold/in transit… threshold is 3, so not low yet
    expect(d.low_stock).toBe(0)
  })

  it('flags low stock and unsettled money', async () => {
    const stock = (await db.query('select stock_qty from public.product_variants where id = $1', [variant])).rows[0].stock_qty
    await rpc(db, owner1, 'apply_stocktake', { p_shop_id: shop1, p_payload: { items: [{ variant_id: variant, counted_qty: 2 }] } })
    expect(stock).toBeGreaterThan(3)
    const [row] = await rpc<{ dashboard_summary: Record<string, number> }>(db, owner1, 'dashboard_summary', { p_shop_id: shop1 })
    expect(row.dashboard_summary.low_stock).toBe(1)
    expect(row.dashboard_summary.unsettled_trips).toBe(1)
    expect(Number(row.dashboard_summary.unsettled_cod)).toBe(100_000)
  })

  it('is private to the shop', async () => {
    await expectPgError(rpc(db, owner2, 'dashboard_summary', { p_shop_id: shop1 }), '42501')
    await expectPgError(rpc(db, shipper1, 'dashboard_summary', { p_shop_id: shop1 }), '42501')
  })
})

describe('admin_shop_summary', () => {
  it('lists every shop with 30-day numbers, for the admin only', async () => {
    const rows = await rpc<{ name: string; orders_30d: string; revenue_30d: string }>(db, admin, 'admin_shop_summary')
    const a = rows.find((r) => r.name === 'Shop M6-A')!
    expect(Number(a.orders_30d)).toBe(5)
    expect(Number(a.revenue_30d)).toBe(420_000)
    expect(rows.find((r) => r.name === 'Shop M6-B')).toBeDefined()
    await expectPgError(rpc(db, owner1, 'admin_shop_summary'), '42501')
  })
})

describe('storage policies', () => {
  const insert = (actor: string | null, bucket: string, name: string) =>
    sql(db, actor, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name])

  it('creates the two buckets', async () => {
    const rows = await sql<{ id: string; public: boolean }>(db, owner1, 'select id, public from storage.buckets order by id')
    expect(rows).toEqual([
      { id: 'delivery-proofs', public: false },
      { id: 'product-images', public: true },
    ])
  })

  it('owners manage the product images of their own shop only', async () => {
    await insert(owner1, 'product-images', `${shop1}/product.jpg`)
    await expectPgError(insert(owner1, 'product-images', `${shop2}/product.jpg`), '42501')
    await expectPgError(insert(owner2, 'product-images', `${shop1}/hack.jpg`), '42501')
    await insert(owner2, 'product-images', `${shop2}/mine.jpg`)
    await insert(admin, 'product-images', `${shop1}/by-admin.jpg`)
    await expectPgError(insert(shipper1, 'product-images', `${shop1}/shipper.jpg`), '42501')
  })

  it('rejects paths that do not start with a shop id', async () => {
    await expectPgError(insert(owner1, 'product-images', 'not-a-uuid/x.jpg'), '42501')
    await expectPgError(insert(owner1, 'product-images', 'x.jpg'), '42501')
  })

  it('a shipper uploads proof photos for his own shop, but cannot read or delete them', async () => {
    await insert(shipper1, 'delivery-proofs', `${shop1}/trip/stop.jpg`)
    expect(await sql(db, shipper1, `select 1 from storage.objects where bucket_id = 'delivery-proofs'`)).toEqual([])
    expect((await sql(db, owner1, `select 1 from storage.objects where bucket_id = 'delivery-proofs'`)).length).toBe(1)
    expect(await sql(db, shipper1, `delete from storage.objects where bucket_id = 'delivery-proofs' returning 1`)).toEqual([])
    expect((await sql(db, owner1, `delete from storage.objects where bucket_id = 'delivery-proofs' returning 1`)).length).toBe(1)
  })

  it('a shipper of another shop, or another owner, cannot touch these proofs', async () => {
    await expectPgError(insert(shipperOther, 'delivery-proofs', `${shop1}/trip/stop.jpg`), '42501')
    await expectPgError(insert(owner2, 'delivery-proofs', `${shop1}/trip/stop.jpg`), '42501')
    await insert(shipper1, 'delivery-proofs', `${shop1}/trip/x.jpg`)
    expect(await sql(db, owner2, `select 1 from storage.objects where bucket_id = 'delivery-proofs'`)).toEqual([])
  })

  it('anonymous users cannot upload', async () => {
    await expectPgError(insert(null, 'product-images', `${shop1}/anon.jpg`), '42501')
  })
})
