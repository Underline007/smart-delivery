import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Sticky area at the bottom, usually the main action button. */
  footer?: ReactNode
}

/**
 * Bottom sheet built on <dialog>: focus trapping and Esc come for free.
 * On wide screens it becomes a centered dialog.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // Click on the backdrop (the dialog element itself) closes the sheet.
        if (event.target === ref.current) onClose()
      }}
      aria-labelledby="sheet-title"
      className={cn(
        'm-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-2xl bg-surface p-0 text-foreground',
        'sm:m-auto sm:max-w-lg sm:rounded-2xl',
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 id="sheet-title" className="text-lg font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 flex size-11 items-center justify-center rounded-full text-muted active:bg-surface-2"
              aria-label="Đóng"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="border-t border-border px-4 pt-3 pb-safe">{footer}</div>}
          {footer && <div className="h-3" />}
        </div>
      )}
    </dialog>
  )
}
