export interface CustomerStats {
  order_count: number
  delivered_count: number
  returned_count: number
}

/** Share of finished deliveries that came back (0–1). Null until there is any outcome. */
export function returnRate(c: CustomerStats): number | null {
  const finished = c.delivered_count + c.returned_count
  return finished === 0 ? null : c.returned_count / finished
}

/**
 * Warning shown when taking an order from a customer who often refuses parcels.
 * Needs at least 2 returns so one unlucky delivery does not brand a customer.
 */
export function returnWarning(c: CustomerStats): string | null {
  const rate = returnRate(c)
  if (rate === null || c.returned_count < 2 || rate < 0.3) return null
  const finished = c.delivered_count + c.returned_count
  return `${c.returned_count}/${finished} đơn trước bị hoàn`
}
