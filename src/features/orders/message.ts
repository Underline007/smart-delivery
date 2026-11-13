import { formatNumber } from '@/lib/format'

export interface MessageOrder {
  code: string
  ship_name: string | null
  ship_full_text: string | null
  total: number
  cod_amount: number
  items: { product_name: string; variant_label: string; qty: number; unit_price: number }[]
}

/** "Áo thun (Đỏ / M) x2 — 300.000đ" */
export function describeItems(items: MessageOrder['items']): string {
  return items
    .map((i) => {
      const name = i.variant_label ? `${i.product_name} (${i.variant_label})` : i.product_name
      return `• ${name} x${i.qty} — ${formatNumber(i.qty * i.unit_price)}đ`
    })
    .join('\n')
}

/**
 * Fills the shop's confirmation template. Variables:
 * {ten} {ma_don} {san_pham} {tong} {cod} {dia_chi}. Unknown variables are left as typed.
 */
export function renderMessage(template: string, order: MessageOrder): string {
  const values: Record<string, string> = {
    ten: order.ship_name ?? 'bạn',
    ma_don: order.code,
    san_pham: describeItems(order.items),
    tong: formatNumber(order.total),
    cod: formatNumber(order.cod_amount),
    dia_chi: order.ship_full_text ?? 'Nhận tại shop',
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}
