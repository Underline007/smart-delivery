import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { CurrentShopProvider } from '@/app/CurrentShopProvider'
import {
  HomeRedirect,
  RequireAccountType,
  RequireAuth,
  RequirePasswordChanged,
  RequireShopAccess,
} from '@/app/guards'
import { AdminLayout, ShipperLayout, ShopLayout } from '@/app/layouts'
import { SessionProvider } from '@/app/SessionProvider'
import { SetupNeeded } from '@/app/SetupNeeded'
import { ComingSoon } from '@/components/ui/ComingSoon'
import { LoadingBlock } from '@/components/ui/misc'
import { AdminAccountsPage } from '@/features/admin/AdminAccountsPage'
import { AdminCatalogPage } from '@/features/admin/AdminCatalogPage'
import { AdminAuditPage } from '@/features/admin/AdminAuditPage'
import { AdminHomePage } from '@/features/admin/AdminHomePage'
import { AdminSettingsPage } from '@/features/admin/AdminSettingsPage'
import { AdminShopsPage } from '@/features/admin/AdminShopsPage'
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage'
import { CustomersPage } from '@/features/customers/CustomersPage'
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { HistoryPage } from '@/features/products/HistoryPage'
import { InventoryPage } from '@/features/products/InventoryPage'
import { ProductFormPage } from '@/features/products/ProductFormPage'
import { ReceiptPage } from '@/features/products/ReceiptPage'
import { StockCardPage } from '@/features/products/StockCardPage'
import { StocktakePage } from '@/features/products/StocktakePage'
import { ShopSettingsPage } from '@/features/shop/ShopSettingsPage'
import { ShopShippersPage } from '@/features/shop/ShopShippersPage'
import { isConfigured } from '@/lib/env'

const lazyPage = <T extends Record<string, React.ComponentType>>(
  load: () => Promise<T>,
  name: keyof T,
) => lazy(async () => ({ default: (await load())[name] as React.ComponentType }))

// Lazy pages are added here as modules are built.
const Lazy = {}
void Lazy
void lazyPage

export function App() {
  if (!isConfigured) return <SetupNeeded />

  return (
    <SessionProvider>
      <CurrentShopProvider>
        <Suspense fallback={<LoadingBlock />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<RequireAuth />}>
              <Route path="/change-password" element={<ChangePasswordPage />} />

              <Route element={<RequirePasswordChanged />}>
                <Route index element={<HomeRedirect />} />

                <Route
                  path="/admin"
                  element={
                    <RequireAccountType types={['admin']}>
                      <AdminLayout />
                    </RequireAccountType>
                  }
                >
                  <Route index element={<AdminHomePage />} />
                  <Route path="shops" element={<AdminShopsPage />} />
                  <Route path="accounts" element={<AdminAccountsPage />} />
                  <Route path="settings" element={<AdminSettingsPage />} />
                  <Route path="audit" element={<AdminAuditPage />} />
                  <Route path="catalog" element={<AdminCatalogPage />} />
                </Route>

                <Route
                  path="/shop"
                  element={
                    <RequireAccountType types={['admin', 'owner']}>
                      <RequireShopAccess>
                        <ShopLayout />
                      </RequireShopAccess>
                    </RequireAccountType>
                  }
                >
                  <Route index element={<ComingSoon title="Tổng quan" />} />
                  <Route path="orders" element={<ComingSoon title="Đơn hàng" />} />
                  <Route path="orders/new" element={<ComingSoon title="Tạo đơn" />} />
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="inventory/products/new" element={<ProductFormPage />} />
                  <Route path="inventory/products/:productId" element={<ProductFormPage />} />
                  <Route path="inventory/receipts/new" element={<ReceiptPage />} />
                  <Route path="inventory/stocktake" element={<StocktakePage />} />
                  <Route path="inventory/stock-card/:variantId" element={<StockCardPage />} />
                  <Route path="inventory/history" element={<HistoryPage />} />
                  <Route path="customers" element={<CustomersPage />} />
                  <Route path="customers/:customerId" element={<CustomerDetailPage />} />
                  <Route path="reports" element={<ComingSoon title="Báo cáo" />} />
                  <Route path="settings" element={<ShopSettingsPage />} />
                  <Route path="settings/shippers" element={<ShopShippersPage />} />
                </Route>

                <Route
                  path="/ship"
                  element={
                    <RequireAccountType types={['shipper']}>
                      <ShipperLayout />
                    </RequireAccountType>
                  }
                >
                  <Route index element={<ComingSoon title="Chuyến hôm nay" />} />
                  <Route path="history" element={<ComingSoon title="Lịch sử" />} />
                  <Route path="account" element={<ComingSoon title="Tài khoản" />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </CurrentShopProvider>
    </SessionProvider>
  )
}
