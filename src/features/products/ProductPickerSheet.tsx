import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useShop } from '@/app/current-shop'
import { SearchInput } from '@/components/ui/Field'
import { Card, LoadingBlock } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import { formatNumber } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import { listProducts, type Product } from './api'
import { totalStock } from './variants'

/** Search the shop's active products and pick one. */
export function ProductPickerSheet({
  onPick,
  onClose,
  excludeIds = [],
}: {
  onPick: (product: Product) => void
  onClose: () => void
  excludeIds?: string[]
}) {
  const shop = useShop()
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim())
  const results = useQuery({
    queryKey: ['shop', shop.id, 'products', 'picker', debounced],
    queryFn: () => listProducts(shop.id, { query: debounced, limit: 20 }),
    placeholderData: (previous) => previous,
  })
  const rows = (results.data ?? []).filter((p) => !excludeIds.includes(p.id))

  return (
    <Sheet open onClose={onClose} title="Chọn sản phẩm">
      <div className="flex flex-col gap-3">
        <SearchInput
          autoFocus
          placeholder="Tìm tên, SKU hoặc mã vạch"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.isLoading ? (
          <LoadingBlock />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Không tìm thấy sản phẩm.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((product) => (
              <li key={product.id}>
                <button type="button" className="w-full text-left" onClick={() => onPick(product)}>
                  <Card className="flex items-center gap-3 py-3 active:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{product.name}</p>
                      <p className="text-sm text-muted">
                        {product.variants.filter((v) => v.active).length} biến thể
                      </p>
                    </div>
                    <span className="text-sm tabular-nums text-muted">
                      Tồn {formatNumber(totalStock(product.variants))}
                    </span>
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
