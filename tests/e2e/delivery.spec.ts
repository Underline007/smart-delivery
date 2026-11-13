import { expect, test, type Page } from '@playwright/test'
import { context, mockSupabase, signedIn } from './mock'

const shop = { id: 's1', name: 'Shop An', order_prefix: 'AN', role: 'owner' as const }

const selfOrder = (id: string, code: string, name: string, lat: number | null, lng: number | null, extra: Record<string, unknown> = {}) => ({
  id,
  shop_id: 's1',
  code,
  customer_id: null,
  status: 'confirmed',
  delivery_method: 'self',
  ship_name: name,
  ship_phone: '0912345678',
  ship_detail: '1 Đường',
  ship_province_code: '79',
  ship_ward_code: null,
  ship_ward_text: null,
  ship_full_text: `${name}, TP. Hồ Chí Minh`,
  ship_lat: lat,
  ship_lng: lng,
  subtotal: 100000,
  shipping_fee: 0,
  discount: 0,
  total: 100000,
  paid_amount: 0,
  cod_amount: 100000,
  weight_g: 300,
  delivery_note: null,
  internal_note: null,
  vtp_service: null,
  vtp_fee_payer: null,
  vtp_delivery_requirement: null,
  vtp_tracking_code: null,
  vtp_batch_id: null,
  stock_deducted: true,
  confirmed_at: null,
  delivered_at: null,
  created_at: '2026-11-13T03:00:00Z',
  items: [],
  ...extra,
})

const shopRow = { id: 's1', name: 'Shop An', phone: '0987654321', address: '1 Nguyễn Huệ', lat: 10.7769, lng: 106.7009, order_prefix: 'AN', active: true }

async function owner(page: Page, extra: Parameters<typeof mockSupabase>[1] = {}) {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: {
      my_context: context('owner', [shop]),
      list_shop_members: [{ user_id: 'sh1', full_name: 'Shipper An', phone: '0933000111', role: 'shipper', active: true, account_active: true, added_at: '2026-11-01T00:00:00Z' }],
      ...extra.rpc,
    },
    tables: { shops: [shopRow], ...extra.tables },
  })
}

test('plans a trip: optimises the order of stops and creates it for a shipper', async ({ page }) => {
  let created: { p_order_ids: string[]; p_shipper_id: string; p_trip: Record<string, unknown> } | null = null
  await owner(page, {
    rpc: {
      create_trip: (body: unknown) => {
        created = body as typeof created
        return 't1'
      },
    },
    tables: {
      orders: [
        // Given far → near → middle: the shortest route from the shop is near → middle → far.
        selfOrder('far', 'AN-FAR', 'Khách xa', 10.9, 106.9),
        selfOrder('near', 'AN-NEAR', 'Khách gần', 10.78, 106.702),
        selfOrder('mid', 'AN-MID', 'Khách giữa', 10.82, 106.75),
      ],
    },
  })
  await page.goto('/shop/delivery/new?orders=far,near,mid')
  await expect(page.getByText('Đơn sẽ giao (3)')).toBeVisible()
  await page.getByLabel(/Thử dịch vụ tối ưu/).uncheck()
  await page.getByRole('button', { name: 'Tối ưu tuyến' }).click()
  await expect(page.getByText('Đã sắp xếp tuyến ngắn nhất')).toBeVisible()

  const route = page.locator('ol').last().locator('li')
  await expect(route.nth(0)).toContainText('Khách gần')
  await expect(route.nth(1)).toContainText('Khách giữa')
  await expect(route.nth(2)).toContainText('Khách xa')
  await expect(page.getByText('điểm giao', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/trip-planner.png', fullPage: true })

  // Manual change: move the first stop down one place.
  await page.getByRole('button', { name: 'Đưa AN-NEAR xuống' }).click()
  await expect(route.nth(0)).toContainText('Khách giữa')

  await page.getByRole('button', { name: 'Lưu và bắt đầu giao' }).click()
  await expect.poll(() => created).not.toBeNull()
  expect(created!.p_order_ids).toEqual(['mid', 'near', 'far'])
  expect(created!.p_shipper_id).toBe('sh1')
  expect(created!.p_trip).toMatchObject({ start: true, end_mode: 'return', optimizer: 'manual', start_lat: 10.7769, start_lng: 106.7009 })
  await expect(page).toHaveURL(/\/shop\/delivery\/t1$/)
})

test('flags orders without a location and puts them last', async ({ page }) => {
  await owner(page, {
    tables: { orders: [selfOrder('a', 'AN-A', 'Khách A', null, null), selfOrder('b', 'AN-B', 'Khách B', 10.78, 106.7)] },
  })
  await page.goto('/shop/delivery/new?orders=a,b')
  await expect(page.getByText('Chưa có vị trí', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Đặt vị trí' })).toBeVisible()
  await expect(page.getByText('1 đơn chưa có vị trí nên được xếp cuối tuyến')).toBeVisible()
})

test('asks for a shipper when the shop has none', async ({ page }) => {
  await owner(page, { rpc: { list_shop_members: [] }, tables: { orders: [selfOrder('a', 'AN-A', 'Khách A', 10.78, 106.7)] } })
  await page.goto('/shop/delivery/new?orders=a')
  await expect(page.getByText('Shop chưa có shipper')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lưu chuyến' })).toBeDisabled()
})

test('owner settles the COD of a finished trip', async ({ page }) => {
  let settled: { p_amount: number; p_note: string | null } | null = null
  await owner(page, {
    rpc: {
      settle_trip: (body: unknown) => {
        settled = body as typeof settled
        return null
      },
    },
    tables: {
      delivery_trips: [
        {
          id: 't1', shop_id: 's1', code: 'CG261113-001', trip_date: '2026-11-13', shipper_id: 'sh1', status: 'done', optimizer: 'local',
          distance_m: 8200, duration_s: 1500, end_mode: 'return', start_lat: null, start_lng: null, cod_expected: 200000, cod_collected: 150000,
          note: null, started_at: null, finished_at: null, settled_at: null, settled_amount: null, settle_note: null,
          shipper: { full_name: 'Shipper An', phone: '0933000111' },
          stops: [
            { id: 's1', order_id: 'o1', seq: 1, status: 'delivered', fail_reason: null, cod_collected: 150000, note: null, proof_photo_path: null, done_at: null, order: { code: 'AN-1', ship_name: 'Khách một', ship_phone: '0900000001', ship_full_text: 'x', ship_lat: null, ship_lng: null, cod_amount: 150000, delivery_note: null, weight_g: 100 } },
            { id: 's2', order_id: 'o2', seq: 2, status: 'failed', fail_reason: 'Không nghe máy', cod_collected: null, note: null, proof_photo_path: null, done_at: null, order: { code: 'AN-2', ship_name: 'Khách hai', ship_phone: '0900000002', ship_full_text: 'y', ship_lat: null, ship_lng: null, cod_amount: 50000, delivery_note: null, weight_g: 100 } },
          ],
        },
      ],
    },
  })
  await page.goto('/shop/delivery/t1')
  await expect(page.getByText('Thất bại: Không nghe máy')).toBeVisible()
  await expect(page.getByText('1/2 đã giao')).toBeVisible()
  await page.screenshot({ path: 'test-results/trip-detail.png', fullPage: true })

  await page.getByRole('button', { name: 'Đối soát tiền thu hộ' }).click()
  await expect(page.getByLabel('Số tiền thực nhận')).toHaveValue('150.000')
  await page.getByLabel('Số tiền thực nhận').fill('140000')
  await expect(page.getByText(/Chênh lệch/)).toBeVisible()
  await page.getByRole('button', { name: 'Xác nhận đã nhận tiền' }).click()
  await expect.poll(() => settled).not.toBeNull()
  expect(settled!.p_amount).toBe(140000)
})

// ------------------------------------------------------------------ shipper

const myTrip = (extra: Record<string, unknown> = {}) => ({
  id: 't1',
  code: 'CG261113-001',
  shop_id: 's1',
  shop_name: 'Shop An',
  trip_date: '2026-11-13',
  status: 'in_progress',
  started_at: '2026-11-13T02:00:00Z',
  cod_expected: 250000,
  cod_collected: 0,
  start_lat: 10.7769,
  start_lng: 106.7009,
  shop_lat: 10.7769,
  shop_lng: 106.7009,
  end_mode: 'return',
  note: null,
  stops: [
    { id: 'st1', seq: 1, status: 'pending', fail_reason: null, cod_collected: null, order_code: 'AN-1', name: 'Nguyễn Thị Lan', phone: '0912345678', address: '12 Lê Lợi, TP. Hồ Chí Minh', lat: 10.78, lng: 106.7, cod: 150000, note: 'Gọi trước 15 phút', weight_g: 500, items: 'Áo thun (Đỏ / M) x2' },
    { id: 'st2', seq: 2, status: 'pending', fail_reason: null, cod_collected: null, order_code: 'AN-2', name: 'Trần Văn B', phone: '0900000002', address: '45 Nguyễn Huệ', lat: null, lng: null, cod: 100000, note: null, weight_g: 300, items: 'Nón x1' },
  ],
  ...extra,
})

async function shipper(page: Page, trips: unknown[], extra: Record<string, unknown> = {}) {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: { my_context: context('shipper', [{ ...shop, role: 'shipper' }]), get_my_trips: trips, ...extra },
  })
}

test('shipper sees the trip, navigates and records a delivery', async ({ page }) => {
  let done: { p_stop_id: string; p_cod: number; p_note: string | null } | null = null
  await shipper(page, [myTrip()], {
    complete_stop: (body: unknown) => {
      done = body as typeof done
      return null
    },
  })
  await page.goto('/ship')
  await expect(page.getByText('Shop An')).toBeVisible()
  await page.getByRole('link', { name: /CG261113-001/ }).click()

  await expect(page.getByText('Điểm 1/2 · AN-1')).toBeVisible()
  await expect(page.getByText('Nguyễn Thị Lan', { exact: true })).toBeVisible()
  await expect(page.getByText('Lưu ý: Gọi trước 15 phút')).toBeVisible()
  await expect(page.getByText('Áo thun (Đỏ / M) x2')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dẫn đường' })).toHaveAttribute('href', /destination=10\.78,106\.7&travelmode=two-wheeler&dir_action=navigate/)
  await expect(page.getByRole('link', { name: 'Gọi' })).toHaveAttribute('href', 'tel:0912345678')
  await page.screenshot({ path: 'test-results/shipper-trip.png', fullPage: true })

  // Jump to the second stop first: it has no coordinates, so navigation falls back to an address search.
  await page.getByRole('button', { name: /Trần Văn B/ }).click()
  await expect(page.getByText('Điểm 2/2 · AN-2')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Dẫn đường' })).toHaveAttribute('href', /maps\/search\/\?api=1&query=45/)

  await page.getByRole('button', { name: 'Đã giao', exact: true }).click()
  await expect(page.getByLabel('Tiền thực thu')).toHaveValue('100.000')
  await page.getByLabel('Tiền thực thu').fill('90000')
  await page.getByRole('button', { name: 'Xác nhận đã giao' }).click()
  await expect.poll(() => done).not.toBeNull()
  expect(done).toMatchObject({ p_stop_id: 'st2', p_cod: 90000 })
})

test('shipper records a failed delivery with a reason', async ({ page }) => {
  let failed: { p_stop_id: string; p_reason: string } | null = null
  await shipper(page, [myTrip()], {
    fail_stop: (body: unknown) => {
      failed = body as typeof failed
      return null
    },
  })
  await page.goto('/ship/trip/t1')
  await page.getByRole('button', { name: 'Thất bại', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ghi nhận thất bại' })).toBeDisabled()
  await page.getByRole('radio', { name: 'Hẹn ngày khác' }).click()
  await page.getByRole('button', { name: 'Ghi nhận thất bại' }).click()
  await expect.poll(() => failed).not.toBeNull()
  expect(failed).toMatchObject({ p_stop_id: 'st1', p_reason: 'Hẹn ngày khác' })
})

test('shipper starts a draft trip and sees the summary of a finished one', async ({ page }) => {
  let started = false
  await shipper(page, [myTrip({ status: 'draft' })], {
    start_trip: () => {
      started = true
      return null
    },
  })
  await page.goto('/ship/trip/t1')
  await page.getByRole('button', { name: 'Bắt đầu chuyến' }).click()
  await expect.poll(() => started).toBe(true)
})

test('shipper sees the cash to hand over after finishing', async ({ page }) => {
  const stops = myTrip().stops.map((s, i) => ({ ...s, status: 'delivered', cod_collected: i === 0 ? 150000 : 100000 }))
  await shipper(page, [myTrip({ status: 'done', cod_collected: 250000, stops })])
  await page.goto('/ship/trip/t1')
  await expect(page.getByText('Hoàn thành chuyến giao')).toBeVisible()
  await expect(page.getByText('250.000đ', { exact: true }).first()).toBeVisible()
})

test('shipper history and the empty state', async ({ page }) => {
  await shipper(page, [], {
    get_my_trip_history: [{ id: 'h1', code: 'CG261112-001', shop_name: 'Shop An', trip_date: '2026-11-12', status: 'done', stops: 5, delivered: 4, failed: 1, cod_collected: 800000, settled_at: null }],
  })
  await page.goto('/ship')
  await expect(page.getByText('Chưa có chuyến giao nào')).toBeVisible()
  await page.getByRole('link', { name: 'Lịch sử' }).click()
  await expect(page.getByText('CG261112-001')).toBeVisible()
  await expect(page.getByText('Chưa nộp')).toBeVisible()
})
