import { lazy, Suspense, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { LoadingBlock } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import { toMessage } from '@/lib/errors'
import { extractUrl, inVietnam, isShortMapsLink, parseMapsLink, type LatLng } from '@/lib/maps/link'
import { resolveMapLink } from './api'
import type { AddressDraft } from './address-draft'
import { useProvinces, useWards } from './catalog'

const MapPicker = lazy(() => import('@/components/map/MapPicker').then((m) => ({ default: m.MapPicker })))

interface AddressFieldsProps {
  value: AddressDraft
  onChange: (value: AddressDraft) => void
  /** Whether to show the location tools (link, map). */
  location?: boolean
}

/** Province / ward / street detail plus the location (Google Maps link or pin). */
export function AddressFields({ value, onChange, location = true }: AddressFieldsProps) {
  const provinces = useProvinces()
  const wards = useWards(value.provinceCode || null)
  const [link, setLink] = useState('')
  const [reading, setReading] = useState(false)
  const [picking, setPicking] = useState(false)

  const set = (patch: Partial<AddressDraft>) => onChange({ ...value, ...patch })
  const hasWards = (wards.data?.length ?? 0) > 0
  const point: LatLng | null = value.lat !== null && value.lng !== null ? { lat: value.lat, lng: value.lng } : null

  async function readLink() {
    const url = extractUrl(link) ?? link.trim()
    let found = parseMapsLink(link)
    if (!found && isShortMapsLink(url)) {
      setReading(true)
      try {
        found = parseMapsLink(await resolveMapLink(url))
      } catch (error) {
        toast.error(await toMessage(error))
        setReading(false)
        return
      }
      setReading(false)
    }
    if (!found) {
      toast.error('Không tìm thấy toạ độ trong link này. Thử chọn trên bản đồ.')
      return
    }
    if (!inVietnam(found)) toast.warning('Vị trí nằm ngoài Việt Nam, hãy kiểm tra lại')
    set({ lat: found.lat, lng: found.lng, geoSource: 'link' })
    setLink('')
    toast.success('Đã lấy vị trí từ link')
  }

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label="Tỉnh / thành phố"
        value={value.provinceCode}
        onChange={(e) => set({ provinceCode: e.target.value, wardCode: '', wardText: '' })}
      >
        <option value="">Chọn tỉnh/thành…</option>
        {provinces.data?.map((p) => (
          <option key={p.code} value={p.code}>
            {p.name}
          </option>
        ))}
      </SelectField>

      {value.provinceCode &&
        (wards.isLoading ? null : hasWards ? (
          <SelectField
            label="Phường / xã"
            value={value.wardCode}
            onChange={(e) => set({ wardCode: e.target.value, wardText: '' })}
          >
            <option value="">Chọn phường/xã…</option>
            {wards.data?.map((w) => (
              <option key={w.code} value={w.code}>
                {w.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextField
            label="Phường / xã"
            placeholder="Ví dụ: Phường Bến Thành"
            value={value.wardText}
            onChange={(e) => set({ wardText: e.target.value })}
            hint="Danh mục xã/phường của tỉnh này chưa được nhập, tạm điền tay."
            maxLength={100}
          />
        ))}

      <TextField
        label="Địa chỉ chi tiết"
        placeholder="Số nhà, tên đường, ngõ/hẻm"
        value={value.detail}
        onChange={(e) => set({ detail: e.target.value })}
        maxLength={300}
      />

      {location && (
        <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3">
          <p className="text-sm font-medium">Vị trí để shipper dẫn đường</p>
          {point ? (
            <p className="text-sm">
              {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
              <span className="text-muted">
                {' '}
                ·{' '}
                {{ link: 'từ link', manual: 'chọn trên bản đồ', gps: 'GPS shipper', osm: 'tìm tự động', google: 'Google', ors: 'tìm tự động' }[
                  value.geoSource ?? 'manual'
                ]}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted">Chưa có vị trí. Nên có để tối ưu tuyến giao.</p>
          )}
          <div className="flex gap-2">
            <input
              aria-label="Dán link Google Maps hoặc toạ độ"
              placeholder="Dán link Google Maps của khách"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
            <Button size="sm" variant="secondary" loading={reading} disabled={!link.trim()} onClick={readLink}>
              Đọc
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
              Chọn trên bản đồ
            </Button>
            {point && (
              <Button size="sm" variant="ghost" onClick={() => set({ lat: null, lng: null, geoSource: null })}>
                Xoá vị trí
              </Button>
            )}
          </div>
        </div>
      )}

      {picking && (
        <Sheet
          open
          onClose={() => setPicking(false)}
          title="Chọn vị trí"
          footer={
            <Button block onClick={() => setPicking(false)}>
              Xong
            </Button>
          }
        >
          <Suspense fallback={<LoadingBlock />}>
            <MapPicker
              value={point}
              onChange={(p) => set({ lat: p.lat, lng: p.lng, geoSource: 'manual' })}
            />
          </Suspense>
        </Sheet>
      )}
    </div>
  )
}
