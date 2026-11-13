import { describe, expect, it } from 'vitest'
import { returnRate, returnWarning } from './stats'

const c = (delivered: number, returned: number) => ({
  order_count: delivered + returned,
  delivered_count: delivered,
  returned_count: returned,
})

describe('returnRate', () => {
  it('is null before any outcome', () => {
    expect(returnRate(c(0, 0))).toBeNull()
  })

  it('divides returns by finished deliveries', () => {
    expect(returnRate(c(3, 1))).toBe(0.25)
    expect(returnRate(c(0, 2))).toBe(1)
  })
})

describe('returnWarning', () => {
  it('warns from 2 returns and 30%', () => {
    expect(returnWarning(c(3, 2))).toBe('2/5 đơn trước bị hoàn')
    expect(returnWarning(c(0, 2))).toBe('2/2 đơn trước bị hoàn')
  })

  it('does not warn on a single return', () => {
    expect(returnWarning(c(0, 1))).toBeNull()
  })

  it('does not warn when returns are a small share', () => {
    expect(returnWarning(c(20, 2))).toBeNull()
  })
})
