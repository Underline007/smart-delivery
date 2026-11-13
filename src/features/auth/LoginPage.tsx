import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/Button'
import { PasswordField, TextField } from '@/components/ui/Field'
import { FullScreenLoader } from '@/components/ui/misc'
import { signIn } from '@/lib/api'
import { toMessage } from '@/lib/errors'
import { normalizeVnMobile } from '@/lib/vn/phone'

export function LoginPage() {
  const { session } = useSession()
  const location = useLocation()
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (session === undefined) return <FullScreenLoader />
  if (session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const normalized = normalizeVnMobile(phone)
    if (!normalized) {
      setPhoneError('Số điện thoại di động không hợp lệ')
      return
    }
    setPhoneError(null)
    setSubmitting(true)
    try {
      await signIn(normalized, password)
    } catch (error) {
      setFormError(await toMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col pt-safe pb-safe">
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-10">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/favicon.svg" alt="" className="size-16 rounded-2xl" />
          <div>
            <h1 className="text-2xl font-bold">Smart Delivery</h1>
            <p className="mt-1 text-muted">Đăng nhập để tiếp tục</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <TextField
            label="Số điện thoại"
            type="tel"
            inputMode="tel"
            autoComplete="username"
            placeholder="0912 345 678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={phoneError}
            required
          />
          <PasswordField
            label="Mật khẩu"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {formError && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger">
              {formError}
            </p>
          )}
          <Button type="submit" block loading={submitting} disabled={!phone || !password}>
            Đăng nhập
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Quên mật khẩu? Liên hệ admin để được đặt lại.
        </p>
      </main>
    </div>
  )
}
