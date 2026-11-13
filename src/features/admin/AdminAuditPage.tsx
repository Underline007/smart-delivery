import { useInfiniteQuery } from '@tanstack/react-query'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/misc'
import { adminListAudit } from '@/lib/api'
import { actionLabel } from '@/lib/audit'
import { formatDateTime } from '@/lib/format'

export function AdminAuditPage() {
  const audit = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => adminListAudit(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].id : undefined),
  })
  const rows = audit.data?.pages.flat() ?? []

  return (
    <>
      <PageHeader title="Nhật ký thao tác" back="/admin/settings" />
      <PageBody>
        {audit.isLoading ? (
          <LoadingBlock />
        ) : audit.error ? (
          <ErrorBlock message="Không tải được nhật ký" onRetry={() => audit.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="Chưa có thao tác nào" />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <Card className="py-3">
                  <p className="font-medium">{actionLabel(row.action)}</p>
                  <p className="text-sm text-muted">
                    {row.actor_name ?? 'Hệ thống'}
                    {row.shop_name && ` · ${row.shop_name}`}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(row.created_at)}</p>
                </Card>
              </li>
            ))}
            {audit.hasNextPage && (
              <Button
                variant="secondary"
                block
                loading={audit.isFetchingNextPage}
                onClick={() => audit.fetchNextPage()}
              >
                Xem thêm
              </Button>
            )}
          </ul>
        )}
      </PageBody>
    </>
  )
}
