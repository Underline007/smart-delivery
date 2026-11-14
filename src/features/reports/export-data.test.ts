import { describe, expect, it } from 'vitest'
import { buildDataWorkbook, type DataSets } from './export-data'

const data: DataSets = {
  orders: [
    {
      id: 'o1', code: 'AN261113-001', created_at: '2026-11-13T03:00:00Z', status: 'delivered', delivery_method: 'self',
      ship_name: 'Nguyễn Thị Lan', ship_phone: '0912345678', ship_full_text: '12 Lê Lợi, TP. Hồ Chí Minh',
      subtotal: 300000, shipping_fee: 30000, discount: 0, total: 330000, paid_amount: 0, cod_amount: 330000, weight_g: 600,
      vtp_tracking_code: null, delivered_at: '2026-11-13T07:00:00Z', delivery_note: null, internal_note: 'VIP',
    },
  ],
  items: [{ order_id: 'o1', product_name: 'Áo thun', variant_label: 'Đỏ / M', sku: 'AT-DO-M', qty: 2, unit_price: 150000, unit_cost: 80000 }],
  customers: [{ name: 'Nguyễn Thị Lan', phone: '0912345678', phone2: null, tags: ['VIP', 'Khách sỉ'], order_count: 1, delivered_count: 1, returned_count: 0, total_spent: 330000, note: null }],
  variants: [{ product: { name: 'Áo thun', category: 'Áo' }, variant_label: 'Đỏ / M', sku: 'AT-DO-M', price: 150000, cost: 80000, weight_g: 250, stock_qty: 8, barcode: null, active: true }],
  movements: [{ created_at: '2026-11-13T03:00:00Z', type: 'order_out', qty_change: -2, stock_after: 8, note: 'AN261113-001' }],
}

async function load(d: DataSets) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await buildDataWorkbook(d)) as unknown as ArrayBuffer)
  return wb
}

describe('buildDataWorkbook', () => {
  it('creates one sheet per data set with Vietnamese headers', async () => {
    const wb = await load(data)
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Đơn hàng', 'Dòng hàng', 'Khách hàng', 'Sản phẩm', 'Sổ kho'])
    expect(wb.getWorksheet('Đơn hàng')!.getRow(1).getCell(1).value).toBe('Mã đơn')
  })

  it('writes readable values, not raw codes', async () => {
    const wb = await load(data)
    const order = wb.getWorksheet('Đơn hàng')!.getRow(2)
    expect(order.getCell(1).value).toBe('AN261113-001')
    expect(order.getCell(3).value).toBe('Đã giao')
    expect(order.getCell(4).value).toBe('Tự giao')
    expect(order.getCell(6).value).toBe('0912345678')
    expect(order.getCell(11).value).toBe(330000)

    const item = wb.getWorksheet('Dòng hàng')!.getRow(2)
    expect(item.getCell(1).value).toBe('AN261113-001') // order code, not the id
    expect(item.getCell(5).value).toBe(2)

    expect(wb.getWorksheet('Khách hàng')!.getRow(2).getCell(4).value).toBe('VIP, Khách sỉ')
    expect(wb.getWorksheet('Sản phẩm')!.getRow(2).getCell(1).value).toBe('Áo thun')
    expect(wb.getWorksheet('Sổ kho')!.getRow(2).getCell(2).value).toBe('Xuất bán')
  })

  it('handles empty data', async () => {
    const wb = await load({ orders: [], items: [], customers: [], variants: [], movements: [] })
    expect(wb.getWorksheet('Đơn hàng')!.rowCount).toBe(1)
  })
})
