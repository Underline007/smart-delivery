import { useQuery } from '@tanstack/react-query'
import { ChevronRight, KeyRound, Lock, LockOpen, Plus, RefreshCw, UserCog } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useMe } from '@/app/session'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { SearchInput, SelectField, TextField } from '@/components/ui/Field'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import {
  adminCreateAccount,
  adminListAccounts,
  adminResetPassword,
  adminSetAccountActive,
  adminUpdateAccount,
} from '@/lib/api'
import { cn } from '@/lib/cn'
import { generateTempPassword } from '@/lib/password'
import { ACCOUNT_TYPE_LABEL, type AccountType, type AdminAccount } from '@/lib/types'
import { useAction } from '@/lib/useAction'
import { useDebounced } from '@/lib/useDebounced'
import { formatVnPhone, normalizeVnMobile } from '@/lib/vn/phone'
import { CredentialsCard } from './CredentialsCard'

const ACCOUNTS_KEY = ['admin', 'accounts']
const INVALIDATE = [ACCOUNTS_KEY, ['admin', 'shops']]

const FILTERS: { value: AccountType | 'all'; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'owner', label: 'Chủ cửa hàng' },
  { value: 'shipper', label: 'Shipper' },
  { value: 'admin', label: 'Admin' },
]

const TYPE_TONE = { admin: 'warning', owner: 'primary', shipper: 'neutral' } as const

function validateIdentity(fullName: string, phone: string) {
  const errors: { full_name?: string; phone?: string } = {}
  if (!fullName.trim()) errors.full_name = 'Nhập họ tên'
  if (!normalizeVnMobile(phone)) errors.phone = 'Số điện thoại di động không hợp lệ'
  return errors
}

function CreateAccountSheet({ onClose }: { onClose: () => void }) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [accountType, setAccountType] = useState<AccountType>('shipper')
  const [password, setPassword] = useState(generateTempPassword)
  const [errors, setErrors] = useState<{ full_name?: string; phone?: string }>({})
  const [created, setCreated] = useState<{ phone: string; password: string } | null>(null)

  const create = useAction(
    () =>
      adminCreateAccount({
        full_name: fullName.trim(),
        phone: normalizeVnMobile(phone)!,
        account_type: accountType,
        password,
      }),
    {
      success: 'Đã tạo tài khoản',
      invalidate: INVALIDATE,
      onSuccess: () => setCreated({ phone: normalizeVnMobile(phone)!, password }),
    },
  )

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next = validateIdentity(fullName, phone)
    setErrors(next)
    if (Object.keys(next).length === 0) create.mutate(undefined)
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={created ? 'Đã tạo tài khoản' : 'Tạo tài khoản'}
      footer={
        created ? (
          <Button block onClick={onClose}>
            Xong
          </Button>
        ) : (
          <Button type="submit" form="create-account" block loading={create.isPending}>
            Tạo tài khoản
          </Button>
        )
      }
    >
      {created ? (
        <CredentialsCard phone={created.phone} password={created.password} />
      ) : (
        <form id="create-account" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <SelectField
            label="Loại tài khoản"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as AccountType)}
          >
            <option value="shipper">Shipper</option>
            <option value="owner">Chủ cửa hàng</option>
            <option value="admin">Admin</option>
          </SelectField>
          <TextField
            label="Họ tên"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={errors.full_name}
            autoComplete="off"
            maxLength={100}
          />
          <TextField
            label="Số điện thoại"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
            hint="Dùng để đăng nhập"
            autoComplete="off"
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField label="Mật khẩu tạm" value={password} readOnly className="font-mono" />
            </div>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Tạo mật khẩu khác"
              icon={<RefreshCw className="size-5" />}
              onClick={() => setPassword(generateTempPassword())}
            />
          </div>
          <p className="text-sm text-muted">
            Người dùng phải đổi mật khẩu ở lần đăng nhập đầu tiên.
            {accountType === 'owner' && ' Sau khi tạo, gán chủ cửa hàng vào shop ở mục Cửa hàng.'}
            {accountType === 'shipper' &&
              ' Chủ cửa hàng sẽ tự chọn shipper này vào shop của họ.'}
          </p>
        </form>
      )}
    </Sheet>
  )
}

function AccountSheet({ account, onClose }: { account: AdminAccount; onClose: () => void }) {
  const { profile } = useMe()
  const isSelf = account.id === profile.id
  const [fullName, setFullName] = useState(account.full_name)
  const [phone, setPhone] = useState(account.phone)
  const [errors, setErrors] = useState<{ full_name?: string; phone?: string }>({})
  const [confirm, setConfirm] = useState<'reset' | 'lock' | null>(null)
  const [newPassword, setNewPassword] = useState<string | null>(null)

  const update = useAction(
    () =>
      adminUpdateAccount(account.id, {
        full_name: fullName.trim(),
        phone: normalizeVnMobile(phone)!,
      }),
    { success: 'Đã lưu', invalidate: INVALIDATE },
  )

  const reset = useAction(
    (password: string) => adminResetPassword(account.id, password).then(() => password),
    {
      invalidate: INVALIDATE,
      onSuccess: (password) => {
        setNewPassword(password)
        setConfirm(null)
      },
    },
  )

  const toggleActive = useAction(() => adminSetAccountActive(account.id, !account.active), {
    success: account.active ? 'Đã khoá tài khoản' : 'Đã mở khoá tài khoản',
    invalidate: INVALIDATE,
    onSuccess: () => setConfirm(null),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next = validateIdentity(fullName, phone)
    setErrors(next)
    if (Object.keys(next).length === 0) update.mutate(undefined)
  }

  return (
    <>
      <Sheet open onClose={onClose} title={account.full_name}>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={TYPE_TONE[account.account_type]}>
              {ACCOUNT_TYPE_LABEL[account.account_type]}
            </Badge>
            {!account.active && <Badge tone="danger">Đang khoá</Badge>}
            {account.must_change_password && <Badge tone="warning">Chưa đổi mật khẩu tạm</Badge>}
          </div>

          {newPassword && <CredentialsCard phone={account.phone} password={newPassword} />}

          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <TextField
              label="Họ tên"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              error={errors.full_name}
              maxLength={100}
            />
            <TextField
              label="Số điện thoại"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              error={errors.phone}
              hint="Đổi số điện thoại thì người dùng đăng nhập bằng số mới"
            />
            <Button
              type="submit"
              variant="secondary"
              block
              loading={update.isPending}
              disabled={fullName === account.full_name && phone === account.phone}
            >
              Lưu thay đổi
            </Button>
          </form>

          {account.shops.length > 0 && (
            <section>
              <SectionTitle>Cửa hàng</SectionTitle>
              <ul className="flex flex-col gap-1 px-1 text-sm">
                {account.shops.map((shop) => (
                  <li key={shop.id}>
                    {shop.name} · {shop.role === 'owner' ? 'Chủ cửa hàng' : 'Shipper'}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <SectionTitle>Bảo mật</SectionTitle>
            <Button
              variant="secondary"
              block
              icon={<KeyRound className="size-5" />}
              onClick={() => setConfirm('reset')}
            >
              Đặt lại mật khẩu
            </Button>
            {!isSelf && (
              <Button
                variant={account.active ? 'danger-soft' : 'secondary'}
                block
                icon={account.active ? <Lock className="size-5" /> : <LockOpen className="size-5" />}
                onClick={() => setConfirm('lock')}
              >
                {account.active ? 'Khoá tài khoản' : 'Mở khoá tài khoản'}
              </Button>
            )}
          </section>
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirm === 'reset'}
        title="Đặt lại mật khẩu?"
        confirmLabel="Đặt lại"
        loading={reset.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => reset.mutate(generateTempPassword())}
      >
        App sẽ tạo một mật khẩu tạm mới cho {account.full_name}. Mật khẩu cũ không dùng được nữa.
      </ConfirmSheet>

      <ConfirmSheet
        open={confirm === 'lock'}
        title={account.active ? 'Khoá tài khoản?' : 'Mở khoá tài khoản?'}
        confirmLabel={account.active ? 'Khoá' : 'Mở khoá'}
        danger={account.active}
        loading={toggleActive.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => toggleActive.mutate(undefined)}
      >
        {account.active
          ? `${account.full_name} sẽ không đăng nhập và không xem được dữ liệu nữa. Lịch sử vẫn được giữ.`
          : `${account.full_name} sẽ đăng nhập lại được.`}
      </ConfirmSheet>
    </>
  )
}

export function AdminAccountsPage() {
  const [filter, setFilter] = useState<AccountType | 'all'>('all')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query.trim())
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const accounts = useQuery({
    queryKey: [...ACCOUNTS_KEY, filter, debouncedQuery],
    queryFn: () => adminListAccounts(filter === 'all' ? undefined : filter, debouncedQuery),
    placeholderData: (previous) => previous,
  })
  const selected = accounts.data?.find((a) => a.id === selectedId) ?? null

  return (
    <>
      <PageHeader
        title="Tài khoản"
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Tạo
          </Button>
        }
      />
      <PageBody className="flex flex-col gap-3">
        <SearchInput
          placeholder="Tìm theo tên hoặc số điện thoại"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={cn(
                'h-9 shrink-0 rounded-full border px-4 text-sm font-medium',
                filter === option.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-surface text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {accounts.isLoading ? (
          <LoadingBlock />
        ) : accounts.error ? (
          <ErrorBlock message="Không tải được danh sách tài khoản" onRetry={() => accounts.refetch()} />
        ) : accounts.data?.length === 0 ? (
          <EmptyState icon={<UserCog className="size-7" />} title="Không có tài khoản nào">
            {debouncedQuery ? 'Thử tìm với từ khoá khác.' : 'Bấm “Tạo” để thêm tài khoản.'}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.data?.map((account) => (
              <li key={account.id}>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setSelectedId(account.id)}
                >
                  <Card className={cn('flex items-center gap-3 py-3 active:bg-surface-2', !account.active && 'opacity-60')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{account.full_name}</p>
                        {!account.active && <Badge tone="danger">Khoá</Badge>}
                      </div>
                      <p className="text-sm text-muted">{formatVnPhone(account.phone)}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone={TYPE_TONE[account.account_type]}>
                          {ACCOUNT_TYPE_LABEL[account.account_type]}
                        </Badge>
                        {account.shops.length > 0 && (
                          <span className="truncate text-xs text-muted">
                            {account.shops.map((s) => s.name).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="size-5 text-muted" />
                  </Card>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PageBody>

      {creating && <CreateAccountSheet onClose={() => setCreating(false)} />}
      {selected && (
        <AccountSheet key={selected.id} account={selected} onClose={() => setSelectedId(null)} />
      )}
    </>
  )
}
