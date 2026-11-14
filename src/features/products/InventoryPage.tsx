import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronDown, ClipboardCheck, History, PackagePlus, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Field'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { productImageUrl } from '@/lib/image-url'
import { formatMoney, formatNumber } from '@/lib/format'
import { useDebounced } from '@/lib/useDebounced'
import { listProducts, PAGE_SIZE, type Product, type ProductFilter } from './api'
import { isLowStock, totalStock } from './variants'

const FILTERS: { value: ProductFilter; label: string }[] = [
  { value: 'active', label: 'Đang bán' },
  { value: 'low', label: 'Sắp hết hàng' },
  { value: 'inactive', label: 'Ngừng bán' },
]

function ProductCard({ product }: { product: Product }) {
  const [open, setOpen] = useState(false)
  const activeVariants = product.variants.filter((v) => v.active)
  const total = totalStock(product.variants)
  const lowCount = activeVariants.filter(isLowStock).length
  const hasOptions = product.option_names.length > 0

  return (
    <Card className="p-0">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-4 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {product.image_path && <img src={productImageUrl(product.image_path) ?? undefined} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg border border-border object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{product.name}</p>
            {!product.active && <Badge tone="neutral">Ngừng bán</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {hasOptions ? `${activeVariants.length} biến thể` : activeVariants[0]?.sku}
            {product.category && ` · ${product.category}`}
          </p>
        </div>
        <div className="text-right">
          <p className={cn('text-lg font-bold tabular-nums', total <= 0 && 'text-danger')}>
            {formatNumber(total)}
          </p>
          <p className="text-xs text-muted">{product.unit}</p>
        </div>
        {lowCount > 0 && <Badge tone="warning">Sắp hết</Badge>}
        <ChevronDown className={cn('size-5 shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-border">
          <ul>
            {product.variants.map((variant) => (
              <li
                key={variant.id}
                className={cn(
                  'flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0',
                  !variant.active && 'opacity-50',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{variant.variant_label || 'Mặc định'}</p>
                  <p className="text-xs text-muted">
                    {variant.sku} · {formatMoney(variant.price)}
                  </p>
                </div>
                <Link
                  to={`/shop/inventory/stock-card/${variant.id}`}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-right tabular-nums active:bg-surface-2',
                    isLowStock(variant) || variant.stock_qty <= 0 ? 'text-danger' : '',
                  )}
                  aria-label={`Thẻ kho ${variant.variant_label || variant.sku}`}
                >
                  <span className="font-semibold">{formatNumber(variant.stock_qty)}</span>
                  <span className="block text-xs text-muted">thẻ kho</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 border-t border-border p-3">
            <Link
              to={`/shop/inventory/products/${product.id}`}
              className="flex h-10 flex-1 items-center justify-center rounded-xl border border-border text-sm font-semibold active:bg-surface-2"
            >
              Sửa sản phẩm
            </Link>
            <Link
              to={`/shop/inventory/receipts/new?product=${product.id}`}
              className="flex h-10 flex-1 items-center justify-center rounded-xl bg-primary-soft text-sm font-semibold text-primary active:opacity-80"
            >
              Nhập kho
            </Link>
          </div>
        </div>
      )}
    </Card>
  )
}

export function InventoryPage() {
  const shop = useShop()
  const [query, setQuery] = useState('')
  const [params] = useSearchParams()
  const initialFilter = FILTERS.some((f) => f.value === params.get('filter')) ? (params.get('filter') as ProductFilter) : 'active'
  const [filter, setFilter] = useState<ProductFilter>(initialFilter)
  const debounced = useDebounced(query.trim())

  const products = useInfiniteQuery({
    queryKey: ['shop', shop.id, 'products', debounced, filter],
    queryFn: ({ pageParam }) =>
      listProducts(shop.id, { query: debounced, filter, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE_SIZE ? all.flat().length : undefined),
  })
  const rows = products.data?.pages.flat() ?? []

  return (
    <>
      <PageHeader
        title="Kho"
        subtitle={shop.name}
        actions={
          <Link
            to="/shop/inventory/history"
            aria-label="Lịch sử nhập kho và kiểm kho"
            className="flex size-11 items-center justify-center rounded-full active:bg-surface-2"
          >
            <History className="size-6" />
          </Link>
        }
      />
      <PageBody className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          <Link to="/shop/inventory/products/new" className="contents">
            <Button block size="sm" icon={<Plus className="size-4" />}>
              Sản phẩm
            </Button>
          </Link>
          <Link to="/shop/inventory/receipts/new" className="contents">
            <Button block size="sm" variant="secondary" icon={<PackagePlus className="size-4" />}>
              Nhập kho
            </Button>
          </Link>
          <Link to="/shop/inventory/stocktake" className="contents">
            <Button block size="sm" variant="secondary" icon={<ClipboardCheck className="size-4" />}>
              Kiểm kho
            </Button>
          </Link>
        </div>

        <SearchInput
          placeholder="Tìm tên, SKU hoặc mã vạch"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={cn(
                'h-9 shrink-0 rounded-full border px-4 text-sm font-medium',
                filter === option.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-surface',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {products.isLoading ? (
          <LoadingBlock />
        ) : products.error ? (
          <ErrorBlock message="Không tải được danh sách sản phẩm" onRetry={() => products.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={debounced || filter !== 'active' ? 'Không có sản phẩm phù hợp' : 'Chưa có sản phẩm nào'}>
            {debounced || filter !== 'active'
              ? 'Thử đổi từ khoá hoặc bộ lọc.'
              : 'Bấm “Sản phẩm” để thêm sản phẩm đầu tiên.'}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
            {products.hasNextPage && (
              <Button
                variant="secondary"
                block
                loading={products.isFetchingNextPage}
                onClick={() => products.fetchNextPage()}
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
