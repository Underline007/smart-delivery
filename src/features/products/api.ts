import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export interface Variant {
  id: string
  shop_id: string
  product_id: string
  sku: string
  option_values: string[]
  variant_label: string
  price: number
  cost: number
  weight_g: number
  length_cm: number | null
  width_cm: number | null
  height_cm: number | null
  barcode: string | null
  image_path: string | null
  stock_qty: number
  low_stock_threshold: number
  is_default: boolean
  active: boolean
}

export interface Product {
  id: string
  shop_id: string
  name: string
  category: string | null
  unit: string
  description: string | null
  image_path: string | null
  option_names: string[]
  active: boolean
  variants: Variant[]
}

export type ProductFilter = 'active' | 'low' | 'inactive' | 'all'
export const PAGE_SIZE = 30

export async function listProducts(
  shopId: string,
  args: { query?: string; filter?: ProductFilter; offset?: number; limit?: number } = {},
): Promise<Product[]> {
  return unwrap(
    await supabase.rpc('list_products', {
      p_shop_id: shopId,
      p_query: args.query || null,
      p_filter: args.filter ?? 'active',
      p_limit: args.limit ?? PAGE_SIZE,
      p_offset: args.offset ?? 0,
    }),
  ) as Product[]
}

export async function fetchProduct(productId: string): Promise<Product | null> {
  const row = unwrap(
    await supabase
      .from('products')
      .select('*, variants:product_variants(*)')
      .eq('id', productId)
      .maybeSingle(),
  ) as (Omit<Product, 'variants'> & { variants: Variant[] }) | null
  if (!row) return null
  const variants = [...row.variants].sort(
    (a, b) => Number(b.is_default) - Number(a.is_default) || a.variant_label.localeCompare(b.variant_label, 'vi'),
  )
  return { ...row, variants }
}

export interface VariantInput {
  id?: string
  sku: string
  option_values: string[]
  price: number
  cost: number
  weight_g: number
  length_cm?: number | null
  width_cm?: number | null
  height_cm?: number | null
  barcode?: string | null
  image_path?: string | null
  low_stock_threshold: number
  active: boolean
}

export interface ProductInput {
  id?: string
  name: string
  category: string
  unit: string
  description: string
  image_path: string | null
  active: boolean
  option_names: string[]
  variants: VariantInput[]
}

export async function saveProduct(shopId: string, product: ProductInput): Promise<string> {
  return unwrap(
    await supabase.rpc('save_product', { p_shop_id: shopId, p_product: product }),
  ) as string
}

export interface StockLine {
  variant_id: string
  qty: number
  unit_cost: number
}

export async function receiveStock(
  shopId: string,
  payload: { supplier: string; note: string; items: StockLine[] },
): Promise<string> {
  return unwrap(await supabase.rpc('receive_stock', { p_shop_id: shopId, p_payload: payload })) as string
}

export async function applyStocktake(
  shopId: string,
  payload: { note: string; items: { variant_id: string; counted_qty: number }[] },
): Promise<string> {
  return unwrap(await supabase.rpc('apply_stocktake', { p_shop_id: shopId, p_payload: payload })) as string
}

export type MovementType = 'receipt' | 'order_out' | 'order_cancel' | 'return' | 'adjust'

export interface StockMovement {
  id: number
  qty_change: number
  type: MovementType
  stock_after: number
  note: string | null
  created_at: string
}

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  receipt: 'Nhập kho',
  order_out: 'Xuất bán',
  order_cancel: 'Huỷ đơn, hoàn kho',
  return: 'Hàng hoàn về',
  adjust: 'Kiểm kho, điều chỉnh',
}

export async function listStockMovements(variantId: string, before?: number): Promise<StockMovement[]> {
  let query = supabase
    .from('stock_movements')
    .select('id, qty_change, type, stock_after, note, created_at')
    .eq('variant_id', variantId)
    .order('id', { ascending: false })
    .limit(40)
  if (before) query = query.lt('id', before)
  return unwrap(await query) as StockMovement[]
}

export async function fetchVariantWithProduct(
  variantId: string,
): Promise<(Variant & { product: { name: string; unit: string } }) | null> {
  return unwrap(
    await supabase
      .from('product_variants')
      .select('*, product:products(name, unit)')
      .eq('id', variantId)
      .maybeSingle(),
  ) as (Variant & { product: { name: string; unit: string } }) | null
}

export interface HistoryRow {
  id: string
  code: string
  note: string | null
  created_at: string
  supplier?: string | null
  total_cost?: number
}

export async function listReceipts(shopId: string): Promise<HistoryRow[]> {
  return unwrap(
    await supabase
      .from('stock_receipts')
      .select('id, code, note, supplier, total_cost, created_at')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(50),
  ) as HistoryRow[]
}

export async function listStocktakes(shopId: string): Promise<HistoryRow[]> {
  return unwrap(
    await supabase
      .from('stocktakes')
      .select('id, code, note, created_at')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(50),
  ) as HistoryRow[]
}
