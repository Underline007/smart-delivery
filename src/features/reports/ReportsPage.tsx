import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { BarChart } from '@/components/ui/BarChart'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { METHOD_LABEL } from '@/features/orders/status'
import { toMessage } from '@/lib/errors'
import { downloadFile } from '@/lib/files'
import { cn } from '@/lib/cn'
import { formatMoney, formatNumber, todayVn } from '@/lib/format'
import { formatVnPhone } from '@/lib/vn/phone'
import { fetchSalesReport } from './api'
import { exportShopData } from './export-data'
import { fillDays, PERIODS, periodRange, returnPercent, type PeriodId } from './period'

function Row({ left, sub, right }: { left: string; sub?: string; right: string }) {
  return (
    <li className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{left}</p>
        {sub && <p className="truncate text-sm text-muted">{sub}</p>}
      </div>
      <p className="font-semibold tabular-nums">{right}</p>
    </li>
  )
}

export function ReportsPage() {
  const shop = useShop()
  const [period, setPeriod] = useState<PeriodId>('7d')
  const [exporting, setExporting] = useState(false)
  const range = periodRange(period)
  const report = useQuery({
    queryKey: ['shop', shop.id, 'report', range.from, range.to],
    queryFn: () => fetchSalesReport(shop.id, range.from, range.to),
  })
  const r = report.data

  async function exportData() {
    setExporting(true)
    try {
      const bytes = await exportShopData(shop.id)
      downloadFile(`smart-delivery_${shop.order_prefix}_${todayVn().replace(/-/g, '')}.xlsx`, bytes)
      toast.success('Đã xuất dữ liệu')
    } catch (error) {
      toast.error(await toMessage(error))
    } finally {
      setExporting(false)
    }
  }

  const days = r ? fillDays(r.from, r.to, r.by_day) : []

  return (
    <>
      <PageHeader title="Báo cáo" subtitle={shop.name} back="/shop/settings" />
      <PageBody className="flex flex-col gap-5">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={cn('h-9 shrink-0 rounded-full border px-4 text-sm font-medium', period === p.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface')}
            >
              {p.label}
            </button>
          ))}
        </div>

        {report.isLoading ? (
          <LoadingBlock />
        ) : report.error || !r ? (
          <ErrorBlock message="Không tải được báo cáo" onRetry={() => report.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <p className="text-sm text-muted">Doanh thu (đã giao)</p>
                <p className="text-2xl font-bold tabular-nums">{formatMoney(r.totals.revenue)}</p>
                <p className="text-sm text-muted">{r.totals.delivered} đơn</p>
              </Card>
              <Card>
                <p className="text-sm text-muted">Lợi nhuận gộp</p>
                <p className={cn('text-2xl font-bold tabular-nums', r.totals.gross_profit < 0 && 'text-danger')}>{formatMoney(r.totals.gross_profit)}</p>
                <p className="text-sm text-muted">Giá vốn {formatMoney(r.totals.cost)}</p>
              </Card>
              <Card>
                <p className="text-sm text-muted">Đơn tạo mới</p>
                <p className="text-2xl font-bold tabular-nums">{r.totals.orders_created}</p>
                <p className="text-sm text-muted">{r.totals.cancelled} đơn huỷ</p>
              </Card>
              <Card>
                <p className="text-sm text-muted">Đơn hoàn</p>
                <p className="text-2xl font-bold tabular-nums">{r.totals.returned}</p>
                <p className="text-sm text-muted">{returnPercent(r.totals.delivered, r.totals.returned) ?? 0}% trên đơn đã có kết quả</p>
              </Card>
            </div>
            <p className="-mt-3 px-1 text-xs text-muted">Doanh thu tính theo ngày giao thành công. Lợi nhuận gộp = tiền hàng − giảm giá − giá vốn (không tính phí ship).</p>

            {r.totals.delivered === 0 && r.totals.orders_created === 0 ? (
              <EmptyState title="Chưa có đơn nào trong khoảng này" />
            ) : (
              <>
                <section>
                  <SectionTitle>Doanh thu theo ngày</SectionTitle>
                  <Card>
                    <BarChart data={days.map((d) => ({ label: d.day.slice(8) + '/' + d.day.slice(5, 7), value: d.revenue }))} />
                  </Card>
                </section>

                {r.top_products.length > 0 && (
                  <section>
                    <SectionTitle>Sản phẩm bán chạy</SectionTitle>
                    <Card className="py-2">
                      <ul>
                        {r.top_products.map((p) => (
                          <Row key={p.name} left={p.name} sub={`${formatNumber(p.qty)} cái · lãi ${formatMoney(p.profit)}`} right={formatMoney(p.revenue)} />
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}

                {r.top_variants.length > 0 && (
                  <section>
                    <SectionTitle>Màu / size bán chạy</SectionTitle>
                    <Card className="py-2">
                      <ul>
                        {r.top_variants.map((v) => (
                          <Row key={v.sku} left={v.name} sub={v.sku} right={`${formatNumber(v.qty)} cái`} />
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}

                {r.top_customers.length > 0 && (
                  <section>
                    <SectionTitle>Khách mua nhiều</SectionTitle>
                    <Card className="py-2">
                      <ul>
                        {r.top_customers.map((c) => (
                          <Row key={`${c.name}-${c.phone}`} left={c.name} sub={`${c.phone ? formatVnPhone(c.phone) : ''} · ${c.orders} đơn`} right={formatMoney(c.spent)} />
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}

                {r.by_method.length > 0 && (
                  <section>
                    <SectionTitle>Theo cách giao</SectionTitle>
                    <Card className="py-2">
                      <ul>
                        {r.by_method.map((m) => (
                          <Row
                            key={m.method}
                            left={METHOD_LABEL[m.method]}
                            sub={`${m.orders} đơn · giao ${m.delivered} · hoàn ${m.returned}`}
                            right={`${returnPercent(m.delivered, m.returned) ?? 0}% hoàn`}
                          />
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}

                {r.shippers.length > 0 && (
                  <section>
                    <SectionTitle>Shipper</SectionTitle>
                    <Card className="py-2">
                      <ul>
                        {r.shippers.map((s) => (
                          <Row key={s.name} left={s.name} sub={`${s.trips} chuyến · giao ${s.delivered} · thất bại ${s.failed}`} right={formatMoney(s.cod_collected)} />
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}
              </>
            )}
          </>
        )}

        <section>
          <SectionTitle>Sao lưu dữ liệu</SectionTitle>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted">Tải toàn bộ đơn hàng, khách hàng, sản phẩm và sổ kho của shop về file Excel. Nên làm định kỳ để có bản sao lưu của riêng bạn.</p>
            <Button variant="secondary" icon={<Download className="size-5" />} loading={exporting} onClick={exportData}>
              Xuất toàn bộ dữ liệu ra Excel
            </Button>
          </Card>
        </section>
      </PageBody>
    </>
  )
}
