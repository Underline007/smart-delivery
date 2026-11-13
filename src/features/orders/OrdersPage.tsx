import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckSquare, ChevronRight, FileSpreadsheet, Receipt, Route as RouteIcon, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { SearchInput } from '@/components/ui/Field'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { formatDateTime, formatMoney } from '@/lib/format'
import { toMessage } from '@/lib/errors'
import { useDebounced } from '@/lib/useDebounced'
import { listOrders, orderStatusCounts, ORDER_PAGE, setOrderStatus, type OrderWithItems } from './api'
import { METHOD_LABEL, STATUS_LABEL, STATUS_TABS, STATUS_TONE, type DeliveryMethod } from './status'

const METHODS: { value: DeliveryMethod | ''; label: string }[] = [
  { value: '', label: 'Mọi cách giao' },
  { value: 'self', label: 'Tự giao' },
  { value: 'vtp', label: 'ViettelPost' },
  { value: 'pickup', label: 'Khách lấy' },
]

export function OrderCard({
  order,
  selectable,
  selected,
  onToggle,
}: {
  order: OrderWithItems
  selectable: boolean
  selected: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()
  const qty = order.items.reduce((sum, i) => sum + i.qty, 0)
  const first = order.items[0]
  return (
    <button
      type="button"
      className="w-full text-left"
      onClick={() => (selectable ? onToggle() : navigate(`/shop/orders/${order.id}`))}
      aria-pressed={selectable ? selected : undefined}
    >
      <Card className={cn('flex items-center gap-3 py-3 active:bg-surface-2', selected && 'border-primary bg-primary-soft')}>
        {selectable && (
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md border-2 text-xs',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
            )}
            aria-hidden
          >
            {selected && '✓'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{order.code}</p>
            <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
          </div>
          <p className="truncate text-sm">
            {order.ship_name ?? 'Khách lấy tại shop'}
            <span className="text-muted"> · {METHOD_LABEL[order.delivery_method]}</span>
          </p>
          <p className="truncate text-sm text-muted">
            {first && `${first.product_name}${first.variant_label ? ` (${first.variant_label})` : ''}`}
            {order.items.length > 1 && ` +${order.items.length - 1} SP`} · {qty} cái
          </p>
          <p className="text-xs text-muted">{formatDateTime(order.created_at)}</p>
        </div>
        <div className="text-right">
          <p className="font-bold tabular-nums">{formatMoney(order.total)}</p>
          {order.cod_amount > 0 && <p className="text-xs text-muted">Thu {formatMoney(order.cod_amount)}</p>}
        </div>
        {!selectable && <ChevronRight className="size-5 text-muted" />}
      </Card>
    </button>
  )
}

export function OrdersPage() {
  const shop = useShop()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]['value']>('open')
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState<DeliveryMethod | ''>('')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Record<string, OrderWithItems>>({})
  const [bulk, setBulk] = useState<'confirm' | 'cancel' | null>(null)
  const [working, setWorking] = useState(false)
  const debounced = useDebounced(query.trim())

  const statuses = STATUS_TABS.find((t) => t.value === tab)?.statuses
  const counts = useQuery({ queryKey: ['shop', shop.id, 'orders', 'counts'], queryFn: () => orderStatusCounts(shop.id) })
  const orders = useInfiniteQuery({
    queryKey: ['shop', shop.id, 'orders', 'list', tab, debounced, method],
    queryFn: ({ pageParam }) => listOrders(shop.id, { statuses, query: debounced, method, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === ORDER_PAGE ? all.flat().length : undefined),
  })
  const rows = orders.data?.pages.flat() ?? []
  const chosen = Object.values(selected)

  const tabCount = (t: (typeof STATUS_TABS)[number]) =>
    t.statuses ? t.statuses.reduce((sum, s) => sum + (counts.data?.[s] ?? 0), 0) : undefined

  const every = (...allowed: string[]) => chosen.length > 0 && chosen.every((o) => allowed.includes(o.status))
  const canConfirm = every('new')
  const canCancel = every('new', 'confirmed', 'vtp_exported')
  const canExport = chosen.length > 0 && chosen.every((o) => o.status === 'confirmed' && o.delivery_method === 'vtp')
  const canTrip = chosen.length > 0 && chosen.every((o) => o.status === 'confirmed' && o.delivery_method === 'self')

  function toggle(order: OrderWithItems) {
    setSelected((all) => {
      const next = { ...all }
      if (next[order.id]) delete next[order.id]
      else next[order.id] = order
      return next
    })
  }

  function stopSelecting() {
    setSelecting(false)
    setSelected({})
  }

  async function runBulk(to: 'confirmed' | 'cancelled') {
    setWorking(true)
    const failures: string[] = []
    for (const order of chosen) {
      try {
        await setOrderStatus(shop.id, order.id, to)
      } catch (error) {
        failures.push(`${order.code}: ${await toMessage(error)}`)
      }
    }
    setWorking(false)
    setBulk(null)
    await queryClient.invalidateQueries({ queryKey: ['shop', shop.id, 'orders'] })
    await queryClient.invalidateQueries({ queryKey: ['shop', shop.id, 'products'] })
    const done = chosen.length - failures.length
    if (done > 0) toast.success(`Đã ${to === 'confirmed' ? 'xác nhận' : 'huỷ'} ${done} đơn`)
    if (failures.length > 0) toast.error(failures.slice(0, 3).join('\n'), { duration: 8000 })
    stopSelecting()
  }

  const ids = chosen.map((o) => o.id).join(',')

  return (
    <>
      <PageHeader
        title="Đơn hàng"
        subtitle={shop.name}
        actions={
          selecting ? (
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={stopSelecting}>
              Xong
            </Button>
          ) : (
            <Button size="sm" variant="ghost" icon={<CheckSquare className="size-4" />} onClick={() => setSelecting(true)}>
              Chọn
            </Button>
          )
        }
      />
      <PageBody className={cn('flex flex-col gap-3', selecting && 'pb-36')}>
        <SearchInput placeholder="Tìm mã đơn, tên hoặc số điện thoại" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {STATUS_TABS.map((t) => {
            const n = tabCount(t)
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={cn(
                  'h-9 shrink-0 rounded-full border px-4 text-sm font-medium',
                  tab === t.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface',
                )}
              >
                {t.label}
                {n !== undefined && n > 0 && <span className="ml-1.5 opacity-80">{n}</span>}
              </button>
            )
          })}
        </div>
        <select
          aria-label="Lọc theo cách giao"
          value={method}
          onChange={(e) => setMethod(e.target.value as DeliveryMethod | '')}
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        >
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>

        {orders.isLoading ? (
          <LoadingBlock />
        ) : orders.error ? (
          <ErrorBlock message="Không tải được danh sách đơn" onRetry={() => orders.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-7" />}
            title={debounced ? 'Không tìm thấy đơn nào' : 'Chưa có đơn nào ở mục này'}
            action={!debounced && tab === 'open' && <Button onClick={() => navigate('/shop/orders/new')}>Tạo đơn đầu tiên</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((order) => (
              <li key={order.id}>
                <OrderCard order={order} selectable={selecting} selected={Boolean(selected[order.id])} onToggle={() => toggle(order)} />
              </li>
            ))}
            {orders.hasNextPage && (
              <Button variant="secondary" block loading={orders.isFetchingNextPage} onClick={() => orders.fetchNextPage()}>
                Xem thêm
              </Button>
            )}
          </ul>
        )}
      </PageBody>

      {selecting && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-screen-sm flex-col gap-2 px-4 py-3">
            <p className="text-sm font-medium">Đã chọn {chosen.length} đơn</p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" disabled={!canConfirm} onClick={() => setBulk('confirm')}>
                Xác nhận
              </Button>
              <Button size="sm" variant="danger-soft" disabled={!canCancel} onClick={() => setBulk('cancel')}>
                Huỷ đơn
              </Button>
              <Link to={`/shop/vtp/export?orders=${ids}`} className={cn('contents', !canExport && 'pointer-events-none')}>
                <Button size="sm" variant="secondary" disabled={!canExport} icon={<FileSpreadsheet className="size-4" />}>
                  Xuất Excel VTP
                </Button>
              </Link>
              <Link to={`/shop/delivery/new?orders=${ids}`} className={cn('contents', !canTrip && 'pointer-events-none')}>
                <Button size="sm" variant="secondary" disabled={!canTrip} icon={<RouteIcon className="size-4" />}>
                  Lập chuyến giao
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      <ConfirmSheet
        open={bulk !== null}
        title={bulk === 'confirm' ? `Xác nhận ${chosen.length} đơn?` : `Huỷ ${chosen.length} đơn?`}
        confirmLabel={bulk === 'confirm' ? 'Xác nhận' : 'Huỷ đơn'}
        danger={bulk === 'cancel'}
        loading={working}
        onClose={() => setBulk(null)}
        onConfirm={() => runBulk(bulk === 'confirm' ? 'confirmed' : 'cancelled')}
      >
        {bulk === 'confirm'
          ? 'Hàng sẽ được trừ khỏi kho. Đơn nào không đủ tồn sẽ được giữ nguyên trạng thái Mới và báo lỗi.'
          : 'Hàng của các đơn đã xác nhận sẽ được trả về kho.'}
      </ConfirmSheet>
    </>
  )
}
