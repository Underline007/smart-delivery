import { formatMoney } from '@/lib/format'

/** Simple bar chart in SVG; one bar per item. The values are also listed for screen readers. */
export function BarChart({
  data,
  height = 140,
  format = formatMoney,
}: {
  data: { label: string; value: number }[]
  height?: number
  format?: (value: number) => string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const barWidth = 100 / Math.max(data.length, 1)
  const step = Math.max(Math.ceil(data.length / 7), 1)
  const summary = data.map((d) => `${d.label}: ${format(d.value)}`).join('; ')

  return (
    <figure>
      <svg
        role="img"
        aria-label={`Biểu đồ cột. ${summary}`}
        viewBox={`0 0 100 ${height / 4 + 14}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: height + 40 }}
      >
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 4)
          return (
            <g key={d.label}>
              <rect
                x={i * barWidth + barWidth * 0.15}
                y={height / 4 - h}
                width={barWidth * 0.7}
                height={Math.max(h, d.value > 0 ? 0.6 : 0.3)}
                rx={0.6}
                fill={d.value > 0 ? 'var(--primary)' : 'var(--border)'}
              />
              {i % step === 0 && (
                <text x={i * barWidth + barWidth / 2} y={height / 4 + 8} textAnchor="middle" fontSize="3.4" fill="var(--muted)">
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  )
}
