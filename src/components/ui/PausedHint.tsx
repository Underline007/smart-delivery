/**
 * Shown when the app cannot reach the server at all. On the free Supabase plan the most
 * likely cause (besides a bad connection) is that the project was paused for inactivity.
 */
export function PausedHint() {
  return (
    <div role="note" className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
      <p className="font-semibold">Không kết nối được máy chủ</p>
      <p className="mt-1">
        Hãy kiểm tra mạng. Nếu mạng bình thường, project Supabase có thể đã bị <strong>tạm dừng</strong> vì
        7 ngày không có hoạt động. Admin vào supabase.com, mở project và bấm <strong>Restore project</strong>;
        dữ liệu không mất. Xem hướng dẫn trong docs/SETUP.md, mục “Giữ Supabase không bị tạm dừng”.
      </p>
    </div>
  )
}
