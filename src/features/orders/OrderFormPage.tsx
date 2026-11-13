import { useQuery } from '@tanstack/react-query'
import { ClipboardPaste, Plus, Trash2, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody, StickyBar } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { MoneyInput, QtyStepper } from '@/components/ui/MoneyInput'
import { Badge, Card, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { AddressFields } from '@/features/customers/AddressFields'
import { addressProblems, draftFromAddress, EMPTY_ADDRESS, type AddressDraft } from '@/features/customers/address-draft'
import { fetchCustomer, findCustomerByPhone, type Customer } from '@/features/customers/api'
import type { PastedMessage } from '@/features/customers/catalog'
import { SmartPasteSheet } from '@/features/customers/SmartPasteSheet'
import { returnWarning } from '@/features/customers/stats'
import { fetchShopSettings } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatMoney, formatNumber } from '@/lib/format'
import type { ShopSettings } from '@/lib/types'
import { useAction } from '@/lib/useAction'
import { normalizeVnMobile } from '@/lib/vn/phone'
import { fetchOrder, fetchVariantStock, saveOrder, type OrderDetail } from './api'
import { CustomerPickerSheet } from './CustomerPickerSheet'
import { isEditable, METHOD_LABEL, type DeliveryMethod } from './status'
import { computeTotals } from './totals'
import { VariantPickerSheet, type PickedVariant } from './VariantPickerSheet'

interface Line {
  variantId: string
  productName: string
  variantLabel: string
  sku: string
  price: number
  qty: number
  weight_g: number
  /** Current stock; null when unknown. */
  stock: number | null
}

interface Initial {
  customer: Customer | null
  name: string
  phone: string
  address: AddressDraft
  method: DeliveryMethod
  lines: Line[]
  shippingFee: number
  discount: number
  paid: number
  deliveryNote: string
  internalNote: string
  vtp: { service: string; feePayer: 'sender' | 'receiver'; requirement: 'no_view' | 'view' | 'try' }
}

function emptyInitial(settings: ShopSettings): Initial {
  return {
    customer: null,
    name: '',
    phone: '',
    address: EMPTY_ADDRESS,
    method: 'self',
    lines: [],
    shippingFee: 0,
    discount: 0,
    paid: 0,
    deliveryNote: '',
    internalNote: '',
    vtp: {
      service: settings.vtp_service,
      feePayer: settings.vtp_fee_payer,
      requirement: settings.vtp_delivery_requirement,
    },
  }
}

async function initialFromOrder(order: OrderDetail, settings: ShopSettings, customer: Customer | null): Promise<Initial> {
  const stock = await fetchVariantStock(order.items.map((i) => i.variant_id))
  const byId = new Map(stock.map((s) => [s.id, s]))
  return {
    customer,
    name: order.ship_name ?? '',
    phone: order.ship_phone ?? '',
    address: {
      detail: order.ship_detail ?? '',
      provinceCode: order.ship_province_code ?? '',
      wardCode: order.ship_ward_code ?? '',
      wardText: order.ship_ward_text ?? '',
      lat: order.ship_lat,
      lng: order.ship_lng,
      geoSource: order.ship_lat === null ? null : 'manual',
    },
    method: order.delivery_method,
    lines: order.items.map((i) => ({
      variantId: i.variant_id,
      productName: i.product_name,
      variantLabel: i.variant_label,
      sku: i.sku,
      price: i.unit_price,
      qty: i.qty,
      weight_g: byId.get(i.variant_id)?.weight_g ?? i.weight_g,
      stock: byId.get(i.variant_id)?.stock_qty ?? null,
    })),
    shippingFee: order.shipping_fee,
    discount: order.discount,
    paid: order.paid_amount,
    deliveryNote: order.delivery_note ?? '',
    internalNote: order.internal_note ?? '',
    vtp: {
      service: order.vtp_service ?? settings.vtp_service,
      feePayer: order.vtp_fee_payer ?? settings.vtp_fee_payer,
      requirement: order.vtp_delivery_requirement ?? settings.vtp_delivery_requirement,
    },
  }
}

function OrderForm({
  settings,
  initial,
  editId,
}: {
  settings: ShopSettings
  initial: Initial
  editId?: string
}) {
  const shop = useShop()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState<Customer | null>(initial.customer)
  const [name, setName] = useState(initial.name)
  const [phone, setPhone] = useState(initial.phone)
  const [address, setAddress] = useState(initial.address)
  const [saveAddress, setSaveAddress] = useState(true)
  const [method, setMethod] = useState(initial.method)
  const [lines, setLines] = useState(initial.lines)
  const [shippingFee, setShippingFee] = useState(initial.shippingFee)
  const [discount, setDiscount] = useState(initial.discount)
  const [paid, setPaid] = useState(initial.paid)
  const [weightOverride, setWeightOverride] = useState<number | null>(null)
  const [deliveryNote, setDeliveryNote] = useState(initial.deliveryNote)
  const [internalNote, setInternalNote] = useState(initial.internalNote)
  const [vtp, setVtp] = useState(initial.vtp)
  const [sheet, setSheet] = useState<'customer' | 'paste' | 'product' | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  const normalizedPhone = normalizeVnMobile(phone)
  const sameCustomerPhone = customer?.phone === normalizedPhone
  const lookup = useQuery({
    queryKey: ['shop', shop.id, 'customer-by-phone', normalizedPhone],
    queryFn: () => findCustomerByPhone(shop.id, normalizedPhone!),
    enabled: Boolean(normalizedPhone) && !sameCustomerPhone,
  })
  const suggested = !customer && lookup.data ? lookup.data : null

  const totals = computeTotals({
    lines: lines.map((l) => ({ qty: l.qty, price: l.price, weight_g: l.weight_g })),
    shippingFee,
    discount,
    paid,
    packagingWeight: settings.packaging_weight_g,
    weightOverride: weightOverride ?? undefined,
  })
  const needsAddress = method !== 'pickup'
  const warning = customer ? returnWarning(customer) : null

  function pickCustomer(c: Customer, addressId?: string) {
    const chosen = c.addresses.find((a) => a.id === addressId) ?? c.addresses.find((a) => a.is_default) ?? c.addresses[0]
    setCustomer(c)
    setName(c.name)
    setPhone(c.phone)
    if (chosen) setAddress(draftFromAddress(chosen))
    setSheet(null)
  }

  function applyPasted(result: PastedMessage) {
    if (result.name) setName(result.name)
    if (result.phone) setPhone(result.phone)
    setAddress(result.address)
    setCustomer(null)
    setSheet(null)
  }

  function addLine({ product, variant, qty }: PickedVariant) {
    setLines((all) => {
      const existing = all.find((l) => l.variantId === variant.id)
      if (existing) return all.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l))
      return [
        ...all,
        {
          variantId: variant.id,
          productName: product.name,
          variantLabel: variant.variant_label,
          sku: variant.sku,
          price: variant.price,
          qty,
          weight_g: variant.weight_g,
          stock: variant.stock_qty,
        },
      ]
    })
    setSheet(null)
  }

  const save = useAction(
    (confirm: boolean) =>
      saveOrder(shop.id, {
        id: editId,
        customer_id: customer?.id ?? null,
        delivery_method: method,
        confirm,
        save_address: saveAddress && needsAddress,
        ship: {
          name: name.trim(),
          phone: phone.trim(),
          detail: needsAddress ? address.detail.trim() : '',
          province_code: needsAddress ? address.provinceCode || null : null,
          ward_code: needsAddress ? address.wardCode || null : null,
          ward_text: needsAddress && !address.wardCode ? address.wardText.trim() : '',
          lat: needsAddress ? address.lat : null,
          lng: needsAddress ? address.lng : null,
          geo_source: needsAddress && address.lat !== null ? address.geoSource : null,
        },
        items: lines.map((l) => ({ variant_id: l.variantId, qty: l.qty, unit_price: l.price })),
        shipping_fee: shippingFee,
        discount,
        paid_amount: paid,
        weight_g: weightOverride ?? undefined,
        delivery_note: deliveryNote.trim(),
        internal_note: internalNote.trim(),
        vtp_service: vtp.service,
        vtp_fee_payer: vtp.feePayer,
        vtp_delivery_requirement: vtp.requirement,
      }),
    {
      success: undefined,
      invalidate: [['shop', shop.id, 'orders'], ['shop', shop.id, 'products'], ['customer'], ['shop', shop.id, 'customers']],
      onSuccess: (id) => {
        toast.success(editId ? 'Đã lưu đơn hàng' : 'Đã tạo đơn hàng')
        navigate(`/shop/orders/${id}`, { replace: true })
      },
    },
  )

  function submit(confirm: boolean) {
    const found: string[] = []
    if (lines.length === 0) found.push('Thêm ít nhất một sản phẩm')
    if (normalizedPhone === null && phone.trim()) found.push('Số điện thoại người nhận không hợp lệ')
    if (needsAddress) {
      if (!name.trim()) found.push('Nhập tên người nhận')
      if (!normalizedPhone) found.push('Nhập số điện thoại người nhận')
      found.push(...addressProblems(address))
    }
    found.push(...totals.errors)
    setProblems(found)
    if (found.length > 0) {
      toast.error(found[0])
      return
    }
    save.mutate(confirm)
  }

  return (
    <>
      <PageBody className="flex flex-col gap-5 pb-40">
        <section>
          <SectionTitle>Người nhận</SectionTitle>
          <Card className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" icon={<UserRound className="size-4" />} onClick={() => setSheet('customer')}>
                Chọn khách cũ
              </Button>
              <Button variant="secondary" size="sm" icon={<ClipboardPaste className="size-4" />} onClick={() => setSheet('paste')}>
                Dán tin nhắn
              </Button>
            </div>

            {customer && (
              <div className="flex items-center gap-2 rounded-xl bg-primary-soft px-3.5 py-2.5">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
                  Khách cũ: {customer.name} · {customer.order_count} đơn
                </p>
                <button type="button" aria-label="Bỏ chọn khách" onClick={() => setCustomer(null)} className="text-primary">
                  <X className="size-5" />
                </button>
              </div>
            )}
            {warning && (
              <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                ⚠ {warning}. Cân nhắc đặt cọc trước khi giao.
              </p>
            )}
            {customer && customer.addresses.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {customer.addresses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => pickCustomer(customer, a.id)}
                    className="h-9 max-w-full truncate rounded-full border border-border bg-surface px-3.5 text-sm"
                  >
                    {a.label || a.detail}
                  </button>
                ))}
              </div>
            )}

            <TextField label="Tên người nhận" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            <TextField
              label="Số điện thoại"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
            />
            {suggested && (
              <div className="-mt-2 flex items-center gap-2 rounded-xl bg-warning-soft px-3.5 py-2.5 text-sm text-warning">
                <p className="min-w-0 flex-1">Số này đã là khách: {suggested.name}</p>
                <button type="button" className="font-semibold underline" onClick={() => pickCustomer(suggested)}>
                  Dùng khách này
                </button>
              </div>
            )}

            {needsAddress && (
              <>
                <AddressFields value={address} onChange={setAddress} />
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--primary)]"
                    checked={saveAddress}
                    onChange={(e) => setSaveAddress(e.target.checked)}
                  />
                  Lưu địa chỉ này vào hồ sơ khách
                </label>
              </>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle
            action={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setSheet('product')}>
                Thêm
              </Button>
            }
          >
            Sản phẩm
          </SectionTitle>
          {lines.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-muted">Chưa có sản phẩm nào trong đơn.</p>
              <Button onClick={() => setSheet('product')}>Thêm sản phẩm</Button>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((line) => {
                const short = !settings.allow_negative_stock && line.stock !== null && line.qty > line.stock
                return (
                  <li key={line.variantId}>
                    <Card className="flex flex-col gap-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {line.productName}
                            {line.variantLabel && <span className="font-normal text-muted"> · {line.variantLabel}</span>}
                          </p>
                          <p className="text-xs text-muted">{line.sku}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Bỏ ${line.productName} ${line.variantLabel}`}
                          icon={<Trash2 className="size-5" />}
                          onClick={() => setLines((all) => all.filter((l) => l !== line))}
                        />
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <QtyStepper
                          label={`Số lượng ${line.productName} ${line.variantLabel}`}
                          value={line.qty}
                          min={1}
                          onChange={(qty) => setLines((all) => all.map((l) => (l === line ? { ...l, qty } : l)))}
                        />
                        <div className="w-36">
                          <MoneyInput
                            aria-label={`Đơn giá ${line.productName} ${line.variantLabel}`}
                            value={line.price}
                            onChange={(price) => setLines((all) => all.map((l) => (l === line ? { ...l, price } : l)))}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        {short ? (
                          <span className="text-danger">Chỉ còn {formatNumber(line.stock ?? 0)} trong kho</span>
                        ) : (
                          <span className="text-muted">{line.stock !== null && `Tồn ${formatNumber(line.stock)}`}</span>
                        )}
                        <span className="font-semibold tabular-nums">{formatMoney(line.qty * line.price)}</span>
                      </div>
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Giao hàng và thanh toán</SectionTitle>
          <Card className="flex flex-col gap-4">
            <div role="radiogroup" aria-label="Phương thức giao hàng" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
              {(Object.keys(METHOD_LABEL) as DeliveryMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    'min-h-11 rounded-lg px-1 text-sm font-semibold',
                    method === m ? 'bg-surface text-primary shadow-sm' : 'text-muted',
                  )}
                >
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MoneyInput label="Phí ship thu khách" value={shippingFee} onChange={setShippingFee} />
              <MoneyInput label="Giảm giá" value={discount} onChange={setDiscount} />
            </div>
            <MoneyInput label="Đã thanh toán / đặt cọc" value={paid} onChange={setPaid} />
            {totals.total > 0 && paid < totals.total && (
              <Button variant="ghost" size="sm" onClick={() => setPaid(totals.total)}>
                Khách đã chuyển khoản đủ
              </Button>
            )}
            <MoneyInput
              label="Khối lượng gói hàng"
              suffix="g"
              blankZero={false}
              value={totals.weight}
              onChange={(v) => setWeightOverride(v > 0 ? v : null)}
              hint={`Tự tính từ sản phẩm + ${settings.packaging_weight_g} g bao bì. Sửa nếu cân thực tế khác.`}
            />
            {method === 'vtp' && (
              <div className="flex flex-col gap-4 border-t border-border pt-4">
                <TextField
                  label="Mã dịch vụ ViettelPost"
                  value={vtp.service}
                  onChange={(e) => setVtp((v) => ({ ...v, service: e.target.value }))}
                  maxLength={20}
                />
                <SelectField
                  label="Người trả cước"
                  value={vtp.feePayer}
                  onChange={(e) => setVtp((v) => ({ ...v, feePayer: e.target.value as 'sender' | 'receiver' }))}
                >
                  <option value="sender">Người gửi (shop)</option>
                  <option value="receiver">Người nhận</option>
                </SelectField>
                <SelectField
                  label="Yêu cầu khi giao"
                  value={vtp.requirement}
                  onChange={(e) => setVtp((v) => ({ ...v, requirement: e.target.value as 'no_view' | 'view' | 'try' }))}
                >
                  <option value="no_view">Không cho xem hàng</option>
                  <option value="view">Cho xem hàng, không cho thử</option>
                  <option value="try">Cho thử hàng</option>
                </SelectField>
              </div>
            )}
            <TextField label="Ghi chú giao hàng (tuỳ chọn)" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} maxLength={500} />
            <TextField label="Ghi chú nội bộ (tuỳ chọn)" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} maxLength={1000} />
          </Card>
        </section>

        {problems.length > 0 && (
          <ul role="alert" className="list-disc rounded-xl bg-danger-soft py-3 pr-3.5 pl-8 text-sm text-danger">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </PageBody>

      <StickyBar>
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span>
            Tổng <strong className="text-base tabular-nums">{formatMoney(totals.total)}</strong>
          </span>
          <span className="text-muted">
            Thu hộ <strong className="tabular-nums text-foreground">{formatMoney(totals.cod)}</strong>
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" block loading={save.isPending && save.variables === false} onClick={() => submit(false)}>
            Lưu nháp
          </Button>
          <Button block loading={save.isPending && save.variables === true} onClick={() => submit(true)}>
            Xác nhận đơn
          </Button>
        </div>
      </StickyBar>

      {sheet === 'customer' && <CustomerPickerSheet onPick={(c) => pickCustomer(c)} onClose={() => setSheet(null)} />}
      {sheet === 'paste' && <SmartPasteSheet onApply={applyPasted} onClose={() => setSheet(null)} />}
      {sheet === 'product' && <VariantPickerSheet onPick={addLine} onClose={() => setSheet(null)} />}
    </>
  )
}

export function OrderFormPage() {
  const shop = useShop()
  const { orderId } = useParams()
  const [params] = useSearchParams()
  const cloneId = params.get('clone')
  const customerId = params.get('customer')

  const settings = useQuery({ queryKey: ['shop', shop.id, 'settings'], queryFn: () => fetchShopSettings(shop.id) })
  const source = useQuery({
    queryKey: ['shop', shop.id, 'order-form', orderId ?? cloneId ?? customerId ?? 'new'],
    enabled: Boolean(settings.data),
    queryFn: async (): Promise<{ initial: Initial; editable: boolean; code?: string }> => {
      const s = settings.data!
      if (orderId || cloneId) {
        const order = await fetchOrder((orderId ?? cloneId)!)
        if (!order) throw new Error('Không tìm thấy đơn hàng')
        const customer = order.customer_id ? await fetchCustomer(order.customer_id) : null
        return {
          initial: await initialFromOrder(order, s, customer),
          editable: orderId ? isEditable(order.status) : true,
          code: order.code,
        }
      }
      const initial = emptyInitial(s)
      if (customerId) {
        const customer = await fetchCustomer(customerId)
        if (customer) {
          const address = customer.addresses.find((a) => a.is_default) ?? customer.addresses[0]
          return {
            initial: { ...initial, customer, name: customer.name, phone: customer.phone, address: draftFromAddress(address) },
            editable: true,
          }
        }
      }
      return { initial, editable: true }
    },
    // The form copies this once; refetching must not reset what the user typed.
    staleTime: Infinity,
    gcTime: 0,
  })

  const title = orderId ? 'Sửa đơn hàng' : cloneId ? 'Nhân bản đơn' : 'Tạo đơn'

  return (
    <>
      <PageHeader title={title} subtitle={source.data?.code} back={orderId ? `/shop/orders/${orderId}` : '/shop/orders'} />
      {settings.isLoading || source.isLoading ? (
        <LoadingBlock />
      ) : settings.error || source.error || !settings.data || !source.data ? (
        <ErrorBlock message="Không tải được dữ liệu đơn hàng" onRetry={() => source.refetch()} />
      ) : !source.data.editable ? (
        <PageBody>
          <Card className="flex flex-col gap-3">
            <Badge tone="warning">Không sửa được</Badge>
            <p>Chỉ sửa được đơn ở trạng thái Mới. Hãy mở đơn và bấm “Mở lại để sửa”.</p>
            <Link to={`/shop/orders/${orderId}`} className="font-semibold text-primary">
              Về chi tiết đơn
            </Link>
          </Card>
        </PageBody>
      ) : (
        <OrderForm key={orderId ?? cloneId ?? customerId ?? 'new'} settings={settings.data} initial={source.data.initial} editId={orderId} />
      )}
    </>
  )
}
