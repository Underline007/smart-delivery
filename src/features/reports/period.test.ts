import { describe, expect, it } from 'vitest'
import { dayKey, fillDays, periodRange, returnPercent } from './period'

// 2026-11-13 03:00 UTC is 10:00 on the same day in Vietnam.
const NOW = new Date('2026-11-13T03:00:00Z')

describe('dayKey', () => {
  it('uses Vietnam time, not UTC', () => {
    expect(dayKey(new Date('2026-11-12T20:00:00Z'))).toBe('2026-11-13') // 03:00 next day in VN
    expect(dayKey(new Date('2026-11-12T16:00:00Z'))).toBe('2026-11-12') // 23:00 in VN
  })
})

describe('periodRange', () => {
  it('builds each period', () => {
    expect(periodRange('today', NOW)).toEqual({ from: '2026-11-13', to: '2026-11-13' })
    expect(periodRange('7d', NOW)).toEqual({ from: '2026-11-07', to: '2026-11-13' })
    expect(periodRange('30d', NOW)).toEqual({ from: '2026-10-15', to: '2026-11-13' })
    expect(periodRange('month', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-13' })
    expect(periodRange('last_month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('handles the start of a year and short months', () => {
    expect(periodRange('last_month', new Date('2027-01-10T03:00:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(periodRange('last_month', new Date('2026-03-05T03:00:00Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodRange('7d', new Date('2026-01-03T03:00:00Z'))).toEqual({ from: '2025-12-28', to: '2026-01-03' })
  })
})

describe('fillDays', () => {
  it('adds zero days between known days', () => {
    const rows = fillDays('2026-11-10', '2026-11-13', [{ day: '2026-11-11', orders: 2, revenue: 500 }])
    expect(rows).toEqual([
      { day: '2026-11-10', orders: 0, revenue: 0 },
      { day: '2026-11-11', orders: 2, revenue: 500 },
      { day: '2026-11-12', orders: 0, revenue: 0 },
      { day: '2026-11-13', orders: 0, revenue: 0 },
    ])
  })

  it('works for a single day', () => {
    expect(fillDays('2026-11-13', '2026-11-13', [])).toEqual([{ day: '2026-11-13', orders: 0, revenue: 0 }])
  })
})

describe('returnPercent', () => {
  it('is null without outcomes and rounds otherwise', () => {
    expect(returnPercent(0, 0)).toBeNull()
    expect(returnPercent(8, 2)).toBe(20)
    expect(returnPercent(2, 1)).toBe(33)
  })
})
