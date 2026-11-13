import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { fetchShop } from '@/lib/api'
import { readStorage, writeStorage } from '@/lib/storage'
import { CurrentShopContext, type CurrentShopValue } from './current-shop'
import { useSession } from './session'

const ADMIN_SHOP_KEY = 'sd.admin-shop'
const ownerShopKey = (userId: string) => `sd.shop.${userId}`

export function CurrentShopProvider({ children }: { children: ReactNode }) {
  const { context } = useSession()
  const profile = context?.profile
  const isAdmin = profile?.account_type === 'admin'

  const ownedShops = useMemo(
    () => (context?.shops ?? []).filter((shop) => shop.role === 'owner'),
    [context],
  )

  // The profile arrives after the first render, so the remembered choice is
  // read from storage on every render until the user picks a shop.
  const [ownerChoice, setOwnerChoice] = useState<string | null>(null)
  const effectiveChoice = ownerChoice ?? (profile ? readStorage(ownerShopKey(profile.id)) : null)
  const [adminShopId, setAdminShopId] = useState<string | null>(() => readStorage(ADMIN_SHOP_KEY))

  const ownerShop =
    ownedShops.find((shop) => shop.id === effectiveChoice) ?? ownedShops[0] ?? null

  const adminShopQuery = useQuery({
    queryKey: ['shop', adminShopId],
    queryFn: () => fetchShop(adminShopId!),
    enabled: isAdmin && Boolean(adminShopId),
  })

  const selectShop = useCallback(
    (shopId: string) => {
      setOwnerChoice(shopId)
      if (profile) writeStorage(ownerShopKey(profile.id), shopId)
    },
    [profile],
  )

  const enterAsAdmin = useCallback((shopId: string) => {
    setAdminShopId(shopId)
    writeStorage(ADMIN_SHOP_KEY, shopId)
  }, [])

  const exitAdminView = useCallback(() => {
    setAdminShopId(null)
    writeStorage(ADMIN_SHOP_KEY, null)
  }, [])

  const value = useMemo<CurrentShopValue>(() => {
    if (isAdmin) {
      const shop = adminShopQuery.data
      return {
        shop: shop ? { id: shop.id, name: shop.name, order_prefix: shop.order_prefix } : null,
        loading: Boolean(adminShopId) && adminShopQuery.isLoading,
        ownedShops: [],
        selectShop,
        isAdminView: Boolean(shop),
        enterAsAdmin,
        exitAdminView,
      }
    }
    return {
      shop: ownerShop,
      loading: false,
      ownedShops,
      selectShop,
      isAdminView: false,
      enterAsAdmin,
      exitAdminView,
    }
  }, [
    isAdmin,
    adminShopQuery.data,
    adminShopQuery.isLoading,
    adminShopId,
    ownerShop,
    ownedShops,
    selectShop,
    enterAsAdmin,
    exitAdminView,
  ])

  return <CurrentShopContext.Provider value={value}>{children}</CurrentShopContext.Provider>
}
