import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export interface Dashboard {
  today: string
  orders_created: number
  revenue_created: number
  delivered_today: number
  revenue_delivered_today: number
  to_process: number
  new_orders: number
  shipping: number
  failed: number
  returning: number
  cod_on_the_road: number
  vtp_waiting_tracking: number
  low_stock: number
  unsettled_trips: number
  unsettled_cod: number
  active_trips: number
}

export async function fetchDashboard(shopId: string): Promise<Dashboard> {
  return unwrap(await supabase.rpc('dashboard_summary', { p_shop_id: shopId })) as Dashboard
}

export interface SalesReport {
  from: string
  to: string
  totals: {
    orders_created: number
    cancelled: number
    delivered: number
    returned: number
    revenue: number
    goods_revenue: number
    cost: number
    gross_profit: number
  }
  by_day: { day: string; orders: number; revenue: number }[]
  top_products: { name: string; qty: number; revenue: number; profit: number }[]
  top_variants: { name: string; sku: string; qty: number; revenue: number }[]
  top_customers: { name: string; phone: string | null; orders: number; spent: number }[]
  by_method: { method: 'self' | 'vtp' | 'pickup'; orders: number; delivered: number; returned: number }[]
  shippers: { name: string; trips: number; delivered: number; failed: number; cod_collected: number }[]
}

export async function fetchSalesReport(shopId: string, from: string, to: string): Promise<SalesReport> {
  return unwrap(await supabase.rpc('sales_report', { p_shop_id: shopId, p_from: from, p_to: to })) as SalesReport
}

export interface ShopSummaryRow {
  shop_id: string
  name: string
  active: boolean
  orders_30d: number
  delivered_30d: number
  revenue_30d: number
}

export async function adminShopSummary(): Promise<ShopSummaryRow[]> {
  const rows = unwrap(await supabase.rpc('admin_shop_summary')) as ShopSummaryRow[]
  return rows.map((r) => ({ ...r, orders_30d: Number(r.orders_30d), delivered_30d: Number(r.delivered_30d), revenue_30d: Number(r.revenue_30d) }))
}

const PAGE = 1000

/** Reads every row of a table for one shop (the API returns at most 1000 per request). */
export async function fetchAllRows<T>(table: string, columns: string, shopId: string, orderBy = 'created_at', limit = 50_000): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; from < limit; from += PAGE) {
    const page = unwrap(
      await supabase.from(table).select(columns).eq('shop_id', shopId).order(orderBy, { ascending: true }).range(from, from + PAGE - 1),
    ) as T[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}
