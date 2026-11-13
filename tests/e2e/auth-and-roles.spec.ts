import { expect, test } from '@playwright/test'
import { context, mockSupabase, signedIn } from './mock'

const shop = { id: 's1', name: 'Shop An', order_prefix: 'AN', role: 'owner' as const }

test('redirects to the login page when signed out', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Smart Delivery' })).toBeVisible()
  await page.screenshot({ path: 'test-results/login.png' })
})

test('rejects an invalid phone number before calling the server', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/login')
  await page.getByLabel('Số điện thoại').fill('12345')
  await page.getByLabel('Mật khẩu', { exact: true }).fill('whatever1')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByText('Số điện thoại di động không hợp lệ')).toBeVisible()
})

test('admin lands on the system page with the admin navigation', async ({ page }) => {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: {
      my_context: context('admin'),
      admin_list_shops: [],
      admin_list_accounts: [],
      admin_db_usage: 52_428_800,
    },
  })
  await page.goto('/')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Hệ thống' })).toBeVisible()
  await expect(page.getByText('50.0 MB / 500 MB')).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  await expect(nav.getByText('Cửa hàng')).toBeVisible()
  await expect(nav.getByText('Tài khoản')).toBeVisible()
  await page.screenshot({ path: 'test-results/admin-home.png' })
})

test('owner lands on the shop area and cannot open the admin area', async ({ page }) => {
  await signedIn(page)
  await mockSupabase(page, { rpc: { my_context: context('owner', [shop]) } })
  await page.goto('/')
  await expect(page).toHaveURL(/\/shop$/)
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  await expect(nav.getByText('Đơn hàng')).toBeVisible()
  await expect(nav.getByText('Kho')).toBeVisible()

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/shop$/)
})

test('shipper lands on the shipper area', async ({ page }) => {
  await signedIn(page)
  await mockSupabase(page, { rpc: { my_context: context('shipper', [{ ...shop, role: 'shipper' }]) } })
  await page.goto('/')
  await expect(page).toHaveURL(/\/ship$/)
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
  await expect(nav.getByText('Chuyến hôm nay')).toBeVisible()
  await page.goto('/shop')
  await expect(page).toHaveURL(/\/ship$/)
})

test('forces a password change while the temporary password is in use', async ({ page }) => {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: { my_context: context('owner', [shop], { must_change_password: true }) },
  })
  await page.goto('/shop')
  await expect(page).toHaveURL(/\/change-password$/)
  await expect(page.getByText('Bạn đang dùng mật khẩu tạm')).toBeVisible()
  await page.screenshot({ path: 'test-results/change-password.png' })
})

test('shows a clear message for a locked account', async ({ page }) => {
  await signedIn(page)
  await mockSupabase(page, { rpc: { my_context: null } })
  await page.goto('/')
  await expect(page.getByText('Tài khoản không hoạt động')).toBeVisible()
})

test('admin shop list and shop owner picker', async ({ page }) => {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: {
      my_context: context('admin'),
      admin_list_shops: [
        {
          id: 's1',
          name: 'Shop An',
          phone: '0987654321',
          address: '12 Lê Lợi',
          order_prefix: 'AN',
          active: true,
          created_at: '2026-11-01T00:00:00Z',
          owners: [{ id: 'o1', full_name: 'Trần Chủ', phone: '0911111111' }],
          shipper_count: 2,
        },
      ],
      admin_list_accounts: [],
    },
  })
  await page.goto('/admin/shops')
  await expect(page.getByText('Chủ: Trần Chủ')).toBeVisible()
  await page.getByText('Shop An').click()
  await expect(page.getByRole('button', { name: 'Vào cửa hàng' })).toBeVisible()
  await page.screenshot({ path: 'test-results/admin-shop-sheet.png' })
})
