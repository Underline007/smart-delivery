import { expect, test, type Page } from '@playwright/test'
import { context, mockSupabase, signedIn } from './mock'

const shop = { id: 's1', name: 'Shop An', order_prefix: 'AN', role: 'owner' as const }

const provinces = [
  { code: '01', name: 'Hà Nội' },
  { code: '79', name: 'TP. Hồ Chí Minh' },
]
const wards = [
  { code: 'w1', province_code: '79', name: 'Phường Bến Thành' },
  { code: 'w2', province_code: '79', name: 'Phường Sài Gòn' },
]

const address = {
  id: 'a1',
  customer_id: 'c1',
  label: 'Nhà',
  detail: '12 Lê Lợi',
  province_code: '79',
  ward_code: 'w1',
  ward_text: null,
  full_text: '12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
  lat: null,
  lng: null,
  geo_source: null,
  is_default: true,
}

const lan = {
  id: 'c1',
  shop_id: 's1',
  name: 'Nguyễn Thị Lan',
  phone: '0912345678',
  phone2: null,
  tags: ['VIP'],
  note: 'Hay đặt buổi sáng',
  order_count: 5,
  delivered_count: 3,
  returned_count: 2,
  total_spent: 2_500_000,
  addresses: [address],
}

async function setup(page: Page, extra: Parameters<typeof mockSupabase>[1] = {}) {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: { my_context: context('owner', [shop]), ...extra.rpc },
    tables: {
      provinces,
      province_aliases: [{ alias_search: 'hcm', province_code: '79' }],
      wards,
      ward_aliases: [],
      customers: [lan],
      ...extra.tables,
    },
    counts: extra.counts,
  })
}

test('lists customers with tags, address and a warning for frequent returns', async ({ page }) => {
  await setup(page)
  await page.goto('/shop/customers')
  const row = page.getByRole('button', { name: /Nguyễn Thị Lan/ })
  await expect(row).toBeVisible()
  await expect(row.getByText('VIP')).toBeVisible()
  await expect(row.getByText('Hay hoàn')).toBeVisible()
  await expect(row.getByText('0912 345 678 · 5 đơn')).toBeVisible()
  await expect(row.getByText('12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh')).toBeVisible()
  await page.screenshot({ path: 'test-results/customers.png' })
})

test('searches by accent-free name and by phone digits', async ({ page }) => {
  const urls: string[] = []
  await setup(page, {
    tables: {
      customers: (_body: unknown, url: URL) => {
        urls.push(url.search)
        return [lan]
      },
    },
  })
  await page.goto('/shop/customers')
  await page.getByPlaceholder('Tìm theo tên hoặc số điện thoại').fill('nguyen thi')
  await expect.poll(() => urls.map((u) => decodeURIComponent(u)).join('\n')).toContain('name_search=ilike.%nguyen+thi%')
  await page.getByPlaceholder('Tìm theo tên hoặc số điện thoại').fill('0912 345')
  await expect.poll(() => urls.map((u) => decodeURIComponent(u)).join('\n')).toContain('phone=ilike.%0912345%')
})

test('shows the customer detail with stats and address actions', async ({ page }) => {
  await setup(page)
  await page.goto('/shop/customers/c1')
  await expect(page.getByRole('heading', { name: 'Nguyễn Thị Lan' })).toBeVisible()
  await expect(page.getByText('40%')).toBeVisible()
  await expect(page.getByText('2/5 đơn trước bị hoàn. Cân nhắc đặt cọc.')).toBeVisible()
  await expect(page.getByText('Chưa có vị trí')).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: 'Tạo đơn' })).toHaveAttribute('href', '/shop/orders/new?customer=c1')
  await page.screenshot({ path: 'test-results/customer-detail.png' })
})

test('creates a customer from a pasted chat message', async ({ page }) => {
  let customerPayload: { p_customer: Record<string, unknown> } | null = null
  let addressPayload: { p_address: Record<string, unknown>; p_customer_id: string } | null = null
  await setup(page, {
    tables: { customers: [], wards },
    rpc: {
      save_customer: (body: unknown) => {
        customerPayload = body as typeof customerPayload
        return 'new-customer'
      },
      save_customer_address: (body: unknown) => {
        addressPayload = body as typeof addressPayload
        return 'new-address'
      },
    },
  })
  await page.goto('/shop/customers')
  await page.getByRole('button', { name: 'Thêm', exact: true }).click()
  await page.getByRole('button', { name: 'Dán tin nhắn của khách' }).click()
  await page
    .getByLabel('Tin nhắn của khách')
    .fill('Chị Lan 0912 345 678, 12 Lê Lợi phường Bến Thành Q1 HCM')
  await page.getByRole('button', { name: 'Phân tích' }).click()

  await expect(page.getByText('Chị Lan', { exact: true })).toBeVisible()
  await expect(page.getByText('0912 345 678')).toBeVisible()
  await expect(page.getByText('Phường Bến Thành', { exact: true })).toBeVisible()
  await expect(page.getByText('TP. Hồ Chí Minh', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/smart-paste.png' })
  await page.getByRole('button', { name: 'Dùng kết quả' }).click()

  await expect(page.getByLabel('Họ tên')).toHaveValue('Chị Lan')
  await expect(page.getByLabel('Số điện thoại', { exact: true })).toHaveValue('0912345678')
  await expect(page.getByLabel('Địa chỉ chi tiết')).toHaveValue('12 Lê Lợi')
  await expect(page.getByLabel('Tỉnh / thành phố')).toHaveValue('79')
  await expect(page.getByLabel('Phường / xã')).toHaveValue('w1')

  await page.getByRole('dialog').getByRole('button', { name: 'Thêm khách hàng' }).click()
  await expect.poll(() => addressPayload).not.toBeNull()
  expect(customerPayload!.p_customer).toMatchObject({ name: 'Chị Lan', phone: '0912345678' })
  expect(addressPayload!.p_customer_id).toBe('new-customer')
  expect(addressPayload!.p_address).toMatchObject({
    detail: '12 Lê Lợi',
    province_code: '79',
    ward_code: 'w1',
    is_default: true,
  })
})

test('warns when the phone number already belongs to a customer', async ({ page }) => {
  await setup(page)
  await page.goto('/shop/customers')
  await page.getByRole('button', { name: 'Thêm', exact: true }).click()
  await page.getByLabel('Số điện thoại', { exact: true }).fill('0912 345 678')
  await expect(page.getByText(/Số này đã có trong danh sách/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Nguyễn Thị Lan' })).toBeVisible()
})

test('admin imports a ward catalogue from CSV', async ({ page }) => {
  let imported: { p_rows: { code: string; province_code: string; name: string }[] } | null = null
  await signedIn(page)
  await mockSupabase(page, {
    rpc: {
      my_context: context('admin'),
      admin_upsert_wards: (body: unknown) => {
        imported = body as typeof imported
        return 2
      },
    },
    tables: { provinces },
    counts: { provinces: 34, wards: 0 },
  })
  await page.goto('/admin/catalog')
  await expect(page.getByText('34', { exact: true })).toBeVisible()
  await page.getByLabel('Chọn file CSV').setInputFiles({
    name: 'wards.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Mã xã,Tên xã,Tỉnh\n26734,Phường Bến Thành,Thành phố Hồ Chí Minh\n00001,Phường Hoàn Kiếm,Hà Nội\n9,Phường Lạ,Atlantis\n',
    ),
  })
  await expect(page.getByText('2 dòng hợp lệ')).toBeVisible()
  await expect(page.getByText('1 dòng lỗi')).toBeVisible()
  await expect(page.getByText('Dòng 4: không nhận ra tỉnh "Atlantis"')).toBeVisible()
  await page.getByRole('button', { name: 'Nhập vào hệ thống' }).click()
  await expect.poll(() => imported).not.toBeNull()
  expect(imported!.p_rows).toEqual([
    { code: '26734', province_code: '79', name: 'Phường Bến Thành' },
    { code: '00001', province_code: '01', name: 'Phường Hoàn Kiếm' },
  ])
})
