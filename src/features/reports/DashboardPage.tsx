import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChartColumn, FileSpreadsheet, PackagePlus, Plus, Route as RouteIcon, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useCurrentShop, useShop } from '@/app/current-shop'
import { useMe } from '@/app/session'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { formatMoney } from '@/lib/format'
import { fetchDashboard, type Dashboard } from './api'

function Stat({ label, value, detail, to }: { label: string; value: ReactNode; detail?: ReactNode; to?: string }) {
  const body = (
    <Card className="flex h-full flex-col gap-1 active:bg-surface-2">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {detail && <p className="text-sm text-muted">{detail}</p>}
    </Card>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

interface Alert {
  to: string
  text: string
  tone: 'warning' | 'danger'
}

function alerts(d: Dashboard): Alert[] {
  const list: Alert[] = []
  if (d.new_orders > 0) list.push({ to: '/shop/orders', text: `${d.new_orders} đơn mới chưa xác nhận`, tone: 'warning' })
  if (d.failed > 0) list.push({ to: '/shop/orders', text: `${d.failed} đơn giao thất bại chờ xử lý`, tone: 'danger' })
  if (d.returning > 0) list.push({ to: '/shop/orders', text: `${d.returning} đơn đang hoàn về, nhớ xác nhận khi nhận hàng`, tone: 'warning' })
  if (d.vtp_waiting_tracking > 0) list.push({ to: '/shop/vtp/tracking', text: `${d.vtp_waiting_tracking} đơn ViettelPost quá 2 ngày chưa có mã vận đơn`, tone: 'warning' })
  if (d.low_stock > 0) list.push({ to: '/shop/inventory?filter=low', text: `${d.low_stock} biến thể sắp hết hàng`, tone: 'warning' })
  if (d.unsettled_trips > 0) list.push({ to: '/shop/delivery', text: `${d.unsettled_trips} chuyến giao chưa đối soát (${formatMoney(d.unsettled_cod)})`, tone: 'warning' })
  return list
}

export function DashboardPage() {
  const shop = useShop()
  const { profile } = useMe()
  const { ownedShops, selectShop, isAdminView } = useCurrentShop()
  const summary = useQuery({ queryKey: ['shop', shop.id, 'dashboard'], queryFn: () => fetchDashboard(shop.id), refetchOnWindowFocus: true })
  const d = summary.data

  return (
    <>
      <PageHeader
        title="Tổng quan"
        subtitle={profile.full_name}
        actions={
          <Link to="/shop/settings" aria-label="Cài đặt" className="flex size-11 items-center justify-center rounded-full active:bg-surface-2">
            <Settings className="size-6" />
          </Link>
        }
      />
      <PageBody className="flex flex-col gap-5">
        {ownedShops.length > 1 && !isAdminView && (
          <select
            aria-label="Chọn cửa hàng"
            value={shop.id}
            onChange={(e) => selectShop(e.target.value)}
            className="h-11 rounded-xl border border-border bg-surface px-3 font-semibold"
          >
            {ownedShops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {!isAdminView && ownedShops.length <= 1 && <p className="px-1 text-lg font-semibold">{shop.name}</p>}

        {summary.isLoading ? (
          <LoadingBlock />
        ) : summary.error || !d ? (
          <ErrorBlock message="Không tải được số liệu" onRetry={() => summary.refetch()} />
        ) : (
          <>
            <section>
              <SectionTitle>Hôm nay</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Đơn mới tạo" value={d.orders_created} detail={`Giá trị ${formatMoney(d.revenue_created)}`} to="/shop/orders" />
                <Stat label="Đã giao" value={d.delivered_today} detail={`Doanh thu ${formatMoney(d.revenue_delivered_today)}`} to="/shop/reports" />
                <Stat label="Cần xử lý" value={d.to_process} detail="Mới, đã xác nhận, đã xuất file" to="/shop/orders" />
                <Stat label="Đang giao" value={d.shipping} detail={`COD trên đường ${formatMoney(d.cod_on_the_road)}`} to="/shop/orders" />
              </div>
            </section>

            {alerts(d).length > 0 && (
              <section>
                <SectionTitle>Cần chú ý</SectionTitle>
                <ul className="flex flex-col gap-2">
                  {alerts(d).map((a) => (
                    <li key={a.text}>
                      <Link
                        to={a.to}
                        className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium active:opacity-80 ${a.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}
                      >
                        <AlertTriangle className="size-5 shrink-0" />
                        {a.text}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <SectionTitle>Lối tắt</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { to: '/shop/orders/new', icon: <Plus className="size-5" />, label: 'Tạo đơn' },
                  { to: '/shop/vtp/export', icon: <FileSpreadsheet className="size-5" />, label: 'Xuất Excel VTP' },
                  { to: '/shop/delivery/new', icon: <RouteIcon className="size-5" />, label: 'Lập chuyến giao' },
                  { to: '/shop/inventory/receipts/new', icon: <PackagePlus className="size-5" />, label: 'Nhập kho' },
                  { to: '/shop/reports', icon: <ChartColumn className="size-5" />, label: 'Báo cáo' },
                  { to: '/shop/delivery', icon: <RouteIcon className="size-5" />, label: `Chuyến giao${d.active_trips ? ` (${d.active_trips})` : ''}` },
                ].map((s) => (
                  <Link key={s.label} to={s.to} className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-4 font-medium active:bg-surface-2">
                    <span className="text-primary">{s.icon}</span>
                    {s.label}
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </PageBody>
    </>
  )
}
