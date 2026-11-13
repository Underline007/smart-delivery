import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Alias, Province, Ward } from '@/lib/vn/address'
import { searchKey } from '@/lib/vn/text'

export type GeoSource = 'gps' | 'link' | 'manual' | 'osm' | 'google' | 'ors'

export interface CustomerAddress {
  id: string
  customer_id: string
  label: string | null
  detail: string
  province_code: string | null
  ward_code: string | null
  ward_text: string | null
  full_text: string
  lat: number | null
  lng: number | null
  geo_source: GeoSource | null
  is_default: boolean
}

export interface Customer {
  id: string
  shop_id: string
  name: string
  phone: string
  phone2: string | null
  tags: string[]
  note: string | null
  order_count: number
  delivered_count: number
  returned_count: number
  total_spent: number
  addresses: CustomerAddress[]
}

const SELECT = '*, addresses:customer_addresses(*)'
export const CUSTOMER_PAGE = 30

export async function listCustomers(
  shopId: string,
  args: { query?: string; offset?: number } = {},
): Promise<Customer[]> {
  let query = supabase
    .from('customers')
    .select(SELECT)
    .eq('shop_id', shopId)
    .order('name_search', { ascending: true })
    .range(args.offset ?? 0, (args.offset ?? 0) + CUSTOMER_PAGE - 1)

  const q = (args.query ?? '').trim()
  if (q) {
    const digits = q.replace(/\D/g, '')
    const key = searchKey(q).replace(/[%,()]/g, ' ')
    // Phone digits when the text looks like a number, otherwise the name.
    query = digits.length >= 3 && /^[\d\s.+-]+$/.test(q)
      ? query.ilike('phone', `%${digits.replace(/^84/, '0')}%`)
      : query.ilike('name_search', `%${key}%`)
  }
  return unwrap(await query) as Customer[]
}

export async function fetchCustomer(customerId: string): Promise<Customer | null> {
  return unwrap(
    await supabase.from('customers').select(SELECT).eq('id', customerId).maybeSingle(),
  ) as Customer | null
}

/** Exact phone lookup used to catch duplicates while typing. */
export async function findCustomerByPhone(shopId: string, phone: string): Promise<Customer | null> {
  return unwrap(
    await supabase.from('customers').select(SELECT).eq('shop_id', shopId).eq('phone', phone).maybeSingle(),
  ) as Customer | null
}

export interface CustomerInput {
  id?: string
  name: string
  phone: string
  phone2: string
  tags: string[]
  note: string
}

export async function saveCustomer(shopId: string, customer: CustomerInput): Promise<string> {
  return unwrap(await supabase.rpc('save_customer', { p_shop_id: shopId, p_customer: customer })) as string
}

export interface AddressInput {
  id?: string
  label: string
  detail: string
  province_code: string | null
  ward_code: string | null
  ward_text: string
  lat: number | null
  lng: number | null
  geo_source: GeoSource | null
  is_default: boolean
}

export async function saveCustomerAddress(
  shopId: string,
  customerId: string,
  address: AddressInput,
): Promise<string> {
  return unwrap(
    await supabase.rpc('save_customer_address', {
      p_shop_id: shopId,
      p_customer_id: customerId,
      p_address: address,
    }),
  ) as string
}

export async function deleteCustomerAddress(shopId: string, addressId: string) {
  unwrap(await supabase.rpc('delete_customer_address', { p_shop_id: shopId, p_address_id: addressId }))
}

// ---------------------------------------------------------------- catalogue

export async function fetchProvinces(): Promise<Province[]> {
  return unwrap(await supabase.from('provinces').select('code, name').order('name_search')) as Province[]
}

export async function fetchProvinceAliases(): Promise<Alias[]> {
  const rows = unwrap(
    await supabase.from('province_aliases').select('alias_search, province_code'),
  ) as { alias_search: string; province_code: string }[]
  return rows.map((r) => ({ alias_search: r.alias_search, code: r.province_code }))
}

export async function fetchWards(provinceCode: string): Promise<Ward[]> {
  return unwrap(
    await supabase
      .from('wards')
      .select('code, province_code, name')
      .eq('province_code', provinceCode)
      .order('name_search')
      .limit(2000),
  ) as Ward[]
}

export async function fetchWardAliases(wardCodes: string[]): Promise<Alias[]> {
  if (wardCodes.length === 0) return []
  const rows = unwrap(
    await supabase.from('ward_aliases').select('alias_search, ward_code').in('ward_code', wardCodes),
  ) as { alias_search: string; ward_code: string }[]
  return rows.map((r) => ({ alias_search: r.alias_search, code: r.ward_code }))
}

export async function catalogCounts(): Promise<{ provinces: number; wards: number }> {
  const [p, w] = await Promise.all([
    supabase.from('provinces').select('*', { count: 'exact', head: true }),
    supabase.from('wards').select('*', { count: 'exact', head: true }),
  ])
  return { provinces: p.count ?? 0, wards: w.count ?? 0 }
}

export async function upsertWards(rows: { code: string; province_code: string; name: string }[]): Promise<number> {
  return unwrap(await supabase.rpc('admin_upsert_wards', { p_rows: rows })) as number
}

export async function upsertAliases(
  rows: { alias: string; province_code?: string; ward_code?: string }[],
): Promise<number> {
  return unwrap(await supabase.rpc('admin_upsert_aliases', { p_rows: rows })) as number
}

// ---------------------------------------------------------------- maps links

/** Resolves maps.app.goo.gl links on the server (browsers cannot follow the redirect). */
export async function resolveMapLink(url: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('resolve-map-link', { body: { url } })
  if (error) throw error
  return (data as { url: string }).url
}
