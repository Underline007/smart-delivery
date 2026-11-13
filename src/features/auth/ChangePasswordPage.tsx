import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useSession } from '@/app/session'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { PasswordField } from '@/components/ui/Field'
import { changePassword } from '@/lib/api'
import { toMessage } from '@/lib/errors'
import { MIN_PASSWORD_LENGTH } from '@/lib/vn/phone'

export function ChangePasswordPage() {
  const { context, refreshContext, signOut } = useSession()
  const navigate = useNavigate()
  const forced = Boolean(context?.profile.must_change_password)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`)
      return
    }
    if (password !== confirm) {
      setError('Hai mật khẩu không khớp')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await changePassword(password)
      await refreshContext()
      toast.success('Đã đổi mật khẩu')
      navigate('/', { replace: true })
    } catch (err) {
      setError(await toMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-dvh">
      <PageHeader title="Đổi mật khẩu" back={forced ? undefined : true} />
      <PageBody>
        {forced && (
          <div className="mb-5 flex gap-3 rounded-2xl bg-primary-soft p-4 text-sm text-primary">
            <KeyRound className="size-5 shrink-0" />
            <p>
              Chào {context?.profile.full_name}. Bạn đang dùng mật khẩu tạm do admin cấp, hãy đặt mật
              khẩu mới để tiếp tục.
            </p>
          </div>
        )}
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <PasswordField
            label="Mật khẩu mới"
            autoComplete="new-password"
            hint={`Ít nhất ${MIN_PASSWORD_LENGTH} ký tự`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordField
            label="Nhập lại mật khẩu mới"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" block loading={submitting}>
            Lưu mật khẩu mới
          </Button>
          {forced && (
            <Button variant="ghost" block onClick={() => signOut()}>
              Đăng xuất
            </Button>
          )}
        </form>
      </PageBody>
    </div>
  )
}
