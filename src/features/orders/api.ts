import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { GeoSource } from '@/features/customers/api'
import type { DeliveryMethod, OrderStatus } from './status'

export interface OrderItem {
  id: string
  variant_id: string
  product_name: string
  variant_label: string
  sku: string
  unit_cost: number
  weight_g: number
  qty: number
  unit_price: number
}

export interface OrderEvent {
  id: number
  from_status: OrderStatus | null
  to_status: OrderStatus
  note: string | null
  created_at: string
}

export interface Order {
  id: string
  shop_id: string
  code: string
  customer_id: string | null
  status: OrderStatus
  delivery_method: DeliveryMethod
  ship_name: string | null
  ship_phone: string | null
  ship_detail: string | null
  ship_province_code: string | null
  ship_ward_code: string | null
  ship_ward_text: string | null
  ship_full_text: string | null
  ship_lat: number | null
  ship_lng: number | null
  subtotal: number
  shipping_fee: number
  discount: number
  total: number
  paid_amount: number
  cod_amount: number
  weight_g: number
  delivery_note: string | null
  internal_note: string | null
  vtp_service: string | null
  vtp_fee_payer: 'sender' | 'receiver' | null
  vtp_delivery_requirement: 'no_view' | 'view' | 'try' | null
  vtp_tracking_code: string | null
  vtp_batch_id: string | null
  stock_deducted: boolean
  confirmed_at: string | null
  delivered_at: string | null
  created_at: string
}

export interface OrderWithItems extends Order {
  items: OrderItem[]
}

export interface OrderDetail extends OrderWithItems {
  events: OrderEvent[]
}

export const ORDER_PAGE = 30

export async function listOrders(
  shopId: string,
  args: { statuses?: OrderStatus[]; query?: string; method?: DeliveryMethod | ''; offset?: number } = {},
): Promise<OrderWithItems[]> {
  let query = supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .range(args.offset ?? 0, (args.offset ?? 0) + ORDER_PAGE - 1)
  if (args.statuses?.length) query = query.in('status', args.statuses)
  if (args.method) query = query.eq('delivery_method', args.method)
  const q = (args.query ?? '').trim().toLowerCase()
  if (q) query = query.ilike('ship_search', `%${q.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[%,()]/g, ' ')}%`)
  return unwrap(await query) as OrderWithItems[]
}

export async function fetchOrder(orderId: string): Promise<OrderDetail | null> {
  const row = unwrap(
    await supabase
      .from('orders')
      .select('*, items:order_items(*), events:order_events(*)')
      .eq('id', orderId)
      .maybeSingle(),
  ) as OrderDetail | null
  if (!row) return null
  return { ...row, events: [...row.events].sort((a, b) => a.id - b.id) }
}

export async function orderStatusCounts(shopId: string): Promise<Partial<Record<OrderStatus, number>>> {
  return unwrap(await supabase.rpc('order_status_counts', { p_shop_id: shopId })) as Partial<Record<OrderStatus, number>>
}

export interface OrderInput {
  id?: string
  customer_id: string | null
  delivery_method: DeliveryMethod
  confirm?: boolean
  save_address?: boolean
  ship: {
    name: string
    phone: string
    detail: string
    province_code: string | null
    ward_code: string | null
    ward_text: string
    lat: number | null
    lng: number | null
    geo_source: GeoSource | null
  }
  items: { variant_id: string; qty: number; unit_price: number }[]
  shipping_fee: number
  discount: number
  paid_amount: number
  weight_g?: number
  delivery_note: string
  internal_note: string
  vtp_service: string
  vtp_fee_payer: 'sender' | 'receiver'
  vtp_delivery_requirement: 'no_view' | 'view' | 'try'
}

export async function saveOrder(shopId: string, order: OrderInput): Promise<string> {
  return unwrap(await supabase.rpc('save_order', { p_shop_id: shopId, p_order: order })) as string
}

export async function setOrderStatus(shopId: string, orderId: string, to: OrderStatus, note?: string) {
  unwrap(
    await supabase.rpc('set_order_status', {
      p_shop_id: shopId,
      p_order_id: orderId,
      p_to: to,
      p_note: note?.trim() || null,
    }),
  )
}

export interface VariantStock {
  id: string
  stock_qty: number
  active: boolean
  weight_g: number
}

/** Current stock / weight of variants already on an order (for warnings while editing). */
export async function fetchVariantStock(ids: string[]): Promise<VariantStock[]> {
  if (ids.length === 0) return []
  return unwrap(
    await supabase.from('product_variants').select('id, stock_qty, active, weight_g').in('id', ids),
  ) as VariantStock[]
}
