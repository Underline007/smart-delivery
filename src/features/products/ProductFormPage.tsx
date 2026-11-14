import { useQuery } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody, StickyBar } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { ImageUpload } from '@/components/ui/ImageUpload'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Badge, Card, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { cn } from '@/lib/cn'
import { useAction } from '@/lib/useAction'
import { fetchProduct, saveProduct, type Product, type VariantInput } from './api'
import { cartesian, comboKey, parseValues, suggestSku } from './variants'

interface VariantForm {
  sku: string
  price: number
  cost: number
  weight_g: number
  barcode: string
  low_stock_threshold: number
  active: boolean
}

const EMPTY_VARIANT: VariantForm = {
  sku: '',
  price: 0,
  cost: 0,
  weight_g: 0,
  barcode: '',
  low_stock_threshold: 0,
  active: true,
}

function initialOptionValues(product: Product | null): string[][] {
  if (!product) return []
  return product.option_names.map((_, i) => {
    const seen: string[] = []
    for (const variant of product.variants) {
      const value = variant.option_values[i]
      if (value && !seen.includes(value)) seen.push(value)
    }
    return seen
  })
}

function initialVariants(product: Product | null): Record<string, VariantForm> {
  const result: Record<string, VariantForm> = {}
  for (const v of product?.variants ?? []) {
    result[comboKey(v.option_values)] = {
      sku: v.sku,
      price: v.price,
      cost: v.cost,
      weight_g: v.weight_g,
      barcode: v.barcode ?? '',
      low_stock_threshold: v.low_stock_threshold,
      active: v.active,
    }
  }
  return result
}

function OptionEditor({
  name,
  values,
  onName,
  onValues,
  onRemove,
}: {
  name: string
  values: string[]
  onName: (name: string) => void
  onValues: (values: string[]) => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState('')

  function add() {
    const added = parseValues(draft, values)
    if (added.length > 0) onValues([...values, ...added])
    setDraft('')
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label="Tên thuộc tính"
            placeholder="Ví dụ: Màu, Size"
            value={name}
            onChange={(e) => onName(e.target.value)}
            maxLength={30}
          />
        </div>
        <Button variant="ghost" size="icon" aria-label="Xoá thuộc tính" onClick={onRemove} icon={<X className="size-5" />} />
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-3 text-sm font-medium text-primary"
          >
            {value}
            <button
              type="button"
              aria-label={`Xoá ${value}`}
              className="flex size-6 items-center justify-center rounded-full active:bg-primary/20"
              onClick={() => onValues(values.filter((v) => v !== value))}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          aria-label={`Thêm giá trị cho ${name || 'thuộc tính'}`}
          placeholder="Thêm giá trị (có thể dán: Đỏ, Xanh, Trắng)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
        />
        <Button size="sm" variant="secondary" onClick={add} disabled={!draft.trim()}>
          Thêm
        </Button>
      </div>
    </Card>
  )
}

function ProductForm({ shopId, product }: { shopId: string; product: Product | null }) {
  const navigate = useNavigate()
  const [name, setName] = useState(product?.name ?? '')
  const [category, setCategory] = useState(product?.category ?? '')
  const [unit, setUnit] = useState(product?.unit ?? 'cái')
  const [description, setDescription] = useState(product?.description ?? '')
  const [active, setActive] = useState(product?.active ?? true)
  const [imagePath, setImagePath] = useState<string | null>(product?.image_path ?? null)
  const [optionNames, setOptionNames] = useState<string[]>(product?.option_names ?? [])
  const [optionValues, setOptionValues] = useState<string[][]>(() => initialOptionValues(product))
  const [variants, setVariants] = useState<Record<string, VariantForm>>(() => initialVariants(product))
  const [bulk, setBulk] = useState({ price: 0, cost: 0, weight_g: 0 })
  const [errors, setErrors] = useState<string[]>([])

  const existingIds = useMemo(() => {
    const ids: Record<string, string> = {}
    for (const v of product?.variants ?? []) ids[comboKey(v.option_values)] = v.id
    return ids
  }, [product])

  const combos = useMemo(() => cartesian(optionValues), [optionValues])
  const hasOptions = optionNames.length > 0
  const keySet = new Set(combos.map(comboKey))
  const droppedCount = Object.keys(existingIds).filter((key) => !keySet.has(key)).length

  const get = (key: string): VariantForm => variants[key] ?? EMPTY_VARIANT
  const patchVariant = (key: string, patch: Partial<VariantForm>) =>
    setVariants((all) => ({ ...all, [key]: { ...(all[key] ?? EMPTY_VARIANT), ...patch } }))

  const save = useAction(
    (payload: Parameters<typeof saveProduct>[1]) => saveProduct(shopId, payload),
    {
      success: 'Đã lưu sản phẩm',
      invalidate: [['shop', shopId, 'products']],
      onSuccess: () => navigate('/shop/inventory'),
    },
  )

  function buildVariants(): VariantInput[] {
    return combos.map((values) => {
      const key = comboKey(values)
      const form = get(key)
      return {
        id: existingIds[key],
        sku: form.sku.trim() || suggestSku(name, values),
        option_values: values,
        price: form.price,
        cost: form.cost,
        weight_g: form.weight_g,
        barcode: form.barcode.trim() || null,
        low_stock_threshold: form.low_stock_threshold,
        active: form.active,
      }
    })
  }

  function onSave() {
    const problems: string[] = []
    if (!name.trim()) problems.push('Nhập tên sản phẩm')
    if (hasOptions && optionNames.some((n) => !n.trim())) problems.push('Đặt tên cho mọi thuộc tính')
    if (hasOptions && optionValues.some((v) => v.length === 0)) {
      problems.push('Mỗi thuộc tính cần ít nhất một giá trị')
    }
    const built = buildVariants()
    const skus = built.map((v) => v.sku.toLowerCase())
    if (new Set(skus).size !== skus.length) problems.push('Mã SKU bị trùng giữa các biến thể')
    if (built.some((v) => v.active && v.weight_g <= 0)) {
      problems.push('Nhập khối lượng (gram) cho mọi biến thể, ViettelPost bắt buộc có')
    }
    setErrors(problems)
    if (problems.length > 0) {
      toast.error(problems[0])
      return
    }
    save.mutate({
      id: product?.id,
      name: name.trim(),
      category: category.trim(),
      unit: unit.trim() || 'cái',
      description: description.trim(),
      image_path: imagePath,
      active,
      option_names: optionNames.map((n) => n.trim()),
      variants: built,
    })
  }

  function applyBulk() {
    setVariants((all) => {
      const next = { ...all }
      for (const values of combos) {
        const key = comboKey(values)
        next[key] = {
          ...(next[key] ?? EMPTY_VARIANT),
          ...(bulk.price > 0 && { price: bulk.price }),
          ...(bulk.cost > 0 && { cost: bulk.cost }),
          ...(bulk.weight_g > 0 && { weight_g: bulk.weight_g }),
        }
      }
      return next
    })
    toast.success('Đã áp dụng cho tất cả biến thể')
  }

  return (
    <>
      <PageBody className="flex flex-col gap-5 pb-28">
        <section>
          <SectionTitle>Thông tin chung</SectionTitle>
          <Card className="flex flex-col gap-4">
            <ImageUpload shopId={shopId} value={imagePath} onChange={setImagePath} />
            <TextField label="Tên sản phẩm" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Nhóm" placeholder="Ví dụ: Áo" value={category} onChange={(e) => setCategory(e.target.value)} />
              <TextField label="Đơn vị" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="product-description" className="text-sm font-medium">
                Mô tả (tuỳ chọn)
              </label>
              <textarea
                id="product-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface p-3.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
            </div>
            {product && (
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--primary)]"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                Đang bán sản phẩm này
              </label>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle
            action={
              optionNames.length < 3 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus className="size-4" />}
                  onClick={() => {
                    setOptionNames((n) => [...n, optionNames.length === 0 ? 'Màu' : optionNames.length === 1 ? 'Size' : ''])
                    setOptionValues((v) => [...v, []])
                  }}
                >
                  Thêm thuộc tính
                </Button>
              ) : undefined
            }
          >
            Thuộc tính (màu, size…)
          </SectionTitle>
          {!hasOptions ? (
            <p className="px-1 text-sm text-muted">
              Sản phẩm không có màu/size thì bỏ qua mục này. Tối đa 3 thuộc tính.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {optionNames.map((optionName, i) => (
                <OptionEditor
                  key={i}
                  name={optionName}
                  values={optionValues[i] ?? []}
                  onName={(v) => setOptionNames((all) => all.map((n, j) => (j === i ? v : n)))}
                  onValues={(v) => setOptionValues((all) => all.map((x, j) => (j === i ? v : x)))}
                  onRemove={() => {
                    setOptionNames((all) => all.filter((_, j) => j !== i))
                    setOptionValues((all) => all.filter((_, j) => j !== i))
                  }}
                />
              ))}
              {product && droppedCount > 0 && (
                <p className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
                  {droppedCount} biến thể hiện có không còn trong danh sách này và sẽ chuyển sang
                  “ngừng bán” khi lưu. Tồn kho cũ vẫn được giữ trong thẻ kho.
                </p>
              )}
            </div>
          )}
        </section>

        <section>
          <SectionTitle>{hasOptions ? `Biến thể (${combos.length})` : 'Giá và kho'}</SectionTitle>
          {combos.length === 0 ? (
            <p className="px-1 text-sm text-muted">Thêm giá trị cho các thuộc tính để tạo biến thể.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {combos.length > 1 && (
                <Card className="flex flex-col gap-3 bg-surface-2">
                  <p className="text-sm font-medium">Áp dụng cho tất cả biến thể</p>
                  <div className="grid grid-cols-3 gap-2">
                    <MoneyInput label="Giá bán" value={bulk.price} onChange={(v) => setBulk((b) => ({ ...b, price: v }))} suffix="" />
                    <MoneyInput label="Giá vốn" value={bulk.cost} onChange={(v) => setBulk((b) => ({ ...b, cost: v }))} suffix="" />
                    <MoneyInput label="KL (g)" value={bulk.weight_g} onChange={(v) => setBulk((b) => ({ ...b, weight_g: v }))} suffix="" />
                  </div>
                  <Button size="sm" variant="secondary" onClick={applyBulk} disabled={!bulk.price && !bulk.cost && !bulk.weight_g}>
                    Áp dụng
                  </Button>
                </Card>
              )}

              {combos.map((values) => {
                const key = comboKey(values)
                const form = get(key)
                const sku = form.sku || suggestSku(name, values)
                return (
                  <Card key={key} className={cn('flex flex-col gap-3', !form.active && 'opacity-60')}>
                    <div className="flex items-center gap-2">
                      <p className="flex-1 font-semibold">{values.join(' / ') || 'Sản phẩm'}</p>
                      {existingIds[key] ? null : product && <Badge tone="primary">Mới</Badge>}
                    </div>
                    <TextField
                      label="Mã SKU"
                      value={form.sku}
                      placeholder={sku}
                      onChange={(e) => patchVariant(key, { sku: e.target.value })}
                      maxLength={50}
                      autoCapitalize="characters"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <MoneyInput label="Giá bán" value={form.price} onChange={(v) => patchVariant(key, { price: v })} />
                      <MoneyInput label="Giá vốn" value={form.cost} onChange={(v) => patchVariant(key, { cost: v })} />
                      <MoneyInput label="Khối lượng" suffix="g" value={form.weight_g} onChange={(v) => patchVariant(key, { weight_g: v })} />
                      <MoneyInput
                        label="Cảnh báo khi còn ≤"
                        suffix=""
                        value={form.low_stock_threshold}
                        onChange={(v) => patchVariant(key, { low_stock_threshold: v })}
                      />
                    </div>
                    <TextField
                      label="Mã vạch (tuỳ chọn)"
                      inputMode="numeric"
                      value={form.barcode}
                      onChange={(e) => patchVariant(key, { barcode: e.target.value })}
                      maxLength={50}
                    />
                    {product && (
                      <label className="flex min-h-11 items-center gap-3">
                        <input
                          type="checkbox"
                          className="size-5 accent-[var(--primary)]"
                          checked={form.active}
                          onChange={(e) => patchVariant(key, { active: e.target.checked })}
                        />
                        Đang bán biến thể này
                      </label>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        {errors.length > 0 && (
          <ul role="alert" className="list-disc rounded-xl bg-danger-soft py-3 pr-3.5 pl-8 text-sm text-danger">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </PageBody>
      <StickyBar>
        <Button block loading={save.isPending} onClick={onSave}>
          Lưu sản phẩm
        </Button>
      </StickyBar>
    </>
  )
}

export function ProductFormPage() {
  const { productId } = useParams()
  const shop = useShop()
  const product = useQuery({
    queryKey: ['shop', shop.id, 'product', productId],
    queryFn: () => fetchProduct(productId!),
    enabled: Boolean(productId),
  })

  return (
    <>
      <PageHeader title={productId ? 'Sửa sản phẩm' : 'Thêm sản phẩm'} back="/shop/inventory" />
      {productId && product.isLoading ? (
        <LoadingBlock />
      ) : productId && (product.error || !product.data) ? (
        <ErrorBlock message="Không tìm thấy sản phẩm" onRetry={() => product.refetch()} />
      ) : (
        <ProductForm key={product.data?.id ?? 'new'} shopId={shop.id} product={product.data ?? null} />
      )}
    </>
  )
}
