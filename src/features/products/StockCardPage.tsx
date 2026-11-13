import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { formatDateTime, formatNumber } from '@/lib/format'
import { fetchVariantWithProduct, listStockMovements, MOVEMENT_LABEL } from './api'

export function StockCardPage() {
  const { variantId } = useParams()
  const variant = useQuery({
    queryKey: ['variant', variantId],
    queryFn: () => fetchVariantWithProduct(variantId!),
  })
  const movements = useInfiniteQuery({
    queryKey: ['variant', variantId, 'movements'],
    queryFn: ({ pageParam }) => listStockMovements(variantId!, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === 40 ? last[last.length - 1].id : undefined),
  })
  const rows = movements.data?.pages.flat() ?? []

  return (
    <>
      <PageHeader
        title="Thẻ kho"
        subtitle={variant.data && `${variant.data.product.name}${variant.data.variant_label ? ` · ${variant.data.variant_label}` : ''}`}
        back="/shop/inventory"
      />
      <PageBody className="flex flex-col gap-4">
        {variant.data && (
          <Card className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">Tồn hiện tại · {variant.data.sku}</p>
              <p className="text-3xl font-bold tabular-nums">
                {formatNumber(variant.data.stock_qty)}{' '}
                <span className="text-base font-normal text-muted">{variant.data.product.unit}</span>
              </p>
            </div>
          </Card>
        )}

        {movements.isLoading ? (
          <LoadingBlock />
        ) : movements.error ? (
          <ErrorBlock message="Không tải được thẻ kho" onRetry={() => movements.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="Chưa có giao dịch kho nào">Nhập kho để bắt đầu ghi sổ.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <Card className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{MOVEMENT_LABEL[row.type]}</p>
                    <p className="truncate text-sm text-muted">
                      {formatDateTime(row.created_at)}
                      {row.note && ` · ${row.note}`}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className={cn('font-bold', row.qty_change > 0 ? 'text-success' : 'text-danger')}>
                      {row.qty_change > 0 ? '+' : ''}
                      {formatNumber(row.qty_change)}
                    </p>
                    <p className="text-xs text-muted">còn {formatNumber(row.stock_after)}</p>
                  </div>
                </Card>
              </li>
            ))}
            {movements.hasNextPage && (
              <Button variant="secondary" block loading={movements.isFetchingNextPage} onClick={() => movements.fetchNextPage()}>
                Xem thêm
              </Button>
            )}
          </ul>
        )}
      </PageBody>
    </>
  )
}
