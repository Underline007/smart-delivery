import { useQueryClient } from '@tanstack/react-query'
import { ClipboardPaste } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { toMessage } from '@/lib/errors'
import { formatVnPhone } from '@/lib/vn/phone'
import { interpretMessage, type PastedMessage } from './catalog'

/** Paste a chat message (Zalo, Facebook…) and get name, phone and address filled in. */
export function SmartPasteSheet({
  onApply,
  onClose,
}: {
  onApply: (result: PastedMessage) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [result, setResult] = useState<PastedMessage | null>(null)
  const [busy, setBusy] = useState(false)

  async function analyse() {
    setBusy(true)
    try {
      setResult(await interpretMessage(text, queryClient))
    } catch (error) {
      toast.error(await toMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function paste() {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip) setText(clip)
    } catch {
      toast.message('Không đọc được bộ nhớ tạm, hãy dán tay vào ô bên dưới')
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Dán tin nhắn của khách"
      footer={
        result ? (
          <div className="flex gap-3">
            <Button variant="secondary" block onClick={() => setResult(null)}>
              Sửa tin nhắn
            </Button>
            <Button block onClick={() => onApply(result)}>
              Dùng kết quả
            </Button>
          </div>
        ) : (
          <Button block loading={busy} disabled={!text.trim()} onClick={analyse}>
            Phân tích
          </Button>
        )
      }
    >
      {result ? (
        <dl className="flex flex-col gap-3">
          {[
            ['Tên', result.name || 'Chưa nhận ra'],
            ['Số điện thoại', result.phone ? formatVnPhone(result.phone) : 'Chưa nhận ra'],
            ['Địa chỉ chi tiết', result.address.detail || 'Chưa nhận ra'],
            ['Phường / xã', result.found.ward ?? 'Chưa nhận ra'],
            ['Tỉnh / thành', result.found.province ?? 'Chưa nhận ra'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-surface-2 px-3.5 py-2.5">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className={value === 'Chưa nhận ra' ? 'text-warning' : 'font-medium'}>{value}</dd>
            </div>
          ))}
          <p className="text-sm text-muted">Kiểm tra lại và sửa trong form nếu cần.</p>
        </dl>
      ) : (
        <div className="flex flex-col gap-3">
          <Button variant="secondary" icon={<ClipboardPaste className="size-5" />} onClick={paste}>
            Dán từ bộ nhớ tạm
          </Button>
          <textarea
            aria-label="Tin nhắn của khách"
            rows={7}
            placeholder={'Ví dụ:\nChị Lan 0912 345 678\n12 Lê Lợi, phường Bến Thành, Q1, HCM'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface p-3.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
      )}
    </Sheet>
  )
}
