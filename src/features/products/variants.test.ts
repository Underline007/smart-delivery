import { describe, expect, it } from 'vitest'
import { cartesian, comboKey, isLowStock, parseValues, suggestSku, totalStock } from './variants'

describe('cartesian', () => {
  it('builds every combination in order', () => {
    expect(
      cartesian([
        ['Đỏ', 'Xanh'],
        ['S', 'M'],
      ]),
    ).toEqual([
      ['Đỏ', 'S'],
      ['Đỏ', 'M'],
      ['Xanh', 'S'],
      ['Xanh', 'M'],
    ])
  })

  it('returns one empty combination when there are no options', () => {
    expect(cartesian([])).toEqual([[]])
  })

  it('returns nothing when an option has no values yet', () => {
    expect(cartesian([['Đỏ'], []])).toEqual([])
  })

  it('handles three options', () => {
    expect(cartesian([['a', 'b'], ['1', '2'], ['x', 'y']])).toHaveLength(8)
  })
})

describe('comboKey', () => {
  it('does not confuse different splits', () => {
    expect(comboKey(['a b', 'c'])).not.toBe(comboKey(['a', 'b c']))
  })
})

describe('parseValues', () => {
  it('splits on commas and semicolons and trims', () => {
    expect(parseValues(' Đỏ, Xanh ;Trắng ')).toEqual(['Đỏ', 'Xanh', 'Trắng'])
  })

  it('drops duplicates, ignoring case and accents', () => {
    expect(parseValues('do, Đỏ, DO', [])).toEqual(['do'])
    expect(parseValues('Đỏ, Xanh', ['do'])).toEqual(['Xanh'])
  })

  it('ignores empty input', () => {
    expect(parseValues(' , ;')).toEqual([])
  })
})

describe('suggestSku', () => {
  it('uses initials of the name plus the values', () => {
    expect(suggestSku('Áo thun basic', ['Đỏ', 'M'])).toBe('ATB-DO-M')
  })

  it('works without options', () => {
    expect(suggestSku('Nón lưỡi trai', [])).toBe('NLT')
  })

  it('falls back for an empty name', () => {
    expect(suggestSku('', ['M'])).toBe('SP-M')
  })

  it('stays within the SKU length limit', () => {
    expect(suggestSku('x', ['a'.repeat(80)]).length).toBeLessThanOrEqual(50)
  })
})

describe('stock helpers', () => {
  it('sums only active variants', () => {
    expect(
      totalStock([
        { stock_qty: 5, active: true },
        { stock_qty: 7, active: false },
        { stock_qty: 2, active: true },
      ]),
    ).toBe(7)
  })

  it('flags low stock only when a threshold is set', () => {
    const base = { active: true, low_stock_threshold: 3 }
    expect(isLowStock({ ...base, stock_qty: 3 })).toBe(true)
    expect(isLowStock({ ...base, stock_qty: 4 })).toBe(false)
    expect(isLowStock({ ...base, low_stock_threshold: 0, stock_qty: 0 })).toBe(false)
    expect(isLowStock({ ...base, active: false, stock_qty: 0 })).toBe(false)
  })
})
