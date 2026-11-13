import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/cn'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Exact match only (for index routes). */
  end?: boolean
  /** Rendered as the raised round button in the middle. */
  primary?: boolean
}

function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-safe"
    >
      <ul
        className="mx-auto grid max-w-screen-sm"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                  isActive ? 'text-primary' : 'text-muted',
                )
              }
            >
              {({ isActive }) =>
                item.primary ? (
                  <>
                    <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
                      <item.icon className="size-6" strokeWidth={2.4} />
                    </span>
                    <span className="sr-only">{item.label}</span>
                  </>
                ) : (
                  <>
                    <item.icon className="size-6" strokeWidth={isActive ? 2.4 : 1.8} />
                    <span>{item.label}</span>
                  </>
                )
              }
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Page frame for signed-in users: content + bottom navigation. */
export function AppShell({ nav, banner }: { nav: NavItem[]; banner?: ReactNode }) {
  return (
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {banner}
      <Outlet />
      <BottomNav items={nav} />
    </div>
  )
}

/** Centered column used by most pages. */
export function PageBody({ className, children }: { className?: string; children: ReactNode }) {
  return <main className={cn('mx-auto max-w-screen-sm px-4 py-4', className)}>{children}</main>
}

/**
 * Action bar fixed above the bottom navigation (e.g. the main "Save" button of a form).
 * Pages using it should add `pb-28` to their content.
 */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto max-w-screen-sm px-4 py-3">{children}</div>
    </div>
  )
}
