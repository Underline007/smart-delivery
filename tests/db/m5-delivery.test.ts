import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAccount, createTestDb, dropTestDb, expectPgError, rpc, sql, type Db } from './helpers'

interface MyTrip {
  id: string
  code: string
  status: string
  shop_name: string
  cod_expected: string
  stops: Record<string, unknown>[]
}

let db: Db
let admin: string
let owner1: string
let owner2: string
let shipperA: string
let shipperB: string
let shop1: string
let shop2: string
const variants: Record<string, string> = {}

const SHIP = { name: 'Nguyễn Thị Lan', phone: '0912345678', detail: '12 Lê Lợi', province_code: '79' }

async function order(opts: { method?: 'self' | 'vtp'; confirm?: boolean; lat?: number; cod?: number; shop?: string; actor?: string; name?: string } = {}) {
  const shop = opts.shop ?? shop1
  const [row] = await rpc<{ save_order: string }>(db, opts.actor ?? owner1, 'save_order', {
    p_shop_id: shop,
    p_order: {
      delivery_method: opts.method ?? 'self',
      confirm: opts.confirm ?? true,
      save_address: true,
      ship: { ...SHIP, name: opts.name ?? SHIP.name, ...(opts.lat ? { lat: opts.lat, lng: 106.7 } : {}) },
      items: [{ variant_id: variants[shop], qty: 1 }],
      shipping_fee: 0,
      paid_amount: opts.cod === undefined ? 0 : 100_000 - opts.cod,
    },
  })
  return row.save_order
}

const orderRow = async (id: string) =>
  (await db.query('select status, ship_lat, ship_lng, customer_id, ship_full_text, cod_amount from public.orders where id = $1', [id]))
    .rows[0] as { status: string; ship_lat: number | null; ship_lng: number | null; customer_id: string; ship_full_text: string; cod_amount: string }

const tripRow = async (id: string) =>
  (await db.query('select * from public.delivery_trips where id = $1', [id])).rows[0] as {
    status: string
    cod_expected: string
    cod_collected: string
    code: string
    finished_at: string | null
    settled_at: string | null
    settled_amount: string | null
  }

async function trip(orderIds: string[], shipper = shipperA, extra: Record<string, unknown> = {}, actor = owner1, shop = shop1) {
  const [row] = await rpc<{ create_trip: string }>(db, actor, 'create_trip', {
    p_shop_id: shop,
    p_order_ids: orderIds,
    p_shipper_id: shipper,
    p_trip: extra,
  })
  return row.create_trip
}

const myTrips = async (actor: string) => (await rpc<{ get_my_trips: MyTrip[] }>(db, actor, 'get_my_trips'))[0].get_my_trips

const stops = async (tripId: string) =>
  (await db.query('select id, order_id, seq, status, cod_collected, fail_reason, done_lat from public.delivery_stops where trip_id = $1 order by seq', [tripId])).rows as {
    id: string
    order_id: string
    seq: number
    status: string
    cod_collected: string | null
    fail_reason: string | null
    done_lat: number | null
  }[]

const start = (actor: string, id: string) => rpc(db, actor, 'start_trip', { p_trip_id: id })
const complete = (actor: string, stopId: string, extra: Record<string, unknown> = {}) =>
  rpc(db, actor, 'complete_stop', { p_stop_id: stopId, ...extra })
const fail = (actor: string, stopId: string, reason = 'Không nghe máy') =>
  rpc(db, actor, 'fail_stop', { p_stop_id: stopId, p_reason: reason })

beforeAll(async () => {
  db = await createTestDb()
  admin = await createAccount(db, 'admin', 'Quản Trị M5')
  owner1 = await createAccount(db, 'owner', 'Chủ Một M5')
  owner2 = await createAccount(db, 'owner', 'Chủ Hai M5')
  shipperA = await createAccount(db, 'shipper', 'Shipper A')
  shipperB = await createAccount(db, 'shipper', 'Shipper B')

  const mk = async (name: string, prefix: string, owner: string) => {
    const [row] = await rpc<{ admin_create_shop: string }>(db, admin, 'admin_create_shop', { p_name: name, p_order_prefix: prefix })
    await rpc(db, admin, 'admin_set_shop_owner', { p_shop_id: row.admin_create_shop, p_user_id: owner })
    return row.admin_create_shop
  }
  shop1 = await mk('Shop M5-A', 'GA', owner1)
  shop2 = await mk('Shop M5-B', 'GB', owner2)
  await rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: shipperA })
  await rpc(db, owner2, 'add_shop_shipper', { p_shop_id: shop2, p_user_id: shipperA }) // A works for both shops
  await rpc(db, owner2, 'add_shop_shipper', { p_shop_id: shop2, p_user_id: shipperB })

  for (const [shop, actor] of [[shop1, owner1], [shop2, owner2]] as const) {
    const [saved] = await rpc<{ save_product: string }>(db, actor, 'save_product', {
      p_shop_id: shop,
      p_product: { name: 'Áo', option_names: [], variants: [{ sku: 'A1', option_values: [], price: 100000, cost: 50000, weight_g: 200 }] },
    })
    const [list] = await rpc<{ list_products: { id: string; variants: { id: string }[] }[] }>(db, actor, 'list_products', { p_shop_id: shop })
    const v = list.list_products.find((p) => p.id === saved.save_product)!.variants[0].id
    await rpc(db, actor, 'receive_stock', { p_shop_id: shop, p_payload: { items: [{ variant_id: v, qty: 500, unit_cost: 50000 }] } })
    variants[shop] = v
  }
})

afterAll(async () => {
  await dropTestDb(db)
})

describe('create_trip', () => {
  it('creates a draft trip with stops in the given order and the expected COD', async () => {
    const a = await order({ cod: 100_000 })
    const b = await order({ cod: 40_000 })
    const c = await order({ cod: 0 })
    const id = await trip([c, a, b], shipperA, { start_lat: 10.78, start_lng: 106.69, end_mode: 'last', optimizer: 'local', distance_m: 8200, duration_s: 1500 })

    const t = await tripRow(id)
    expect(t.status).toBe('draft')
    expect(t.code).toMatch(/^CG\d{6}-\d{3}$/)
    expect(Number(t.cod_expected)).toBe(140_000)
    expect((await stops(id)).map((s) => [s.seq, s.order_id])).toEqual([[1, c], [2, a], [3, b]])
    // Orders are untouched until the trip starts.
    expect((await orderRow(a)).status).toBe('confirmed')
  })

  it('rejects orders that cannot be delivered by the shop’s own shipper', async () => {
    const vtp = await order({ method: 'vtp' })
    const draft = await order({ confirm: false })
    await expectPgError(trip([vtp]), '55000')
    await expectPgError(trip([draft]), '55000')
  })

  it('does not let an order sit in two trips', async () => {
    const a = await order()
    await trip([a])
    await expectPgError(trip([a]), '55000')
  })

  it('validates shipper, selection and coordinates', async () => {
    const a = await order()
    await expectPgError(trip([a], shipperB), '22023') // B is not a shipper of shop 1
    await expectPgError(trip([]), '22023')
    await expectPgError(trip([a, a]), '22023')
    await expectPgError(trip([a], shipperA, { start_lat: 10.7 }), '22023')
  })

  it('refuses orders of another shop', async () => {
    const other = await order({ shop: shop2, actor: owner2 })
    await expectPgError(trip([other]), 'P0002')
  })
})

describe('running a trip', () => {
  it('start puts the orders in "shipping"', async () => {
    const [a, b] = [await order(), await order()]
    const id = await trip([a, b])
    await start(owner1, id)
    expect((await tripRow(id)).status).toBe('in_progress')
    expect((await orderRow(a)).status).toBe('shipping')
    expect((await orderRow(b)).status).toBe('shipping')
    await expectPgError(start(owner1, id), '55000')
  })

  it('the assigned shipper can start, another shipper cannot', async () => {
    const id = await trip([await order()])
    await expectPgError(start(shipperB, id), '42501')
    await start(shipperA, id)
    expect((await tripRow(id)).status).toBe('in_progress')
  })

  it('delivering the last stop finishes the trip and sums the COD collected', async () => {
    const a = await order({ cod: 100_000 })
    const b = await order({ cod: 60_000 })
    const id = await trip([a, b])
    await start(shipperA, id)
    const [s1, s2] = await stops(id)

    await complete(shipperA, s1.id)
    expect((await orderRow(a)).status).toBe('delivered')
    expect((await tripRow(id)).status).toBe('in_progress')

    await complete(shipperA, s2.id, { p_cod: 50_000, p_note: 'Khách trả thiếu' })
    const t = await tripRow(id)
    expect(t.status).toBe('done')
    expect(t.finished_at).not.toBeNull()
    expect(Number(t.cod_collected)).toBe(150_000)
    expect((await orderRow(b)).status).toBe('delivered')
  })

  it('a failed delivery marks the order failed, and it can go on a new trip', async () => {
    const a = await order()
    const first = await trip([a])
    await start(shipperA, first)
    const [s1] = await stops(first)
    await fail(shipperA, s1.id, 'Khách hẹn ngày khác')

    expect((await tripRow(first)).status).toBe('done')
    expect((await orderRow(a)).status).toBe('failed')
    expect((await stops(first))[0]).toMatchObject({ status: 'failed', fail_reason: 'Khách hẹn ngày khác' })

    const second = await trip([a]) // failed orders can be sent again
    await start(owner1, second)
    expect((await orderRow(a)).status).toBe('shipping')
  })

  it('saves the shipper’s GPS as the location of the order and the customer address, once', async () => {
    const a = await order()
    const id = await trip([a])
    await start(shipperA, id)
    await complete(shipperA, (await stops(id))[0].id, { p_lat: 10.7769, p_lng: 106.7009 })

    const o = await orderRow(a)
    expect(o.ship_lat).toBeCloseTo(10.7769)
    const addr = await db.query(
      'select lat, geo_source from public.customer_addresses where customer_id = $1 and full_text = $2',
      [o.customer_id, o.ship_full_text],
    )
    expect(addr.rows[0].geo_source).toBe('gps')
    expect(addr.rows[0].lat).toBeCloseTo(10.7769)

    // A second delivery to the same place must not overwrite it.
    const b = await order()
    const t2 = await trip([b])
    await start(shipperA, t2)
    await complete(shipperA, (await stops(t2))[0].id, { p_lat: 11.5, p_lng: 107.5 })
    const again = await db.query('select lat from public.customer_addresses where customer_id = $1 and full_text = $2', [o.customer_id, o.ship_full_text])
    expect(again.rows[0].lat).toBeCloseTo(10.7769)
  })

  it('finishing early turns the pending stops into failed deliveries', async () => {
    const [a, b] = [await order(), await order()]
    const id = await trip([a, b])
    await start(shipperA, id)
    await complete(shipperA, (await stops(id))[0].id)
    await rpc(db, shipperA, 'finish_trip', { p_trip_id: id, p_reason: 'Hết giờ' })
    expect((await tripRow(id)).status).toBe('done')
    expect((await orderRow(b)).status).toBe('failed')
    expect((await stops(id))[1]).toMatchObject({ status: 'failed', fail_reason: 'Hết giờ' })
  })

  it('validates results', async () => {
    const a = await order()
    const id = await trip([a])
    const [s1] = await stops(id)
    await expectPgError(complete(shipperA, s1.id), '55000') // not started
    await start(shipperA, id)
    await expectPgError(fail(shipperA, s1.id, '  '), '22023')
    await expectPgError(complete(shipperA, s1.id, { p_cod: -5 }), '22023')
    await expectPgError(complete(shipperA, s1.id, { p_lat: 10.7 }), '22023')
    await expectPgError(complete(shipperA, s1.id, { p_photo: 'other-shop/x.jpg' }), '22023')
    await complete(shipperA, s1.id, { p_photo: `${shop1}/${id}/${s1.id}.jpg` })
    await expectPgError(complete(shipperA, s1.id), '55000') // already done
    await expectPgError(fail(shipperA, s1.id), '55000')
  })

  it('the owner can record a result on behalf of the shipper', async () => {
    const a = await order()
    const id = await trip([a])
    await start(owner1, id)
    await complete(owner1, (await stops(id))[0].id)
    expect((await orderRow(a)).status).toBe('delivered')
  })
})

describe('keeping orders and trips consistent', () => {
  it('an order in a trip cannot be changed from the order screen', async () => {
    const a = await order()
    const id = await trip([a])
    await expectPgError(rpc(db, owner1, 'set_order_status', { p_shop_id: shop1, p_order_id: a, p_to: 'cancelled' }), '55000')
    await start(owner1, id)
    await expectPgError(rpc(db, owner1, 'set_order_status', { p_shop_id: shop1, p_order_id: a, p_to: 'delivered' }), '55000')
  })

  it('cancelling a draft trip frees its orders', async () => {
    const a = await order()
    const id = await trip([a])
    await rpc(db, owner1, 'cancel_trip', { p_shop_id: shop1, p_trip_id: id })
    expect((await tripRow(id)).status).toBe('cancelled')
    expect(await stops(id)).toEqual([])
    await rpc(db, owner1, 'set_order_status', { p_shop_id: shop1, p_order_id: a, p_to: 'cancelled' })
    expect((await orderRow(a)).status).toBe('cancelled')
  })

  it('a trip that has started cannot be cancelled', async () => {
    const id = await trip([await order()])
    await start(owner1, id)
    await expectPgError(rpc(db, owner1, 'cancel_trip', { p_shop_id: shop1, p_trip_id: id }), '55000')
  })

  it('a shipper with an unfinished trip cannot be removed from the shop', async () => {
    const id = await trip([await order()])
    await expectPgError(rpc(db, owner1, 'remove_shop_shipper', { p_shop_id: shop1, p_user_id: shipperA }), '55000')
    await rpc(db, owner1, 'cancel_trip', { p_shop_id: shop1, p_trip_id: id })
  })

  it('set_order_location updates the order and an address without coordinates', async () => {
    const a = await order()
    await rpc(db, owner1, 'set_order_location', { p_shop_id: shop1, p_order_id: a, p_lat: 10.8, p_lng: 106.7, p_source: 'manual' })
    const o = await orderRow(a)
    expect(o.ship_lat).toBeCloseTo(10.8)
    await expectPgError(rpc(db, owner1, 'set_order_location', { p_shop_id: shop1, p_order_id: a, p_lat: 200, p_lng: 0 }), '22023')
  })
})

describe('settling', () => {
  it('records what the shipper handed over, once, only for finished trips', async () => {
    const a = await order({ cod: 100_000 })
    const id = await trip([a])
    await expectPgError(rpc(db, owner1, 'settle_trip', { p_shop_id: shop1, p_trip_id: id, p_amount: 1 }), '55000')
    await start(shipperA, id)
    await complete(shipperA, (await stops(id))[0].id)
    await rpc(db, owner1, 'settle_trip', { p_shop_id: shop1, p_trip_id: id, p_amount: 100_000, p_note: 'Đủ' })
    const t = await tripRow(id)
    expect(t.settled_at).not.toBeNull()
    expect(Number(t.settled_amount)).toBe(100_000)
    await expectPgError(rpc(db, owner1, 'settle_trip', { p_shop_id: shop1, p_trip_id: id, p_amount: 100_000 }), '55000')
    await expectPgError(rpc(db, shipperA, 'settle_trip', { p_shop_id: shop1, p_trip_id: id, p_amount: 1 }), '42501')
    const audit = await db.query(`select action from public.audit_logs where target_id = $1`, [id])
    expect(audit.rows).toEqual([{ action: 'trip.settle' }])
  })
})

describe('what a shipper sees', () => {
  it('only his own trips, across shops, with only the fields he needs', async () => {
    const a = await order({ name: 'Khách Một' })
    const b = await order({ shop: shop2, actor: owner2, name: 'Khách Hai' })
    const t1 = await trip([a], shipperA)
    const t2 = await trip([b], shipperA, {}, owner2, shop2)
    const t3 = await trip([await order({ shop: shop2, actor: owner2 })], shipperB, {}, owner2, shop2)

    const mine = await myTrips(shipperA)
    const ids = mine.map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining([t1, t2]))
    expect(ids).not.toContain(t3)
    expect(mine.find((t) => t.id === t2)!.shop_name).toBe('Shop M5-B')

    const stop = mine.find((t) => t.id === t1)!.stops[0]
    expect(Object.keys(stop).sort()).toEqual(
      ['address', 'cod', 'cod_collected', 'fail_reason', 'id', 'items', 'lat', 'lng', 'name', 'note', 'order_code', 'phone', 'seq', 'status', 'weight_g'].sort(),
    )
    expect(stop.name).toBe('Khách Một')
    expect(stop.items).toBe('Áo x1')
    // No costs, prices or totals leak.
    expect(JSON.stringify(mine)).not.toMatch(/unit_cost|subtotal|"total"|profit/)

    expect((await myTrips(shipperB)).map((t) => t.id)).toEqual([t3])
  })

  it('cannot read any table, call manager functions, or act on another shipper’s trip', async () => {
    const a = await order()
    const id = await trip([a])
    await start(owner1, id)
    const [s1] = await stops(id)
    for (const table of ['delivery_trips', 'delivery_stops', 'orders', 'customers']) {
      expect(await sql(db, shipperA, `select 1 from public.${table}`)).toEqual([])
    }
    await expectPgError(complete(shipperB, s1.id), '42501')
    await expectPgError(fail(shipperB, s1.id), '42501')
    await expectPgError(rpc(db, shipperA, 'create_trip', { p_shop_id: shop1, p_order_ids: [a], p_shipper_id: shipperA }), '42501')
    await expectPgError(rpc(db, shipperA, 'cancel_trip', { p_shop_id: shop1, p_trip_id: id }), '42501')
    await expectPgError(rpc(db, shipperA, 'set_order_location', { p_shop_id: shop1, p_order_id: a, p_lat: 1, p_lng: 1 }), '42501')
  })

  it('a shipper who was removed from the shop loses access', async () => {
    // Earlier tests leave unfinished trips behind; close them so the shipper can be removed.
    await db.query(`update public.delivery_trips set status = 'cancelled' where shop_id = $1 and shipper_id = $2 and status in ('draft', 'in_progress')`, [shop1, shipperA])
    await rpc(db, owner1, 'remove_shop_shipper', { p_shop_id: shop1, p_user_id: shipperA })
    const draft = await db.query(`select id from public.delivery_trips where shop_id = $1 and shipper_id = $2 and status in ('draft','in_progress')`, [shop1, shipperA])
    expect(draft.rows).toEqual([])
    expect((await myTrips(shipperA)).filter((t) => t.shop_name === 'Shop M5-A')).toEqual([])
    // Put the shipper back for the following tests.
    await rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: shipperA })
  })

  it('history lists finished trips with counts', async () => {
    const rows = await rpc<{ id: string; stops: number; delivered: number; failed: number; status: string }>(db, shipperA, 'get_my_trip_history')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(['done', 'cancelled']).toContain(r.status)
      expect(r.delivered + r.failed).toBeLessThanOrEqual(r.stops)
    }
  })
})

describe('isolation between shops', () => {
  it('owner 2 cannot see or touch trips of shop 1', async () => {
    const a = await order()
    const id = await trip([a])
    expect(await sql(db, owner2, 'select 1 from public.delivery_trips where shop_id = $1', [shop1])).toEqual([])
    expect(await sql(db, owner2, 'select 1 from public.delivery_stops where shop_id = $1', [shop1])).toEqual([])
    await expectPgError(trip([a], shipperA, {}, owner2, shop1), '42501')
    await expectPgError(rpc(db, owner2, 'cancel_trip', { p_shop_id: shop1, p_trip_id: id }), '42501')
    await expectPgError(rpc(db, owner2, 'cancel_trip', { p_shop_id: shop2, p_trip_id: id }), 'P0002')
    await expectPgError(start(owner2, id), '42501')
    await expectPgError(complete(owner2, (await stops(id))[0].id), '42501')
  })

  it('blocks direct writes and anonymous access', async () => {
    await expectPgError(sql(db, owner1, `update public.delivery_trips set status = 'done'`), '42501')
    await expectPgError(sql(db, owner1, `delete from public.delivery_stops`), '42501')
    await expectPgError(sql(db, null, 'select 1 from public.delivery_trips'), '42501')
    await expectPgError(rpc(db, null, 'get_my_trips'), '42501')
  })

  it('the admin can work in any shop', async () => {
    const id = await trip([await order()], shipperA, {}, admin)
    await start(admin, id)
    expect((await tripRow(id)).status).toBe('in_progress')
  })
})
