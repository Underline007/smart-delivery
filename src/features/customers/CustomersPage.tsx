import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronRight, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Field'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/misc'
import { useDebounced } from '@/lib/useDebounced'
import { formatVnPhone } from '@/lib/vn/phone'
import { CUSTOMER_PAGE, listCustomers } from './api'
import { CustomerFormSheet } from './CustomerFormSheet'
import { returnWarning } from './stats'

export function CustomersPage() {
  const shop = useShop()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const debounced = useDebounced(query.trim())

  const customers = useInfiniteQuery({
    queryKey: ['shop', shop.id, 'customers', debounced],
    queryFn: ({ pageParam }) => listCustomers(shop.id, { query: debounced, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === CUSTOMER_PAGE ? all.flat().length : undefined),
  })
  const rows = customers.data?.pages.flat() ?? []

  return (
    <>
      <PageHeader
        title="Khách hàng"
        subtitle={shop.name}
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Thêm
          </Button>
        }
      />
      <PageBody className="flex flex-col gap-3">
        <SearchInput
          placeholder="Tìm theo tên hoặc số điện thoại"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {customers.isLoading ? (
          <LoadingBlock />
        ) : customers.error ? (
          <ErrorBlock message="Không tải được danh sách khách" onRetry={() => customers.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="size-7" />}
            title={debounced ? 'Không tìm thấy khách nào' : 'Chưa có khách hàng nào'}
            action={!debounced && <Button onClick={() => setCreating(true)}>Thêm khách hàng</Button>}
          >
            {debounced ? 'Thử tìm bằng số điện thoại hoặc tên khác.' : 'Khách mới sẽ được lưu khi bạn tạo đơn, hoặc thêm trực tiếp ở đây.'}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((customer) => {
              const warning = returnWarning(customer)
              const address = customer.addresses.find((a) => a.is_default) ?? customer.addresses[0]
              return (
                <li key={customer.id}>
                  <button type="button" className="w-full text-left" onClick={() => navigate(`/shop/customers/${customer.id}`)}>
                    <Card className="flex items-center gap-3 py-3 active:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate font-semibold">{customer.name}</p>
                          {customer.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} tone="primary">
                              {tag}
                            </Badge>
                          ))}
                          {warning && <Badge tone="danger">Hay hoàn</Badge>}
                        </div>
                        <p className="text-sm text-muted">
                          {formatVnPhone(customer.phone)} · {customer.order_count} đơn
                        </p>
                        {address && <p className="truncate text-sm text-muted">{address.full_text}</p>}
                      </div>
                      <ChevronRight className="size-5 text-muted" />
                    </Card>
                  </button>
                </li>
              )
            })}
            {customers.hasNextPage && (
              <Button variant="secondary" block loading={customers.isFetchingNextPage} onClick={() => customers.fetchNextPage()}>
                Xem thêm
              </Button>
            )}
          </ul>
        )}
      </PageBody>

      {creating && (
        <CustomerFormSheet
          shopId={shop.id}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            navigate(`/shop/customers/${id}`)
          }}
        />
      )}
    </>
  )
}
