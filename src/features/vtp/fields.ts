import { searchKey } from '@/lib/vn/text'

/** One order, with everything the export needs, already resolved to text. */
export interface ExportOrder {
  index: number
  code: string
  receiverName: string
  receiverPhone: string
  /** Street / house number part only. */
  receiverAddress: string
  receiverWard: string
  receiverDistrict: string
  receiverProvince: string
  receiverFullAddress: string
  productName: string
  productQty: number
  weightG: number
  goodsValue: number
  cod: number
  service: string
  feePayer: 'sender' | 'receiver'
  deliveryRequirement: 'no_view' | 'view' | 'try'
  note: string
}

export interface SenderInfo {
  name: string
  phone: string
  address: string
}

export interface ValueLabels {
  fee_payer: Record<'sender' | 'receiver', string>
  requirement: Record<'no_view' | 'view' | 'try', string>
}

export const DEFAULT_VALUE_LABELS: ValueLabels = {
  fee_payer: { sender: 'Người gửi', receiver: 'Người nhận' },
  requirement: {
    no_view: 'Không cho xem hàng',
    view: 'Cho xem hàng, không cho thử',
    try: 'Cho thử hàng',
  },
}

export type CellValue = string | number

interface Ctx {
  sender: SenderInfo
  labels: ValueLabels
}

export interface FieldDef {
  id: string
  label: string
  /** Numbers stay numbers in Excel; everything else is written as text (keeps leading zeros). */
  get: (o: ExportOrder, ctx: Ctx) => CellValue
}

export const FIELDS: FieldDef[] = [
  { id: 'index', label: 'STT', get: (o) => o.index },
  { id: 'order_code', label: 'Mã đơn của shop (mã tham chiếu)', get: (o) => o.code },
  { id: 'receiver_name', label: 'Tên người nhận', get: (o) => o.receiverName },
  { id: 'receiver_phone', label: 'SĐT người nhận', get: (o) => o.receiverPhone },
  { id: 'receiver_address', label: 'Địa chỉ người nhận (số nhà, đường)', get: (o) => o.receiverAddress },
  { id: 'receiver_ward', label: 'Phường / xã người nhận', get: (o) => o.receiverWard },
  { id: 'receiver_district', label: 'Quận / huyện (để trống nếu mẫu không cần)', get: (o) => o.receiverDistrict },
  { id: 'receiver_province', label: 'Tỉnh / thành người nhận', get: (o) => o.receiverProvince },
  { id: 'receiver_full_address', label: 'Địa chỉ đầy đủ người nhận', get: (o) => o.receiverFullAddress },
  { id: 'sender_name', label: 'Tên người gửi', get: (_, c) => c.sender.name },
  { id: 'sender_phone', label: 'SĐT người gửi', get: (_, c) => c.sender.phone },
  { id: 'sender_address', label: 'Địa chỉ người gửi', get: (_, c) => c.sender.address },
  { id: 'product_name', label: 'Tên hàng hoá', get: (o) => o.productName },
  { id: 'product_qty', label: 'Số lượng', get: (o) => o.productQty },
  { id: 'weight_g', label: 'Khối lượng (gram)', get: (o) => o.weightG },
  { id: 'weight_kg', label: 'Khối lượng (kg)', get: (o) => Math.round(o.weightG) / 1000 },
  { id: 'goods_value', label: 'Giá trị hàng hoá', get: (o) => o.goodsValue },
  { id: 'cod', label: 'Tiền thu hộ (COD)', get: (o) => o.cod },
  { id: 'service', label: 'Dịch vụ', get: (o) => o.service },
  { id: 'fee_payer', label: 'Người trả cước', get: (o, c) => c.labels.fee_payer[o.feePayer] },
  { id: 'delivery_requirement', label: 'Yêu cầu khi giao', get: (o, c) => c.labels.requirement[o.deliveryRequirement] },
  { id: 'note', label: 'Ghi chú', get: (o) => o.note },
]

export const STATIC_FIELD = 'static'
export const FIELD_BY_ID = new Map(FIELDS.map((f) => [f.id, f]))

/** Where each field goes in the template. */
export interface ColumnSpec {
  /** Excel column letter(s), e.g. "A", "AB". */
  col: string
  /** A field id from FIELDS, or "static" for a fixed value. */
  field: string
  /** Header text, only used when building the built-in layout. */
  header?: string
  /** The fixed value when field is "static". */
  value?: string
}

export interface TemplateMapping {
  /** Sheet name; the first sheet when empty. */
  sheet: string | null
  headerRow: number
  firstDataRow: number
  columns: ColumnSpec[]
  values?: Partial<ValueLabels>
  /** Longest allowed "Tên hàng hoá"; longer text is shortened. */
  maxProductNameLength?: number
}

/** Generic layout used until the admin uploads the real ViettelPost template. */
export const DEFAULT_MAPPING: TemplateMapping = {
  sheet: null,
  headerRow: 1,
  firstDataRow: 2,
  maxProductNameLength: 200,
  columns: [
    { col: 'A', field: 'index', header: 'STT' },
    { col: 'B', field: 'order_code', header: 'Mã đơn của shop' },
    { col: 'C', field: 'receiver_name', header: 'Tên người nhận' },
    { col: 'D', field: 'receiver_phone', header: 'SĐT người nhận' },
    { col: 'E', field: 'receiver_address', header: 'Địa chỉ (số nhà, đường)' },
    { col: 'F', field: 'receiver_ward', header: 'Phường / xã' },
    { col: 'G', field: 'receiver_province', header: 'Tỉnh / thành phố' },
    { col: 'H', field: 'product_name', header: 'Tên hàng hoá' },
    { col: 'I', field: 'product_qty', header: 'Số lượng' },
    { col: 'J', field: 'weight_g', header: 'Khối lượng (gram)' },
    { col: 'K', field: 'goods_value', header: 'Giá trị hàng hoá' },
    { col: 'L', field: 'cod', header: 'Tiền thu hộ (COD)' },
    { col: 'M', field: 'service', header: 'Dịch vụ' },
    { col: 'N', field: 'fee_payer', header: 'Người trả cước' },
    { col: 'O', field: 'delivery_requirement', header: 'Yêu cầu khi giao' },
    { col: 'P', field: 'note', header: 'Ghi chú' },
  ],
}

/** Guesses which field a template column holds from its header text. */
export function suggestField(header: string): string | null {
  const h = searchKey(header).replace(/[^a-z0-9]+/g, ' ').trim()
  if (!h) return null
  const has = (...words: string[]) => words.some((w) => h.includes(w))
  const sender = has('nguoi gui', 'gui hang', 'ben gui')

  if (h === 'stt' || h === 'so thu tu' || h === 'tt') return 'index'
  if (has('ma don', 'ma tham chieu', 'ma khach hang', 'order code', 'ma don rieng', 'ref')) return 'order_code'
  if (has('thu ho', 'cod')) return 'cod'
  if (has('gia tri')) return 'goods_value'
  if (has('khoi luong', 'trong luong')) return has('kg') ? 'weight_kg' : 'weight_g'
  if (has('so luong')) return 'product_qty'
  if (has('ten hang', 'san pham', 'noi dung hang', 'mo ta hang')) return 'product_name'
  if (has('dich vu')) return 'service'
  if (has('tra cuoc', 'nguoi thanh toan')) return 'fee_payer'
  if (has('yeu cau', 'cho xem', 'cho thu', 'luu y giao')) return 'delivery_requirement'
  if (has('ghi chu')) return 'note'
  if (has('ten')) return sender ? 'sender_name' : 'receiver_name'
  if (has('sdt', 'dien thoai', 'so may')) return sender ? 'sender_phone' : 'receiver_phone'
  if (has('phuong', 'xa')) return 'receiver_ward'
  if (has('quan', 'huyen')) return 'receiver_district'
  if (has('tinh', 'thanh pho')) return 'receiver_province'
  if (has('dia chi')) return sender ? 'sender_address' : has('day du') ? 'receiver_full_address' : 'receiver_address'
  return null
}

/** Excel column letters → 1-based index ("A" → 1, "AB" → 28). */
export function columnIndex(letters: string): number {
  return letters
    .toUpperCase()
    .split('')
    .reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
}

/** 1-based index → letters (1 → "A", 28 → "AB"). */
export function columnLetters(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}
