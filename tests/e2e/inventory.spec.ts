import { expect, test, type Page } from '@playwright/test'
import { context, mockSupabase, signedIn } from './mock'

const shop = { id: 's1', name: 'Shop An', order_prefix: 'AN', role: 'owner' as const }

const variant = (id: string, color: string, size: string, stock: number) => ({
  id,
  shop_id: 's1',
  product_id: 'p1',
  sku: `ATB-${color}-${size}`,
  option_values: [color, size],
  variant_label: `${color} / ${size}`,
  price: 150000,
  cost: 80000,
  weight_g: 250,
  length_cm: null,
  width_cm: null,
  height_cm: null,
  barcode: null,
  image_path: null,
  stock_qty: stock,
  low_stock_threshold: 3,
  is_default: false,
  active: true,
})

const shirt = {
  id: 'p1',
  shop_id: 's1',
  name: 'Áo thun basic',
  category: 'Áo',
  unit: 'cái',
  description: null,
  image_path: null,
  option_names: ['Màu', 'Size'],
  active: true,
  variants: [
    variant('v1', 'Đỏ', 'S', 10),
    variant('v2', 'Đỏ', 'M', 2),
    variant('v3', 'Xanh', 'S', 0),
    variant('v4', 'Xanh', 'M', 7),
  ],
}

async function setup(page: Page, rpc: Record<string, unknown> = {}) {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: {
      my_context: context('owner', [shop]),
      list_products: [shirt],
      ...rpc,
    },
    tables: { products: shirt },
  })
}

test('lists products with total stock, low-stock badge and variants', async ({ page }) => {
  await setup(page)
  await page.goto('/shop/inventory')
  const card = page.getByRole('button', { name: /Áo thun basic/ })
  await expect(card).toBeVisible()
  await expect(card.getByText('Sắp hết')).toBeVisible()
  await expect(card.getByText('19')).toBeVisible()
  await card.click()
  await expect(page.getByText('Đỏ / M')).toBeVisible()
  await expect(page.getByRole('link', { name: /Thẻ kho Xanh \/ S/ })).toBeVisible()
  await page.screenshot({ path: 'test-results/inventory.png' })
})

test('creates a product with a colour × size matrix', async ({ page }) => {
  let saved: { p_product: { variants: { sku: string; option_values: string[]; price: number; weight_g: number }[]; option_names: string[]; name: string } } | null = null
  await setup(page, {
    save_product: (body: unknown) => {
      saved = body as typeof saved
      return 'new-id'
    },
  })
  await page.goto('/shop/inventory/products/new')

  await page.getByLabel('Tên sản phẩm').fill('Áo thun basic')
  await page.getByRole('button', { name: 'Thêm thuộc tính' }).click()
  await page.getByLabel('Thêm giá trị cho Màu').fill('Đỏ, Xanh')
  await page.getByLabel('Thêm giá trị cho Màu').press('Enter')
  await page.getByRole('button', { name: 'Thêm thuộc tính' }).click()
  await page.getByLabel('Thêm giá trị cho Size').fill('S, M')
  await page.getByLabel('Thêm giá trị cho Size').press('Enter')

  await expect(page.getByText('Biến thể (4)')).toBeVisible()
  const bulk = page.locator('div', { hasText: 'Áp dụng cho tất cả biến thể' }).last()
  await bulk.getByLabel('Giá bán').fill('150000')
  await bulk.getByLabel('KL (g)').fill('250')
  await page.getByRole('button', { name: 'Áp dụng', exact: true }).click()
  await page.screenshot({ path: 'test-results/product-form.png', fullPage: true })

  await page.getByRole('button', { name: 'Lưu sản phẩm' }).click()
  await expect.poll(() => saved).not.toBeNull()
  const product = saved!.p_product
  expect(product.name).toBe('Áo thun basic')
  expect(product.option_names).toEqual(['Màu', 'Size'])
  expect(product.variants.map((v) => v.option_values.join('/'))).toEqual(['Đỏ/S', 'Đỏ/M', 'Xanh/S', 'Xanh/M'])
  expect(product.variants.map((v) => v.sku)).toEqual(['ATB-DO-S', 'ATB-DO-M', 'ATB-XANH-S', 'ATB-XANH-M'])
  expect(product.variants.every((v) => v.price === 150000 && v.weight_g === 250)).toBe(true)
})

test('blocks saving a variant without a weight', async ({ page }) => {
  let called = false
  await setup(page, {
    save_product: () => {
      called = true
      return 'x'
    },
  })
  await page.goto('/shop/inventory/products/new')
  await page.getByLabel('Tên sản phẩm').fill('Nón')
  await page.getByRole('button', { name: 'Lưu sản phẩm' }).click()
  await expect(page.getByText(/Nhập khối lượng/).first()).toBeVisible()
  expect(called).toBe(false)
})

test('receives stock through the colour × size grid', async ({ page }) => {
  let payload: { p_payload: { items: { variant_id: string; qty: number; unit_cost: number }[] } } | null = null
  await setup(page, {
    receive_stock: (body: unknown) => {
      payload = body as typeof payload
      return 'receipt-id'
    },
  })
  await page.goto('/shop/inventory/receipts/new')
  await page.getByRole('button', { name: 'Chọn sản phẩm' }).first().click()
  await page.getByText('Áo thun basic').click()

  await page.getByLabel('Số lượng nhập Đỏ / S').fill('10')
  await page.getByLabel('Số lượng nhập Xanh / M').fill('5')
  await page.getByLabel('Giá nhập mỗi cái (áp cho cả sản phẩm)').fill('90000')
  await expect(page.getByText('15', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/receipt.png' })

  await page.getByRole('button', { name: 'Lưu phiếu nhập' }).click()
  await expect.poll(() => payload).not.toBeNull()
  expect(payload!.p_payload.items).toEqual([
    { variant_id: 'v1', qty: 10, unit_cost: 90000 },
    { variant_id: 'v4', qty: 5, unit_cost: 90000 },
  ])
})

test('stocktake shows differences and only saves when something changed', async ({ page }) => {
  let payload: { p_payload: { items: { variant_id: string; counted_qty: number }[] } } | null = null
  await setup(page, {
    apply_stocktake: (body: unknown) => {
      payload = body as typeof payload
      return 'st-id'
    },
  })
  await page.goto('/shop/inventory/stocktake')
  await page.getByRole('button', { name: 'Chọn sản phẩm' }).first().click()
  await page.getByText('Áo thun basic').click()
  await expect(page.getByText('Chưa có chênh lệch nào')).toBeVisible()

  await page.getByLabel('Số đếm thực tế Đỏ / M').fill('1')
  await expect(page.getByText('1 biến thể chênh lệch sẽ được điều chỉnh')).toBeVisible()
  await expect(page.getByText('máy 2 (-1)')).toBeVisible()
  await page.getByRole('button', { name: 'Lưu phiếu kiểm kho' }).click()
  await expect.poll(() => payload).not.toBeNull()
  expect(payload!.p_payload.items.find((i) => i.variant_id === 'v2')?.counted_qty).toBe(1)
  expect(payload!.p_payload.items).toHaveLength(4)
})
