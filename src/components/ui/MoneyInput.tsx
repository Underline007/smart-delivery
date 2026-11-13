import { useId, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { formatNumber, parseMoney } from '@/lib/format'

interface MoneyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  label?: string
  value: number
  onChange: (value: number) => void
  suffix?: string
  hint?: string
  error?: string | null
  /** Show an empty field for 0 (nicer to type into). */
  blankZero?: boolean
}

/** Whole-number input shown with thousands separators: typing 150000 shows 150.000. */
export function MoneyInput({
  label,
  value,
  onChange,
  suffix = 'đ',
  hint,
  error,
  blankZero = true,
  className,
  id,
  ...props
}: MoneyInputProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={fieldId} className="text-sm font-medium">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={fieldId}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          value={blankZero && value === 0 ? '' : formatNumber(value)}
          placeholder="0"
          onChange={(e) => onChange(parseMoney(e.target.value))}
          className={cn(
            'h-12 w-full rounded-xl border border-border bg-surface px-3.5 text-right text-foreground tabular-nums outline-none',
            'focus:border-primary focus:ring-2 focus:ring-primary/25 aria-[invalid=true]:border-danger',
            suffix && 'pr-9',
            className,
          )}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-muted">
            {suffix}
          </span>
        )}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  )
}

/** Small +/- stepper for quantities. */
export function QtyStepper({
  value,
  onChange,
  min = 0,
  max = 99999,
  label,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  label: string
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  return (
    <div className="inline-flex items-center rounded-xl border border-border bg-surface">
      <button
        type="button"
        aria-label={`Giảm ${label}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className="flex size-11 items-center justify-center text-xl text-muted active:bg-surface-2 disabled:opacity-40"
      >
        −
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => onChange(clamp(parseMoney(e.target.value)))}
        className="h-11 w-12 bg-transparent text-center tabular-nums outline-none"
      />
      <button
        type="button"
        aria-label={`Tăng ${label}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="flex size-11 items-center justify-center text-xl text-primary active:bg-surface-2 disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}
