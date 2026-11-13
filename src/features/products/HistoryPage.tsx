import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { formatDateTime, formatMoney } from '@/lib/format'
import { listReceipts, listStocktakes } from './api'

type Tab = 'receipts' | 'stocktakes'

export function HistoryPage() {
  const shop = useShop()
  const [tab, setTab] = useState<Tab>('receipts')
  const rows = useQuery({
    queryKey: ['shop', shop.id, 'history', tab],
    queryFn: () => (tab === 'receipts' ? listReceipts(shop.id) : listStocktakes(shop.id)),
  })

  return (
    <>
      <PageHeader title="Lịch sử kho" back="/shop/inventory" />
      <PageBody className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
          {(
            [
              ['receipts', 'Phiếu nhập'],
              ['stocktakes', 'Phiếu kiểm'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn('h-10 rounded-lg text-sm font-semibold', tab === value ? 'bg-surface shadow-sm' : 'text-muted')}
            >
              {label}
            </button>
          ))}
        </div>
        {rows.isLoading ? (
          <LoadingBlock />
        ) : rows.error ? (
          <ErrorBlock message="Không tải được lịch sử" onRetry={() => rows.refetch()} />
        ) : rows.data?.length === 0 ? (
          <EmptyState title="Chưa có phiếu nào" />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.data?.map((row) => (
              <li key={row.id}>
                <Card className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{row.code}</p>
                    <p className="truncate text-sm text-muted">
                      {formatDateTime(row.created_at)}
                      {row.supplier && ` · ${row.supplier}`}
                      {row.note && ` · ${row.note}`}
                    </p>
                  </div>
                  {tab === 'receipts' && <p className="font-semibold tabular-nums">{formatMoney(row.total_cost)}</p>}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  )
}
