import { expect, test, type Page } from '@playwright/test'
import { context, mockSupabase, signedIn } from './mock'

const HOUR = 3_600_000
const DAY = 24 * HOUR

async function adminHome(page: Page, lastPingAgoMs: number) {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: {
      my_context: context('admin'),
      admin_list_shops: [],
      admin_list_accounts: [],
      admin_db_usage: 10 * 1024 * 1024,
      admin_shop_summary: [],
      admin_heartbeat: { last_ping: new Date(Date.now() - lastPingAgoMs).toISOString(), pings: 42 },
    },
  })
  await page.goto('/admin')
}

test('admin sees that the keep-alive pings are healthy', async ({ page }) => {
  await adminHome(page, 3 * HOUR)
  await expect(page.getByText('Giữ Supabase không bị tạm dừng')).toBeVisible()
  await expect(page.getByText('Hoạt động bình thường. Lần gọi gần nhất: 3 giờ trước.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/heartbeat-ok.png' })
})

test('admin is warned when the pings seem to have stopped', async ({ page }) => {
  await adminHome(page, 3 * DAY)
  const alert = page.getByRole('alert').filter({ hasText: 'Giữ Supabase' })
  await expect(alert).toContainText('3 ngày trước')
  await expect(alert).toContainText('Kiểm tra workflow')
})

test('admin gets an urgent warning shortly before a pause', async ({ page }) => {
  await adminHome(page, 6 * DAY)
  const alert = page.getByRole('alert').filter({ hasText: 'Giữ Supabase' })
  await expect(alert).toContainText('6 ngày trước')
  await expect(alert).toContainText('sắp bị tạm dừng')
  await page.screenshot({ path: 'test-results/heartbeat-danger.png' })
})

test('login explains a possibly paused project when the server cannot be reached', async ({ page }) => {
  await mockSupabase(page)
  await page.route('http://supabase.test/auth/v1/token**', (route) => route.abort())
  await page.goto('/login')
  await page.getByLabel('Số điện thoại').fill('0912345678')
  await page.getByLabel('Mật khẩu', { exact: true }).fill('some-password')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()

  const hint = page.getByRole('note')
  await expect(hint).toContainText('Không kết nối được máy chủ')
  await expect(hint).toContainText('tạm dừng')
  await expect(hint).toContainText('Restore project')
  await page.screenshot({ path: 'test-results/paused-hint.png' })
})

test('a wrong password is still reported as a wrong password, not as a paused project', async ({ page }) => {
  await mockSupabase(page)
  await page.route('http://supabase.test/auth/v1/token**', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }),
    }),
  )
  await page.goto('/login')
  await page.getByLabel('Số điện thoại').fill('0912345678')
  await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByRole('alert')).toContainText('Sai số điện thoại hoặc mật khẩu')
  await expect(page.getByRole('note')).toHaveCount(0)
})

test('the app explains the problem when the account cannot be loaded after signing in', async ({ page }) => {
  await signedIn(page)
  await mockSupabase(page, { rpc: { my_context: context('owner') } })
  await page.route('http://supabase.test/rest/v1/rpc/my_context', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByText('Không tải được thông tin tài khoản')).toBeVisible()
  await expect(page.getByRole('note')).toContainText('tạm dừng')
})
