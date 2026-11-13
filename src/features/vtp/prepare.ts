import type { OrderWithItems } from '@/features/orders/api'
import { formatMoney } from '@/lib/format'
import type { ExportOrder } from './fields'

export interface PlaceNames {
  provinces: Map<string, string>
  wards: Map<string, string>
}

/**
 * "Áo thun (Đỏ / M) x2; Quần jean (30) x1". When it would be longer than `max`
 * the rest is summarised: "Áo thun (Đỏ / M) x2 +3 SP khác".
 */
export function describeForExport(items: OrderWithItems['items'], max = 200): string {
  const parts = items.map((i) => {
    const name = i.variant_label ? `${i.product_name} (${i.variant_label})` : i.product_name
    return `${name} x${i.qty}`
  })
  if (parts.join('; ').length <= max) return parts.join('; ')

  // Keep as many whole items as fit together with the "+N SP khác" suffix.
  let text = ''
  let kept = 0
  for (let i = 0; i < parts.length; i++) {
    const next = i === 0 ? parts[0] : `${text}; ${parts[i]}`
    const rest = parts.length - (i + 1)
    const suffix = rest > 0 ? ` +${rest} SP khác` : ''
    if (next.length + suffix.length > max) break
    text = next
    kept = i + 1
  }
  if (kept === 0) {
    // Even the first item alone is too long: cut it.
    const suffix = parts.length > 1 ? ` +${parts.length - 1} SP khác` : ''
    return `${parts[0].slice(0, Math.max(max - suffix.length - 1, 1))}…${suffix}`
  }
  return `${text} +${parts.length - kept} SP khác`
}

export function toExportOrder(
  order: OrderWithItems,
  index: number,
  names: PlaceNames,
  maxProductName = 200,
): ExportOrder {
  const province = order.ship_province_code ? (names.provinces.get(order.ship_province_code) ?? '') : ''
  const ward = (order.ship_ward_code ? names.wards.get(order.ship_ward_code) : null) ?? order.ship_ward_text ?? ''
  return {
    index,
    code: order.code,
    receiverName: order.ship_name ?? '',
    receiverPhone: order.ship_phone ?? '',
    receiverAddress: order.ship_detail ?? '',
    receiverWard: ward,
    receiverDistrict: '',
    receiverProvince: province,
    receiverFullAddress: order.ship_full_text ?? '',
    productName: describeForExport(order.items, maxProductName),
    productQty: order.items.reduce((sum, i) => sum + i.qty, 0),
    weightG: order.weight_g,
    goodsValue: order.subtotal,
    cod: order.cod_amount,
    service: order.vtp_service ?? '',
    feePayer: order.vtp_fee_payer ?? 'sender',
    deliveryRequirement: order.vtp_delivery_requirement ?? 'no_view',
    note: order.delivery_note ?? '',
  }
}

export interface Validation {
  errors: string[]
  warnings: string[]
}

/** Problems ViettelPost would reject, found before the file is made. */
export function validateForVtp(
  order: OrderWithItems,
  context: { wardCatalogLoaded: boolean },
): Validation {
  const errors: string[] = []
  const warnings: string[] = []

  if (order.delivery_method !== 'vtp') errors.push('Đơn không giao bằng ViettelPost')
  if (order.status !== 'confirmed') errors.push('Đơn chưa ở trạng thái “Đã xác nhận”')
  if (!order.ship_name?.trim()) errors.push('Thiếu tên người nhận')
  if (!order.ship_phone) errors.push('Thiếu số điện thoại người nhận')
  if (!order.ship_detail?.trim()) errors.push('Thiếu địa chỉ chi tiết')
  if (!order.ship_province_code) errors.push('Thiếu tỉnh/thành')
  if (order.weight_g <= 0) errors.push('Khối lượng phải lớn hơn 0')
  if (!order.vtp_service?.trim()) errors.push('Thiếu mã dịch vụ ViettelPost')

  if (order.ship_province_code && !order.ship_ward_code) {
    const message = order.ship_ward_text
      ? 'Phường/xã chưa chọn từ danh mục, tên có thể không khớp ViettelPost'
      : 'Thiếu phường/xã'
    if (context.wardCatalogLoaded || !order.ship_ward_text) errors.push(message)
    else warnings.push(message)
  }
  if ((order.ship_name?.length ?? 0) > 100) warnings.push('Tên người nhận dài hơn 100 ký tự')
  if ((order.ship_detail?.length ?? 0) > 200) warnings.push('Địa chỉ dài hơn 200 ký tự')
  if (order.cod_amount > 20_000_000) warnings.push(`Tiền thu hộ ${formatMoney(order.cod_amount)} rất lớn, hãy kiểm tra`)
  return { errors, warnings }
}
