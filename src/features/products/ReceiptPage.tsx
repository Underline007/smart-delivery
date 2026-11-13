import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody, StickyBar } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Card, EmptyState, SectionTitle } from '@/components/ui/misc'
import { formatMoney, formatNumber } from '@/lib/format'
import { useAction } from '@/lib/useAction'
import { fetchProduct, receiveStock, type Product, type StockLine } from './api'
import { ProductPickerSheet } from './ProductPickerSheet'
import { QtyGrid } from './QtyGrid'

function defaultCost(product: Product): number {
  return product.variants.find((v) => v.active && v.cost > 0)?.cost ?? 0
}

export function ReceiptPage() {
  const shop = useShop()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preselect = params.get('product')

  const [products, setProducts] = useState<Product[]>([])
  const [qty, setQty] = useState<Record<string, number>>({})
  const [costs, setCosts] = useState<Record<string, number>>({})
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState(false)
  const [preselected, setPreselected] = useState(false)

  const preselectedProduct = useQuery({
    queryKey: ['shop', shop.id, 'product', preselect],
    queryFn: () => fetchProduct(preselect!),
    enabled: Boolean(preselect) && !preselected,
  })

  function addProduct(product: Product) {
    setProducts((all) => (all.some((p) => p.id === product.id) ? all : [...all, product]))
    setCosts((all) => ({ ...all, [product.id]: all[product.id] ?? defaultCost(product) }))
    setPicking(false)
  }

  // Add the product from ?product=... exactly once, as soon as it has loaded.
  if (preselectedProduct.data && !preselected) {
    setPreselected(true)
    addProduct(preselectedProduct.data)
  }

  const items: StockLine[] = products.flatMap((product) =>
    product.variants
      .filter((v) => v.active && (qty[v.id] ?? 0) > 0)
      .map((v) => ({ variant_id: v.id, qty: qty[v.id], unit_cost: costs[product.id] ?? 0 })),
  )
  const totalQty = items.reduce((sum, i) => sum + i.qty, 0)
  const totalCost = items.reduce((sum, i) => sum + i.qty * i.unit_cost, 0)

  const save = useAction(() => receiveStock(shop.id, { supplier, note, items }), {
    success: 'Đã lưu phiếu nhập kho',
    invalidate: [['shop', shop.id, 'products'], ['shop', shop.id, 'history']],
    onSuccess: () => navigate('/shop/inventory'),
  })

  return (
    <>
      <PageHeader title="Nhập kho" back="/shop/inventory" />
      <PageBody className="flex flex-col gap-4 pb-28">
        {products.length === 0 ? (
          <EmptyState title="Chọn sản phẩm cần nhập" action={<Button onClick={() => setPicking(true)}>Chọn sản phẩm</Button>}>
            Nhập số lượng theo từng màu, size rồi lưu một lần.
          </EmptyState>
        ) : (
          <>
            {products.map((product) => (
              <Card key={product.id} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{product.name}</h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Bỏ ${product.name}`}
                    icon={<Trash2 className="size-5" />}
                    onClick={() => setProducts((all) => all.filter((p) => p.id !== product.id))}
                  />
                </div>
                <QtyGrid
                  product={product}
                  values={qty}
                  onChange={(id, value) => setQty((all) => ({ ...all, [id]: value }))}
                  inputLabel="Số lượng nhập"
                  hint={(v) => `tồn ${formatNumber(v.stock_qty)}`}
                />
                <MoneyInput
                  label="Giá nhập mỗi cái (áp cho cả sản phẩm)"
                  value={costs[product.id] ?? 0}
                  onChange={(v) => setCosts((all) => ({ ...all, [product.id]: v }))}
                />
              </Card>
            ))}
            <Button variant="secondary" block icon={<Plus className="size-5" />} onClick={() => setPicking(true)}>
              Thêm sản phẩm khác
            </Button>

            <section>
              <SectionTitle>Thông tin phiếu</SectionTitle>
              <Card className="flex flex-col gap-4">
                <TextField label="Nhà cung cấp (tuỳ chọn)" value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={200} />
                <TextField label="Ghi chú (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
              </Card>
            </section>
          </>
        )}
      </PageBody>
      {products.length > 0 && (
        <StickyBar>
          <div className="mb-2 flex justify-between text-sm">
            <span>
              Tổng <strong className="tabular-nums">{formatNumber(totalQty)}</strong> cái
            </span>
            <strong className="tabular-nums">{formatMoney(totalCost)}</strong>
          </div>
          <Button
            block
            loading={save.isPending}
            onClick={() => (items.length === 0 ? toast.error('Nhập số lượng cho ít nhất một biến thể') : save.mutate(undefined))}
          >
            Lưu phiếu nhập
          </Button>
        </StickyBar>
      )}
      {picking && (
        <ProductPickerSheet
          onPick={addProduct}
          onClose={() => setPicking(false)}
          excludeIds={products.map((p) => p.id)}
        />
      )}
    </>
  )
}
