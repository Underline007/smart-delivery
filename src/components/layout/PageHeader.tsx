import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'

interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  /** Shows a back arrow that goes to this path (or history back when true). */
  back?: string | true
  actions?: ReactNode
}

export function PageHeader({ title, subtitle, back, actions }: PageHeaderProps) {
  const navigate = useNavigate()
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 pt-safe backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-screen-sm items-center gap-1 px-2">
        {back && (
          <button
            type="button"
            onClick={() => (back === true ? navigate(-1) : navigate(back))}
            className="flex size-11 items-center justify-center rounded-full active:bg-surface-2"
            aria-label="Quay lại"
          >
            <ArrowLeft className="size-6" />
          </button>
        )}
        <div className={back ? 'min-w-0 flex-1' : 'min-w-0 flex-1 pl-2'}>
          <h1 className="truncate text-xl font-bold">{title}</h1>
          {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-1 pr-1">{actions}</div>}
      </div>
    </header>
  )
}
