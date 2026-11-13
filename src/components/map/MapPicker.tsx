import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LocateFixed } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import type { LatLng } from '@/lib/maps/link'
import { OSM_TILES, pinIcon } from './leaflet-utils'

const VIETNAM_CENTER: LatLng = { lat: 16.0, lng: 106.0 }

interface MapPickerProps {
  value: LatLng | null
  onChange: (point: LatLng) => void
  height?: number
}

/** Map with one draggable pin; tap the map to move it. */
export function MapPicker({ value, onChange, height = 320 }: MapPickerProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  const [locating, setLocating] = useState(false)

  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (!container.current || mapRef.current) return
    const start = value ?? VIETNAM_CENTER
    const map = L.map(container.current, { zoomControl: true }).setView([start.lat, start.lng], value ? 17 : 6)
    L.tileLayer(OSM_TILES.url, { attribution: OSM_TILES.attribution, maxZoom: 19 }).addTo(map)
    mapRef.current = map

    const place = (point: LatLng) => {
      if (markerRef.current) {
        markerRef.current.setLatLng([point.lat, point.lng])
      } else {
        const marker = L.marker([point.lat, point.lng], { draggable: true, icon: pinIcon() }).addTo(map)
        marker.on('dragend', () => {
          const p = marker.getLatLng()
          onChangeRef.current({ lat: p.lat, lng: p.lng })
        })
        markerRef.current = marker
      }
    }
    if (value) place(value)
    map.on('click', (e: L.LeafletMouseEvent) => {
      place({ lat: e.latlng.lat, lng: e.latlng.lng })
      onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng })
    })

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // The map is created once; later changes of `value` are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow the value when it changes from outside (pasted link, GPS button).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !value) return
    if (markerRef.current) {
      markerRef.current.setLatLng([value.lat, value.lng])
    } else {
      const marker = L.marker([value.lat, value.lng], { draggable: true, icon: pinIcon() }).addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        onChangeRef.current({ lat: p.lat, lng: p.lng })
      })
      markerRef.current = marker
    }
    map.setView([value.lat, value.lng], Math.max(map.getZoom(), 16))
  }, [value])

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      toast.error('Thiết bị không hỗ trợ định vị')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        setLocating(false)
        toast.error('Không lấy được vị trí. Hãy cho phép truy cập vị trí trong cài đặt trình duyệt.')
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={container}
        style={{ height }}
        className="z-0 w-full overflow-hidden rounded-xl border border-border"
        role="application"
        aria-label="Bản đồ chọn vị trí"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" loading={locating} icon={<LocateFixed className="size-4" />} onClick={useMyLocation}>
          Vị trí của tôi
        </Button>
        <p className="text-sm text-muted">Chạm vào bản đồ hoặc kéo ghim để chọn vị trí.</p>
      </div>
    </div>
  )
}
