import { useQuery } from '@tanstack/react-query'
import { Copy, CopyPlus, FileSpreadsheet, MapPin, MessageCircle, Pencil, Phone, Route as RouteIcon, Share2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge, Card, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import { fetchShopSettings } from '@/lib/api'
import { formatDateTime, formatMoney, formatWeight } from '@/lib/format'
import { navigationUrl, searchUrl } from '@/lib/maps/link'
import { useAction } from '@/lib/useAction'
import { formatVnPhone, zaloLink } from '@/lib/vn/phone'
import { fetchOrder, setOrderStatus } from './api'
import { renderMessage } from './message'
import { isEditable, METHOD_LABEL, nextActions, STATUS_LABEL, STATUS_TONE, type OrderStatus, type StatusAction } from './status'

function ActionSheet({
  action,
  busy,
  onConfirm,
  onClose,
}: {
  action: StatusAction
  busy: boolean
  onConfirm: (note: string) => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  return (
    <Sheet
      open
      onClose={onClose}
      title={action.label}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" block onClick={onClose}>
            Quay lại
          </Button>
          <Button variant={action.tone === 'danger' ? 'danger' : 'primary'} block loading={busy} onClick={() => onConfirm(note)}>
            Đồng ý
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {action.confirm && <p>{action.confirm}</p>}
        {action.askNote && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="status-note" className="text-sm font-medium">
              Lý do / ghi chú (tuỳ chọn)
            </label>
            <textarea
              id="status-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface p-3.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>
        )}
        {!action.confirm && !action.askNote && <p>Chuyển đơn sang “{STATUS_LABEL[action.to]}”?</p>}
      </div>
    </Sheet>
  )
}

export function OrderDetailPage() {
  const { orderId } = useParams()
  const shop = useShop()
  const order = useQuery({ queryKey: ['shop', shop.id, 'orders', 'detail', orderId], queryFn: () => fetchOrder(orderId!) })
  const settings = useQuery({ queryKey: ['shop', shop.id, 'settings'], queryFn: () => fetchShopSettings(shop.id) })
  const [action, setAction] = useState<StatusAction | null>(null)

  const change = useAction(({ to, note }: { to: OrderStatus; note: string }) => setOrderStatus(shop.id, orderId!, to, note), {
    success: 'Đã cập nhật đơn hàng',
    invalidate: [['shop', shop.id, 'orders'], ['shop', shop.id, 'products'], ['customer'], ['shop', shop.id, 'customers']],
    onSuccess: () => setAction(null),
  })

  const data = order.data
  const message = data && settings.data ? renderMessage(settings.data.message_template, data) : ''

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message)
      toast.success('Đã sao chép tin nhắn')
    } catch {
      toast.error('Không sao chép được')
    }
  }

  return (
    <>
      <PageHeader
        title={data?.code ?? 'Đơn hàng'}
        subtitle={data && <Badge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Badge>}
        back="/shop/orders"
      />
      <PageBody className="flex flex-col gap-5">
        {order.isLoading ? (
          <LoadingBlock />
        ) : order.error || !data ? (
          <ErrorBlock message="Không tìm thấy đơn hàng" onRetry={() => order.refetch()} />
        ) : (
          <>
            <Card className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{data.ship_name ?? 'Khách lấy tại shop'}</p>
                  {data.ship_phone && <p className="text-sm text-muted">{formatVnPhone(data.ship_phone)}</p>}
                </div>
                <Badge tone="primary">{METHOD_LABEL[data.delivery_method]}</Badge>
              </div>
              {data.ship_phone && (
                <div className="grid grid-cols-2 gap-2">
                  <a href={`tel:${data.ship_phone}`} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border text-sm font-medium active:bg-surface-2">
                    <Phone className="size-4" /> Gọi
                  </a>
                  <a href={zaloLink(data.ship_phone)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border text-sm font-medium active:bg-surface-2">
                    <MessageCircle className="size-4" /> Zalo
                  </a>
                </div>
              )}
              {data.ship_full_text && (
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-5 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{data.ship_full_text}</p>
                    {data.ship_lat === null && <Badge tone="warning">Chưa có vị trí bản đồ</Badge>}
                  </div>
                  <a
                    href={data.ship_lat !== null && data.ship_lng !== null ? navigationUrl({ lat: data.ship_lat, lng: data.ship_lng }) : searchUrl(data.ship_full_text)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium active:bg-surface-2"
                  >
                    Bản đồ
                  </a>
                </div>
              )}
              {data.customer_id && (
                <Link to={`/shop/customers/${data.customer_id}`} className="text-sm font-medium text-primary">
                  Xem hồ sơ khách →
                </Link>
              )}
              {data.vtp_tracking_code && <p className="text-sm">Mã vận đơn: <strong>{data.vtp_tracking_code}</strong></p>}
              {data.delivery_note && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">Giao hàng: {data.delivery_note}</p>}
              {data.internal_note && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">Nội bộ: {data.internal_note}</p>}
            </Card>

            <section>
              <SectionTitle>Sản phẩm</SectionTitle>
              <Card className="flex flex-col gap-3">
                {data.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {item.product_name}
                        {item.variant_label && <span className="font-normal text-muted"> · {item.variant_label}</span>}
                      </p>
                      <p className="text-sm text-muted">
                        {item.qty} × {formatMoney(item.unit_price)}
                      </p>
                    </div>
                    <p className="font-semibold tabular-nums">{formatMoney(item.qty * item.unit_price)}</p>
                  </div>
                ))}
                <dl className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
                  {[
                    ['Tiền hàng', formatMoney(data.subtotal)],
                    ['Phí ship', formatMoney(data.shipping_fee)],
                    ['Giảm giá', `−${formatMoney(data.discount)}`],
                    ['Đã thanh toán', formatMoney(data.paid_amount)],
                    ['Khối lượng', formatWeight(data.weight_g)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-muted">{label}</dt>
                      <dd className="tabular-nums">{value}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between text-base font-bold">
                    <dt>Tổng đơn</dt>
                    <dd className="tabular-nums">{formatMoney(data.total)}</dd>
                  </div>
                  <div className="flex justify-between text-base font-bold text-primary">
                    <dt>Thu hộ (COD)</dt>
                    <dd className="tabular-nums">{formatMoney(data.cod_amount)}</dd>
                  </div>
                </dl>
              </Card>
            </section>

            <section className="flex flex-col gap-2">
              <SectionTitle>Xử lý đơn</SectionTitle>
              {data.status === 'confirmed' && data.delivery_method === 'vtp' && (
                <Link to={`/shop/vtp/export?orders=${data.id}`} className="contents">
                  <Button icon={<FileSpreadsheet className="size-5" />}>Xuất Excel ViettelPost</Button>
                </Link>
              )}
              {data.status === 'confirmed' && data.delivery_method === 'self' && (
                <Link to={`/shop/delivery/new?orders=${data.id}`} className="contents">
                  <Button icon={<RouteIcon className="size-5" />}>Lập chuyến giao</Button>
                </Link>
              )}
              {isEditable(data.status) && (
                <Link to={`/shop/orders/${data.id}/edit`} className="contents">
                  <Button variant="secondary" icon={<Pencil className="size-5" />}>
                    Sửa đơn
                  </Button>
                </Link>
              )}
              {nextActions(data.status, data.delivery_method).map((a) => (
                <Button
                  key={a.to}
                  variant={a.tone === 'primary' ? (data.status === 'confirmed' && data.delivery_method !== 'pickup' ? 'secondary' : 'primary') : a.tone === 'danger' ? 'danger-soft' : 'secondary'}
                  onClick={() => (a.confirm || a.askNote ? setAction(a) : change.mutate({ to: a.to, note: '' }))}
                  loading={change.isPending && change.variables?.to === a.to && !action}
                >
                  {a.label}
                </Button>
              ))}
              {nextActions(data.status, data.delivery_method).length === 0 && (
                <p className="px-1 text-sm text-muted">Đơn đã hoàn tất, không còn thao tác nào.</p>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <SectionTitle>Chia sẻ</SectionTitle>
              <Card className="flex flex-col gap-3">
                <pre className="whitespace-pre-wrap text-sm">{message}</pre>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={copyMessage} disabled={!message}>
                    Sao chép
                  </Button>
                  {typeof navigator.share === 'function' && (
                    <Button size="sm" variant="secondary" icon={<Share2 className="size-4" />} onClick={() => navigator.share({ text: message }).catch(() => undefined)}>
                      Gửi
                    </Button>
                  )}
                  <Link to={`/shop/orders/new?clone=${data.id}`} className="contents">
                    <Button size="sm" variant="secondary" icon={<CopyPlus className="size-4" />}>
                      Nhân bản
                    </Button>
                  </Link>
                </div>
              </Card>
            </section>

            <section>
              <SectionTitle>Lịch sử</SectionTitle>
              <ol className="flex flex-col gap-3 border-l-2 border-border pl-4">
                {data.events.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full bg-primary" />
                    <p className="font-medium">{STATUS_LABEL[event.to_status]}</p>
                    <p className="text-sm text-muted">
                      {formatDateTime(event.created_at)}
                      {event.note && ` · ${event.note}`}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </PageBody>

      {action && (
        <ActionSheet
          action={action}
          busy={change.isPending}
          onClose={() => setAction(null)}
          onConfirm={(note) => change.mutate({ to: action.to, note })}
        />
      )}
    </>
  )
}
