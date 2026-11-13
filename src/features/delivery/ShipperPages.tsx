import { useQuery } from '@tanstack/react-query'
import { Check, ChevronRight, MessageCircle, Navigation, Phone, Truck, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AccountSection } from '@/features/account/AccountSection'
import { useQueryClient } from '@tanstack/react-query'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { formatDate, formatMoney } from '@/lib/format'
import { navigationUrl, searchUrl } from '@/lib/maps/link'
import { useAction } from '@/lib/useAction'
import { formatVnPhone, zaloLink } from '@/lib/vn/phone'
import { finishTrip, getMyTripHistory, getMyTrips, startTrip, TRIP_STATUS_LABEL, type MyStop, type MyTrip } from './api'
import { DeliverSheet, FailSheet } from './StopSheets'
import { useStopResults } from './useStopResults'

const TripMap = lazy(() => import('@/components/map/TripMap').then((m) => ({ default: m.TripMap })))
const MY_TRIPS = ['my-trips']

function counts(trip: MyTrip) {
  const delivered = trip.stops.filter((s) => s.status === 'delivered').length
  const failed = trip.stops.filter((s) => s.status === 'failed').length
  return { delivered, failed, pending: trip.stops.length - delivered - failed, total: trip.stops.length }
}

export function ShipperTripsPage() {
  const trips = useQuery({ queryKey: MY_TRIPS, queryFn: getMyTrips, refetchInterval: 60_000 })
  return (
    <>
      <PageHeader title="Chuyến hôm nay" />
      <PageBody className="flex flex-col gap-3">
        {trips.isLoading ? (
          <LoadingBlock />
        ) : trips.error ? (
          <ErrorBlock message="Không tải được chuyến giao" onRetry={() => trips.refetch()} />
        ) : trips.data?.length === 0 ? (
          <EmptyState icon={<Truck className="size-7" />} title="Chưa có chuyến giao nào">
            Khi chủ shop giao chuyến cho bạn, chuyến sẽ hiện ở đây. Kéo xuống để làm mới.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {trips.data?.map((trip) => {
              const c = counts(trip)
              return (
                <li key={trip.id}>
                  <Link to={`/ship/trip/${trip.id}`} className="block">
                    <Card className="flex items-center gap-3 active:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-muted">{trip.shop_name}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-lg font-semibold">{trip.code}</p>
                          <Badge tone={trip.status === 'in_progress' ? 'warning' : trip.status === 'done' ? 'success' : 'neutral'}>{TRIP_STATUS_LABEL[trip.status]}</Badge>
                        </div>
                        <p className="text-sm text-muted">
                          {c.delivered}/{c.total} điểm · thu hộ {formatMoney(trip.cod_expected)}
                        </p>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${c.total ? ((c.delivered + c.failed) / c.total) * 100 : 0}%` }} />
                        </div>
                      </div>
                      <ChevronRight className="size-5 text-muted" />
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </PageBody>
    </>
  )
}

function StopCard({ stop, trip, onDeliver, onFail }: { stop: MyStop; trip: MyTrip; onDeliver: () => void; onFail: () => void }) {
  const hasPoint = stop.lat !== null && stop.lng !== null
  const navHref = hasPoint ? navigationUrl({ lat: stop.lat!, lng: stop.lng! }, 'two-wheeler') : searchUrl(stop.address ?? '')
  return (
    <Card className="flex flex-col gap-3 border-primary">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            Điểm {stop.seq}/{trip.stops.length} · {stop.order_code}
          </p>
          <p className="text-xl font-bold">{stop.name}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Thu hộ</p>
          <p className="text-xl font-bold tabular-nums text-primary">{formatMoney(stop.cod)}</p>
        </div>
      </div>
      <p className="text-base">{stop.address}</p>
      {!hasPoint && <Badge tone="warning">Chưa có vị trí chính xác, mở tìm kiếm theo địa chỉ</Badge>}
      {stop.items && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">{stop.items}</p>}
      {stop.note && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Lưu ý: {stop.note}</p>}
      <div className="grid grid-cols-3 gap-2">
        <a href={`tel:${stop.phone}`} className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl border border-border text-xs font-medium active:bg-surface-2">
          <Phone className="size-5" /> Gọi
        </a>
        <a href={zaloLink(stop.phone ?? '')} target="_blank" rel="noreferrer" className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl border border-border text-xs font-medium active:bg-surface-2">
          <MessageCircle className="size-5" /> Zalo
        </a>
        <a href={navHref} target="_blank" rel="noreferrer" className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl bg-primary-soft text-xs font-semibold text-primary active:opacity-80">
          <Navigation className="size-5" /> Dẫn đường
        </a>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button icon={<Check className="size-5" />} onClick={onDeliver}>
          Đã giao
        </Button>
        <Button variant="danger-soft" icon={<X className="size-5" />} onClick={onFail}>
          Thất bại
        </Button>
      </div>
    </Card>
  )
}

export function ShipperTripPage() {
  const { tripId } = useParams()
  const queryClient = useQueryClient()
  const trips = useQuery({ queryKey: MY_TRIPS, queryFn: getMyTrips })
  const trip = trips.data?.find((t) => t.id === tripId)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [action, setAction] = useState<{ type: 'deliver' | 'fail'; stop: MyStop } | null>(null)
  const [confirmFinish, setConfirmFinish] = useState(false)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: MY_TRIPS })
    setAction(null)
    setChosenId(null)
  }
  const results = useStopResults({ id: tripId ?? '', shopId: trip?.shop_id ?? '' }, refresh)
  const start = useAction(() => startTrip(tripId!), { success: 'Đã bắt đầu chuyến', invalidate: [MY_TRIPS] })
  const finish = useAction(() => finishTrip(tripId!, 'Chưa giao kịp'), {
    success: 'Đã kết thúc chuyến',
    invalidate: [MY_TRIPS],
    onSuccess: () => setConfirmFinish(false),
  })

  if (trips.isLoading) return <LoadingBlock />
  if (!trip) {
    return (
      <>
        <PageHeader title="Chuyến giao" back="/ship" />
        <PageBody>
          <ErrorBlock message="Không tìm thấy chuyến giao này" onRetry={() => trips.refetch()} />
        </PageBody>
      </>
    )
  }

  const c = counts(trip)
  const pending = trip.stops.filter((s) => s.status === 'pending')
  const current = pending.find((s) => s.id === chosenId) ?? pending[0]
  const others = pending.filter((s) => s.id !== current?.id)
  const startPoint =
    trip.start_lat !== null && trip.start_lng !== null
      ? { lat: trip.start_lat, lng: trip.start_lng }
      : trip.shop_lat !== null && trip.shop_lng !== null
        ? { lat: trip.shop_lat, lng: trip.shop_lng }
        : null
  const mapStops = trip.stops
    .filter((s) => s.lat !== null && s.lng !== null)
    .map((s) => ({ lat: s.lat!, lng: s.lng!, label: String(s.seq), state: s.id === current?.id ? ('current' as const) : s.status }))

  return (
    <>
      <PageHeader title={trip.code} subtitle={trip.shop_name} back="/ship" />
      <PageBody className="flex flex-col gap-4">
        <Card className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              Đã giao <strong>{c.delivered}</strong>/{c.total}
              {c.failed > 0 && <span className="text-danger"> · thất bại {c.failed}</span>}
            </span>
            <span>
              Đã thu <strong className="tabular-nums">{formatMoney(trip.cod_collected)}</strong>
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary" style={{ width: `${c.total ? ((c.delivered + c.failed) / c.total) * 100 : 0}%` }} />
          </div>
        </Card>

        {trip.status === 'draft' && (
          <Button size="md" loading={start.isPending} onClick={() => start.mutate(undefined)}>
            Bắt đầu chuyến
          </Button>
        )}

        {trip.status === 'in_progress' && current && (
          <StopCard stop={current} trip={trip} onDeliver={() => setAction({ type: 'deliver', stop: current })} onFail={() => setAction({ type: 'fail', stop: current })} />
        )}

        {trip.status === 'done' && (
          <Card className="flex flex-col gap-2 bg-success-soft">
            <p className="text-lg font-bold text-success">Hoàn thành chuyến giao</p>
            <p>
              Thành công <strong>{c.delivered}</strong> · thất bại <strong>{c.failed}</strong>
            </p>
            <p>
              Tiền thu hộ phải nộp lại: <strong className="text-xl tabular-nums">{formatMoney(trip.cod_collected)}</strong>
            </p>
          </Card>
        )}

        {mapStops.length > 0 && (
          <Suspense fallback={<LoadingBlock />}>
            <TripMap start={startPoint} stops={mapStops} returnToStart={trip.end_mode === 'return'} height={220} />
          </Suspense>
        )}

        {trip.status === 'in_progress' && others.length > 0 && (
          <section>
            <SectionTitle>Điểm tiếp theo</SectionTitle>
            <ul className="flex flex-col gap-2">
              {others.map((stop) => (
                <li key={stop.id}>
                  <button type="button" className="w-full text-left" onClick={() => setChosenId(stop.id)}>
                    <Card className="flex items-center gap-3 py-3 active:bg-surface-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{stop.seq}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{stop.name}</p>
                        <p className="truncate text-sm text-muted">{stop.address}</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{formatMoney(stop.cod)}</span>
                    </Card>
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-1 pt-2 text-xs text-muted">Chạm vào một điểm để giao điểm đó trước.</p>
          </section>
        )}

        {trip.stops.some((s) => s.status !== 'pending') && (
          <section>
            <SectionTitle>Đã xong</SectionTitle>
            <ul className="flex flex-col gap-2">
              {trip.stops
                .filter((s) => s.status !== 'pending')
                .map((stop) => (
                  <li key={stop.id}>
                    <Card className={cn('flex items-center gap-3 py-3', stop.status === 'failed' && 'border-danger')}>
                      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-white', stop.status === 'delivered' ? 'bg-slate-500' : 'bg-danger')}>
                        {stop.status === 'delivered' ? <Check className="size-4" /> : <X className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{stop.name}</p>
                        <p className="text-sm text-muted">{stop.status === 'delivered' ? `Thu ${formatMoney(stop.cod_collected)}` : stop.fail_reason}</p>
                      </div>
                      {stop.phone && (
                        <a href={`tel:${stop.phone}`} className="text-sm text-primary">
                          {formatVnPhone(stop.phone)}
                        </a>
                      )}
                    </Card>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {trip.status === 'in_progress' && (
          <Button variant="secondary" onClick={() => setConfirmFinish(true)}>
            Kết thúc chuyến
          </Button>
        )}
      </PageBody>

      {action?.type === 'deliver' && (
        <DeliverSheet name={action.stop.name ?? ''} expectedCod={action.stop.cod} busy={results.busy} onClose={() => setAction(null)} onConfirm={(r) => results.deliver(action.stop.id, r)} />
      )}
      {action?.type === 'fail' && (
        <FailSheet name={action.stop.name ?? ''} busy={results.busy} onClose={() => setAction(null)} onConfirm={(reason, note) => results.fail(action.stop.id, reason, note)} />
      )}
      <ConfirmSheet open={confirmFinish} title="Kết thúc chuyến?" confirmLabel="Kết thúc" danger loading={finish.isPending} onClose={() => setConfirmFinish(false)} onConfirm={() => finish.mutate(undefined)}>
        Còn {c.pending} điểm chưa giao sẽ được ghi nhận là giao thất bại.
      </ConfirmSheet>
    </>
  )
}

export function ShipperHistoryPage() {
  const history = useQuery({ queryKey: ['my-trip-history'], queryFn: getMyTripHistory })
  return (
    <>
      <PageHeader title="Lịch sử" />
      <PageBody className="flex flex-col gap-2">
        {history.isLoading ? (
          <LoadingBlock />
        ) : history.error ? (
          <ErrorBlock message="Không tải được lịch sử" onRetry={() => history.refetch()} />
        ) : history.data?.length === 0 ? (
          <EmptyState title="Chưa có chuyến nào hoàn thành" />
        ) : (
          history.data?.map((trip) => (
            <Card key={trip.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {trip.code} <span className="font-normal text-muted">· {trip.shop_name}</span>
                </p>
                <p className="text-sm text-muted">
                  {formatDate(trip.trip_date)} · giao {trip.delivered}/{trip.stops}
                  {trip.failed > 0 && ` · thất bại ${trip.failed}`}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{formatMoney(trip.cod_collected)}</p>
                {trip.status === 'done' && <Badge tone={trip.settled_at ? 'success' : 'warning'}>{trip.settled_at ? 'Đã nộp' : 'Chưa nộp'}</Badge>}
              </div>
            </Card>
          ))
        )}
      </PageBody>
    </>
  )
}

export function ShipperAccountPage() {
  return (
    <>
      <PageHeader title="Tài khoản" />
      <PageBody>
        <AccountSection />
      </PageBody>
    </>
  )
}
