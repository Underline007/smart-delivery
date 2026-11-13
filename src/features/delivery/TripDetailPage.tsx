import { useQuery } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { TextField } from '@/components/ui/Field'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Badge, Card, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { formatDate, formatMoney } from '@/lib/format'
import { useAction } from '@/lib/useAction'
import { formatVnPhone } from '@/lib/vn/phone'
import { cancelTrip, fetchTrip, finishTrip, proofUrl, settleTrip, startTrip, TRIP_STATUS_LABEL, type TripStopRow } from './api'
import { tripProgress } from './progress'
import { DeliverSheet, FailSheet } from './StopSheets'
import { useStopResults } from './useStopResults'

const TripMap = lazy(() => import('@/components/map/TripMap').then((m) => ({ default: m.TripMap })))

function ProofButton({ path }: { path: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={busy}
      icon={<Camera className="size-4" />}
      onClick={async () => {
        setBusy(true)
        const url = await proofUrl(path)
        setBusy(false)
        if (url) window.open(url, '_blank', 'noopener')
        else toast.error('Không mở được ảnh')
      }}
    >
      Xem ảnh
    </Button>
  )
}

export function TripDetailPage() {
  const { tripId } = useParams()
  const shop = useShop()
  const trip = useQuery({ queryKey: ['shop', shop.id, 'delivery', 'trip', tripId], queryFn: () => fetchTrip(tripId!) })
  const data = trip.data
  const [action, setAction] = useState<{ type: 'deliver' | 'fail'; stop: TripStopRow } | null>(null)
  const [confirm, setConfirm] = useState<'cancel' | 'finish' | null>(null)
  const [settling, setSettling] = useState(false)
  const [amount, setAmount] = useState(0)
  const [settleNote, setSettleNote] = useState('')

  const refresh = async () => {
    await trip.refetch()
    setAction(null)
  }
  const results = useStopResults({ id: tripId ?? '', shopId: shop.id }, refresh)
  const keys = [['shop', shop.id, 'delivery'], ['shop', shop.id, 'orders']]

  const start = useAction(() => startTrip(tripId!), { success: 'Đã bắt đầu chuyến giao', invalidate: keys })
  const cancel = useAction(() => cancelTrip(shop.id, tripId!), { success: 'Đã huỷ chuyến', invalidate: keys, onSuccess: () => setConfirm(null) })
  const finish = useAction(() => finishTrip(tripId!, 'Chưa giao kịp'), { success: 'Đã kết thúc chuyến', invalidate: keys, onSuccess: () => setConfirm(null) })
  const settle = useAction(() => settleTrip(shop.id, tripId!, amount, settleNote), {
    success: 'Đã đối soát tiền thu hộ',
    invalidate: keys,
    onSuccess: () => setSettling(false),
  })

  const p = data ? tripProgress(data) : null
  const mapStops = (data?.stops ?? [])
    .filter((s) => s.order?.ship_lat != null && s.order?.ship_lng != null)
    .map((s) => ({ lat: s.order!.ship_lat!, lng: s.order!.ship_lng!, label: String(s.seq), state: s.status }))
  const startPoint = data?.start_lat != null && data.start_lng != null ? { lat: data.start_lat, lng: data.start_lng } : null

  return (
    <>
      <PageHeader title={data?.code ?? 'Chuyến giao'} subtitle={data && `${data.shipper?.full_name ?? ''} · ${formatDate(data.trip_date)}`} back="/shop/delivery" />
      <PageBody className="flex flex-col gap-5">
        {trip.isLoading ? (
          <LoadingBlock />
        ) : trip.error || !data || !p ? (
          <ErrorBlock message="Không tìm thấy chuyến giao" onRetry={() => trip.refetch()} />
        ) : (
          <>
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Badge tone={data.status === 'in_progress' ? 'warning' : data.status === 'done' ? 'success' : 'neutral'}>{TRIP_STATUS_LABEL[data.status]}</Badge>
                {data.settled_at && <Badge tone="success">Đã đối soát</Badge>}
                <span className="flex-1" />
                <span className="text-sm text-muted">
                  {p.delivered}/{p.total} đã giao
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-primary" style={{ width: `${p.total ? ((p.delivered + p.failed) / p.total) * 100 : 0}%` }} />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted">COD cần thu</dt>
                  <dd className="font-bold tabular-nums">{formatMoney(data.cod_expected)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Đã thu</dt>
                  <dd className="font-bold tabular-nums">{formatMoney(data.cod_collected)}</dd>
                </div>
                {data.distance_m !== null && (
                  <div>
                    <dt className="text-muted">Quãng đường</dt>
                    <dd className="tabular-nums">{(data.distance_m / 1000).toFixed(1)} km</dd>
                  </div>
                )}
                {data.shipper && (
                  <div>
                    <dt className="text-muted">Shipper</dt>
                    <dd>
                      <a href={`tel:${data.shipper.phone}`} className="text-primary">
                        {formatVnPhone(data.shipper.phone)}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </Card>

            {mapStops.length > 0 && (
              <Suspense fallback={<LoadingBlock />}>
                <TripMap start={startPoint} stops={mapStops} returnToStart={data.end_mode === 'return'} />
              </Suspense>
            )}

            <section>
              <SectionTitle>Các điểm giao</SectionTitle>
              <ol className="flex flex-col gap-2">
                {data.stops.map((stop) => (
                  <li key={stop.id}>
                    <Card className="flex flex-col gap-2 py-3">
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                            stop.status === 'delivered' ? 'bg-slate-500' : stop.status === 'failed' ? 'bg-danger' : 'bg-primary',
                          )}
                        >
                          {stop.seq}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {stop.order?.ship_name} <span className="font-normal text-muted">· {stop.order?.code}</span>
                          </p>
                          <p className="text-sm text-muted">{stop.order?.ship_full_text}</p>
                          <p className="text-sm">
                            {stop.status === 'delivered' && <span className="text-success">Đã giao · thu {formatMoney(stop.cod_collected)}</span>}
                            {stop.status === 'failed' && <span className="text-danger">Thất bại: {stop.fail_reason}</span>}
                            {stop.status === 'pending' && <span className="text-muted">Chờ giao · thu {formatMoney(stop.order?.cod_amount)}</span>}
                          </p>
                          {stop.note && <p className="text-xs text-muted">{stop.note}</p>}
                        </div>
                        {stop.proof_photo_path && <ProofButton path={stop.proof_photo_path} />}
                      </div>
                      {data.status === 'in_progress' && stop.status === 'pending' && (
                        <div className="grid grid-cols-2 gap-2">
                          <Button size="sm" onClick={() => setAction({ type: 'deliver', stop })}>
                            Đã giao
                          </Button>
                          <Button size="sm" variant="danger-soft" onClick={() => setAction({ type: 'fail', stop })}>
                            Thất bại
                          </Button>
                        </div>
                      )}
                    </Card>
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-2">
              {data.status === 'draft' && (
                <>
                  <Button loading={start.isPending} onClick={() => start.mutate(undefined)}>
                    Bắt đầu giao
                  </Button>
                  <Button variant="danger-soft" onClick={() => setConfirm('cancel')}>
                    Huỷ chuyến
                  </Button>
                </>
              )}
              {data.status === 'in_progress' && (
                <Button variant="secondary" onClick={() => setConfirm('finish')}>
                  Kết thúc chuyến
                </Button>
              )}
              {data.status === 'done' && !data.settled_at && (
                <Button
                  onClick={() => {
                    setAmount(data.cod_collected)
                    setSettling(true)
                  }}
                >
                  Đối soát tiền thu hộ
                </Button>
              )}
              {data.settled_at && (
                <Card className="text-sm">
                  Đã nhận <strong>{formatMoney(data.settled_amount)}</strong>
                  {data.settled_amount !== data.cod_collected && (
                    <span className="text-warning"> (chênh {formatMoney((data.settled_amount ?? 0) - data.cod_collected)})</span>
                  )}
                  {data.settle_note && <p className="mt-1 text-muted">{data.settle_note}</p>}
                </Card>
              )}
            </section>
          </>
        )}
      </PageBody>

      {action?.type === 'deliver' && (
        <DeliverSheet
          name={action.stop.order?.ship_name ?? ''}
          expectedCod={action.stop.order?.cod_amount ?? 0}
          busy={results.busy}
          onClose={() => setAction(null)}
          onConfirm={(r) => results.deliver(action.stop.id, r)}
        />
      )}
      {action?.type === 'fail' && (
        <FailSheet name={action.stop.order?.ship_name ?? ''} busy={results.busy} onClose={() => setAction(null)} onConfirm={(reason, note) => results.fail(action.stop.id, reason, note)} />
      )}

      <ConfirmSheet open={confirm === 'cancel'} title="Huỷ chuyến?" confirmLabel="Huỷ chuyến" danger loading={cancel.isPending} onClose={() => setConfirm(null)} onConfirm={() => cancel.mutate(undefined)}>
        Các đơn trong chuyến trở lại danh sách chờ giao.
      </ConfirmSheet>
      <ConfirmSheet open={confirm === 'finish'} title="Kết thúc chuyến?" confirmLabel="Kết thúc" danger loading={finish.isPending} onClose={() => setConfirm(null)} onConfirm={() => finish.mutate(undefined)}>
        Các điểm chưa giao ({p?.pending ?? 0}) sẽ được ghi nhận là giao thất bại và đơn chuyển sang “Giao thất bại”.
      </ConfirmSheet>

      {settling && data && (
        <Sheet
          open
          onClose={() => setSettling(false)}
          title="Đối soát tiền thu hộ"
          footer={
            <Button block loading={settle.isPending} onClick={() => settle.mutate(undefined)}>
              Xác nhận đã nhận tiền
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Shipper đã ghi nhận thu <strong className="text-foreground">{formatMoney(data.cod_collected)}</strong>. Nhập số tiền bạn thực nhận.
            </p>
            <MoneyInput label="Số tiền thực nhận" value={amount} onChange={setAmount} blankZero={false} />
            {amount !== data.cod_collected && <p className="text-sm text-warning">Chênh lệch {formatMoney(amount - data.cod_collected)} so với số shipper ghi nhận.</p>}
            <TextField label="Ghi chú (tuỳ chọn)" value={settleNote} onChange={(e) => setSettleNote(e.target.value)} maxLength={500} />
          </div>
        </Sheet>
      )}
    </>
  )
}
