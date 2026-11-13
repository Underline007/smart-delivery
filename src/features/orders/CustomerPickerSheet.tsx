import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useShop } from '@/app/current-shop'
import { SearchInput } from '@/components/ui/Field'
import { Badge, Card, LoadingBlock } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import { listCustomers, type Customer } from '@/features/customers/api'
import { returnWarning } from '@/features/customers/stats'
import { useDebounced } from '@/lib/useDebounced'
import { formatVnPhone } from '@/lib/vn/phone'

export function CustomerPickerSheet({ onPick, onClose }: { onPick: (customer: Customer) => void; onClose: () => void }) {
  const shop = useShop()
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim())
  const results = useQuery({
    queryKey: ['shop', shop.id, 'customers', 'picker', debounced],
    queryFn: () => listCustomers(shop.id, { query: debounced }),
    placeholderData: (previous) => previous,
  })

  return (
    <Sheet open onClose={onClose} title="Chọn khách hàng">
      <div className="flex flex-col gap-3">
        <SearchInput autoFocus placeholder="Số điện thoại hoặc tên" value={query} onChange={(e) => setQuery(e.target.value)} />
        {results.isLoading ? (
          <LoadingBlock />
        ) : results.data?.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Không tìm thấy khách. Hãy nhập thông tin người nhận, khách mới sẽ được lưu tự động.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {results.data?.map((customer) => (
              <li key={customer.id}>
                <button type="button" className="w-full text-left" onClick={() => onPick(customer)}>
                  <Card className="flex items-center gap-3 py-3 active:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{customer.name}</p>
                      <p className="text-sm text-muted">
                        {formatVnPhone(customer.phone)} · {customer.order_count} đơn
                      </p>
                    </div>
                    {returnWarning(customer) && <Badge tone="danger">Hay hoàn</Badge>}
                  </Card>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
