import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { EndMode } from './route'

export type TripStatus = 'draft' | 'in_progress' | 'done' | 'cancelled'
export type StopStatus = 'pending' | 'delivered' | 'failed'

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  draft: 'Chưa bắt đầu',
  in_progress: 'Đang giao',
  done: 'Đã kết thúc',
  cancelled: 'Đã huỷ',
}

export const FAIL_REASONS = ['Không nghe máy', 'Hẹn ngày khác', 'Sai địa chỉ', 'Khách từ chối nhận', 'Khác']

// ---------------------------------------------------------------- owner

export interface TripStopRow {
  id: string
  order_id: string
  seq: number
  status: StopStatus
  fail_reason: string | null
  cod_collected: number | null
  note: string | null
  proof_photo_path: string | null
  done_at: string | null
  order: {
    code: string
    ship_name: string | null
    ship_phone: string | null
    ship_full_text: string | null
    ship_lat: number | null
    ship_lng: number | null
    cod_amount: number
    delivery_note: string | null
    weight_g: number
  } | null
}

export interface Trip {
  id: string
  shop_id: string
  code: string
  trip_date: string
  shipper_id: string
  status: TripStatus
  optimizer: 'local' | 'ors' | 'manual'
  distance_m: number | null
  duration_s: number | null
  end_mode: EndMode
  start_lat: number | null
  start_lng: number | null
  cod_expected: number
  cod_collected: number
  note: string | null
  started_at: string | null
  finished_at: string | null
  settled_at: string | null
  settled_amount: number | null
  settle_note: string | null
  shipper: { full_name: string; phone: string } | null
  stops: TripStopRow[]
}

const TRIP_SELECT =
  '*, shipper:profiles!shipper_id(full_name, phone), stops:delivery_stops(*, order:orders(code, ship_name, ship_phone, ship_full_text, ship_lat, ship_lng, cod_amount, delivery_note, weight_g))'

function sorted(trip: Trip): Trip {
  return { ...trip, stops: [...trip.stops].sort((a, b) => a.seq - b.seq) }
}

export async function listTrips(shopId: string): Promise<Trip[]> {
  const rows = unwrap(
    await supabase
      .from('delivery_trips')
      .select(TRIP_SELECT)
      .eq('shop_id', shopId)
      .neq('status', 'cancelled')
      .order('trip_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(60),
  ) as Trip[]
  return rows.map(sorted)
}

export async function fetchTrip(tripId: string): Promise<Trip | null> {
  const row = unwrap(await supabase.from('delivery_trips').select(TRIP_SELECT).eq('id', tripId).maybeSingle()) as Trip | null
  return row ? sorted(row) : null
}

export interface TripInput {
  start_lat: number | null
  start_lng: number | null
  end_mode: EndMode
  optimizer: 'local' | 'ors' | 'manual'
  distance_m: number | null
  duration_s: number | null
  note: string
  start: boolean
}

export async function createTrip(shopId: string, orderIds: string[], shipperId: string, trip: TripInput): Promise<string> {
  return unwrap(
    await supabase.rpc('create_trip', { p_shop_id: shopId, p_order_ids: orderIds, p_shipper_id: shipperId, p_trip: trip }),
  ) as string
}

export async function cancelTrip(shopId: string, tripId: string) {
  unwrap(await supabase.rpc('cancel_trip', { p_shop_id: shopId, p_trip_id: tripId }))
}

export async function settleTrip(shopId: string, tripId: string, amount: number, note: string) {
  unwrap(await supabase.rpc('settle_trip', { p_shop_id: shopId, p_trip_id: tripId, p_amount: amount, p_note: note || null }))
}

export async function setOrderLocation(shopId: string, orderId: string, lat: number, lng: number, source = 'manual') {
  unwrap(await supabase.rpc('set_order_location', { p_shop_id: shopId, p_order_id: orderId, p_lat: lat, p_lng: lng, p_source: source }))
}

export interface RemoteRoute {
  order: number[]
  distance_m: number | null
  duration_s: number | null
}

/** Optimises on OpenRouteService through the Edge Function. Throws when it is not configured or out of quota. */
export async function optimizeRemote(
  start: { lat: number; lng: number },
  stops: { lat: number; lng: number }[],
  endMode: EndMode,
): Promise<RemoteRoute> {
  const { data, error } = await supabase.functions.invoke('optimize-route', {
    body: { start, stops, end_mode: endMode },
  })
  if (error) throw error
  return data as RemoteRoute
}

// ---------------------------------------------------------------- shipper

export interface MyStop {
  id: string
  seq: number
  status: StopStatus
  fail_reason: string | null
  cod_collected: number | null
  order_code: string
  name: string | null
  phone: string | null
  address: string | null
  lat: number | null
  lng: number | null
  cod: number
  note: string | null
  weight_g: number
  items: string | null
}

export interface MyTrip {
  id: string
  code: string
  shop_id: string
  shop_name: string
  trip_date: string
  status: TripStatus
  started_at: string | null
  cod_expected: number
  cod_collected: number
  start_lat: number | null
  start_lng: number | null
  shop_lat: number | null
  shop_lng: number | null
  end_mode: EndMode
  note: string | null
  stops: MyStop[]
}

export async function getMyTrips(): Promise<MyTrip[]> {
  return unwrap(await supabase.rpc('get_my_trips')) as MyTrip[]
}

export interface HistoryTrip {
  id: string
  code: string
  shop_name: string
  trip_date: string
  status: TripStatus
  stops: number
  delivered: number
  failed: number
  cod_collected: number
  settled_at: string | null
}

export async function getMyTripHistory(): Promise<HistoryTrip[]> {
  return unwrap(await supabase.rpc('get_my_trip_history', { p_limit: 40 })) as HistoryTrip[]
}

export async function startTrip(tripId: string) {
  unwrap(await supabase.rpc('start_trip', { p_trip_id: tripId }))
}

export async function finishTrip(tripId: string, reason: string) {
  unwrap(await supabase.rpc('finish_trip', { p_trip_id: tripId, p_reason: reason }))
}

export async function completeStop(
  stopId: string,
  args: { cod: number; lat: number | null; lng: number | null; photo: string | null; note: string },
) {
  unwrap(
    await supabase.rpc('complete_stop', {
      p_stop_id: stopId,
      p_cod: args.cod,
      p_lat: args.lat,
      p_lng: args.lng,
      p_photo: args.photo,
      p_note: args.note || null,
    }),
  )
}

export async function failStop(stopId: string, reason: string, note: string) {
  unwrap(await supabase.rpc('fail_stop', { p_stop_id: stopId, p_reason: reason, p_note: note || null }))
}

/** Uploads a (compressed) proof-of-delivery photo and returns its storage path. */
export async function uploadProof(shopId: string, tripId: string, stopId: string, blob: Blob): Promise<string> {
  const path = `${shopId}/${tripId}/${stopId}.jpg`
  const { error } = await supabase.storage.from('delivery-proofs').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  return path
}

export async function proofUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('delivery-proofs').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}
