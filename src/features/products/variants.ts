import { searchKey, slugUpper } from '@/lib/vn/text'

/** Separator that cannot appear in typed option values. */
const SEP = '\u0001'

/** ['Đỏ','M'] → one stable string key. */
export function comboKey(values: string[]): string {
  return values.join(SEP)
}

/** [[Đỏ, Xanh], [S, M]] → [[Đỏ,S],[Đỏ,M],[Xanh,S],[Xanh,M]]. No options → one empty combination. */
export function cartesian(valuesPerOption: string[][]): string[][] {
  if (valuesPerOption.length === 0) return [[]]
  return valuesPerOption.reduce<string[][]>(
    (combos, values) => combos.flatMap((combo) => values.map((value) => [...combo, value])),
    [[]],
  )
}

/** Splits "Đỏ, Xanh; Trắng" into clean unique values, case-insensitive on the accent-free form. */
export function parseValues(input: string, existing: string[] = []): string[] {
  const seen = new Set(existing.map(searchKey))
  const added: string[] = []
  for (const raw of input.split(/[,;\n]/)) {
    const value = raw.trim().replace(/\s+/g, ' ')
    const key = searchKey(value)
    if (value && !seen.has(key)) {
      seen.add(key)
      added.push(value)
    }
  }
  return added
}

/** "Áo thun basic" + [Đỏ, M] → "ATB-DO-M" (initials of the name, then the values). */
export function suggestSku(productName: string, values: string[]): string {
  const initials = searchKey(productName)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 4)
  return [initials || 'SP', ...values.map(slugUpper).filter(Boolean)].join('-').slice(0, 50)
}

/** Total stock of a product's active variants. */
export function totalStock(variants: { stock_qty: number; active: boolean }[]): number {
  return variants.filter((v) => v.active).reduce((sum, v) => sum + v.stock_qty, 0)
}

/** A variant is "low" when it has a threshold and the stock fell to or below it. */
export function isLowStock(variant: {
  stock_qty: number
  low_stock_threshold: number
  active: boolean
}): boolean {
  return variant.active && variant.low_stock_threshold > 0 && variant.stock_qty <= variant.low_stock_threshold
}
