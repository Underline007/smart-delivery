import { Lock, Store } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '@/components/ui/Button'
import { PausedHint } from '@/components/ui/PausedHint'
import { EmptyState, FullScreenLoader } from '@/components/ui/misc'
import type { AccountType } from '@/lib/types'
import { useCurrentShop } from './current-shop'
import { useSession } from './session'

function CenteredScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-4">{children}</div>
}

/** Signed in, with an active profile. */
export function RequireAuth() {
  const { session, context, contextError, signOut, refreshContext } = useSession()
  const location = useLocation()

  if (session === undefined) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  if (contextError) {
    return (
      <CenteredScreen>
        <EmptyState
          title="Không tải được thông tin tài khoản"
          action={
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => signOut()}>
                Đăng xuất
              </Button>
              <Button onClick={() => refreshContext()}>Thử lại</Button>
            </div>
          }
        >
          <PausedHint />
        </EmptyState>
      </CenteredScreen>
    )
  }
  if (context === undefined) return <FullScreenLoader />
  if (context === null) {
    return (
      <CenteredScreen>
        <EmptyState
          icon={<Lock className="size-7" />}
          title="Tài khoản không hoạt động"
          action={<Button onClick={() => signOut()}>Đăng xuất</Button>}
        >
          Tài khoản đã bị khoá hoặc chưa được thiết lập. Liên hệ admin để được hỗ trợ.
        </EmptyState>
      </CenteredScreen>
    )
  }
  return <Outlet />
}

/** Sends users who still use a temporary password to the change-password screen. */
export function RequirePasswordChanged() {
  const { context } = useSession()
  if (context?.profile.must_change_password) return <Navigate to="/change-password" replace />
  return <Outlet />
}

export function HomeRedirect() {
  const { context } = useSession()
  switch (context?.profile.account_type) {
    case 'admin':
      return <Navigate to="/admin" replace />
    case 'owner':
      return <Navigate to="/shop" replace />
    case 'shipper':
      return <Navigate to="/ship" replace />
    default:
      return <Navigate to="/login" replace />
  }
}

export function RequireAccountType({
  types,
  children,
}: {
  types: AccountType[]
  children: ReactNode
}) {
  const { context } = useSession()
  if (!context || !types.includes(context.profile.account_type)) return <Navigate to="/" replace />
  return children
}

/** Owners with at least one shop, or an admin who entered a shop. */
export function RequireShopAccess({ children }: { children: ReactNode }) {
  const { context, signOut } = useSession()
  const { shop, loading } = useCurrentShop()
  const type = context?.profile.account_type

  if (type === 'shipper') return <Navigate to="/" replace />
  if (loading) return <FullScreenLoader />
  if (type === 'admin' && !shop) return <Navigate to="/admin/shops" replace />
  if (!shop) {
    return (
      <CenteredScreen>
        <EmptyState
          icon={<Store className="size-7" />}
          title="Bạn chưa được gán vào cửa hàng nào"
          action={
            <Button variant="secondary" onClick={() => signOut()}>
              Đăng xuất
            </Button>
          }
        >
          Liên hệ admin để được thêm làm chủ cửa hàng.
        </EmptyState>
      </CenteredScreen>
    )
  }
  return children
}
