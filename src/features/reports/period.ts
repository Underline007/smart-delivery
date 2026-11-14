/** YYYY-MM-DD of a date in Vietnam time. */
export function dayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date)
}

export type PeriodId = 'today' | '7d' | '30d' | 'month' | 'last_month'

export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'today', label: 'Hôm nay' },
  { id: '7d', label: '7 ngày' },
  { id: '30d', label: '30 ngày' },
  { id: 'month', label: 'Tháng này' },
  { id: 'last_month', label: 'Tháng trước' },
]

/** Inclusive date range for a period, relative to `now`. */
export function periodRange(id: PeriodId, now = new Date()): { from: string; to: string } {
  const today = dayKey(now)
  const [y, m, d] = today.split('-').map(Number)
  const shift = (days: number) => dayKey(new Date(Date.UTC(y, m - 1, d - days, 12)))
  switch (id) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: shift(6), to: today }
    case '30d':
      return { from: shift(29), to: today }
    case 'month':
      return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: today }
    case 'last_month': {
      const first = new Date(Date.UTC(y, m - 2, 1, 12))
      const last = new Date(Date.UTC(y, m - 1, 0, 12))
      return { from: dayKey(first), to: dayKey(last) }
    }
  }
}

/** Fills days without sales with zero so a chart shows the whole range. */
export function fillDays(
  from: string,
  to: string,
  rows: { day: string; orders: number; revenue: number }[],
): { day: string; orders: number; revenue: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r]))
  const out: { day: string; orders: number; revenue: number }[] = []
  const [fy, fm, fd] = from.split('-').map(Number)
  for (let i = 0; i < 400; i++) {
    const day = dayKey(new Date(Date.UTC(fy, fm - 1, fd + i, 12)))
    out.push(byDay.get(day) ?? { day, orders: 0, revenue: 0 })
    if (day === to) break
  }
  return out
}

/** Share of finished deliveries that came back, as a whole percentage. */
export function returnPercent(delivered: number, returned: number): number | null {
  const finished = delivered + returned
  return finished === 0 ? null : Math.round((returned / finished) * 100)
}
