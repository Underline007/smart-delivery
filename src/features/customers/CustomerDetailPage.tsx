import { useQuery } from '@tanstack/react-query'
import { MapPin, MessageCircle, Pencil, Phone, Plus, ReceiptText, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { TextField } from '@/components/ui/Field'
import { Badge, Card, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import { formatMoney } from '@/lib/format'
import { navigationUrl, searchUrl } from '@/lib/maps/link'
import { useAction } from '@/lib/useAction'
import { formatVnPhone, zaloLink } from '@/lib/vn/phone'
import { addressInput, addressProblems, draftFromAddress, type AddressDraft } from './address-draft'
import { AddressFields } from './AddressFields'
import {
  deleteCustomerAddress,
  fetchCustomer,
  saveCustomerAddress,
  type Customer,
  type CustomerAddress,
} from './api'
import { CustomerFormSheet } from './CustomerFormSheet'
import { returnRate, returnWarning } from './stats'

function AddressSheet({
  shopId,
  customerId,
  address,
  onClose,
}: {
  shopId: string
  customerId: string
  address?: CustomerAddress
  onClose: () => void
}) {
  const [draft, setDraft] = useState<AddressDraft>(draftFromAddress(address))
  const [label, setLabel] = useState(address?.label ?? '')
  const [isDefault, setIsDefault] = useState(address?.is_default ?? false)
  const [error, setError] = useState<string | null>(null)

  const save = useAction(
    () => saveCustomerAddress(shopId, customerId, addressInput(draft, { id: address?.id, label, is_default: isDefault })),
    { success: 'Đã lưu địa chỉ', invalidate: [['customer', customerId], ['shop', shopId, 'customers']], onSuccess: onClose },
  )

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const problems = addressProblems(draft)
    setError(problems[0] ?? null)
    if (problems.length === 0) save.mutate(undefined)
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={address ? 'Sửa địa chỉ' : 'Thêm địa chỉ'}
      footer={
        <Button type="submit" form="address-form" block loading={save.isPending}>
          Lưu địa chỉ
        </Button>
      }
    >
      <form id="address-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <TextField label="Tên gọi (tuỳ chọn)" placeholder="Nhà, Công ty…" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={50} />
        <AddressFields value={draft} onChange={setDraft} />
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Địa chỉ mặc định
        </label>
        {error && <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger">{error}</p>}
      </form>
    </Sheet>
  )
}

function Stats({ customer }: { customer: Customer }) {
  const rate = returnRate(customer)
  const warning = returnWarning(customer)
  return (
    <Card className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-2xl font-bold tabular-nums">{customer.order_count}</p>
          <p className="text-xs text-muted">Đơn</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{formatMoney(customer.total_spent)}</p>
          <p className="text-xs text-muted">Đã mua</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{rate === null ? '–' : `${Math.round(rate * 100)}%`}</p>
          <p className="text-xs text-muted">Tỉ lệ hoàn</p>
        </div>
      </div>
      {warning && <p className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">{warning}. Cân nhắc đặt cọc.</p>}
    </Card>
  )
}

export function CustomerDetailPage() {
  const { customerId } = useParams()
  const shop = useShop()
  const customer = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomer(customerId!),
  })
  const [editing, setEditing] = useState(false)
  const [addressSheet, setAddressSheet] = useState<{ address?: CustomerAddress } | null>(null)
  const [deleting, setDeleting] = useState<CustomerAddress | null>(null)

  const remove = useAction((id: string) => deleteCustomerAddress(shop.id, id), {
    success: 'Đã xoá địa chỉ',
    invalidate: [['customer', customerId], ['shop', shop.id, 'customers']],
    onSuccess: () => setDeleting(null),
  })

  const data = customer.data

  return (
    <>
      <PageHeader title={data?.name ?? 'Khách hàng'} subtitle={data && formatVnPhone(data.phone)} back="/shop/customers" />
      <PageBody className="flex flex-col gap-5">
        {customer.isLoading ? (
          <LoadingBlock />
        ) : customer.error || !data ? (
          <ErrorBlock message="Không tìm thấy khách hàng" onRetry={() => customer.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              {[
                { href: `tel:${data.phone}`, icon: <Phone className="size-5" />, label: 'Gọi' },
                { href: zaloLink(data.phone), icon: <MessageCircle className="size-5" />, label: 'Zalo', external: true },
              ].map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target={item.external ? '_blank' : undefined}
                  rel={item.external ? 'noreferrer' : undefined}
                  className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface text-xs font-medium active:bg-surface-2"
                >
                  {item.icon}
                  {item.label}
                </a>
              ))}
              <Link
                to={`/shop/orders/new?customer=${data.id}`}
                className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl bg-primary text-xs font-medium text-primary-foreground active:opacity-90"
              >
                <ReceiptText className="size-5" />
                Tạo đơn
              </Link>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface text-xs font-medium active:bg-surface-2"
              >
                <Pencil className="size-5" />
                Sửa
              </button>
            </div>

            <Stats customer={data} />

            {(data.tags.length > 0 || data.note || data.phone2) && (
              <Card className="flex flex-col gap-2">
                {data.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {data.tags.map((tag) => (
                      <Badge key={tag} tone="primary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                {data.phone2 && <p className="text-sm">SĐT phụ: {formatVnPhone(data.phone2)}</p>}
                {data.note && <p className="text-sm text-muted">{data.note}</p>}
              </Card>
            )}

            <section>
              <SectionTitle
                action={
                  <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAddressSheet({})}>
                    Thêm
                  </Button>
                }
              >
                Địa chỉ
              </SectionTitle>
              {data.addresses.length === 0 ? (
                <p className="px-1 text-sm text-muted">Chưa có địa chỉ giao hàng.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {[...data.addresses]
                    .sort((a, b) => Number(b.is_default) - Number(a.is_default))
                    .map((address) => (
                      <li key={address.id}>
                        <Card className="flex flex-col gap-2">
                          <div className="flex items-start gap-2">
                            <MapPin className="mt-0.5 size-5 shrink-0 text-muted" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                {address.label && <p className="font-semibold">{address.label}</p>}
                                {address.is_default && <Badge tone="success">Mặc định</Badge>}
                                {address.lat === null && <Badge tone="warning">Chưa có vị trí</Badge>}
                              </div>
                              <p className="text-sm">{address.full_text}</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <a
                              href={address.lat !== null && address.lng !== null ? navigationUrl({ lat: address.lat, lng: address.lng }) : searchUrl(address.full_text)}
                              target="_blank"
                              rel="noreferrer"
                              className="flex h-9 flex-1 items-center justify-center rounded-lg border border-border text-sm font-medium active:bg-surface-2"
                            >
                              Mở bản đồ
                            </a>
                            <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setAddressSheet({ address })}>
                              Sửa
                            </Button>
                            <Button size="sm" variant="danger-soft" aria-label="Xoá địa chỉ" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(address)} />
                          </div>
                        </Card>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          </>
        )}
      </PageBody>

      {editing && data && (
        <CustomerFormSheet shopId={shop.id} customer={data} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      )}
      {addressSheet && data && (
        <AddressSheet shopId={shop.id} customerId={data.id} address={addressSheet.address} onClose={() => setAddressSheet(null)} />
      )}
      <ConfirmSheet
        open={Boolean(deleting)}
        title="Xoá địa chỉ?"
        confirmLabel="Xoá"
        danger
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        {deleting?.full_text}
        <br />
        Các đơn cũ vẫn giữ nguyên địa chỉ đã giao.
      </ConfirmSheet>
    </>
  )
}
