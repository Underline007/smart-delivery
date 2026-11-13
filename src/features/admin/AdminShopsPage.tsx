import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Pencil, Plus, Store, Truck, UserMinus, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useCurrentShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { SelectField, TextField } from '@/components/ui/Field'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import {
  adminCreateShop,
  adminListAccounts,
  adminListShops,
  adminSetShopOwner,
  adminUpdateShop,
  type ShopInput,
} from '@/lib/api'
import { cn } from '@/lib/cn'
import type { AdminShop } from '@/lib/types'
import { useAction } from '@/lib/useAction'
import { formatVnPhone } from '@/lib/vn/phone'

const SHOPS_KEY = ['admin', 'shops']

function ShopFormSheet({
  open,
  shop,
  onClose,
}: {
  open: boolean
  shop?: AdminShop
  onClose: () => void
}) {
  const [form, setForm] = useState<ShopInput>({
    name: shop?.name ?? '',
    order_prefix: shop?.order_prefix ?? '',
    phone: shop?.phone ?? '',
    address: shop?.address ?? '',
  })
  const [active, setActive] = useState(shop?.active ?? true)
  const [errors, setErrors] = useState<Partial<Record<keyof ShopInput, string>>>({})

  const save = useAction(
    () => (shop ? adminUpdateShop(shop.id, { ...form, active }) : adminCreateShop(form)),
    {
      success: shop ? 'Đã lưu cửa hàng' : 'Đã tạo cửa hàng',
      invalidate: [SHOPS_KEY],
      onSuccess: onClose,
    },
  )

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: typeof errors = {}
    if (!form.name.trim()) next.name = 'Nhập tên cửa hàng'
    if (!/^[A-Z0-9]{1,5}$/.test(form.order_prefix)) {
      next.order_prefix = 'Từ 1 đến 5 ký tự, chỉ gồm chữ in hoa không dấu và số'
    }
    setErrors(next)
    if (Object.keys(next).length === 0) save.mutate(undefined)
  }

  const set = (key: keyof ShopInput) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={shop ? 'Sửa cửa hàng' : 'Thêm cửa hàng'}
      footer={
        <Button type="submit" form="shop-form" block loading={save.isPending}>
          {shop ? 'Lưu' : 'Tạo cửa hàng'}
        </Button>
      }
    >
      <form id="shop-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="Tên cửa hàng"
          value={form.name}
          onChange={(e) => set('name')(e.target.value)}
          error={errors.name}
          maxLength={100}
        />
        <TextField
          label="Tiền tố mã đơn"
          value={form.order_prefix}
          onChange={(e) =>
            set('order_prefix')(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))
          }
          error={errors.order_prefix}
          hint={`Đứng đầu mã đơn, ví dụ ${form.order_prefix || 'AB'}261113-001. Không trùng giữa các cửa hàng.`}
          autoCapitalize="characters"
        />
        <TextField
          label="Số điện thoại (tuỳ chọn)"
          type="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => set('phone')(e.target.value.replace(/[^\d]/g, ''))}
        />
        <TextField
          label="Địa chỉ lấy hàng (tuỳ chọn)"
          value={form.address}
          onChange={(e) => set('address')(e.target.value)}
          maxLength={300}
        />
        {shop && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Trạng thái</span>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1">
              {[
                { value: true, label: 'Đang hoạt động' },
                { value: false, label: 'Khoá' },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setActive(option.value)}
                  className={cn(
                    'h-10 rounded-lg text-sm font-semibold',
                    active === option.value ? 'bg-surface shadow-sm' : 'text-muted',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {!active && (
              <p className="text-sm text-warning">
                Khi khoá, chủ cửa hàng và shipper của shop này không truy cập được dữ liệu của shop.
              </p>
            )}
          </div>
        )}
      </form>
    </Sheet>
  )
}

function ShopDetailSheet({
  shop,
  onClose,
  onEdit,
}: {
  shop: AdminShop | null
  onClose: () => void
  onEdit: () => void
}) {
  const navigate = useNavigate()
  const { enterAsAdmin } = useCurrentShop()
  const [newOwner, setNewOwner] = useState('')
  const [removing, setRemoving] = useState<{ id: string; full_name: string } | null>(null)

  const owners = useQuery({
    queryKey: ['admin', 'accounts', 'owner'],
    queryFn: () => adminListAccounts('owner'),
    enabled: Boolean(shop),
  })

  const setOwner = useAction(
    ({ userId, active }: { userId: string; active: boolean }) =>
      adminSetShopOwner(shop!.id, userId, active),
    {
      invalidate: [SHOPS_KEY, ['admin', 'accounts']],
      onSuccess: () => {
        setNewOwner('')
        setRemoving(null)
      },
    },
  )

  if (!shop) return null
  const candidates = (owners.data ?? []).filter(
    (account) => account.active && !shop.owners.some((owner) => owner.id === account.id),
  )

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={shop.name}
        footer={
          <Button
            block
            disabled={!shop.active}
            onClick={() => {
              enterAsAdmin(shop.id)
              navigate('/shop')
            }}
          >
            Vào cửa hàng
          </Button>
        }
      >
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Badge tone="primary">{shop.order_prefix}</Badge>
              {!shop.active && <Badge tone="danger">Đang khoá</Badge>}
              <span className="flex-1" />
              <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={onEdit}>
                Sửa
              </Button>
            </div>
            {shop.phone && <p className="text-sm">📞 {formatVnPhone(shop.phone)}</p>}
            {shop.address && <p className="text-sm text-muted">{shop.address}</p>}
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Truck className="size-4" /> {shop.shipper_count} shipper
            </p>
          </Card>

          <section>
            <SectionTitle>Chủ cửa hàng</SectionTitle>
            {shop.owners.length === 0 ? (
              <p className="px-1 pb-2 text-sm text-warning">Chưa có chủ cửa hàng.</p>
            ) : (
              <ul className="mb-3 flex flex-col gap-2">
                {shop.owners.map((owner) => (
                  <li key={owner.id}>
                    <Card className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{owner.full_name}</p>
                        <p className="text-sm text-muted">{formatVnPhone(owner.phone)}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="danger-soft"
                        icon={<UserMinus className="size-4" />}
                        onClick={() => setRemoving(owner)}
                      >
                        Bỏ
                      </Button>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <SelectField
                  label="Thêm chủ cửa hàng"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  hint={
                    owners.data && candidates.length === 0
                      ? 'Không còn tài khoản chủ cửa hàng nào để thêm. Tạo ở mục Tài khoản.'
                      : undefined
                  }
                >
                  <option value="">Chọn tài khoản…</option>
                  {candidates.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.full_name} · {formatVnPhone(account.phone)}
                    </option>
                  ))}
                </SelectField>
              </div>
            </div>
            <Button
              className="mt-2"
              block
              variant="secondary"
              icon={<UserPlus className="size-5" />}
              disabled={!newOwner}
              loading={setOwner.isPending && !removing}
              onClick={() => setOwner.mutate({ userId: newOwner, active: true })}
            >
              Thêm làm chủ cửa hàng
            </Button>
          </section>
        </div>
      </Sheet>

      <ConfirmSheet
        open={Boolean(removing)}
        title="Bỏ chủ cửa hàng?"
        confirmLabel="Bỏ khỏi cửa hàng"
        danger
        loading={setOwner.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && setOwner.mutate({ userId: removing.id, active: false })}
      >
        {removing?.full_name} sẽ không còn quản lý <strong>{shop.name}</strong>. Tài khoản vẫn được
        giữ lại.
      </ConfirmSheet>
    </>
  )
}

export function AdminShopsPage() {
  const shops = useQuery({ queryKey: SHOPS_KEY, queryFn: adminListShops })
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const selected = shops.data?.find((s) => s.id === selectedId) ?? null

  return (
    <>
      <PageHeader
        title="Cửa hàng"
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Thêm
          </Button>
        }
      />
      <PageBody>
        {shops.isLoading ? (
          <LoadingBlock />
        ) : shops.error ? (
          <ErrorBlock message="Không tải được danh sách cửa hàng" onRetry={() => shops.refetch()} />
        ) : shops.data?.length === 0 ? (
          <EmptyState
            icon={<Store className="size-7" />}
            title="Chưa có cửa hàng nào"
            action={<Button onClick={() => setCreating(true)}>Thêm cửa hàng</Button>}
          >
            Tạo cửa hàng, rồi gán chủ cửa hàng cho nó.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {shops.data?.map((shop) => (
              <li key={shop.id}>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setSelectedId(shop.id)}
                >
                  <Card className={cn('flex items-center gap-3 active:bg-surface-2', !shop.active && 'opacity-70')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{shop.name}</p>
                        <Badge tone="primary">{shop.order_prefix}</Badge>
                        {!shop.active && <Badge tone="danger">Khoá</Badge>}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted">
                        {shop.owners.length > 0
                          ? `Chủ: ${shop.owners.map((o) => o.full_name).join(', ')}`
                          : 'Chưa có chủ cửa hàng'}
                      </p>
                      <p className="text-sm text-muted">{shop.shipper_count} shipper</p>
                    </div>
                    <ChevronRight className="size-5 text-muted" />
                  </Card>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PageBody>

      {creating && <ShopFormSheet open onClose={() => setCreating(false)} />}
      {selected && !editing && (
        <ShopDetailSheet
          shop={selected}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditing(true)}
        />
      )}
      {selected && editing && (
        <ShopFormSheet open shop={selected} onClose={() => setEditing(false)} />
      )}
    </>
  )
}
