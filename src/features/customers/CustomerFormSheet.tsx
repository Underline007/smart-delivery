import { useQuery } from '@tanstack/react-query'
import { ClipboardPaste } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { toMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { useAction } from '@/lib/useAction'
import { normalizeVnMobile } from '@/lib/vn/phone'
import { addressInput, addressProblems, EMPTY_ADDRESS, type AddressDraft } from './address-draft'
import { AddressFields } from './AddressFields'
import { findCustomerByPhone, saveCustomer, saveCustomerAddress, type Customer } from './api'
import type { PastedMessage } from './catalog'
import { SmartPasteSheet } from './SmartPasteSheet'

const SUGGESTED_TAGS = ['VIP', 'Khách sỉ', 'Hay hoàn hàng']

interface Props {
  shopId: string
  customer?: Customer
  /** Called with the saved customer id. */
  onSaved: (id: string) => void
  onClose: () => void
}

export function CustomerFormSheet({ shopId, customer, onSaved, onClose }: Props) {
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [phone2, setPhone2] = useState(customer?.phone2 ?? '')
  const [tags, setTags] = useState<string[]>(customer?.tags ?? [])
  const [tagDraft, setTagDraft] = useState('')
  const [note, setNote] = useState(customer?.note ?? '')
  const [withAddress, setWithAddress] = useState(false)
  const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS)
  const [errors, setErrors] = useState<{ name?: string; phone?: string; phone2?: string; address?: string }>({})
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)

  const normalized = normalizeVnMobile(phone)
  const existing = useQuery({
    queryKey: ['shop', shopId, 'customer-by-phone', normalized],
    queryFn: () => findCustomerByPhone(shopId, normalized!),
    enabled: Boolean(normalized) && normalized !== customer?.phone,
  })
  const duplicate = existing.data && existing.data.id !== customer?.id ? existing.data : null

  const save = useAction(
    async () => {
      const id = await saveCustomer(shopId, {
        id: customer?.id,
        name: name.trim(),
        phone: normalized!,
        phone2: phone2.trim(),
        tags,
        note: note.trim(),
      })
      if (!customer && withAddress && address.detail.trim()) {
        await saveCustomerAddress(shopId, id, addressInput(address, { is_default: true }))
      }
      return id
    },
    {
      success: customer ? 'Đã lưu khách hàng' : 'Đã thêm khách hàng',
      invalidate: [['shop', shopId, 'customers'], ['customer']],
      onSuccess: onSaved,
    },
  )

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: typeof errors = {}
    if (!name.trim()) next.name = 'Nhập tên khách hàng'
    if (!normalized) next.phone = 'Số điện thoại di động không hợp lệ'
    if (phone2.trim() && !normalizeVnMobile(phone2)) next.phone2 = 'Số điện thoại phụ không hợp lệ'
    if (withAddress && address.detail.trim()) {
      const problems = addressProblems(address)
      if (problems.length > 0) next.address = problems[0]
    }
    setErrors(next)
    setDuplicateId(null)
    if (Object.keys(next).length > 0) return
    try {
      await save.mutateAsync(undefined)
    } catch (error) {
      const { code, hint } = error as { code?: string; hint?: string }
      if (code === '23505' && hint) setDuplicateId(hint)
      // The toast is already shown by useAction.
      void toMessage
    }
  }

  function applyPasted(result: PastedMessage) {
    if (result.name) setName(result.name)
    if (result.phone) setPhone(result.phone)
    if (result.address.detail || result.address.provinceCode) {
      setWithAddress(true)
      setAddress(result.address)
    }
    setPasting(false)
  }

  const toggleTag = (tag: string) =>
    setTags((all) => (all.includes(tag) ? all.filter((t) => t !== tag) : [...all, tag]))

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={customer ? 'Sửa khách hàng' : 'Thêm khách hàng'}
        footer={
          <Button type="submit" form="customer-form" block loading={save.isPending}>
            {customer ? 'Lưu' : 'Thêm khách hàng'}
          </Button>
        }
      >
        <form id="customer-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {!customer && (
            <Button variant="secondary" icon={<ClipboardPaste className="size-5" />} onClick={() => setPasting(true)}>
              Dán tin nhắn của khách
            </Button>
          )}
          <TextField label="Họ tên" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={100} />
          <TextField
            label="Số điện thoại"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
            autoComplete="off"
          />
          {(duplicate || duplicateId) && (
            <p role="alert" className="-mt-2 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
              Số này đã có trong danh sách:{' '}
              <Link
                to={`/shop/customers/${duplicate?.id ?? duplicateId}`}
                className="font-semibold underline"
                onClick={onClose}
              >
                {duplicate?.name ?? 'mở khách đó'}
              </Link>
              .
            </p>
          )}
          <TextField
            label="Số điện thoại phụ (tuỳ chọn)"
            type="tel"
            inputMode="tel"
            value={phone2}
            onChange={(e) => setPhone2(e.target.value)}
            error={errors.phone2}
          />

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Nhãn</span>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...SUGGESTED_TAGS, ...tags])].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={tags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'h-9 rounded-full border px-3.5 text-sm font-medium',
                    tags.includes(tag) ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface',
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
            <input
              aria-label="Thêm nhãn khác"
              placeholder="Nhãn khác, nhấn Enter để thêm"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const tag = tagDraft.trim().slice(0, 30)
                  if (tag && !tags.includes(tag) && tags.length < 10) setTags([...tags, tag])
                  setTagDraft('')
                }
              }}
              className="h-11 rounded-xl border border-border bg-surface px-3.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <TextField label="Ghi chú (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />

          {!customer &&
            (withAddress ? (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <p className="font-semibold">Địa chỉ giao hàng</p>
                <AddressFields value={address} onChange={setAddress} />
                {errors.address && <p className="text-sm text-danger">{errors.address}</p>}
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setWithAddress(true)}>
                + Thêm địa chỉ giao hàng
              </Button>
            ))}
        </form>
      </Sheet>
      {pasting && <SmartPasteSheet onApply={applyPasted} onClose={() => setPasting(false)} />}
    </>
  )
}
