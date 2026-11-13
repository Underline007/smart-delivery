import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody, StickyBar } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Card, EmptyState } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { useAction } from '@/lib/useAction'
import { applyStocktake, type Product } from './api'
import { ProductPickerSheet } from './ProductPickerSheet'
import { QtyGrid } from './QtyGrid'

export function StocktakePage() {
  const shop = useShop()
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  // Counted quantity per variant; starts at the system quantity.
  const [counted, setCounted] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState(false)

  function addProduct(product: Product) {
    setProducts((all) => (all.some((p) => p.id === product.id) ? all : [...all, product]))
    setCounted((all) => {
      const next = { ...all }
      for (const v of product.variants) if (v.active && !(v.id in next)) next[v.id] = v.stock_qty
      return next
    })
    setPicking(false)
  }

  const variants = products.flatMap((p) => p.variants.filter((v) => v.active))
  const differences = variants.filter((v) => (counted[v.id] ?? v.stock_qty) !== v.stock_qty)

  const save = useAction(
    () =>
      applyStocktake(shop.id, {
        note,
        items: variants.map((v) => ({ variant_id: v.id, counted_qty: counted[v.id] ?? v.stock_qty })),
      }),
    {
      success: 'Đã lưu phiếu kiểm kho',
      invalidate: [['shop', shop.id, 'products'], ['shop', shop.id, 'history']],
      onSuccess: () => navigate('/shop/inventory'),
    },
  )

  return (
    <>
      <PageHeader title="Kiểm kho" back="/shop/inventory" />
      <PageBody className="flex flex-col gap-4 pb-28">
        {products.length === 0 ? (
          <EmptyState title="Chọn sản phẩm cần kiểm" action={<Button onClick={() => setPicking(true)}>Chọn sản phẩm</Button>}>
            Đếm hàng thực tế rồi nhập vào. App tự điều chỉnh phần chênh lệch với tồn kho trong máy.
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
                  values={counted}
                  onChange={(id, value) => setCounted((all) => ({ ...all, [id]: value }))}
                  inputLabel="Số đếm thực tế"
                  hint={(v) => {
                    const diff = (counted[v.id] ?? v.stock_qty) - v.stock_qty
                    return (
                      <span className={cn(diff < 0 && 'text-danger', diff > 0 && 'text-success')}>
                        máy {v.stock_qty}
                        {diff !== 0 && ` (${diff > 0 ? '+' : ''}${diff})`}
                      </span>
                    )
                  }}
                />
              </Card>
            ))}
            <Button variant="secondary" block icon={<Plus className="size-5" />} onClick={() => setPicking(true)}>
              Thêm sản phẩm khác
            </Button>
            <Card>
              <TextField label="Ghi chú (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </Card>
          </>
        )}
      </PageBody>
      {products.length > 0 && (
        <StickyBar>
          <p className="mb-2 text-sm">
            {differences.length === 0
              ? 'Chưa có chênh lệch nào'
              : `${differences.length} biến thể chênh lệch sẽ được điều chỉnh`}
          </p>
          <Button
            block
            loading={save.isPending}
            onClick={() =>
              differences.length === 0
                ? toast.message('Số đếm khớp với tồn kho, không cần điều chỉnh')
                : save.mutate(undefined)
            }
          >
            Lưu phiếu kiểm kho
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
