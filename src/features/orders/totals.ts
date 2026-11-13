export interface OrderLineLike {
  qty: number
  price: number
  weight_g: number
}

export interface Totals {
  subtotal: number
  total: number
  cod: number
  weight: number
  /** Problems that would make the server refuse the order. */
  errors: string[]
}

/**
 * Same arithmetic as save_order(), so the screen shows what will be stored:
 * total = subtotal + shipping − discount, COD = total − paid,
 * weight = Σ(weight × qty) + packaging.
 */
export function computeTotals(args: {
  lines: OrderLineLike[]
  shippingFee: number
  discount: number
  paid: number
  packagingWeight: number
  weightOverride?: number
}): Totals {
  const subtotal = args.lines.reduce((sum, l) => sum + l.qty * l.price, 0)
  const total = Math.max(subtotal + args.shippingFee - args.discount, 0)
  const goods = args.lines.reduce((sum, l) => sum + l.qty * l.weight_g, 0)
  const errors: string[] = []
  if (args.discount > subtotal + args.shippingFee) errors.push('Giảm giá lớn hơn tổng tiền hàng')
  if (args.paid > total) errors.push('Số tiền đã thanh toán lớn hơn tổng đơn')
  return {
    subtotal,
    total,
    cod: Math.max(total - args.paid, 0),
    weight: args.weightOverride && args.weightOverride > 0 ? args.weightOverride : goods + args.packagingWeight,
    errors,
  }
}
