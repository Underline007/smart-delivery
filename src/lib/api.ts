import { env } from './env'
import { unwrap } from './errors'
import { supabase } from './supabase'
import type {
  AccountType,
  AdminAccount,
  AdminShop,
  MyContext,
  ShipperSearchResult,
  Shop,
  ShopMember,
} from './types'
import { phoneToLoginEmail } from './vn/phone'

// ---------------------------------------------------------------- auth

export async function signIn(phone: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToLoginEmail(phone, env.loginEmailDomain),
    password,
  })
  if (error) throw error
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function changePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
  unwrap(await supabase.rpc('mark_password_changed'))
}

export async function fetchMyContext(): Promise<MyContext | null> {
  return unwrap(await supabase.rpc('my_context')) as MyContext | null
}

// ---------------------------------------------------------------- admin

export async function adminDbUsage(): Promise<number> {
  return Number(unwrap(await supabase.rpc('admin_db_usage')))
}

export async function adminListShops(): Promise<AdminShop[]> {
  const rows = unwrap(await supabase.rpc('admin_list_shops')) as AdminShop[]
  return rows.map((row) => ({ ...row, shipper_count: Number(row.shipper_count) }))
}

export interface ShopInput {
  name: string
  order_prefix: string
  phone: string
  address: string
}

export async function adminCreateShop(input: ShopInput): Promise<string> {
  return unwrap(
    await supabase.rpc('admin_create_shop', {
      p_name: input.name,
      p_order_prefix: input.order_prefix,
      p_phone: input.phone,
      p_address: input.address,
    }),
  ) as string
}

export async function adminUpdateShop(id: string, input: ShopInput & { active: boolean }) {
  unwrap(
    await supabase.rpc('admin_update_shop', {
      p_shop_id: id,
      p_name: input.name,
      p_order_prefix: input.order_prefix,
      p_phone: input.phone,
      p_address: input.address,
      p_active: input.active,
    }),
  )
}

export async function adminSetShopOwner(shopId: string, userId: string, active: boolean) {
  unwrap(
    await supabase.rpc('admin_set_shop_owner', {
      p_shop_id: shopId,
      p_user_id: userId,
      p_active: active,
    }),
  )
}

export async function adminListAccounts(
  accountType?: AccountType,
  query?: string,
): Promise<AdminAccount[]> {
  return unwrap(
    await supabase.rpc('admin_list_accounts', {
      p_account_type: accountType ?? null,
      p_query: query || null,
    }),
  ) as AdminAccount[]
}

async function invokeAdminUsers(body: Record<string, unknown>): Promise<{ id: string }> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) throw error
  return data as { id: string }
}

export interface AccountInput {
  full_name: string
  phone: string
}

export function adminCreateAccount(
  input: AccountInput & { account_type: AccountType; password: string },
) {
  return invokeAdminUsers({ action: 'create', ...input })
}

export function adminUpdateAccount(userId: string, input: AccountInput) {
  return invokeAdminUsers({ action: 'update', user_id: userId, ...input })
}

export function adminResetPassword(userId: string, password: string) {
  return invokeAdminUsers({ action: 'reset_password', user_id: userId, password })
}

export function adminSetAccountActive(userId: string, active: boolean) {
  return invokeAdminUsers({ action: 'set_active', user_id: userId, active })
}

// ---------------------------------------------------------------- shop

export async function fetchShop(shopId: string): Promise<Shop | null> {
  return unwrap(
    await supabase
      .from('shops')
      .select('id, name, phone, address, order_prefix, active')
      .eq('id', shopId)
      .maybeSingle(),
  ) as Shop | null
}

export async function updateShopInfo(
  shopId: string,
  input: { name: string; phone: string; address: string },
) {
  unwrap(
    await supabase.rpc('update_shop_info', {
      p_shop_id: shopId,
      p_name: input.name,
      p_phone: input.phone,
      p_address: input.address,
    }),
  )
}

export async function listShopMembers(shopId: string): Promise<ShopMember[]> {
  return unwrap(await supabase.rpc('list_shop_members', { p_shop_id: shopId })) as ShopMember[]
}

export async function searchShippers(
  shopId: string,
  query: string,
): Promise<ShipperSearchResult[]> {
  return unwrap(
    await supabase.rpc('search_shippers', { p_shop_id: shopId, p_query: query || null }),
  ) as ShipperSearchResult[]
}

export async function addShopShipper(shopId: string, userId: string) {
  unwrap(await supabase.rpc('add_shop_shipper', { p_shop_id: shopId, p_user_id: userId }))
}

export async function removeShopShipper(shopId: string, userId: string) {
  unwrap(await supabase.rpc('remove_shop_shipper', { p_shop_id: shopId, p_user_id: userId }))
}
