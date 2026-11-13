import {
  CircleUser,
  Gauge,
  History,
  House,
  Package,
  Plus,
  ReceiptText,
  Settings,
  Store,
  Truck,
  UserCog,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router'
import { AppShell, type NavItem } from '@/components/layout/AppShell'
import { useCurrentShop } from './current-shop'

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Hệ thống', icon: Gauge, end: true },
  { to: '/admin/shops', label: 'Cửa hàng', icon: Store },
  { to: '/admin/accounts', label: 'Tài khoản', icon: UserCog },
  { to: '/admin/settings', label: 'Cài đặt', icon: Settings },
]

const SHOP_NAV: NavItem[] = [
  { to: '/shop', label: 'Tổng quan', icon: House, end: true },
  { to: '/shop/orders', label: 'Đơn hàng', icon: ReceiptText, end: true },
  { to: '/shop/orders/new', label: 'Tạo đơn', icon: Plus, primary: true },
  { to: '/shop/inventory', label: 'Kho', icon: Package },
  { to: '/shop/customers', label: 'Khách hàng', icon: Users },
]

const SHIPPER_NAV: NavItem[] = [
  { to: '/ship', label: 'Chuyến hôm nay', icon: Truck, end: true },
  { to: '/ship/history', label: 'Lịch sử', icon: History },
  { to: '/ship/account', label: 'Tài khoản', icon: CircleUser },
]

export function AdminLayout() {
  return <AppShell nav={ADMIN_NAV} />
}

function AdminViewBanner() {
  const { shop, isAdminView, exitAdminView } = useCurrentShop()
  const navigate = useNavigate()
  if (!isAdminView || !shop) return null
  return (
    <div className="bg-warning-soft pt-safe text-warning">
      <div className="mx-auto flex max-w-screen-sm items-center gap-3 px-4 py-2 text-sm">
        <p className="min-w-0 flex-1 truncate">
          Đang xem <strong>{shop.name}</strong> với quyền admin
        </p>
        <button
          type="button"
          className="shrink-0 rounded-lg px-2 py-1 font-semibold underline"
          onClick={() => {
            exitAdminView()
            navigate('/admin/shops')
          }}
        >
          Thoát
        </button>
      </div>
    </div>
  )
}

export function ShopLayout() {
  return <AppShell nav={SHOP_NAV} banner={<AdminViewBanner />} />
}

export function ShipperLayout() {
  return <AppShell nav={SHIPPER_NAV} />
}
