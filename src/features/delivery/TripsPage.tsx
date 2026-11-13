import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Plus, Route as RouteIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { formatDate, formatMoney } from '@/lib/format'
import { listTrips, TRIP_STATUS_LABEL, type Trip } from './api'
import { tripProgress } from './progress'

type Tab = 'active' | 'unsettled' | 'done'

const TABS: { value: Tab; label: string; match: (t: Trip) => boolean }[] = [
  { value: 'active', label: 'Đang chạy', match: (t) => t.status === 'draft' || t.status === 'in_progress' },
  { value: 'unsettled', label: 'Chưa đối soát', match: (t) => t.status === 'done' && !t.settled_at },
  { value: 'done', label: 'Đã đối soát', match: (t) => t.status === 'done' && Boolean(t.settled_at) },
]

export function TripsPage() {
  const shop = useShop()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('active')
  const trips = useQuery({ queryKey: ['shop', shop.id, 'delivery', 'trips'], queryFn: () => listTrips(shop.id) })
  const rows = (trips.data ?? []).filter((t) => TABS.find((x) => x.value === tab)!.match(t))
  const counts = Object.fromEntries(TABS.map((t) => [t.value, (trips.data ?? []).filter(t.match).length]))

  return (
    <>
      <PageHeader
        title="Chuyến giao"
        subtitle={shop.name}
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => navigate('/shop/delivery/new')}>
            Lập chuyến
          </Button>
        }
      />
      <PageBody className="flex flex-col gap-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn('h-9 shrink-0 rounded-full border px-4 text-sm font-medium', tab === t.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface')}
            >
              {t.label}
              {counts[t.value] > 0 && <span className="ml-1.5 opacity-80">{counts[t.value]}</span>}
            </button>
          ))}
        </div>

        {trips.isLoading ? (
          <LoadingBlock />
        ) : trips.error ? (
          <ErrorBlock message="Không tải được danh sách chuyến" onRetry={() => trips.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<RouteIcon className="size-7" />}
            title="Không có chuyến nào ở mục này"
            action={tab === 'active' && <Button onClick={() => navigate('/shop/delivery/new')}>Lập chuyến giao</Button>}
          >
            Chọn các đơn tự giao đã xác nhận, sắp xếp tuyến rồi giao cho shipper.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((trip) => {
              const p = tripProgress(trip)
              return (
                <li key={trip.id}>
                  <button type="button" className="w-full text-left" onClick={() => navigate(`/shop/delivery/${trip.id}`)}>
                    <Card className="flex items-center gap-3 py-3 active:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{trip.code}</p>
                          <Badge tone={trip.status === 'in_progress' ? 'warning' : trip.status === 'done' ? 'success' : 'neutral'}>{TRIP_STATUS_LABEL[trip.status]}</Badge>
                        </div>
                        <p className="text-sm">
                          {trip.shipper?.full_name ?? 'Shipper'} · {formatDate(trip.trip_date)}
                        </p>
                        <p className="text-sm text-muted">
                          Giao {p.delivered}/{p.total}
                          {p.failed > 0 && ` · thất bại ${p.failed}`} · COD {formatMoney(trip.status === 'done' ? trip.cod_collected : trip.cod_expected)}
                        </p>
                      </div>
                      <ChevronRight className="size-5 text-muted" />
                    </Card>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PageBody>
    </>
  )
}
