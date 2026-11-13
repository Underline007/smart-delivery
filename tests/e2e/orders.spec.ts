import { expect, test, type Page } from '@playwright/test'
import { context, mockSupabase, signedIn } from './mock'

const shop = { id: 's1', name: 'Shop An', order_prefix: 'AN', role: 'owner' as const }

const settings = {
  shop_id: 's1',
  vtp_service: 'VCN',
  vtp_fee_payer: 'sender',
  vtp_delivery_requirement: 'no_view',
  packaging_weight_g: 100,
  allow_negative_stock: false,
  message_template: 'Chào {ten}, đơn {ma_don}:\n{san_pham}\nThu hộ {cod}đ',
}

const variant = (id: string, label: string, stock: number) => ({
  id,
  shop_id: 's1',
  product_id: 'p1',
  sku: `ATB-${label}`,
  option_values: label.split(' / '),
  variant_label: label,
  price: 150000,
  cost: 80000,
  weight_g: 250,
  length_cm: null,
  width_cm: null,
  height_cm: null,
  barcode: null,
  image_path: null,
  stock_qty: stock,
  low_stock_threshold: 0,
  is_default: false,
  active: true,
})

const shirt = {
  id: 'p1',
  shop_id: 's1',
  name: 'Áo thun basic',
  category: null,
  unit: 'cái',
  description: null,
  image_path: null,
  option_names: ['Màu', 'Size'],
  active: true,
  variants: [variant('v1', 'Đỏ / M', 5), variant('v2', 'Đỏ / L', 0), variant('v3', 'Xanh / M', 3)],
}

const item = (id: string, qty: number) => ({
  id,
  variant_id: 'v1',
  product_name: 'Áo thun basic',
  variant_label: 'Đỏ / M',
  sku: 'ATB-Đỏ / M',
  unit_cost: 80000,
  weight_g: 250,
  qty,
  unit_price: 150000,
})

const order = (overrides: Record<string, unknown> = {}) => ({
  id: 'o1',
  shop_id: 's1',
  code: 'AN261113-001',
  customer_id: 'c1',
  status: 'new',
  delivery_method: 'self',
  ship_name: 'Chị Lan',
  ship_phone: '0912345678',
  ship_detail: '12 Lê Lợi',
  ship_province_code: '79',
  ship_ward_code: null,
  ship_ward_text: null,
  ship_full_text: '12 Lê Lợi, TP. Hồ Chí Minh',
  ship_lat: null,
  ship_lng: null,
  subtotal: 300000,
  shipping_fee: 30000,
  discount: 0,
  total: 330000,
  paid_amount: 0,
  cod_amount: 330000,
  weight_g: 600,
  delivery_note: null,
  internal_note: null,
  vtp_service: 'VCN',
  vtp_fee_payer: 'sender',
  vtp_delivery_requirement: 'no_view',
  vtp_tracking_code: null,
  vtp_batch_id: null,
  stock_deducted: false,
  confirmed_at: null,
  delivered_at: null,
  created_at: '2026-11-13T03:00:00Z',
  items: [item('i1', 2)],
  events: [{ id: 1, from_status: null, to_status: 'new', note: null, created_at: '2026-11-13T03:00:00Z' }],
  ...overrides,
})

async function setup(page: Page, extra: Parameters<typeof mockSupabase>[1] = {}) {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: {
      my_context: context('owner', [shop]),
      list_products: [shirt],
      order_status_counts: { new: 2, confirmed: 1, shipping: 1, delivered: 5 },
      ...extra.rpc,
    },
    tables: {
      shop_settings: settings,
      provinces: [{ code: '79', name: 'TP. Hồ Chí Minh' }],
      province_aliases: [{ alias_search: 'hcm', province_code: '79' }],
      wards: [],
      ward_aliases: [],
      customers: [],
      orders: [order()],
      product_variants: [{ id: 'v1', stock_qty: 5, active: true, weight_g: 250 }],
      ...extra.tables,
    },
  })
}

test('lists orders with status tabs and counts', async ({ page }) => {
  await setup(page)
  await page.goto('/shop/orders')
  await expect(page.getByRole('button', { name: /Cần xử lý\s*3/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Đang giao\s*1/ })).toBeVisible()
  const card = page.getByRole('button', { name: /AN261113-001/ })
  await expect(card).toBeVisible()
  await expect(card.getByText('Mới', { exact: true })).toBeVisible()
  await expect(card.getByText('330.000đ', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/orders.png' })
})

test('selecting orders enables only the bulk actions that apply', async ({ page }) => {
  await setup(page, { tables: { orders: [order(), order({ id: 'o2', code: 'AN261113-002', status: 'confirmed', delivery_method: 'vtp' })] } })
  await page.goto('/shop/orders')
  await page.getByRole('button', { name: 'Chọn', exact: true }).click()
  await page.getByRole('button', { name: /AN261113-001/ }).click()
  await expect(page.getByText('Đã chọn 1 đơn')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Xác nhận', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Xuất Excel VTP' })).toBeDisabled()

  await page.getByRole('button', { name: /AN261113-001/ }).click()
  await page.getByRole('button', { name: /AN261113-002/ }).click()
  await expect(page.getByRole('button', { name: 'Xác nhận', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Xuất Excel VTP' })).toBeEnabled()
})

test('creates an order from a customer message with live totals, then confirms it', async ({ page }) => {
  let payload: { p_order: Record<string, unknown> } | null = null
  await setup(page, {
    rpc: {
      save_order: (body: unknown) => {
        payload = body as typeof payload
        return 'o9'
      },
    },
    tables: { orders: [order({ id: 'o9' })] },
  })
  await page.goto('/shop/orders/new')

  // Customer: paste a chat message
  await page.getByRole('button', { name: 'Dán tin nhắn' }).click()
  await page.getByRole('textbox', { name: 'Tin nhắn của khách' }).fill('Chị Lan 0912 345 678, 12 Lê Lợi, TP.HCM')
  await page.getByRole('button', { name: 'Phân tích' }).click()
  await page.getByRole('button', { name: 'Dùng kết quả' }).click()
  await expect(page.getByLabel('Tên người nhận')).toHaveValue('Chị Lan')
  await expect(page.getByLabel('Tỉnh / thành phố')).toHaveValue('79')

  // Product: pick colour and size with chips
  await page.getByRole('button', { name: 'Thêm sản phẩm' }).first().click()
  await page.getByText('Áo thun basic').click()
  await page.getByRole('button', { name: 'Xanh', exact: true }).click()
  await page.getByRole('button', { name: 'M', exact: true }).click()
  await expect(page.getByText('Còn 3 · ATB-Xanh / M')).toBeVisible()
  await page.getByRole('button', { name: 'Tăng Số lượng' }).click()
  await page.getByRole('button', { name: 'Thêm vào đơn' }).click()

  // Money
  await page.getByLabel('Phí ship thu khách').fill('30000')
  await page.getByLabel('Đã thanh toán / đặt cọc').fill('50000')
  // 2 × 150.000 + 30.000 = 330.000, COD 280.000
  const bar = page.locator('.fixed').filter({ hasText: 'Thu hộ' })
  await expect(bar.getByText('330.000đ')).toBeVisible()
  await expect(bar.getByText('280.000đ')).toBeVisible()
  // 2 × 250 g + 100 g packaging
  await expect(page.getByLabel('Khối lượng gói hàng')).toHaveValue('600')
  await page.screenshot({ path: 'test-results/order-form.png', fullPage: true })

  await page.getByRole('button', { name: 'Xác nhận đơn' }).click()
  await expect.poll(() => payload).not.toBeNull()
  expect(payload!.p_order).toMatchObject({
    delivery_method: 'self',
    confirm: true,
    shipping_fee: 30000,
    paid_amount: 50000,
    ship: { name: 'Chị Lan', phone: '0912345678', detail: '12 Lê Lợi', province_code: '79' },
    items: [{ variant_id: 'v3', qty: 2, unit_price: 150000 }],
  })
  await expect(page).toHaveURL(/\/shop\/orders\/o9$/)
})

test('does not submit an invalid order', async ({ page }) => {
  let called = false
  await setup(page, { rpc: { save_order: () => ((called = true), 'x') } })
  await page.goto('/shop/orders/new')
  await page.getByRole('button', { name: 'Lưu nháp' }).click()
  await expect(page.getByText('Thêm ít nhất một sản phẩm').first()).toBeVisible()
  await expect(page.getByText('Nhập tên người nhận')).toBeVisible()
  expect(called).toBe(false)
})

test('warns about stock while building an order', async ({ page }) => {
  await setup(page)
  await page.goto('/shop/orders/new')
  await page.getByRole('button', { name: 'Thêm sản phẩm' }).first().click()
  await page.getByText('Áo thun basic').click()
  await page.getByRole('button', { name: 'Tăng Số lượng' }).click() // Đỏ / M, stock 5
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Tăng Số lượng' }).click()
  await page.getByRole('button', { name: 'Thêm vào đơn' }).click()
  await expect(page.getByText('Chỉ còn 5 trong kho')).toBeVisible()
})

test('order detail shows totals, message and status actions', async ({ page }) => {
  let status: { p_to: string; p_note: string | null } | null = null
  await setup(page, {
    rpc: {
      set_order_status: (body: unknown) => {
        status = body as typeof status
        return null
      },
    },
    tables: { orders: [order({ status: 'shipping', ship_lat: 10.77, ship_lng: 106.69 })] },
  })
  await page.goto('/shop/orders/o1')
  await expect(page.getByText('Thu hộ (COD)')).toBeVisible()
  await expect(page.getByText('Chào Chị Lan, đơn AN261113-001:')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Bản đồ' })).toHaveAttribute('href', /destination=10\.77,106\.69/)
  await page.screenshot({ path: 'test-results/order-detail.png', fullPage: true })

  await page.getByRole('button', { name: 'Giao thất bại' }).click()
  await page.getByLabel('Lý do / ghi chú (tuỳ chọn)').fill('Không nghe máy')
  await page.getByRole('button', { name: 'Đồng ý' }).click()
  await expect.poll(() => status).not.toBeNull()
  expect(status).toMatchObject({ p_to: 'failed', p_note: 'Không nghe máy' })
})

test('a confirmed order cannot be edited directly', async ({ page }) => {
  await setup(page, { tables: { orders: [order({ status: 'confirmed' })] } })
  await page.goto('/shop/orders/o1/edit')
  await expect(page.getByText('Chỉ sửa được đơn ở trạng thái Mới')).toBeVisible()
})
