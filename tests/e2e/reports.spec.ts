import { expect, test, type Page } from '@playwright/test'
import { context, mockSupabase, signedIn } from './mock'

const shop = { id: 's1', name: 'Shop An', order_prefix: 'AN', role: 'owner' as const }

const dashboard = {
  today: '2026-11-13',
  orders_created: 7,
  revenue_created: 2_100_000,
  delivered_today: 4,
  revenue_delivered_today: 1_450_000,
  to_process: 3,
  new_orders: 2,
  shipping: 5,
  failed: 1,
  returning: 0,
  cod_on_the_road: 1_800_000,
  vtp_waiting_tracking: 2,
  low_stock: 3,
  unsettled_trips: 1,
  unsettled_cod: 600_000,
  active_trips: 1,
}

const report = {
  from: '2026-11-07',
  to: '2026-11-13',
  totals: { orders_created: 20, cancelled: 2, delivered: 14, returned: 3, revenue: 6_000_000, goods_revenue: 5_500_000, cost: 3_000_000, gross_profit: 2_500_000 },
  by_day: [
    { day: '2026-11-08', orders: 3, revenue: 900_000 },
    { day: '2026-11-12', orders: 5, revenue: 2_000_000 },
  ],
  top_products: [{ name: 'Áo thun basic', qty: 30, revenue: 4_500_000, profit: 2_100_000 }],
  top_variants: [{ name: 'Áo thun basic (Đỏ / M)', sku: 'ATB-DO-M', qty: 12, revenue: 1_800_000 }],
  top_customers: [{ name: 'Nguyễn Thị Lan', phone: '0912345678', orders: 4, spent: 1_300_000 }],
  by_method: [{ method: 'self', orders: 12, delivered: 9, returned: 1 }, { method: 'vtp', orders: 8, delivered: 5, returned: 2 }],
  shippers: [{ name: 'Shipper An', trips: 5, delivered: 9, failed: 1, cod_collected: 3_200_000 }],
}

async function setup(page: Page, rpc: Record<string, unknown> = {}) {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: { my_context: context('owner', [shop]), dashboard_summary: dashboard, sales_report: report, ...rpc },
  })
}

test('dashboard shows today’s numbers, alerts and shortcuts', async ({ page }) => {
  await setup(page)
  await page.goto('/shop')
  await expect(page.getByRole('heading', { name: 'Tổng quan' })).toBeVisible()
  await expect(page.getByText('1.450.000đ', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('COD trên đường 1.800.000đ')).toBeVisible()
  await expect(page.getByRole('link', { name: '2 đơn mới chưa xác nhận' })).toBeVisible()
  await expect(page.getByRole('link', { name: '1 đơn giao thất bại chờ xử lý' })).toBeVisible()
  await expect(page.getByRole('link', { name: '2 đơn ViettelPost quá 2 ngày chưa có mã vận đơn' })).toHaveAttribute('href', '/shop/vtp/tracking')
  await expect(page.getByRole('link', { name: '3 biến thể sắp hết hàng' })).toHaveAttribute('href', '/shop/inventory?filter=low')
  await expect(page.getByRole('link', { name: /1 chuyến giao chưa đối soát \(600\.000đ\)/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Lập chuyến giao' })).toBeVisible()
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true })
})

test('dashboard has no alerts when everything is fine', async ({ page }) => {
  await setup(page, {
    dashboard_summary: { ...dashboard, new_orders: 0, failed: 0, vtp_waiting_tracking: 0, low_stock: 0, unsettled_trips: 0, unsettled_cod: 0, active_trips: 0 },
  })
  await page.goto('/shop')
  await expect(page.getByText('Cần chú ý')).toHaveCount(0)
})

test('the low-stock alert opens the inventory already filtered', async ({ page }) => {
  let filter: string | null = null
  await setup(page, {
    list_products: (body: unknown) => {
      filter = (body as { p_filter: string }).p_filter
      return []
    },
  })
  await page.goto('/shop/inventory?filter=low')
  await expect.poll(() => filter).toBe('low')
})

test('report shows totals, return rate and the lists', async ({ page }) => {
  let range: { p_from: string; p_to: string } | null = null
  await setup(page, {
    sales_report: (body: unknown) => {
      range = body as typeof range
      return report
    },
  })
  await page.goto('/shop/reports')
  await expect(page.getByText('6.000.000đ', { exact: true })).toBeVisible()
  await expect(page.getByText('2.500.000đ', { exact: true })).toBeVisible()
  await expect(page.getByText('18% trên đơn đã có kết quả')).toBeVisible() // 3 / (14 + 3)
  await expect(page.getByText('Áo thun basic', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Áo thun basic (Đỏ / M)')).toBeVisible()
  await expect(page.getByText('Tự giao')).toBeVisible()
  await expect(page.getByText('29% hoàn')).toBeVisible() // vtp: 2 / (5 + 2)
  await expect(page.getByRole('img', { name: /Biểu đồ cột/ })).toBeVisible()
  expect(range!.p_to >= range!.p_from).toBe(true)
  await page.screenshot({ path: 'test-results/reports.png', fullPage: true })

  await page.getByRole('button', { name: 'Hôm nay' }).click()
  await expect.poll(() => range!.p_from === range!.p_to).toBe(true)
})

test('report shows an empty state without orders', async ({ page }) => {
  await setup(page, {
    sales_report: { ...report, totals: { ...report.totals, orders_created: 0, delivered: 0, returned: 0, revenue: 0, gross_profit: 0, cost: 0, cancelled: 0 }, by_day: [], top_products: [], top_variants: [], top_customers: [], by_method: [], shippers: [] },
  })
  await page.goto('/shop/reports')
  await expect(page.getByText('Chưa có đơn nào trong khoảng này')).toBeVisible()
})

test('admin home warns when the database is nearly full and lists shops', async ({ page }) => {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: {
      my_context: context('admin'),
      admin_list_shops: [],
      admin_list_accounts: [],
      admin_db_usage: 400 * 1024 * 1024,
      admin_shop_summary: [{ shop_id: 's1', name: 'Shop An', active: true, orders_30d: 120, delivered_30d: 90, revenue_30d: 31_000_000 }],
    },
  })
  await page.goto('/admin')
  await expect(page.getByRole('alert')).toContainText('quá 70%')
  await expect(page.getByText('120 đơn · đã giao 90')).toBeVisible()
  await expect(page.getByText('31.000.000đ')).toBeVisible()
})
