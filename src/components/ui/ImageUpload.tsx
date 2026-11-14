import { ImagePlus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { toMessage } from '@/lib/errors'
import { compressImage } from '@/lib/image'
import { PRODUCT_IMAGE_BUCKET, productImageUrl } from '@/lib/image-url'
import { supabase } from '@/lib/supabase'
import { Button } from './Button'

/**
 * Picks a photo, shrinks it (so the free 1 GB lasts) and uploads it for a shop.
 * `onChange` receives the new storage path, or null after removing.
 */
export function ImageUpload({
  shopId,
  value,
  onChange,
  label = 'Ảnh sản phẩm',
}: {
  shopId: string
  value: string | null
  onChange: (path: string | null) => void
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const url = productImageUrl(value)

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const blob = await compressImage(file, { maxDim: 800, quality: 0.7 })
      const path = `${shopId}/${crypto.randomUUID()}.jpg`
      const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      // Best effort: the old file is no longer used.
      if (value) void supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([value])
      onChange(path)
    } catch (error) {
      toast.error(await toMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        {url ? (
          <img src={url} alt="" className="size-20 rounded-xl border border-border object-cover" />
        ) : (
          <div className="flex size-20 items-center justify-center rounded-xl border border-dashed border-border text-muted">
            <ImagePlus className="size-7" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <input ref={input} type="file" accept="image/*" className="hidden" aria-label={`Chọn ${label.toLowerCase()}`} onChange={(e) => pick(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
            {url ? 'Đổi ảnh' : 'Chọn ảnh'}
          </Button>
          {url && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              onClick={() => {
                if (value) void supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([value])
                onChange(null)
              }}
            >
              Bỏ ảnh
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
