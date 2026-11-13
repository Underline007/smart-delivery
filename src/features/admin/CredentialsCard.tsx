import { Copy, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { formatVnPhone } from '@/lib/vn/phone'

/** Shows sign-in details once, so the admin can pass them to the person (Zalo, SMS…). */
export function CredentialsCard({ phone, password }: { phone: string; password: string }) {
  const text =
    `Tài khoản Smart Delivery\n` +
    `Đăng nhập: ${window.location.origin}\n` +
    `Số điện thoại: ${phone}\n` +
    `Mật khẩu tạm: ${password}\n` +
    `Lần đầu đăng nhập sẽ được yêu cầu đổi mật khẩu.`

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Đã sao chép')
    } catch {
      toast.error('Không sao chép được, hãy ghi lại thủ công')
    }
  }

  const canShare = typeof navigator.share === 'function'

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-primary-soft p-4">
      <p className="text-sm text-primary">
        Gửi thông tin này cho người dùng. Mật khẩu tạm chỉ hiện một lần.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
        <dt className="text-muted">SĐT</dt>
        <dd className="font-semibold">{formatVnPhone(phone)}</dd>
        <dt className="text-muted">Mật khẩu</dt>
        <dd className="font-mono text-lg font-semibold tracking-wide">{password}</dd>
      </dl>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={copy}>
          Sao chép
        </Button>
        {canShare && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Share2 className="size-4" />}
            onClick={() => navigator.share({ text }).catch(() => undefined)}
          >
            Chia sẻ
          </Button>
        )}
      </div>
    </div>
  )
}
