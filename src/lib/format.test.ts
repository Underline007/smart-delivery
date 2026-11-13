import { describe, expect, it } from 'vitest'
import { formatMoney, formatNumber, formatWeight, parseMoney } from './format'

describe('money', () => {
  it('formats Vietnamese dong with dot separators', () => {
    expect(formatMoney(1250000)).toBe('1.250.000đ')
    expect(formatMoney('150000')).toBe('150.000đ')
    expect(formatMoney(0)).toBe('0đ')
    expect(formatMoney(null)).toBe('0đ')
    expect(formatNumber(2048)).toBe('2.048')
  })

  it('parses typed input', () => {
    expect(parseMoney('1.250.000')).toBe(1250000)
    expect(parseMoney('150')).toBe(150)
    expect(parseMoney('abc')).toBe(0)
    expect(parseMoney('')).toBe(0)
  })
})

describe('formatWeight', () => {
  it('uses grams below one kilogram', () => {
    expect(formatWeight(800)).toBe('800 g')
  })

  it('uses kilograms from 1000 g', () => {
    expect(formatWeight(1000)).toBe('1 kg')
    expect(formatWeight(1250)).toBe('1,25 kg')
  })
})
