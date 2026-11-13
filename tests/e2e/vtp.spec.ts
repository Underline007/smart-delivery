import { expect, test, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { context, mockSupabase, signedIn } from './mock'

const shop = { id: 's1', name: 'Shop An', order_prefix: 'AN', role: 'owner' as const }

const vtpOrder = (id: string, code: string, extra: Record<string, unknown> = {}) => ({
  id,
  shop_id: 's1',
  code,
  customer_id: null,
  status: 'confirmed',
  delivery_method: 'vtp',
  ship_name: 'Nguyễn Thị Lan',
  ship_phone: '0912345678',
  ship_detail: '12 Lê Lợi',
  ship_province_code: '79',
  ship_ward_code: 'w1',
  ship_ward_text: null,
  ship_full_text: '12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
  ship_lat: null,
  ship_lng: null,
  subtotal: 300000,
  shipping_fee: 30000,
  discount: 0,
  total: 330000,
  paid_amount: 0,
  cod_amount: 330000,
  weight_g: 600,
  delivery_note: 'Gọi trước',
  internal_note: null,
  vtp_service: 'VCN',
  vtp_fee_payer: 'sender',
  vtp_delivery_requirement: 'no_view',
  vtp_tracking_code: null,
  vtp_batch_id: null,
  stock_deducted: true,
  confirmed_at: null,
  delivered_at: null,
  created_at: '2026-11-13T03:00:00Z',
  items: [
    { id: 'i1', variant_id: 'v1', product_name: 'Áo thun', variant_label: 'Đỏ / M', sku: 'A', unit_cost: 1, weight_g: 250, qty: 2, unit_price: 150000 },
  ],
  ...extra,
})

async function setup(page: Page, extra: Parameters<typeof mockSupabase>[1] = {}, role: 'owner' | 'admin' = 'owner') {
  await signedIn(page)
  await mockSupabase(page, {
    rpc: { my_context: context(role, role === 'owner' ? [shop] : []), ...extra.rpc },
    tables: {
      orders: [vtpOrder('o1', 'AN261113-001'), vtpOrder('o2', 'AN261113-002', { ship_name: 'Trần Văn B', ship_phone: '0900000002' })],
      system_settings: [{ vtp_template_name: null, vtp_template_version: null, vtp_template_b64: null, vtp_column_mapping: null, map_provider: 'osm' }],
      shops: [{ id: 's1', name: 'Shop An', phone: '0987654321', address: '1 Nguyễn Huệ', lat: null, lng: null, order_prefix: 'AN', active: true }],
      provinces: [{ code: '79', name: 'TP. Hồ Chí Minh' }],
      wards: [{ code: 'w1', name: 'Phường Bến Thành' }],
      vtp_export_batches: [],
      ...extra.tables,
    },
    counts: { provinces: 34, wards: 3321, ...extra.counts },
  })
}

test('exports valid orders to a real Excel file and records the batch', async ({ page }) => {
  let batch: { p_order_ids: string[]; p_file_name: string } | null = null
  await setup(page, {
    rpc: {
      create_vtp_batch: (body: unknown) => {
        batch = body as typeof batch
        return 'batch-1'
      },
    },
  })
  await page.goto('/shop/vtp/export?orders=o1,o2')
  await expect(page.getByText('AN261113-001 · Nguyễn Thị Lan')).toBeVisible()
  await expect(page.getByText('Chưa có file mẫu ViettelPost')).toBeVisible()
  await page.screenshot({ path: 'test-results/vtp-export.png' })

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Tạo file Excel (2 đơn)' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^VTP_AN_\d{8}_2don\.xlsx$/)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile((await file.path())!)
  const ws = wb.worksheets[0]
  expect(ws.getRow(2).getCell('B').value).toBe('AN261113-001')
  expect(ws.getRow(2).getCell('C').value).toBe('Nguyễn Thị Lan')
  expect(ws.getRow(2).getCell('D').value).toBe('0912345678')
  expect(ws.getRow(2).getCell('F').value).toBe('Phường Bến Thành')
  expect(ws.getRow(2).getCell('G').value).toBe('TP. Hồ Chí Minh')
  expect(ws.getRow(2).getCell('H').value).toBe('Áo thun (Đỏ / M) x2')
  expect(ws.getRow(2).getCell('J').value).toBe(600)
  expect(ws.getRow(2).getCell('L').value).toBe(330000)
  expect(ws.getRow(3).getCell('C').value).toBe('Trần Văn B')

  await expect.poll(() => batch).not.toBeNull()
  expect(batch!.p_order_ids).toEqual(['o1', 'o2'])
  await expect(page.getByText('Đã xuất 2 đơn')).toBeVisible()
})

test('blocks export while a selected order has errors, and lets you leave it out', async ({ page }) => {
  await setup(page, {
    tables: {
      orders: [
        vtpOrder('o1', 'AN261113-001'),
        vtpOrder('o2', 'AN261113-002', { weight_g: 0, ship_ward_code: null, ship_ward_text: null }),
      ],
    },
  })
  await page.goto('/shop/vtp/export?orders=o1,o2')
  await expect(page.getByText('✕ Khối lượng phải lớn hơn 0')).toBeVisible()
  await expect(page.getByText('✕ Thiếu phường/xã')).toBeVisible()
  const button = page.getByRole('button', { name: /Tạo file Excel/ })
  await expect(button).toBeDisabled()
  await expect(page.getByText('1 đơn còn lỗi')).toBeVisible()

  await page.getByRole('button', { name: /AN261113-002/ }).click()
  await expect(page.getByRole('button', { name: 'Tạo file Excel (1 đơn)' })).toBeEnabled()
})

test('imports tracking codes from a pasted list', async ({ page }) => {
  let applied: { p_rows: { order_code: string; tracking_code: string }[] } | null = null
  await setup(page, {
    rpc: {
      apply_vtp_tracking: (body: unknown) => {
        applied = body as typeof applied
        return { applied: 1, skipped: [] }
      },
    },
    tables: {
      orders: [
        { code: 'AN261113-001', status: 'vtp_exported', delivery_method: 'vtp', vtp_tracking_code: null },
        { code: 'AN261113-002', status: 'new', delivery_method: 'vtp', vtp_tracking_code: null },
      ],
    },
  })
  await page.goto('/shop/vtp/tracking')
  await page.getByLabel('Dán mã đơn và mã vận đơn').fill('AN261113-001  VTP123456789\nVTP987654321 an261113-002\nAN261113-099 VTP555555555')
  await page.getByRole('button', { name: 'Đọc danh sách' }).click()

  await expect(page.getByText('1/3 dòng áp dụng được')).toBeVisible()
  await expect(page.getByText('Sẽ cập nhật')).toHaveCount(1)
  await expect(page.getByText('Đơn đang ở trạng thái “Mới”')).toBeVisible()
  await expect(page.getByText('Không tìm thấy đơn')).toBeVisible()
  await page.screenshot({ path: 'test-results/vtp-tracking.png' })

  await page.getByRole('button', { name: 'Cập nhật 1 đơn' }).click()
  await expect.poll(() => applied).not.toBeNull()
  expect(applied!.p_rows).toEqual([{ order_code: 'AN261113-001', tracking_code: 'VTP123456789' }])
})

test('admin uploads a template, the columns are guessed, and the mapping is saved', async ({ page }) => {
  let saved: { p_name: string; p_b64: string; p_mapping: { sheet: string; headerRow: number; firstDataRow: number; columns: { col: string; field: string }[] } } | null = null
  await setup(
    page,
    {
      rpc: {
        admin_save_vtp_template: (body: unknown) => {
          saved = body as typeof saved
          return '20261113000000'
        },
      },
    },
    'admin',
  )

  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('Hướng dẫn').getCell('A1').value = 'Đọc kỹ'
  const ws = wb.addWorksheet('Nhập đơn')
  ws.getCell('A1').value = 'MẪU TẠO ĐƠN HÀNG LOẠT'
  ws.getRow(3).values = [undefined, 'STT', 'Họ tên người nhận', 'Số điện thoại người nhận', 'Địa chỉ người nhận', 'Khối lượng (gram)', 'Tiền thu hộ COD', 'Cột lạ']
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())

  await page.goto('/admin/vtp-template')
  await expect(page.getByText('Bố cục mặc định')).toBeVisible()
  await page.getByLabel('Chọn file mẫu Excel').setInputFiles({ name: 'mau-vtp.xlsx', mimeType: 'application/octet-stream', buffer })

  await expect(page.getByText('mau-vtp.xlsx')).toBeVisible()
  await page.getByLabel('Sheet nhập đơn').selectOption('Nhập đơn')
  await expect(page.getByLabel('Dòng tiêu đề')).toHaveValue('3')
  await expect(page.getByLabel('Dòng điền đơn đầu tiên')).toHaveValue('4')
  await expect(page.getByLabel('Dữ liệu cho cột C')).toHaveValue('receiver_name')
  await expect(page.getByLabel('Dữ liệu cho cột D')).toHaveValue('receiver_phone')
  await expect(page.getByLabel('Dữ liệu cho cột F')).toHaveValue('weight_g')
  await expect(page.getByLabel('Dữ liệu cho cột G')).toHaveValue('cod')
  await expect(page.getByLabel('Dữ liệu cho cột H')).toHaveValue('')
  await page.screenshot({ path: 'test-results/vtp-template.png', fullPage: true })

  await page.getByLabel('Dữ liệu cho cột H').selectOption('note')
  await page.getByRole('button', { name: 'Lưu mẫu' }).click()
  await expect.poll(() => saved).not.toBeNull()
  expect(saved!.p_name).toBe('mau-vtp.xlsx')
  expect(saved!.p_b64.length).toBeGreaterThan(100)
  expect(saved!.p_mapping).toMatchObject({ sheet: 'Nhập đơn', headerRow: 3, firstDataRow: 4 })
  expect(saved!.p_mapping.columns.map((c) => `${c.col}:${c.field}`)).toEqual([
    'B:index',
    'C:receiver_name',
    'D:receiver_phone',
    'E:receiver_address',
    'F:weight_g',
    'G:cod',
    'H:note',
  ])
})
