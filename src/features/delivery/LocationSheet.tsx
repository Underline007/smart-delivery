import { lazy, Suspense, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { LoadingBlock } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import { resolveMapLink } from '@/features/customers/api'
import { toMessage } from '@/lib/errors'
import { extractUrl, inVietnam, isShortMapsLink, parseMapsLink, type LatLng } from '@/lib/maps/link'

const MapPicker = lazy(() => import('@/components/map/MapPicker').then((m) => ({ default: m.MapPicker })))

/** Pick a location by pasting a Google Maps link or placing a pin. */
export function LocationSheet({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string
  initial: LatLng | null
  onSave: (point: LatLng) => Promise<void> | void
  onClose: () => void
}) {
  const [point, setPoint] = useState<LatLng | null>(initial)
  const [link, setLink] = useState('')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function readLink() {
    const url = extractUrl(link) ?? link.trim()
    let found = parseMapsLink(link)
    if (!found && isShortMapsLink(url)) {
      setReading(true)
      try {
        found = parseMapsLink(await resolveMapLink(url))
      } catch (error) {
        toast.error(await toMessage(error))
      }
      setReading(false)
    }
    if (!found) {
      toast.error('Không tìm thấy toạ độ trong link này')
      return
    }
    if (!inVietnam(found)) toast.warning('Vị trí nằm ngoài Việt Nam, hãy kiểm tra lại')
    setPoint(found)
    setLink('')
  }

  async function save() {
    if (!point) return
    setSaving(true)
    try {
      await onSave(point)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <Button block disabled={!point} loading={saving} onClick={save}>
          Lưu vị trí
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <input
            aria-label="Dán link Google Maps"
            placeholder="Dán link Google Maps của khách"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
          <Button size="sm" variant="secondary" loading={reading} disabled={!link.trim()} onClick={readLink}>
            Đọc
          </Button>
        </div>
        <Suspense fallback={<LoadingBlock />}>
          <MapPicker value={point} onChange={setPoint} />
        </Suspense>
      </div>
    </Sheet>
  )
}
