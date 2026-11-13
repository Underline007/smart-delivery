import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { connect, createAccount, expectPgError, rpc, sql, type Db } from './helpers'

interface Variant {
  id: string
  sku: string
  variant_label: string
  stock_qty: number
  cost: number
  active: boolean
  is_default: boolean
}
interface Product {
  id: string
  name: string
  active: boolean
  option_names: string[]
  variants: Variant[]
}

let db: Db
let admin: string
let owner1: string
let owner2: string
let shipper: string
let shop1: string
let shop2: string
let shirt: Product

const variantInput = (sku: string, values: string[], extra: Record<string, unknown> = {}) => ({
  sku,
  option_values: values,
  price: 150_000,
  cost: 80_000,
  weight_g: 250,
  low_stock_threshold: 3,
  ...extra,
})

async function saveProduct(actor: string, shop: string, product: Record<string, unknown>) {
  const [row] = await rpc<{ save_product: string }>(db, actor, 'save_product', {
    p_shop_id: shop,
    p_product: product,
  })
  return row.save_product
}

async function listProducts(actor: string, shop: string, args: Record<string, unknown> = {}) {
  const [row] = await rpc<{ list_products: Product[] }>(db, actor, 'list_products', {
    p_shop_id: shop,
    ...args,
  })
  return row.list_products
}

async function stockOf(variantId: string): Promise<number> {
  const res = await db.query('select stock_qty from public.product_variants where id = $1', [
    variantId,
  ])
  return res.rows[0].stock_qty
}

beforeAll(async () => {
  db = await connect(inject('testDbUrl'))
  admin = await createAccount(db, 'admin', 'Quản Trị M1')
  owner1 = await createAccount(db, 'owner', 'Chủ Một M1')
  owner2 = await createAccount(db, 'owner', 'Chủ Hai M1')
  shipper = await createAccount(db, 'shipper', 'Shipper M1')

  const mk = async (name: string, prefix: string, owner: string) => {
    const [row] = await rpc<{ admin_create_shop: string }>(db, admin, 'admin_create_shop', {
      p_name: name,
      p_order_prefix: prefix,
    })
    await rpc(db, admin, 'admin_set_shop_owner', { p_shop_id: row.admin_create_shop, p_user_id: owner })
    return row.admin_create_shop
  }
  shop1 = await mk('Shop M1-A', 'PA', owner1)
  shop2 = await mk('Shop M1-B', 'PB', owner2)
  await rpc(db, owner1, 'add_shop_shipper', { p_shop_id: shop1, p_user_id: shipper })

  const id = await saveProduct(owner1, shop1, {
    name: 'Áo thun basic',
    category: 'Áo',
    option_names: ['Màu', 'Size'],
    variants: [
      variantInput('AT-DO-M', ['Đỏ', 'M']),
      variantInput('AT-DO-L', ['Đỏ', 'L']),
      variantInput('AT-XANH-M', ['Xanh', 'M']),
    ],
  })
  shirt = (await listProducts(owner1, shop1)).find((p) => p.id === id)!
})

afterAll(async () => {
  await db?.end()
})

describe('shop settings', () => {
  it('creates default settings for each new shop', async () => {
    const rows = await sql<{ allow_negative_stock: boolean; vtp_fee_payer: string }>(
      db,
      owner1,
      'select * from public.shop_settings',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].allow_negative_stock).toBe(false)
    expect(rows[0].vtp_fee_payer).toBe('sender')
  })

  it('lets the owner change settings but not another shop', async () => {
    await rpc(db, owner1, 'save_shop_settings', {
      p_shop_id: shop1,
      p_settings: { packaging_weight_g: 150, allow_negative_stock: true },
    })
    const rows = await sql<{ packaging_weight_g: number; allow_negative_stock: boolean }>(
      db,
      owner1,
      'select packaging_weight_g, allow_negative_stock from public.shop_settings',
    )
    expect(rows[0]).toEqual({ packaging_weight_g: 150, allow_negative_stock: true })
    await expectPgError(
      rpc(db, owner2, 'save_shop_settings', { p_shop_id: shop1, p_settings: {} }),
      '42501',
    )
    await rpc(db, owner1, 'save_shop_settings', {
      p_shop_id: shop1,
      p_settings: { allow_negative_stock: false },
    })
  })
})

describe('save_product', () => {
  it('creates a product with labelled variants', () => {
    expect(shirt.option_names).toEqual(['Màu', 'Size'])
    expect(shirt.variants.map((v) => v.variant_label).sort()).toEqual([
      'Xanh / M',
      'Đỏ / L',
      'Đỏ / M',
    ])
    expect(shirt.variants.every((v) => v.stock_qty === 0 && !v.is_default)).toBe(true)
  })

  it('creates a hidden default variant for a product without options', async () => {
    const id = await saveProduct(owner1, shop1, {
      name: 'Nón lưỡi trai',
      option_names: [],
      variants: [variantInput('NON-1', [])],
    })
    const product = (await listProducts(owner1, shop1)).find((p) => p.id === id)!
    expect(product.variants).toHaveLength(1)
    expect(product.variants[0].is_default).toBe(true)
    expect(product.variants[0].variant_label).toBe('')
  })

  it('rejects a duplicate SKU in the same shop with a readable message', async () => {
    const error = await expectPgError(
      saveProduct(owner1, shop1, {
        name: 'Áo khác',
        option_names: [],
        variants: [variantInput('AT-DO-M', [])],
      }),
      '23505',
    )
    expect(error.message).toContain('AT-DO-M')
  })

  it('allows the same SKU in another shop', async () => {
    await saveProduct(owner2, shop2, {
      name: 'Áo của shop khác',
      option_names: [],
      variants: [variantInput('AT-DO-M', [])],
    })
  })

  it('validates input', async () => {
    await expectPgError(
      saveProduct(owner1, shop1, { name: '  ', option_names: [], variants: [variantInput('X', [])] }),
      '22023',
    )
    await expectPgError(
      saveProduct(owner1, shop1, {
        name: 'Quá nhiều',
        option_names: ['a', 'b', 'c', 'd'],
        variants: [variantInput('Q1', ['1', '2', '3', '4'])],
      }),
      '22023',
    )
    await expectPgError(
      saveProduct(owner1, shop1, {
        name: 'Thiếu giá trị',
        option_names: ['Màu', 'Size'],
        variants: [variantInput('TG1', ['Đỏ'])],
      }),
      '22023',
    )
    await expectPgError(
      saveProduct(owner1, shop1, {
        name: 'Trùng biến thể',
        option_names: ['Màu'],
        variants: [variantInput('TB1', ['Đỏ']), variantInput('TB2', ['Đỏ'])],
      }),
      '22023',
    )
    await expectPgError(
      saveProduct(owner1, shop1, { name: 'Không biến thể', option_names: [], variants: [] }),
      '22023',
    )
  })

  it('deactivates variants that are removed, keeping their history', async () => {
    const id = await saveProduct(owner1, shop1, {
      name: 'Quần jean',
      option_names: ['Size'],
      variants: [variantInput('QJ-29', ['29']), variantInput('QJ-30', ['30'])],
    })
    const before = (await listProducts(owner1, shop1)).find((p) => p.id === id)!
    const keep = before.variants.find((v) => v.sku === 'QJ-29')!

    await saveProduct(owner1, shop1, {
      id,
      name: 'Quần jean',
      option_names: ['Size'],
      variants: [{ ...variantInput('QJ-29', ['29']), id: keep.id }],
    })
    const after = (await listProducts(owner1, shop1)).find((p) => p.id === id)!
    expect(after.variants.find((v) => v.sku === 'QJ-30')?.active).toBe(false)
    expect(after.variants.find((v) => v.sku === 'QJ-29')?.active).toBe(true)
  })
})

describe('receive_stock', () => {
  it('adds stock, writes the ledger and numbers the receipt', async () => {
    const [m, l] = ['AT-DO-M', 'AT-DO-L'].map((sku) => shirt.variants.find((v) => v.sku === sku)!)
    const [row] = await rpc<{ receive_stock: string }>(db, owner1, 'receive_stock', {
      p_shop_id: shop1,
      p_payload: {
        supplier: 'Xưởng A',
        items: [
          { variant_id: m.id, qty: 10, unit_cost: 80_000 },
          { variant_id: l.id, qty: 5, unit_cost: 90_000 },
        ],
      },
    })
    expect(await stockOf(m.id)).toBe(10)
    expect(await stockOf(l.id)).toBe(5)

    const receipt = await sql<{ code: string; total_cost: string }>(
      db,
      owner1,
      'select code, total_cost from public.stock_receipts where id = $1',
      [row.receive_stock],
    )
    expect(receipt[0].code).toMatch(/^PN\d{6}-\d{3}$/)
    expect(Number(receipt[0].total_cost)).toBe(10 * 80_000 + 5 * 90_000)

    const ledger = await sql<{ qty_change: number; stock_after: number; type: string }>(
      db,
      owner1,
      'select qty_change, stock_after, type from public.stock_movements where variant_id = $1',
      [m.id],
    )
    expect(ledger).toEqual([{ qty_change: 10, stock_after: 10, type: 'receipt' }])
  })

  it('uses a moving average for the cost', async () => {
    const m = shirt.variants.find((v) => v.sku === 'AT-DO-M')!
    // stock 10 @ 80.000, add 10 @ 100.000 → 90.000
    await rpc(db, owner1, 'receive_stock', {
      p_shop_id: shop1,
      p_payload: { items: [{ variant_id: m.id, qty: 10, unit_cost: 100_000 }] },
    })
    const [row] = await sql<{ cost: string; stock_qty: number }>(
      db,
      owner1,
      'select cost, stock_qty from public.product_variants where id = $1',
      [m.id],
    )
    expect(Number(row.cost)).toBe(90_000)
    expect(row.stock_qty).toBe(20)
  })

  it('merges duplicate lines of the same variant', async () => {
    const x = shirt.variants.find((v) => v.sku === 'AT-XANH-M')!
    await rpc(db, owner1, 'receive_stock', {
      p_shop_id: shop1,
      p_payload: {
        items: [
          { variant_id: x.id, qty: 2, unit_cost: 50_000 },
          { variant_id: x.id, qty: 3, unit_cost: 50_000 },
        ],
      },
    })
    expect(await stockOf(x.id)).toBe(5)
  })

  it('rejects bad input and variants from another shop', async () => {
    const m = shirt.variants.find((v) => v.sku === 'AT-DO-M')!
    await expectPgError(
      rpc(db, owner1, 'receive_stock', { p_shop_id: shop1, p_payload: { items: [] } }),
      '22023',
    )
    await expectPgError(
      rpc(db, owner1, 'receive_stock', {
        p_shop_id: shop1,
        p_payload: { items: [{ variant_id: m.id, qty: 0, unit_cost: 1 }] },
      }),
      '22023',
    )
    await expectPgError(
      rpc(db, owner2, 'receive_stock', {
        p_shop_id: shop2,
        p_payload: { items: [{ variant_id: m.id, qty: 1, unit_cost: 1 }] },
      }),
      'P0002',
    )
  })
})

describe('apply_stocktake', () => {
  it('records the difference and adjusts the stock', async () => {
    const l = shirt.variants.find((v) => v.sku === 'AT-DO-L')!
    const before = await stockOf(l.id) // 5
    const [row] = await rpc<{ apply_stocktake: string }>(db, owner1, 'apply_stocktake', {
      p_shop_id: shop1,
      p_payload: { note: 'Kiểm cuối ngày', items: [{ variant_id: l.id, counted_qty: before - 2 }] },
    })
    expect(await stockOf(l.id)).toBe(before - 2)

    const items = await sql<{ system_qty: number; counted_qty: number; diff: number }>(
      db,
      owner1,
      'select system_qty, counted_qty, diff from public.stocktake_items where stocktake_id = $1',
      [row.apply_stocktake],
    )
    expect(items).toEqual([{ system_qty: before, counted_qty: before - 2, diff: -2 }])

    const adjust = await sql<{ qty_change: number; type: string }>(
      db,
      owner1,
      `select qty_change, type from public.stock_movements where variant_id = $1 and type = 'adjust'`,
      [l.id],
    )
    expect(adjust).toEqual([{ qty_change: -2, type: 'adjust' }])
  })

  it('does not write a movement when the count matches', async () => {
    const x = shirt.variants.find((v) => v.sku === 'AT-XANH-M')!
    await rpc(db, owner1, 'apply_stocktake', {
      p_shop_id: shop1,
      p_payload: { items: [{ variant_id: x.id, counted_qty: await stockOf(x.id) }] },
    })
    const rows = await sql(
      db,
      owner1,
      `select 1 from public.stock_movements where variant_id = $1 and type = 'adjust'`,
      [x.id],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('_apply_stock_change', () => {
  it('refuses to go negative when not allowed, and says which product', async () => {
    const x = shirt.variants.find((v) => v.sku === 'AT-XANH-M')!
    const error = await expectPgError(
      db.query(
        `select public._apply_stock_change($1, $2, -100, 'order_out', null, null, null, null, false)`,
        [shop1, x.id],
      ),
      '23514',
    )
    expect(error.message).toContain('Áo thun basic (Xanh / M)')
    expect(await stockOf(x.id)).toBe(5)
  })
})

describe('list_products', () => {
  it('finds products without typing diacritics, by name or SKU', async () => {
    expect((await listProducts(owner1, shop1, { p_query: 'ao thun' })).map((p) => p.name)).toEqual([
      'Áo thun basic',
    ])
    expect((await listProducts(owner1, shop1, { p_query: 'at-xanh' })).map((p) => p.name)).toEqual([
      'Áo thun basic',
    ])
    expect(await listProducts(owner1, shop1, { p_query: 'khong co that' })).toEqual([])
  })

  it('filters low stock and inactive products', async () => {
    // AT-DO-L: 3 left with threshold 3 → low
    const low = await listProducts(owner1, shop1, { p_filter: 'low' })
    expect(low.map((p) => p.name)).toContain('Áo thun basic')

    const id = await saveProduct(owner1, shop1, {
      name: 'Hàng ngừng bán',
      active: false,
      option_names: [],
      variants: [variantInput('NB-1', [])],
    })
    expect((await listProducts(owner1, shop1)).some((p) => p.id === id)).toBe(false)
    expect((await listProducts(owner1, shop1, { p_filter: 'inactive' })).some((p) => p.id === id)).toBe(true)
  })

  it('pages results', async () => {
    const page1 = await listProducts(owner1, shop1, { p_limit: 1, p_offset: 0, p_filter: 'all' })
    const page2 = await listProducts(owner1, shop1, { p_limit: 1, p_offset: 1, p_filter: 'all' })
    expect(page1).toHaveLength(1)
    expect(page2).toHaveLength(1)
    expect(page1[0].id).not.toBe(page2[0].id)
  })
})

describe('isolation', () => {
  it('owner 2 cannot see shop 1 products, variants or ledger', async () => {
    expect(await sql(db, owner2, 'select 1 from public.products where shop_id = $1', [shop1])).toEqual([])
    expect(
      await sql(db, owner2, 'select 1 from public.product_variants where shop_id = $1', [shop1]),
    ).toEqual([])
    expect(
      await sql(db, owner2, 'select 1 from public.stock_movements where shop_id = $1', [shop1]),
    ).toEqual([])
    await expectPgError(listProducts(owner2, shop1), '42501')
    await expectPgError(
      saveProduct(owner2, shop1, { name: 'Hack', option_names: [], variants: [variantInput('H1', [])] }),
      '42501',
    )
  })

  it('owner 2 cannot edit a product of shop 1 by passing their own shop id', async () => {
    await expectPgError(
      saveProduct(owner2, shop2, {
        id: shirt.id,
        name: 'Đổi tên',
        option_names: [],
        variants: [variantInput('Z1', [])],
      }),
      'P0002',
    )
  })

  it('shippers and anonymous users read nothing', async () => {
    expect(await sql(db, shipper, 'select 1 from public.products')).toEqual([])
    expect(await sql(db, shipper, 'select 1 from public.product_variants')).toEqual([])
    await expectPgError(listProducts(shipper, shop1), '42501')
    await expectPgError(sql(db, null, 'select 1 from public.products'), '42501')
  })

  it('the admin can work inside any shop', async () => {
    expect((await listProducts(admin, shop1, { p_filter: 'all' })).length).toBeGreaterThan(0)
  })

  it('blocks direct writes', async () => {
    await expectPgError(
      sql(db, owner1, `update public.product_variants set stock_qty = 999 where shop_id = $1`, [shop1]),
      '42501',
    )
    await expectPgError(
      sql(db, owner1, `insert into public.stock_movements (shop_id, variant_id, qty_change, type, stock_after)
                       values ($1, $2, 1, 'adjust', 1)`, [shop1, shirt.variants[0].id]),
      '42501',
    )
  })

  it('cannot call internal helpers', async () => {
    await expectPgError(
      sql(db, owner1, `select public._apply_stock_change($1, $2, 5, 'adjust')`, [shop1, shirt.variants[0].id]),
      '42501',
    )
    await expectPgError(sql(db, owner1, `select public._next_code($1, 'x', 'X')`, [shop1]), '42501')
  })
})
