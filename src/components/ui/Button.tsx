import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft'
type Size = 'md' | 'sm' | 'icon'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground active:opacity-90',
  secondary: 'bg-surface text-foreground border border-border active:bg-surface-2',
  ghost: 'bg-transparent text-foreground active:bg-surface-2',
  danger: 'bg-danger text-white active:opacity-90',
  'danger-soft': 'bg-danger-soft text-danger active:opacity-90',
}

const sizes: Record<Size, string> = {
  md: 'h-12 px-5 text-base gap-2',
  sm: 'h-10 px-4 text-sm gap-1.5',
  icon: 'h-11 w-11 justify-center',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  block?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  block,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl font-semibold transition select-none',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}
