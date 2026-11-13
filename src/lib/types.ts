export type AccountType = 'admin' | 'owner' | 'shipper'
export type ShopRole = 'owner' | 'shipper'

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  admin: 'Admin',
  owner: 'Chủ cửa hàng',
  shipper: 'Shipper',
}

export interface Profile {
  id: string
  full_name: string
  phone: string
  account_type: AccountType
  active: boolean
  must_change_password: boolean
}

export interface MyShop {
  id: string
  name: string
  order_prefix: string
  role: ShopRole
}

export interface MyContext {
  profile: Profile
  shops: MyShop[]
}

export interface Shop {
  id: string
  name: string
  phone: string | null
  address: string | null
  lat: number | null
  lng: number | null
  order_prefix: string
  active: boolean
}

export interface ShopSettings {
  shop_id: string
  vtp_service: string
  vtp_fee_payer: 'sender' | 'receiver'
  vtp_delivery_requirement: 'no_view' | 'view' | 'try'
  packaging_weight_g: number
  allow_negative_stock: boolean
  message_template: string
}

export interface AdminShop extends Omit<Shop, 'lat' | 'lng'> {
  created_at: string
  owners: { id: string; full_name: string; phone: string }[]
  shipper_count: number
}

export interface AdminAccount {
  id: string
  full_name: string
  phone: string
  account_type: AccountType
  active: boolean
  must_change_password: boolean
  created_at: string
  shops: { id: string; name: string; role: ShopRole }[]
}

export interface ShopMember {
  user_id: string
  full_name: string
  phone: string
  role: ShopRole
  active: boolean
  account_active: boolean
  added_at: string
}

export interface ShipperSearchResult {
  id: string
  full_name: string
  phone: string
  is_member: boolean
}
