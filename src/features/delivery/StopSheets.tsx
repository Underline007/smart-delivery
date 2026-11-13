import { Camera } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { FAIL_REASONS } from './api'

export interface DeliverResult {
  cod: number
  note: string
  photo: Blob | null
}

export function DeliverSheet({
  name,
  expectedCod,
  busy,
  onConfirm,
  onClose,
}: {
  name: string
  expectedCod: number
  busy: boolean
  onConfirm: (result: DeliverResult) => void
  onClose: () => void
}) {
  const [cod, setCod] = useState(expectedCod)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)

  return (
    <Sheet
      open
      onClose={onClose}
      title="Đã giao hàng"
      footer={
        <Button block loading={busy} onClick={() => onConfirm({ cod, note, photo })}>
          Xác nhận đã giao
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base">
          Giao cho <strong>{name}</strong>
        </p>
        <MoneyInput
          label="Tiền thực thu"
          value={cod}
          onChange={setCod}
          blankZero={false}
          hint={cod === expectedCod ? 'Đúng số tiền cần thu' : `Cần thu ${expectedCod.toLocaleString('vi-VN')}đ`}
        />
        <TextField label="Ghi chú (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        <div className="flex flex-col gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Chụp ảnh giao hàng"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <Button variant="secondary" icon={<Camera className="size-5" />} onClick={() => input.current?.click()}>
            {photo ? 'Chụp lại ảnh' : 'Chụp ảnh giao hàng (tuỳ chọn)'}
          </Button>
          {photo && <p className="text-sm text-muted">Đã chọn: {photo.name}</p>}
        </div>
      </div>
    </Sheet>
  )
}

export function FailSheet({
  name,
  busy,
  onConfirm,
  onClose,
}: {
  name: string
  busy: boolean
  onConfirm: (reason: string, note: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  return (
    <Sheet
      open
      onClose={onClose}
      title="Giao không thành công"
      footer={
        <Button block variant="danger" disabled={!reason} loading={busy} onClick={() => onConfirm(reason, note)}>
          Ghi nhận thất bại
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-base">
          Điểm giao: <strong>{name}</strong>
        </p>
        <div role="radiogroup" aria-label="Lý do" className="flex flex-col gap-2">
          {FAIL_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className={cn('min-h-12 rounded-xl border px-4 text-left text-base font-medium', reason === r ? 'border-danger bg-danger-soft text-danger' : 'border-border bg-surface')}
            >
              {r}
            </button>
          ))}
        </div>
        <TextField label="Ghi chú (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
    </Sheet>
  )
}
