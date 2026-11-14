import { lazy, Suspense, type ComponentType } from 'react'
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
import { LoadingBlock } from '@/components/ui/misc'
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { isConfigured } from '@/lib/env'

/** Loads a page's code only when its route is opened (keeps the first download small). */
function lazyPage<M, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }))
}

const AdminAccountsPage = lazyPage(() => import('@/features/admin/AdminAccountsPage'), 'AdminAccountsPage')
const AdminCatalogPage = lazyPage(() => import('@/features/admin/AdminCatalogPage'), 'AdminCatalogPage')
const AdminVtpTemplatePage = lazyPage(() => import('@/features/vtp/AdminVtpTemplatePage'), 'AdminVtpTemplatePage')
const VtpExportPage = lazyPage(() => import('@/features/vtp/VtpExportPage'), 'VtpExportPage')
const VtpTrackingPage = lazyPage(() => import('@/features/vtp/VtpTrackingPage'), 'VtpTrackingPage')
const AdminAuditPage = lazyPage(() => import('@/features/admin/AdminAuditPage'), 'AdminAuditPage')
const AdminHomePage = lazyPage(() => import('@/features/admin/AdminHomePage'), 'AdminHomePage')
const AdminSettingsPage = lazyPage(() => import('@/features/admin/AdminSettingsPage'), 'AdminSettingsPage')
const AdminShopsPage = lazyPage(() => import('@/features/admin/AdminShopsPage'), 'AdminShopsPage')
const CustomerDetailPage = lazyPage(() => import('@/features/customers/CustomerDetailPage'), 'CustomerDetailPage')
const CustomersPage = lazyPage(() => import('@/features/customers/CustomersPage'), 'CustomersPage')
const HistoryPage = lazyPage(() => import('@/features/products/HistoryPage'), 'HistoryPage')
const InventoryPage = lazyPage(() => import('@/features/products/InventoryPage'), 'InventoryPage')
const ProductFormPage = lazyPage(() => import('@/features/products/ProductFormPage'), 'ProductFormPage')
const ReceiptPage = lazyPage(() => import('@/features/products/ReceiptPage'), 'ReceiptPage')
const StockCardPage = lazyPage(() => import('@/features/products/StockCardPage'), 'StockCardPage')
const StocktakePage = lazyPage(() => import('@/features/products/StocktakePage'), 'StocktakePage')
const OrderDetailPage = lazyPage(() => import('@/features/orders/OrderDetailPage'), 'OrderDetailPage')
const OrderFormPage = lazyPage(() => import('@/features/orders/OrderFormPage'), 'OrderFormPage')
const OrdersPage = lazyPage(() => import('@/features/orders/OrdersPage'), 'OrdersPage')
const ShipperAccountPage = lazyPage(() => import('@/features/delivery/ShipperPages'), 'ShipperAccountPage')
const ShipperHistoryPage = lazyPage(() => import('@/features/delivery/ShipperPages'), 'ShipperHistoryPage')
const ShipperTripPage = lazyPage(() => import('@/features/delivery/ShipperPages'), 'ShipperTripPage')
const ShipperTripsPage = lazyPage(() => import('@/features/delivery/ShipperPages'), 'ShipperTripsPage')
const TripDetailPage = lazyPage(() => import('@/features/delivery/TripDetailPage'), 'TripDetailPage')
const TripPlannerPage = lazyPage(() => import('@/features/delivery/TripPlannerPage'), 'TripPlannerPage')
const TripsPage = lazyPage(() => import('@/features/delivery/TripsPage'), 'TripsPage')
const DashboardPage = lazyPage(() => import('@/features/reports/DashboardPage'), 'DashboardPage')
const ReportsPage = lazyPage(() => import('@/features/reports/ReportsPage'), 'ReportsPage')
const ShopSettingsPage = lazyPage(() => import('@/features/shop/ShopSettingsPage'), 'ShopSettingsPage')
const ShopShippersPage = lazyPage(() => import('@/features/shop/ShopShippersPage'), 'ShopShippersPage')

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
                  <Route path="vtp-template" element={<AdminVtpTemplatePage />} />
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
                  <Route index element={<DashboardPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="orders/new" element={<OrderFormPage />} />
                  <Route path="orders/:orderId" element={<OrderDetailPage />} />
                  <Route path="orders/:orderId/edit" element={<OrderFormPage />} />
                  <Route path="inventory" element={<InventoryPage />} />
                  <Route path="inventory/products/new" element={<ProductFormPage />} />
                  <Route path="inventory/products/:productId" element={<ProductFormPage />} />
                  <Route path="inventory/receipts/new" element={<ReceiptPage />} />
                  <Route path="inventory/stocktake" element={<StocktakePage />} />
                  <Route path="inventory/stock-card/:variantId" element={<StockCardPage />} />
                  <Route path="inventory/history" element={<HistoryPage />} />
                  <Route path="customers" element={<CustomersPage />} />
                  <Route path="customers/:customerId" element={<CustomerDetailPage />} />
                  <Route path="delivery" element={<TripsPage />} />
                  <Route path="delivery/new" element={<TripPlannerPage />} />
                  <Route path="delivery/:tripId" element={<TripDetailPage />} />
                  <Route path="vtp/export" element={<VtpExportPage />} />
                  <Route path="vtp/tracking" element={<VtpTrackingPage />} />
                  <Route path="reports" element={<ReportsPage />} />
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
                  <Route index element={<ShipperTripsPage />} />
                  <Route path="trip/:tripId" element={<ShipperTripPage />} />
                  <Route path="history" element={<ShipperHistoryPage />} />
                  <Route path="account" element={<ShipperAccountPage />} />
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
