import { createContext, useContext } from 'react'
import type { MyShop } from '@/lib/types'

export interface CurrentShop {
  id: string
  name: string
  order_prefix: string
}

export interface CurrentShopValue {
  /** Shop the owner (or an admin who entered it) is working on. */
  shop: CurrentShop | null
  loading: boolean
  /** Shops the user owns; more than one shows a shop picker. */
  ownedShops: MyShop[]
  selectShop: (shopId: string) => void
  /** True when an admin is working inside a shop. */
  isAdminView: boolean
  enterAsAdmin: (shopId: string) => void
  exitAdminView: () => void
}

export const CurrentShopContext = createContext<CurrentShopValue | null>(null)

export function useCurrentShop(): CurrentShopValue {
  const value = useContext(CurrentShopContext)
  if (!value) throw new Error('useCurrentShop must be used inside CurrentShopProvider')
  return value
}

/** The current shop; only use below RequireShopAccess. */
export function useShop(): CurrentShop {
  const { shop } = useCurrentShop()
  if (!shop) throw new Error('useShop must be used below RequireShopAccess')
  return shop
}
