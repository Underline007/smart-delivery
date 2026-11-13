import { describe, expect, it } from 'vitest'
import type { OrderWithItems } from '@/features/orders/api'
import { buildWorkbook, exportFileName } from './exporter'
import {
  columnIndex,
  columnLetters,
  DEFAULT_MAPPING,
  suggestField,
  type ExportOrder,
  type TemplateMapping,
} from './fields'
import { describeForExport, toExportOrder, validateForVtp } from './prepare'
import { detectTrackingColumns, extractTracking, parsePastedTracking, readSheetRows } from './tracking'

const sender = { name: 'Shop An', phone: '0987654321', address: '1 Nguyễn Huệ, TP. Hồ Chí Minh' }

const exportOrder = (extra: Partial<ExportOrder> = {}): ExportOrder => ({
  index: 1,
  code: 'AN261113-001',
  receiverName: 'Nguyễn Thị Lan',
  receiverPhone: '0912345678',
  receiverAddress: '12 Lê Lợi',
  receiverWard: 'Phường Bến Thành',
  receiverDistrict: '',
  receiverProvince: 'TP. Hồ Chí Minh',
  receiverFullAddress: '12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
  productName: 'Áo thun (Đỏ / M) x2',
  productQty: 2,
  weightG: 600,
  goodsValue: 300_000,
  cod: 330_000,
  service: 'VCN',
  feePayer: 'sender',
  deliveryRequirement: 'no_view',
  note: 'Gọi trước',
  ...extra,
})

async function readBack(bytes: Uint8Array) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes as unknown as ArrayBuffer)
  return wb
}

describe('column letters', () => {
  it('converts both ways', () => {
    expect(columnIndex('A')).toBe(1)
    expect(columnIndex('Z')).toBe(26)
    expect(columnIndex('AB')).toBe(28)
    expect(columnLetters(1)).toBe('A')
    expect(columnLetters(28)).toBe('AB')
    expect(columnLetters(columnIndex('ZZ'))).toBe('ZZ')
  })
})

describe('suggestField', () => {
  it.each([
    ['STT', 'index'],
    ['Mã đơn hàng riêng', 'order_code'],
    ['Họ tên người nhận', 'receiver_name'],
    ['Tên người gửi', 'sender_name'],
    ['SĐT người nhận', 'receiver_phone'],
    ['Điện thoại người gửi', 'sender_phone'],
    ['Địa chỉ người nhận', 'receiver_address'],
    ['Địa chỉ đầy đủ', 'receiver_full_address'],
    ['Phường/Xã', 'receiver_ward'],
    ['Quận/Huyện', 'receiver_district'],
    ['Tỉnh/Thành phố', 'receiver_province'],
    ['Tên hàng hóa', 'product_name'],
    ['Số lượng', 'product_qty'],
    ['Khối lượng (gram)', 'weight_g'],
    ['Trọng lượng (kg)', 'weight_kg'],
    ['Giá trị hàng', 'goods_value'],
    ['Tiền thu hộ COD', 'cod'],
    ['Dịch vụ', 'service'],
    ['Người trả cước', 'fee_payer'],
    ['Yêu cầu khi giao', 'delivery_requirement'],
    ['Ghi chú', 'note'],
  ])('%s → %s', (header, field) => {
    expect(suggestField(header)).toBe(field)
  })

  it('returns null for unknown or empty headers', () => {
    expect(suggestField('Cột lạ')).toBeNull()
    expect(suggestField('')).toBeNull()
  })
})

describe('buildWorkbook · built-in layout', () => {
  it('writes headers and one row per order with the right values', async () => {
    const bytes = await buildWorkbook({
      orders: [exportOrder(), exportOrder({ index: 2, code: 'AN261113-002', receiverPhone: '0900000001', cod: 0, feePayer: 'receiver' })],
      sender,
    })
    const ws = (await readBack(bytes)).worksheets[0]
    expect(ws.getRow(1).values).toEqual([undefined, 'STT', 'Mã đơn của shop', 'Tên người nhận', 'SĐT người nhận', 'Địa chỉ (số nhà, đường)', 'Phường / xã', 'Tỉnh / thành phố', 'Tên hàng hoá', 'Số lượng', 'Khối lượng (gram)', 'Giá trị hàng hoá', 'Tiền thu hộ (COD)', 'Dịch vụ', 'Người trả cước', 'Yêu cầu khi giao', 'Ghi chú'])
    const row = ws.getRow(2)
    expect(row.getCell('B').value).toBe('AN261113-001')
    expect(row.getCell('C').value).toBe('Nguyễn Thị Lan')
    expect(row.getCell('D').value).toBe('0912345678') // stays text, leading zero kept
    expect(row.getCell('J').value).toBe(600)
    expect(row.getCell('L').value).toBe(330_000)
    expect(row.getCell('N').value).toBe('Người gửi')
    expect(row.getCell('O').value).toBe('Không cho xem hàng')
    expect(ws.getRow(3).getCell('D').value).toBe('0900000001')
    expect(ws.getRow(3).getCell('L').value).toBe(0)
    expect(ws.getRow(3).getCell('N').value).toBe('Người nhận')
    expect(ws.getRow(4).getCell('B').value).toBeNull()
  })
})

describe('buildWorkbook · with a template', () => {
  const mapping: TemplateMapping = {
    sheet: 'Don hang',
    headerRow: 3,
    firstDataRow: 4,
    columns: [
      { col: 'B', field: 'receiver_name' },
      { col: 'C', field: 'receiver_phone' },
      { col: 'E', field: 'weight_kg' },
      { col: 'F', field: 'cod' },
      { col: 'H', field: 'static', value: 'COD' },
      { col: 'I', field: 'fee_payer' },
    ],
    values: { fee_payer: { sender: '1', receiver: '2' } },
  }

  async function makeTemplate() {
    const { default: ExcelJS } = await import('exceljs')
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Huong dan').getCell('A1').value = 'Đọc kỹ hướng dẫn'
    const ws = wb.addWorksheet('Don hang')
    ws.getCell('A1').value = 'MẪU NHẬP ĐƠN'
    ws.getRow(3).values = [undefined, 'Tên', 'SĐT', 'Địa chỉ', 'KL', 'COD', 'x', 'Loại', 'Cước']
    // an example row with a style and sample data
    const example = ws.getRow(4)
    example.getCell('B').value = 'Ví dụ'
    example.getCell('F').value = 99
    example.getCell('F').numFmt = '#,##0'
    example.getCell('F').font = { bold: true, color: { argb: 'FFFF0000' } }
    ws.getRow(5).getCell('B').value = 'Ví dụ 2'
    ws.getRow(6).getCell('B').value = 'Ví dụ 3'
    return new Uint8Array(await wb.xlsx.writeBuffer())
  }

  it('fills the template, keeps other sheets and cells, and clears leftover examples', async () => {
    const bytes = await buildWorkbook({
      orders: [exportOrder(), exportOrder({ index: 2, receiverName: 'Trần B', cod: 100_000, weightG: 1500, feePayer: 'receiver' })],
      sender,
      mapping,
      template: await makeTemplate(),
    })
    const wb = await readBack(bytes)
    expect(wb.getWorksheet('Huong dan')!.getCell('A1').value).toBe('Đọc kỹ hướng dẫn')
    const ws = wb.getWorksheet('Don hang')!
    expect(ws.getCell('A1').value).toBe('MẪU NHẬP ĐƠN')
    expect(ws.getRow(3).getCell('B').value).toBe('Tên')

    expect(ws.getRow(4).getCell('B').value).toBe('Nguyễn Thị Lan')
    expect(ws.getRow(4).getCell('E').value).toBe(0.6)
    expect(ws.getRow(4).getCell('H').value).toBe('COD')
    expect(ws.getRow(4).getCell('I').value).toBe('1')
    expect(ws.getRow(5).getCell('B').value).toBe('Trần B')
    expect(ws.getRow(5).getCell('E').value).toBe(1.5)
    expect(ws.getRow(5).getCell('I').value).toBe('2')
    // the third example row is emptied
    expect(ws.getRow(6).getCell('B').value).toBeNull()
  })

  it('copies the first data row’s formatting to the next rows', async () => {
    const bytes = await buildWorkbook({
      orders: [exportOrder(), exportOrder({ index: 2 })],
      sender,
      mapping,
      template: await makeTemplate(),
    })
    const ws = (await readBack(bytes)).getWorksheet('Don hang')!
    expect(ws.getRow(5).getCell('F').numFmt).toBe('#,##0')
    expect(ws.getRow(5).getCell('F').font?.bold).toBe(true)
  })

  it('explains a missing sheet', async () => {
    await expect(
      buildWorkbook({ orders: [exportOrder()], sender, mapping: { ...mapping, sheet: 'Khac' }, template: await makeTemplate() }),
    ).rejects.toThrow('Không tìm thấy sheet "Khac"')
  })
})

describe('describeForExport', () => {
  const item = (name: string, label: string, qty: number) =>
    ({ product_name: name, variant_label: label, qty }) as OrderWithItems['items'][number]

  it('lists items with their variants', () => {
    expect(describeForExport([item('Áo thun', 'Đỏ / M', 2), item('Nón', '', 1)])).toBe('Áo thun (Đỏ / M) x2; Nón x1')
  })

  it('shortens a long list and says how many were left out', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`Sản phẩm số ${i + 1}`, 'Đỏ / M', 1))
    const text = describeForExport(items, 80)
    expect(text.length).toBeLessThanOrEqual(80)
    expect(text).toMatch(/\+\d+ SP khác$/)
    expect(text.startsWith('Sản phẩm số 1 (Đỏ / M) x1')).toBe(true)
  })

  it('cuts a single very long name', () => {
    const text = describeForExport([item('A'.repeat(300), '', 1)], 50)
    expect(text.length).toBeLessThanOrEqual(50)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('validateForVtp', () => {
  const base = {
    delivery_method: 'vtp',
    status: 'confirmed',
    ship_name: 'Lan',
    ship_phone: '0912345678',
    ship_detail: '12 Lê Lợi',
    ship_province_code: '79',
    ship_ward_code: 'w1',
    ship_ward_text: null,
    weight_g: 500,
    vtp_service: 'VCN',
    cod_amount: 100_000,
  } as unknown as OrderWithItems

  it('accepts a complete order', () => {
    expect(validateForVtp(base, { wardCatalogLoaded: true })).toEqual({ errors: [], warnings: [] })
  })

  it('reports everything that is missing', () => {
    const { errors } = validateForVtp(
      { ...base, ship_name: '', ship_phone: null, ship_detail: '', ship_province_code: null, weight_g: 0, vtp_service: '' } as unknown as OrderWithItems,
      { wardCatalogLoaded: true },
    )
    expect(errors).toEqual([
      'Thiếu tên người nhận',
      'Thiếu số điện thoại người nhận',
      'Thiếu địa chỉ chi tiết',
      'Thiếu tỉnh/thành',
      'Khối lượng phải lớn hơn 0',
      'Thiếu mã dịch vụ ViettelPost',
    ])
  })

  it('treats a typed ward as a warning only while the catalogue is empty', () => {
    const typed = { ...base, ship_ward_code: null, ship_ward_text: 'Phường Lạ' } as unknown as OrderWithItems
    expect(validateForVtp(typed, { wardCatalogLoaded: false })).toMatchObject({ errors: [], warnings: [expect.stringContaining('chưa chọn từ danh mục')] })
    expect(validateForVtp(typed, { wardCatalogLoaded: true }).errors).toHaveLength(1)
    expect(validateForVtp({ ...typed, ship_ward_text: null } as unknown as OrderWithItems, { wardCatalogLoaded: false }).errors).toEqual(['Thiếu phường/xã'])
  })

  it('rejects an order that is not confirmed or not for ViettelPost', () => {
    expect(validateForVtp({ ...base, status: 'new' } as unknown as OrderWithItems, { wardCatalogLoaded: true }).errors).toHaveLength(1)
    expect(validateForVtp({ ...base, delivery_method: 'self' } as unknown as OrderWithItems, { wardCatalogLoaded: true }).errors).toHaveLength(1)
  })
})

describe('toExportOrder', () => {
  it('resolves province and ward names and totals', () => {
    const order = {
      code: 'AN1',
      ship_name: 'Lan',
      ship_phone: '0912345678',
      ship_detail: '12 Lê Lợi',
      ship_province_code: '79',
      ship_ward_code: 'w1',
      ship_ward_text: null,
      ship_full_text: 'x',
      items: [{ product_name: 'Áo', variant_label: 'Đỏ', qty: 2 }, { product_name: 'Nón', variant_label: '', qty: 1 }],
      weight_g: 700,
      subtotal: 300_000,
      cod_amount: 250_000,
      vtp_service: 'VCN',
      vtp_fee_payer: 'receiver',
      vtp_delivery_requirement: 'try',
      delivery_note: null,
    } as unknown as OrderWithItems
    const result = toExportOrder(order, 3, { provinces: new Map([['79', 'TP. Hồ Chí Minh']]), wards: new Map([['w1', 'Phường Bến Thành']]) })
    expect(result).toMatchObject({
      index: 3,
      receiverProvince: 'TP. Hồ Chí Minh',
      receiverWard: 'Phường Bến Thành',
      productName: 'Áo (Đỏ) x2; Nón x1',
      productQty: 3,
      feePayer: 'receiver',
      deliveryRequirement: 'try',
      note: '',
    })
  })
})

describe('exportFileName', () => {
  it('builds the name', () => {
    expect(exportFileName('AN', 15, '2026-11-13')).toBe('VTP_AN_20261113_15don.xlsx')
  })
})

describe('tracking import', () => {
  const rows = [
    ['Mã vận đơn', 'Mã đơn hàng', 'Người nhận', 'COD'],
    ['VTP123456789', 'AN261113-001', 'Lan', '330000'],
    ['VTP987654321', 'an261113-002', 'Trần B', '0'],
    ['', 'AN261113-003', 'Chưa có', '0'],
  ]

  it('finds the columns by their headers', () => {
    expect(detectTrackingColumns(rows)).toEqual({ headerRow: 0, orderCol: 1, trackingCol: 0 })
  })

  it('finds the columns by what the cells look like when headers are unclear', () => {
    const unnamed = [
      ['A', 'B', 'C'],
      ['x', 'AN261113-001', 'VTP123456789'],
      ['y', 'AN261113-002', 'VTP987654321'],
    ]
    expect(detectTrackingColumns(unnamed)).toEqual({ headerRow: 0, orderCol: 1, trackingCol: 2 })
  })

  it('returns null when nothing looks like an order code', () => {
    expect(detectTrackingColumns([['a', 'b'], ['1', '2']])).toBeNull()
  })

  it('extracts only rows with both values', () => {
    const columns = detectTrackingColumns(rows)!
    expect(extractTracking(rows, columns)).toEqual([
      { order_code: 'AN261113-001', tracking_code: 'VTP123456789' },
      { order_code: 'an261113-002', tracking_code: 'VTP987654321' },
    ])
  })

  it('reads a real xlsx file and a CSV', async () => {
    const bytes = await buildWorkbook({
      orders: [exportOrder()],
      sender,
      mapping: { ...DEFAULT_MAPPING, columns: DEFAULT_MAPPING.columns.slice(0, 3) },
    })
    const fromXlsx = await readSheetRows({ name: 'don.xlsx', bytes })
    expect(fromXlsx[0]).toEqual(['STT', 'Mã đơn của shop', 'Tên người nhận'])
    expect(fromXlsx[1]).toEqual(['1', 'AN261113-001', 'Nguyễn Thị Lan'])

    const csv = new TextEncoder().encode('Mã vận đơn,Mã đơn\nVTP1,AN1')
    expect(await readSheetRows({ name: 'don.csv', bytes: csv })).toEqual([['Mã vận đơn', 'Mã đơn'], ['VTP1', 'AN1']])
  })
})

describe('parsePastedTracking', () => {
  it('reads lines in either order with any separator', () => {
    expect(
      parsePastedTracking('AN261113-001  VTP123456789\nVTP987654321, an261113-002\n\nchỉ có chữ\nAN261113-003\tVTP555555555'),
    ).toEqual([
      { order_code: 'AN261113-001', tracking_code: 'VTP123456789' },
      { order_code: 'an261113-002', tracking_code: 'VTP987654321' },
      { order_code: 'AN261113-003', tracking_code: 'VTP555555555' },
    ])
  })
})
