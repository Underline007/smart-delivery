import { useQuery } from '@tanstack/react-query'
import { Database, Store, Truck, UserCog } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useMe } from '@/app/session'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, SectionTitle, Spinner } from '@/components/ui/misc'
import { adminShopSummary } from '@/features/reports/api'
import { adminDbUsage, adminHeartbeat, adminListAccounts, adminListShops } from '@/lib/api'
import { heartbeatStatus } from './heartbeat'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/cn'

const DB_LIMIT_BYTES = 500 * 1024 * 1024

function StatCard({
  to,
  icon,
  label,
  value,
  detail,
}: {
  to: string
  icon: ReactNode
  label: string
  value: ReactNode
  detail?: ReactNode
}) {
  return (
    <Link to={to} className="block">
      <Card className="flex h-full flex-col gap-2 active:bg-surface-2">
        <div className="flex items-center gap-2 text-sm text-muted">
          {icon}
          {label}
        </div>
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        {detail && <div className="text-sm text-muted">{detail}</div>}
      </Card>
    </Link>
  )
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const ratio = Math.min(used / limit, 1)
  const tone = ratio > 0.85 ? 'bg-danger' : ratio > 0.7 ? 'bg-warning' : 'bg-primary'
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.max(ratio * 100, 2)}%` }} />
    </div>
  )
}

export function AdminHomePage() {
  const { profile } = useMe()
  const shops = useQuery({ queryKey: ['admin', 'shops'], queryFn: adminListShops })
  const accounts = useQuery({ queryKey: ['admin', 'accounts'], queryFn: () => adminListAccounts() })
  const usage = useQuery({ queryKey: ['admin', 'db-usage'], queryFn: adminDbUsage })
  const summary = useQuery({ queryKey: ['admin', 'shop-summary'], queryFn: adminShopSummary })
  const heartbeat = useQuery({ queryKey: ['admin', 'heartbeat'], queryFn: adminHeartbeat })
  const pulse = heartbeat.data ? heartbeatStatus(heartbeat.data.last_ping) : null
  const nearLimit = usage.data !== undefined && usage.data / DB_LIMIT_BYTES > 0.7

  const count = (type: string) =>
    accounts.data?.filter((a) => a.account_type === type && a.active).length ?? '–'
  const activeShops = shops.data?.filter((s) => s.active).length

  return (
    <>
      <PageHeader title="Hệ thống" subtitle={`Xin chào, ${profile.full_name}`} />
      <PageBody className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            to="/admin/shops"
            icon={<Store className="size-4" />}
            label="Cửa hàng"
            value={activeShops ?? '–'}
            detail={shops.data && `${shops.data.length - (activeShops ?? 0)} đang khoá`}
          />
          <StatCard
            to="/admin/accounts"
            icon={<UserCog className="size-4" />}
            label="Chủ cửa hàng"
            value={count('owner')}
          />
          <StatCard
            to="/admin/accounts"
            icon={<Truck className="size-4" />}
            label="Shipper"
            value={count('shipper')}
          />
          <StatCard
            to="/admin/accounts"
            icon={<UserCog className="size-4" />}
            label="Admin"
            value={count('admin')}
          />
        </div>

        {summary.data && summary.data.length > 0 && (
          <section>
            <SectionTitle>Cửa hàng trong 30 ngày</SectionTitle>
            <Card className="py-2">
              <ul>
                {summary.data.map((shop) => (
                  <li key={shop.shop_id} className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {shop.name}
                        {!shop.active && <span className="text-muted"> (khoá)</span>}
                      </p>
                      <p className="text-sm text-muted">
                        {shop.orders_30d} đơn · đã giao {shop.delivered_30d}
                      </p>
                    </div>
                    <p className="font-semibold tabular-nums">{formatMoney(shop.revenue_30d)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        <section>
          <SectionTitle>Hạ tầng miễn phí</SectionTitle>
          <Card className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Database className="size-5 text-muted" />
              <span className="flex-1 font-medium">Cơ sở dữ liệu</span>
              {usage.isLoading ? (
                <Spinner className="size-4" />
              ) : (
                <span className="text-sm tabular-nums text-muted">
                  {usage.data !== undefined ? `${(usage.data / 1024 / 1024).toFixed(1)} MB` : '–'} / 500 MB
                </span>
              )}
            </div>
            {usage.data !== undefined && <UsageBar used={usage.data} limit={DB_LIMIT_BYTES} />}
            <p className="text-sm text-muted">
              Gói miễn phí của Supabase cho tối đa 500 MB.
            </p>
            <div
              role={pulse && pulse.level !== 'ok' ? 'alert' : undefined}
              className={cn(
                'rounded-xl px-3.5 py-3 text-sm',
                !pulse || pulse.level === 'ok' ? 'bg-success-soft text-success' : pulse.level === 'warning' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger',
              )}
            >
              <p className="font-semibold">Giữ Supabase không bị tạm dừng</p>
              {!pulse ? (
                <p>{heartbeat.isLoading ? 'Đang kiểm tra…' : 'Chưa đọc được trạng thái.'}</p>
              ) : pulse.level === 'ok' ? (
                <p>Hoạt động bình thường. Lần gọi gần nhất: {pulse.ago}.</p>
              ) : (
                <p>
                  Lần gọi gần nhất: <strong>{pulse.ago}</strong>.{' '}
                  {pulse.level === 'danger'
                    ? 'Project sắp bị tạm dừng! Kiểm tra ngay các workflow “Keep Supabase awake” trên GitHub (và Cloudflare Worker nếu có).'
                    : 'Các lần gọi tự động có vẻ đã dừng. Kiểm tra workflow “Keep Supabase awake” trên GitHub.'}
                </p>
              )}
            </div>
            {nearLimit && (
              <p role="alert" className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
                Đã dùng quá 70% dung lượng cơ sở dữ liệu. Hãy xuất dữ liệu cũ ra Excel, xoá bớt ảnh không dùng, hoặc cân nhắc nâng gói.
              </p>
            )}
          </Card>
        </section>
      </PageBody>
    </>
  )
}
