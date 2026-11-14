import { METHOD_LABEL, STATUS_LABEL, type DeliveryMethod, type OrderStatus } from '@/features/orders/status'
import { fetchAllRows } from './api'

type Row = Record<string, unknown>

export interface DataSets {
  orders: Row[]
  items: Row[]
  customers: Row[]
  variants: Row[]
  movements: Row[]
}

interface Column {
  header: string
  width: number
  value: (row: Row, ctx: { orderCode: Map<string, string> }) => string | number | null
}

const text = (key: string) => (row: Row) => (row[key] as string | null) ?? ''
const num = (key: string) => (row: Row) => (row[key] === null || row[key] === undefined ? null : Number(row[key]))
const when = (key: string) => (row: Row) => {
  const v = row[key] as string | null
  return v
    ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(v))
    : ''
}

const MOVEMENT_TYPE: Record<string, string> = {
  receipt: 'Nhập kho',
  order_out: 'Xuất bán',
  order_cancel: 'Huỷ đơn, hoàn kho',
  return: 'Hàng hoàn về',
  adjust: 'Kiểm kho, điều chỉnh',
}

const SHEETS: { name: string; rows: (d: DataSets) => Row[]; columns: Column[] }[] = [
  {
    name: 'Đơn hàng',
    rows: (d) => d.orders,
    columns: [
      { header: 'Mã đơn', width: 16, value: text('code') },
      { header: 'Ngày tạo', width: 17, value: when('created_at') },
      { header: 'Trạng thái', width: 16, value: (r) => STATUS_LABEL[r.status as OrderStatus] ?? String(r.status) },
      { header: 'Cách giao', width: 18, value: (r) => METHOD_LABEL[r.delivery_method as DeliveryMethod] ?? '' },
      { header: 'Người nhận', width: 22, value: text('ship_name') },
      { header: 'SĐT', width: 13, value: text('ship_phone') },
      { header: 'Địa chỉ', width: 40, value: text('ship_full_text') },
      { header: 'Tiền hàng', width: 12, value: num('subtotal') },
      { header: 'Phí ship', width: 10, value: num('shipping_fee') },
      { header: 'Giảm giá', width: 10, value: num('discount') },
      { header: 'Tổng đơn', width: 12, value: num('total') },
      { header: 'Đã thanh toán', width: 13, value: num('paid_amount') },
      { header: 'Thu hộ (COD)', width: 13, value: num('cod_amount') },
      { header: 'Khối lượng (g)', width: 13, value: num('weight_g') },
      { header: 'Mã vận đơn', width: 16, value: text('vtp_tracking_code') },
      { header: 'Ngày giao', width: 17, value: when('delivered_at') },
      { header: 'Ghi chú giao hàng', width: 24, value: text('delivery_note') },
      { header: 'Ghi chú nội bộ', width: 24, value: text('internal_note') },
    ],
  },
  {
    name: 'Dòng hàng',
    rows: (d) => d.items,
    columns: [
      { header: 'Mã đơn', width: 16, value: (r, c) => c.orderCode.get(r.order_id as string) ?? '' },
      { header: 'Sản phẩm', width: 28, value: text('product_name') },
      { header: 'Biến thể', width: 16, value: text('variant_label') },
      { header: 'SKU', width: 16, value: text('sku') },
      { header: 'Số lượng', width: 10, value: num('qty') },
      { header: 'Đơn giá', width: 12, value: num('unit_price') },
      { header: 'Giá vốn', width: 12, value: num('unit_cost') },
    ],
  },
  {
    name: 'Khách hàng',
    rows: (d) => d.customers,
    columns: [
      { header: 'Tên', width: 24, value: text('name') },
      { header: 'SĐT', width: 13, value: text('phone') },
      { header: 'SĐT phụ', width: 13, value: text('phone2') },
      { header: 'Nhãn', width: 20, value: (r) => ((r.tags as string[] | null) ?? []).join(', ') },
      { header: 'Số đơn', width: 9, value: num('order_count') },
      { header: 'Đã giao', width: 9, value: num('delivered_count') },
      { header: 'Hoàn', width: 8, value: num('returned_count') },
      { header: 'Tổng chi', width: 13, value: num('total_spent') },
      { header: 'Ghi chú', width: 30, value: text('note') },
    ],
  },
  {
    name: 'Sản phẩm',
    rows: (d) => d.variants,
    columns: [
      { header: 'Sản phẩm', width: 28, value: (r) => ((r.product as { name?: string } | null)?.name ?? '') },
      { header: 'Nhóm', width: 14, value: (r) => ((r.product as { category?: string } | null)?.category ?? '') },
      { header: 'Biến thể', width: 16, value: text('variant_label') },
      { header: 'SKU', width: 16, value: text('sku') },
      { header: 'Giá bán', width: 12, value: num('price') },
      { header: 'Giá vốn', width: 12, value: num('cost') },
      { header: 'Khối lượng (g)', width: 13, value: num('weight_g') },
      { header: 'Tồn kho', width: 10, value: num('stock_qty') },
      { header: 'Mã vạch', width: 16, value: text('barcode') },
      { header: 'Đang bán', width: 10, value: (r) => (r.active ? 'Có' : 'Không') },
    ],
  },
  {
    name: 'Sổ kho',
    rows: (d) => d.movements,
    columns: [
      { header: 'Thời gian', width: 17, value: when('created_at') },
      { header: 'Loại', width: 20, value: (r) => MOVEMENT_TYPE[r.type as string] ?? String(r.type) },
      { header: 'Thay đổi', width: 10, value: num('qty_change') },
      { header: 'Tồn sau', width: 10, value: num('stock_after') },
      { header: 'Ghi chú', width: 24, value: text('note') },
    ],
  },
]

/** One workbook with orders, order lines, customers, products and the stock ledger. */
export async function buildDataWorkbook(data: DataSets): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const orderCode = new Map(data.orders.map((o) => [o.id as string, o.code as string]))

  for (const sheet of SHEETS) {
    const ws = workbook.addWorksheet(sheet.name)
    ws.columns = sheet.columns.map((c) => ({ header: c.header, width: c.width }))
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    for (const row of sheet.rows(data)) {
      const added = ws.addRow(sheet.columns.map((c) => c.value(row, { orderCode })))
      sheet.columns.forEach((c, i) => {
        // Phone numbers and codes stay text so Excel keeps leading zeros.
        if (/SĐT|Mã|SKU/.test(c.header)) added.getCell(i + 1).numFmt = '@'
      })
    }
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** Downloads everything of one shop (up to 50.000 rows per table) as one workbook. */
export async function exportShopData(shopId: string): Promise<Uint8Array> {
  const [orders, items, customers, variants, movements] = await Promise.all([
    fetchAllRows<Row>('orders', '*', shopId),
    fetchAllRows<Row>('order_items', '*', shopId, 'id'),
    fetchAllRows<Row>('customers', '*', shopId),
    fetchAllRows<Row>('product_variants', '*, product:products(name, category)', shopId),
    fetchAllRows<Row>('stock_movements', '*', shopId, 'id', 20_000),
  ])
  return buildDataWorkbook({ orders, items, customers, variants, movements })
}
