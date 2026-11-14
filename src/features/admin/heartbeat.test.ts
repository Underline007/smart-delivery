import { describe, expect, it } from 'vitest'
import { heartbeatStatus } from './heartbeat'

const NOW = new Date('2026-11-14T12:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const HOUR = 3_600_000
const DAY = 24 * HOUR

describe('heartbeatStatus', () => {
  it('is fine for a recent ping', () => {
    expect(heartbeatStatus(ago(10 * 60_000), NOW)).toEqual({ level: 'ok', ago: 'vừa xong' })
    expect(heartbeatStatus(ago(5 * HOUR), NOW)).toEqual({ level: 'ok', ago: '5 giờ trước' })
    expect(heartbeatStatus(ago(35 * HOUR), NOW).level).toBe('ok')
  })

  it('warns when the pingers seem to have stopped', () => {
    expect(heartbeatStatus(ago(37 * HOUR), NOW)).toEqual({ level: 'warning', ago: '1 ngày trước' })
    expect(heartbeatStatus(ago(4 * DAY), NOW)).toEqual({ level: 'warning', ago: '4 ngày trước' })
  })

  it('is urgent once a pause (7 days) is close', () => {
    expect(heartbeatStatus(ago(5 * DAY), NOW)).toEqual({ level: 'danger', ago: '5 ngày trước' })
    expect(heartbeatStatus(ago(9 * DAY), NOW).level).toBe('danger')
  })

  it('treats a time slightly in the future (clock skew) as "just now"', () => {
    expect(heartbeatStatus(ago(-30_000), NOW)).toEqual({ level: 'ok', ago: 'vừa xong' })
  })
})
