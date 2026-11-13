import type { OrderWithItems } from '@/features/orders/api'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { TemplateMapping } from './fields'
import type { TrackingRow } from './tracking'

export interface VtpTemplate {
  name: string | null
  version: string | null
  b64: string | null
  mapping: TemplateMapping | null
}

export async function fetchVtpTemplate(): Promise<VtpTemplate> {
  const row = unwrap(
    await supabase
      .from('system_settings')
      .select('vtp_template_name, vtp_template_version, vtp_template_b64, vtp_column_mapping')
      .eq('id', 1)
      .single(),
  ) as {
    vtp_template_name: string | null
    vtp_template_version: string | null
    vtp_template_b64: string | null
    vtp_column_mapping: TemplateMapping | null
  }
  return {
    name: row.vtp_template_name,
    version: row.vtp_template_version,
    b64: row.vtp_template_b64,
    mapping: row.vtp_column_mapping,
  }
}

export async function saveVtpTemplate(args: { name: string | null; b64: string | null; mapping: TemplateMapping | null }) {
  return unwrap(
    await supabase.rpc('admin_save_vtp_template', { p_name: args.name, p_b64: args.b64, p_mapping: args.mapping }),
  ) as string
}

export interface Batch {
  id: string
  file_name: string
  order_count: number
  template_version: string | null
  created_at: string
  cancelled_at: string | null
}

export async function listBatches(shopId: string): Promise<Batch[]> {
  return unwrap(
    await supabase
      .from('vtp_export_batches')
      .select('id, file_name, order_count, template_version, created_at, cancelled_at')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(20),
  ) as Batch[]
}

export async function createBatch(shopId: string, orderIds: string[], fileName: string, templateVersion: string | null) {
  return unwrap(
    await supabase.rpc('create_vtp_batch', {
      p_shop_id: shopId,
      p_order_ids: orderIds,
      p_file_name: fileName,
      p_template_version: templateVersion,
    }),
  ) as string
}

export async function cancelBatch(shopId: string, batchId: string) {
  return unwrap(await supabase.rpc('cancel_vtp_batch', { p_shop_id: shopId, p_batch_id: batchId })) as number
}

export async function fetchOrdersByIds(ids: string[]): Promise<OrderWithItems[]> {
  if (ids.length === 0) return []
  return unwrap(await supabase.from('orders').select('*, items:order_items(*)').in('id', ids).order('code')) as OrderWithItems[]
}

export async function fetchOrdersOfBatch(batchId: string): Promise<OrderWithItems[]> {
  return unwrap(
    await supabase.from('orders').select('*, items:order_items(*)').eq('vtp_batch_id', batchId).order('code'),
  ) as OrderWithItems[]
}

export async function fetchWardNames(codes: string[]): Promise<{ code: string; name: string }[]> {
  if (codes.length === 0) return []
  return unwrap(await supabase.from('wards').select('code, name').in('code', codes)) as { code: string; name: string }[]
}

export interface TrackingResult {
  applied: number
  skipped: { code: string; reason: string }[]
}

export async function applyTracking(shopId: string, rows: TrackingRow[]): Promise<TrackingResult> {
  return unwrap(await supabase.rpc('apply_vtp_tracking', { p_shop_id: shopId, p_rows: rows })) as TrackingResult
}

/** Status of the orders named in an import file, for the preview. */
export async function fetchOrderStatuses(
  shopId: string,
  codes: string[],
): Promise<{ code: string; status: string; delivery_method: string; vtp_tracking_code: string | null }[]> {
  if (codes.length === 0) return []
  return unwrap(
    await supabase
      .from('orders')
      .select('code, status, delivery_method, vtp_tracking_code')
      .eq('shop_id', shopId)
      .in('code', codes),
  ) as { code: string; status: string; delivery_method: string; vtp_tracking_code: string | null }[]
}
