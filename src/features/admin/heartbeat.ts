export type HeartbeatLevel = 'ok' | 'warning' | 'danger'

export interface HeartbeatStatus {
  level: HeartbeatLevel
  /** "2 giờ trước", "3 ngày trước" */
  ago: string
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * How healthy the keep-alive pings look. Supabase's free plan pauses a project after about
 * 7 days without activity, so the thresholds leave time to react:
 * under 36 h = fine, under 5 days = pingers are failing, 5 days or more = pause is near.
 */
export function heartbeatStatus(lastPing: string, now = Date.now()): HeartbeatStatus {
  const age = Math.max(now - new Date(lastPing).getTime(), 0)
  const level: HeartbeatLevel = age < 36 * HOUR ? 'ok' : age < 5 * DAY ? 'warning' : 'danger'
  const ago =
    age < HOUR
      ? 'vừa xong'
      : age < DAY
        ? `${Math.floor(age / HOUR)} giờ trước`
        : `${Math.floor(age / DAY)} ngày trước`
  return { level, ago }
}
