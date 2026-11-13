import { ChevronRight, KeyRound, LogOut } from 'lucide-react'
import { Link } from 'react-router'
import { useMe, useSession } from '@/app/session'
import { Card, SectionTitle } from '@/components/ui/misc'
import { ACCOUNT_TYPE_LABEL } from '@/lib/types'
import { formatVnPhone } from '@/lib/vn/phone'

/** "Tài khoản" block used on every role's settings/account page. */
export function AccountSection() {
  const { profile } = useMe()
  const { signOut } = useSession()

  return (
    <section>
      <SectionTitle>Tài khoản</SectionTitle>
      <Card className="p-0">
        <div className="flex items-center gap-3 p-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-lg font-bold text-primary">
            {profile.full_name.trim().split(/\s+/).pop()?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{profile.full_name}</p>
            <p className="text-sm text-muted">
              {formatVnPhone(profile.phone)} · {ACCOUNT_TYPE_LABEL[profile.account_type]}
            </p>
          </div>
        </div>
        <Link
          to="/change-password"
          className="flex min-h-14 items-center gap-3 border-t border-border px-4 active:bg-surface-2"
        >
          <KeyRound className="size-5 text-muted" />
          <span className="flex-1">Đổi mật khẩu</span>
          <ChevronRight className="size-5 text-muted" />
        </Link>
        <button
          type="button"
          onClick={() => signOut()}
          className="flex min-h-14 w-full items-center gap-3 border-t border-border px-4 text-left text-danger active:bg-surface-2"
        >
          <LogOut className="size-5" />
          <span className="flex-1">Đăng xuất</span>
        </button>
      </Card>
    </section>
  )
}
