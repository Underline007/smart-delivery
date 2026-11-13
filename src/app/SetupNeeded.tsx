import { Settings } from 'lucide-react'
import { EmptyState } from '@/components/ui/misc'

/** Shown when the Supabase URL / key are not set (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY). */
export function SetupNeeded() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <EmptyState icon={<Settings className="size-7" />} title="Chưa cấu hình kết nối">
        Thiếu <code>VITE_SUPABASE_URL</code> và <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>. Xem{' '}
        <code>docs/SETUP.md</code> để tạo project Supabase rồi khai báo hai biến này.
      </EmptyState>
    </div>
  )
}
