import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, MapPin, Route as RouteIcon, Wand2 } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/Field'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { listOrders, type OrderWithItems } from '@/features/orders/api'
import { fetchOrdersByIds } from '@/features/vtp/api'
import { fetchShop, listShopMembers } from '@/lib/api'
import { cn } from '@/lib/cn'
import { toMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/format'
import { getPosition } from '@/lib/geo'
import type { LatLng } from '@/lib/maps/link'
import { useAction } from '@/lib/useAction'
import { createTrip, optimizeRemote, setOrderLocation } from './api'
import { LocationSheet } from './LocationSheet'
import { estimateRoad, measure, optimizeLocal, type EndMode } from './route'

const TripMap = lazy(() => import('@/components/map/TripMap').then((m) => ({ default: m.TripMap })))

type StartSource = 'shop' | 'gps' | 'map'

const hasPoint = (o: OrderWithItems): o is OrderWithItems & { ship_lat: number; ship_lng: number } =>
  o.ship_lat !== null && o.ship_lng !== null

export function TripPlannerPage() {
  const shop = useShop()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const idsParam = params.get('orders')
  const ids = useMemo(() => (idsParam ? idsParam.split(',').filter(Boolean) : []), [idsParam])

  const candidates = useQuery({
    queryKey: ['shop', shop.id, 'delivery', 'candidates', idsParam ?? 'all'],
    queryFn: () => (ids.length > 0 ? fetchOrdersByIds(ids) : listOrders(shop.id, { statuses: ['confirmed', 'failed'], method: 'self' })),
  })
  const members = useQuery({ queryKey: ['shop', shop.id, 'members'], queryFn: () => listShopMembers(shop.id) })
  const shopInfo = useQuery({ queryKey: ['shop', shop.id], queryFn: () => fetchShop(shop.id) })

  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [sequence, setSequence] = useState<string[]>([])
  const [startSource, setStartSource] = useState<StartSource>('shop')
  const [picked, setPicked] = useState<LatLng | null>(null)
  const [gps, setGps] = useState<LatLng | null>(null)
  const [endMode, setEndMode] = useState<EndMode>('return')
  const [optimizer, setOptimizer] = useState<'local' | 'ors' | 'manual'>('manual')
  const [remote, setRemote] = useState<{ signature: string; distance_m: number | null; duration_s: number | null } | null>(null)
  const [useOnline, setUseOnline] = useState(true)
  const [working, setWorking] = useState(false)
  const [shipperId, setShipperId] = useState('')
  const [pickingStart, setPickingStart] = useState(false)
  const [locating, setLocating] = useState<OrderWithItems | null>(null)

  const shippers = (members.data ?? []).filter((m) => m.role === 'shipper' && m.active && m.account_active)
  const effectiveShipper = shipperId || shippers[0]?.user_id || ''

  const selected = (candidates.data ?? []).filter((o) => !excluded.has(o.id))
  const rank = new Map(sequence.map((id, i) => [id, i]))
  const ordered = [...selected].sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999))
  const located = ordered.filter(hasPoint)
  const missing = ordered.filter((o) => !hasPoint(o))

  const shopPoint: LatLng | null =
    shopInfo.data?.lat != null && shopInfo.data?.lng != null ? { lat: shopInfo.data.lat, lng: shopInfo.data.lng } : null
  const start: LatLng | null = startSource === 'shop' ? shopPoint : startSource === 'gps' ? gps : picked

  const signature = located.map((o) => o.id).join(',')
  const straight = start && located.length > 0 ? measure(start, located.map((o) => ({ lat: o.ship_lat, lng: o.ship_lng })), located.map((_, i) => i), endMode) : 0
  const estimate = estimateRoad(straight)
  const stats = remote && remote.signature === signature && remote.distance_m !== null
    ? { distance_m: remote.distance_m, duration_s: remote.duration_s ?? estimate.duration_s }
    : estimate
  const cod = selected.reduce((sum, o) => sum + o.cod_amount, 0)

  async function chooseStart(source: StartSource) {
    setStartSource(source)
    if (source === 'gps') {
      const point = await getPosition()
      if (point) setGps(point)
      else toast.error('Không lấy được vị trí GPS. Hãy cho phép truy cập vị trí hoặc chọn trên bản đồ.')
    }
    if (source === 'map') setPickingStart(true)
  }

  async function optimize() {
    if (!start) {
      toast.error('Chọn điểm xuất phát trước')
      return
    }
    if (located.length === 0) {
      toast.error('Chưa có đơn nào có vị trí bản đồ')
      return
    }
    setWorking(true)
    const points = located.map((o) => ({ lat: o.ship_lat, lng: o.ship_lng }))
    try {
      let order: number[] | null = null
      let used: 'local' | 'ors' = 'local'
      if (useOnline && located.length >= 2) {
        try {
          const result = await optimizeRemote(start, points, endMode)
          order = result.order
          used = 'ors'
          setRemote({ signature: result.order.map((i) => located[i].id).join(','), distance_m: result.distance_m, duration_s: result.duration_s })
        } catch (error) {
          const status = (error as { context?: { status?: number } }).context?.status
          if (status !== 501) toast.message('Dịch vụ tối ưu online chưa dùng được, đã tối ưu ngay trên máy')
        }
      }
      if (!order) order = optimizeLocal(start, points, endMode).order
      const next = [...order.map((i) => located[i].id), ...missing.map((o) => o.id)]
      setSequence(next)
      setOptimizer(used)
      if (used === 'local') setRemote(null)
      toast.success(used === 'ors' ? 'Đã tối ưu tuyến theo đường thật' : 'Đã sắp xếp tuyến ngắn nhất')
    } catch (error) {
      toast.error(await toMessage(error))
    } finally {
      setWorking(false)
    }
  }

  function move(id: string, delta: -1 | 1) {
    const ids = ordered.map((o) => o.id)
    const from = ids.indexOf(id)
    const to = from + delta
    if (to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    setSequence(ids)
    setOptimizer('manual')
  }

  const save = useAction(
    (startNow: boolean) =>
      createTrip(shop.id, ordered.map((o) => o.id), effectiveShipper, {
        start_lat: start?.lat ?? null,
        start_lng: start?.lng ?? null,
        end_mode: endMode,
        optimizer,
        distance_m: located.length > 0 && start ? stats.distance_m : null,
        duration_s: located.length > 0 && start ? stats.duration_s : null,
        note: '',
        start: startNow,
      }),
    {
      invalidate: [['shop', shop.id, 'delivery'], ['shop', shop.id, 'orders']],
      onSuccess: (id) => {
        toast.success('Đã lập chuyến giao')
        navigate(`/shop/delivery/${id}`, { replace: true })
      },
    },
  )

  const toggle = (id: string) =>
    setExcluded((all) => {
      const next = new Set(all)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function saveLocation(order: OrderWithItems, point: LatLng) {
    try {
      await setOrderLocation(shop.id, order.id, point.lat, point.lng)
      setLocating(null)
      await queryClient.invalidateQueries({ queryKey: ['shop', shop.id, 'delivery', 'candidates'] })
      toast.success('Đã lưu vị trí')
    } catch (error) {
      toast.error(await toMessage(error))
    }
  }

  const canSave = ordered.length > 0 && Boolean(effectiveShipper)

  return (
    <>
      <PageHeader title="Lập chuyến giao" subtitle={shop.name} back="/shop/delivery" />
      <PageBody className="flex flex-col gap-5 pb-44">
        <section>
          <SectionTitle>Đơn sẽ giao ({selected.length})</SectionTitle>
          {candidates.isLoading ? (
            <LoadingBlock />
          ) : candidates.error ? (
            <ErrorBlock message="Không tải được đơn" onRetry={() => candidates.refetch()} />
          ) : (candidates.data ?? []).length === 0 ? (
            <EmptyState icon={<RouteIcon className="size-7" />} title="Không có đơn nào để giao">
              Chỉ lập chuyến cho đơn tự giao ở trạng thái “Đã xác nhận” hoặc “Giao thất bại”.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {(candidates.data ?? []).map((order) => {
                const on = !excluded.has(order.id)
                return (
                  <li key={order.id}>
                    <Card className={cn('flex items-start gap-3 py-3', !on && 'opacity-60')}>
                      <button type="button" aria-pressed={on} aria-label={`Chọn ${order.code}`} onClick={() => toggle(order.id)} className="mt-0.5">
                        <span className={cn('flex size-6 items-center justify-center rounded-md border-2 text-xs', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                          {on && '✓'}
                        </span>
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {order.code} · {order.ship_name}
                        </p>
                        <p className="truncate text-sm text-muted">{order.ship_full_text}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                          <span className="text-muted">Thu {formatMoney(order.cod_amount)}</span>
                          {order.status === 'failed' && <Badge tone="danger">Giao lại</Badge>}
                          {!hasPoint(order) && <Badge tone="warning">Chưa có vị trí</Badge>}
                        </div>
                      </div>
                      {!hasPoint(order) && on && (
                        <Button size="sm" variant="secondary" icon={<MapPin className="size-4" />} onClick={() => setLocating(order)}>
                          Đặt vị trí
                        </Button>
                      )}
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Xuất phát và kết thúc</SectionTitle>
          <Card className="flex flex-col gap-4">
            <div role="radiogroup" aria-label="Điểm xuất phát" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
              {(
                [
                  ['shop', 'Địa chỉ shop'],
                  ['gps', 'Vị trí hiện tại'],
                  ['map', 'Chọn trên bản đồ'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={startSource === value}
                  onClick={() => chooseStart(value)}
                  className={cn('min-h-11 rounded-lg px-1 text-sm font-semibold', startSource === value ? 'bg-surface text-primary shadow-sm' : 'text-muted')}
                >
                  {label}
                </button>
              ))}
            </div>
            {startSource === 'shop' && !shopPoint && (
              <p className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
                Shop chưa có toạ độ. Đặt ở <Link to="/shop/settings" className="font-semibold underline">Cài đặt</Link> hoặc chọn cách khác.
              </p>
            )}
            {start && <p className="text-sm text-muted">Xuất phát: {start.lat.toFixed(5)}, {start.lng.toFixed(5)}</p>}
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={endMode === 'return'} onChange={(e) => setEndMode(e.target.checked ? 'return' : 'last')} />
              Quay về điểm xuất phát sau khi giao xong
            </label>
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>Tuyến giao</SectionTitle>
          <Button icon={<Wand2 className="size-5" />} loading={working} disabled={located.length === 0} onClick={optimize}>
            Tối ưu tuyến
          </Button>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={useOnline} onChange={(e) => setUseOnline(e.target.checked)} />
            Thử dịch vụ tối ưu theo đường thật (OpenRouteService) trước
          </label>
          {missing.length > 0 && (
            <p className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
              {missing.length} đơn chưa có vị trí nên được xếp cuối tuyến. Bấm “Đặt vị trí” ở trên để đưa vào tối ưu.
            </p>
          )}
          {start && located.length > 0 && (
            <Card className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xl font-bold tabular-nums">{(stats.distance_m / 1000).toFixed(1)}</p>
                <p className="text-xs text-muted">km{optimizer === 'ors' && remote?.signature === signature ? '' : ' (ước tính)'}</p>
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums">{Math.max(Math.round(stats.duration_s / 60), 1)}</p>
                <p className="text-xs text-muted">phút di chuyển</p>
              </div>
              <div>
                <p className="text-xl font-bold tabular-nums">{ordered.length}</p>
                <p className="text-xs text-muted">điểm giao</p>
              </div>
            </Card>
          )}
          {located.length > 0 && (
            <Suspense fallback={<LoadingBlock />}>
              <TripMap
                start={start}
                stops={located.map((o, i) => ({ lat: o.ship_lat, lng: o.ship_lng, label: String(i + 1) }))}
                returnToStart={endMode === 'return'}
              />
            </Suspense>
          )}
          <ol className="flex flex-col gap-2">
            {ordered.map((order, index) => (
              <li key={order.id}>
                <Card className="flex items-center gap-3 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{order.ship_name}</p>
                    <p className="truncate text-sm text-muted">{order.ship_full_text}</p>
                  </div>
                  <div className="flex flex-col">
                    <button type="button" aria-label={`Đưa ${order.code} lên`} disabled={index === 0} onClick={() => move(order.id, -1)} className="flex size-9 items-center justify-center rounded-lg text-muted disabled:opacity-30 active:bg-surface-2">
                      <ArrowUp className="size-5" />
                    </button>
                    <button type="button" aria-label={`Đưa ${order.code} xuống`} disabled={index === ordered.length - 1} onClick={() => move(order.id, 1)} className="flex size-9 items-center justify-center rounded-lg text-muted disabled:opacity-30 active:bg-surface-2">
                      <ArrowDown className="size-5" />
                    </button>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <SectionTitle>Shipper</SectionTitle>
          {shippers.length === 0 && members.isSuccess ? (
            <p className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
              Shop chưa có shipper. <Link to="/shop/settings/shippers" className="font-semibold underline">Thêm shipper</Link> trước.
            </p>
          ) : (
            <SelectField label="Giao cho" value={effectiveShipper} onChange={(e) => setShipperId(e.target.value)}>
              {shippers.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.full_name}
                </option>
              ))}
            </SelectField>
          )}
        </section>
      </PageBody>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto max-w-screen-sm px-4 py-3">
          <p className="mb-2 text-sm text-muted">
            {ordered.length} đơn · thu hộ <strong className="text-foreground">{formatMoney(cod)}</strong>
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" block disabled={!canSave} loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>
              Lưu chuyến
            </Button>
            <Button block disabled={!canSave} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>
              Lưu và bắt đầu giao
            </Button>
          </div>
        </div>
      </div>

      {pickingStart && (
        <LocationSheet
          title="Chọn điểm xuất phát"
          initial={picked}
          onClose={() => setPickingStart(false)}
          onSave={(point) => {
            setPicked(point)
            setPickingStart(false)
          }}
        />
      )}
      {locating && (
        <LocationSheet
          title={`Vị trí giao ${locating.code}`}
          initial={null}
          onClose={() => setLocating(null)}
          onSave={(point) => saveLocation(locating, point)}
        />
      )}
    </>
  )
}
