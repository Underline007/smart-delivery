import { Eye, EyeOff, Search } from 'lucide-react'
import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { cn } from '@/lib/cn'

const inputClass =
  'h-12 w-full rounded-xl border border-border bg-surface px-3.5 text-foreground placeholder:text-muted ' +
  'outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25 ' +
  'disabled:opacity-60 aria-[invalid=true]:border-danger'

interface FieldShellProps {
  label: string
  hint?: ReactNode
  error?: string | null
  id: string
  children: ReactNode
}

function FieldShell({ label, hint, error, id, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: string | null
}

export function TextField({ label, hint, error, className, id, ...props }: TextFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldShell label={label} hint={hint} error={error} id={fieldId}>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={cn(inputClass, className)}
        {...props}
      />
    </FieldShell>
  )
}

export function PasswordField({ label, hint, error, id, ...props }: TextFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const [visible, setVisible] = useState(false)
  return (
    <FieldShell label={label} hint={hint} error={error} id={fieldId}>
      <div className="relative">
        <input
          id={fieldId}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          className={cn(inputClass, 'pr-12')}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted"
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>
    </FieldShell>
  )
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  hint?: ReactNode
  error?: string | null
}

export function SelectField({ label, hint, error, id, className, children, ...props }: SelectFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldShell label={label} hint={hint} error={error} id={fieldId}>
      <select id={fieldId} className={cn(inputClass, 'appearance-auto', className)} {...props}>
        {children}
      </select>
    </FieldShell>
  )
}

export function SearchInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted" />
      <input type="search" className={cn(inputClass, 'pl-11')} {...props} />
    </div>
  )
}
