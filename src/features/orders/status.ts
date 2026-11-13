export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'vtp_exported'
  | 'shipping'
  | 'delivered'
  | 'failed'
  | 'returning'
  | 'returned'
  | 'cancelled'

export type DeliveryMethod = 'self' | 'vtp' | 'pickup'

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'Mới',
  confirmed: 'Đã xác nhận',
  vtp_exported: 'Đã xuất file VTP',
  shipping: 'Đang giao',
  delivered: 'Đã giao',
  failed: 'Giao thất bại',
  returning: 'Đang hoàn',
  returned: 'Đã hoàn về kho',
  cancelled: 'Đã huỷ',
}

export const STATUS_TONE: Record<OrderStatus, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  new: 'neutral',
  confirmed: 'primary',
  vtp_exported: 'primary',
  shipping: 'warning',
  delivered: 'success',
  failed: 'danger',
  returning: 'warning',
  returned: 'neutral',
  cancelled: 'neutral',
}

export const METHOD_LABEL: Record<DeliveryMethod, string> = {
  self: 'Tự giao',
  vtp: 'ViettelPost',
  pickup: 'Khách lấy tại shop',
}

/** Tabs of the order list, in order. */
export const STATUS_TABS: { value: OrderStatus | 'all' | 'open'; label: string; statuses?: OrderStatus[] }[] = [
  { value: 'open', label: 'Cần xử lý', statuses: ['new', 'confirmed', 'vtp_exported', 'failed'] },
  { value: 'shipping', label: 'Đang giao', statuses: ['shipping', 'returning'] },
  { value: 'delivered', label: 'Đã giao', statuses: ['delivered'] },
  { value: 'cancelled', label: 'Huỷ / hoàn', statuses: ['cancelled', 'returned'] },
  { value: 'all', label: 'Tất cả' },
]

export interface StatusAction {
  to: OrderStatus
  label: string
  /** Styling hint. */
  tone: 'primary' | 'secondary' | 'danger'
  /** Ask for a note (e.g. reason for a failed delivery). */
  askNote?: boolean
  confirm?: string
}

/** What the owner can do next with an order. Mirrors the transitions allowed by the database. */
export function nextActions(status: OrderStatus, method: DeliveryMethod): StatusAction[] {
  switch (status) {
    case 'new':
      return [
        { to: 'confirmed', label: 'Xác nhận đơn', tone: 'primary' },
        { to: 'cancelled', label: 'Huỷ đơn', tone: 'danger', askNote: true, confirm: 'Huỷ đơn này?' },
      ]
    case 'confirmed': {
      const actions: StatusAction[] = []
      if (method === 'pickup') actions.push({ to: 'delivered', label: 'Khách đã nhận hàng', tone: 'primary' })
      if (method !== 'pickup') actions.push({ to: 'shipping', label: 'Bắt đầu giao', tone: 'secondary' })
      actions.push(
        { to: 'new', label: 'Mở lại để sửa', tone: 'secondary', confirm: 'Mở lại đơn? Hàng sẽ được trả về kho để bạn sửa.' },
        { to: 'cancelled', label: 'Huỷ đơn', tone: 'danger', askNote: true, confirm: 'Huỷ đơn? Hàng sẽ được trả về kho.' },
      )
      return actions
    }
    case 'vtp_exported':
      return [
        { to: 'shipping', label: 'Đã có mã vận đơn, đang giao', tone: 'primary' },
        { to: 'confirmed', label: 'Huỷ xuất file', tone: 'secondary' },
        { to: 'cancelled', label: 'Huỷ đơn', tone: 'danger', askNote: true, confirm: 'Huỷ đơn? Hàng sẽ được trả về kho.' },
      ]
    case 'shipping':
      return [
        { to: 'delivered', label: 'Đã giao thành công', tone: 'primary' },
        { to: 'failed', label: 'Giao thất bại', tone: 'secondary', askNote: true },
        { to: 'returning', label: 'Đang hoàn về', tone: 'secondary' },
      ]
    case 'failed':
      return [
        { to: 'shipping', label: 'Giao lại', tone: 'primary' },
        { to: 'returning', label: 'Hoàn hàng về', tone: 'danger' },
      ]
    case 'returning':
      return [{ to: 'returned', label: 'Đã nhận hàng hoàn', tone: 'primary', confirm: 'Xác nhận đã nhận lại hàng? Hàng sẽ được cộng lại vào kho.' }]
    default:
      return []
  }
}

/** Orders in these statuses can still be edited after "Mở lại". */
export const isEditable = (status: OrderStatus) => status === 'new'

/** Orders that have goods waiting to be handed to a shipper or exported. */
export const isReadyToShip = (status: OrderStatus) => status === 'confirmed'
