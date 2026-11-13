import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { parseMoney } from '@/lib/format'
import type { Product, Variant } from './api'

interface QtyGridProps {
  product: Product
  values: Record<string, number>
  onChange: (variantId: string, qty: number) => void
  /** Small text under each input, e.g. the current stock. */
  hint?: (variant: Variant) => ReactNode
  inputLabel: string
}

function CellInput({
  variant,
  value,
  onChange,
  hint,
  label,
}: {
  variant: Variant
  value: number
  onChange: (qty: number) => void
  hint?: (variant: Variant) => ReactNode
  label: string
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <input
        aria-label={`${label} ${variant.variant_label || variant.sku}`}
        inputMode="numeric"
        value={value === 0 ? '' : String(value)}
        placeholder="0"
        onChange={(e) => onChange(parseMoney(e.target.value))}
        onFocus={(e) => e.target.select()}
        className="h-11 w-full min-w-14 rounded-lg border border-border bg-surface px-1 text-center tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
      />
      {hint && <span className="text-[11px] text-muted">{hint(variant)}</span>}
    </div>
  )
}

/**
 * Quantity entry for all variants of one product.
 * Two options (e.g. colour × size) → a table; otherwise a simple list.
 */
export function QtyGrid({ product, values, onChange, hint, inputLabel }: QtyGridProps) {
  const variants = product.variants.filter((v) => v.active)

  if (product.option_names.length === 2) {
    const rows: string[] = []
    const cols: string[] = []
    for (const v of variants) {
      if (!rows.includes(v.option_values[0])) rows.push(v.option_values[0])
      if (!cols.includes(v.option_values[1])) cols.push(v.option_values[1])
    }
    const byKey = new Map(variants.map((v) => [`${v.option_values[0]}\u0001${v.option_values[1]}`, v]))

    return (
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-separate border-spacing-1.5 text-sm">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-muted">
                {product.option_names[0]} \ {product.option_names[1]}
              </th>
              {cols.map((col) => (
                <th key={col} className="px-1 text-center font-semibold">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th scope="row" className="pr-2 text-left font-semibold whitespace-nowrap">
                  {row}
                </th>
                {cols.map((col) => {
                  const variant = byKey.get(`${row}\u0001${col}`)
                  return (
                    <td key={col} className="align-top">
                      {variant ? (
                        <CellInput
                          variant={variant}
                          value={values[variant.id] ?? 0}
                          onChange={(qty) => onChange(variant.id, qty)}
                          hint={hint}
                          label={inputLabel}
                        />
                      ) : (
                        <div className="py-3 text-center text-muted">–</div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {variants.map((variant) => (
        <li key={variant.id} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className={cn('truncate font-medium', !variant.variant_label && 'text-muted')}>
              {variant.variant_label || 'Mặc định'}
            </p>
            <p className="text-xs text-muted">{variant.sku}</p>
          </div>
          <div className="w-24">
            <CellInput
              variant={variant}
              value={values[variant.id] ?? 0}
              onChange={(qty) => onChange(variant.id, qty)}
              hint={hint}
              label={inputLabel}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
