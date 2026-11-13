import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useShop } from '@/app/current-shop'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Field'
import { QtyStepper } from '@/components/ui/MoneyInput'
import { Card, LoadingBlock } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { formatMoney, formatNumber } from '@/lib/format'
import { listProducts, type Product, type Variant } from '@/features/products/api'
import { totalStock } from '@/features/products/variants'
import { useDebounced } from '@/lib/useDebounced'

export interface PickedVariant {
  product: Product
  variant: Variant
  qty: number
}

function Chooser({
  product,
  onPick,
  onBack,
}: {
  product: Product
  onPick: (picked: PickedVariant) => void
  onBack: () => void
}) {
  const variants = product.variants.filter((v) => v.active)
  const [selected, setSelected] = useState<string[]>(() => variants[0]?.option_values ?? [])
  const [qty, setQty] = useState(1)

  const optionValues = product.option_names.map((_, i) => [...new Set(variants.map((v) => v.option_values[i]))])
  const match = variants.find((v) => v.option_values.every((value, i) => value === selected[i]))
  // A value is available when some variant has it together with the other current choices.
  const hasStock = (index: number, value: string) =>
    variants.some(
      (v) =>
        v.option_values[index] === value &&
        v.stock_qty > 0 &&
        v.option_values.every((x, i) => i === index || x === selected[i]),
    )

  return (
    <div className="flex flex-col gap-5">
      <div>
        <button type="button" className="text-sm text-primary" onClick={onBack}>
          ← Chọn sản phẩm khác
        </button>
        <h3 className="mt-1 text-lg font-semibold">{product.name}</h3>
      </div>

      {product.option_names.map((optionName, index) => (
        <div key={optionName} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{optionName}</p>
          <div className="flex flex-wrap gap-2">
            {optionValues[index].map((value) => {
              const active = selected[index] === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelected((all) => all.map((x, i) => (i === index ? value : x)))}
                  className={cn(
                    'h-11 min-w-12 rounded-xl border px-4 text-base font-medium',
                    active ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface',
                    !active && !hasStock(index, value) && 'text-muted opacity-50',
                  )}
                >
                  {value}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {match ? (
        <Card className="flex items-center justify-between bg-surface-2">
          <div>
            <p className="font-semibold">{formatMoney(match.price)}</p>
            <p className={cn('text-sm', match.stock_qty <= 0 ? 'text-danger' : 'text-muted')}>
              {match.stock_qty <= 0 ? 'Hết hàng' : `Còn ${formatNumber(match.stock_qty)}`} · {match.sku}
            </p>
          </div>
          <QtyStepper value={qty} min={1} onChange={setQty} label="Số lượng" />
        </Card>
      ) : (
        <p className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">Không có biến thể này.</p>
      )}

      <Button block disabled={!match} onClick={() => match && onPick({ product, variant: match, qty })}>
        Thêm vào đơn
      </Button>
    </div>
  )
}

/** Search a product, pick colour/size with chips, choose quantity. */
export function VariantPickerSheet({
  onPick,
  onClose,
}: {
  onPick: (picked: PickedVariant) => void
  onClose: () => void
}) {
  const shop = useShop()
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState<Product | null>(null)
  const debounced = useDebounced(query.trim())
  const results = useQuery({
    queryKey: ['shop', shop.id, 'products', 'order-picker', debounced],
    queryFn: () => listProducts(shop.id, { query: debounced, limit: 20 }),
    placeholderData: (previous) => previous,
  })

  return (
    <Sheet open onClose={onClose} title={product ? 'Chọn biến thể' : 'Thêm sản phẩm'}>
      {product ? (
        <Chooser product={product} onBack={() => setProduct(null)} onPick={onPick} />
      ) : (
        <div className="flex flex-col gap-3">
          <SearchInput
            autoFocus
            placeholder="Tìm tên, SKU hoặc mã vạch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.isLoading ? (
            <LoadingBlock />
          ) : results.data?.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Không tìm thấy sản phẩm.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.data?.map((p) => (
                <li key={p.id}>
                  <button type="button" className="w-full text-left" onClick={() => setProduct(p)}>
                    <Card className="flex items-center gap-3 py-3 active:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="text-sm text-muted">
                          {formatMoney(Math.min(...p.variants.filter((v) => v.active).map((v) => v.price)))}
                          {p.variants.length > 1 && ' trở lên'}
                        </p>
                      </div>
                      <span className="text-sm tabular-nums text-muted">Tồn {formatNumber(totalStock(p.variants))}</span>
                    </Card>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  )
}
