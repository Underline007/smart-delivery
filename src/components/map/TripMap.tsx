import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { LatLng } from '@/lib/maps/link'
import { OSM_TILES } from './leaflet-utils'

export interface MapStop extends LatLng {
  label: string
  /** pending (default), delivered or failed: changes the pin colour. */
  state?: 'pending' | 'delivered' | 'failed' | 'current'
}

const COLORS = { pending: '#0f766e', current: '#d97706', delivered: '#64748b', failed: '#c62828' }

function numberedPin(label: string, state: MapStop['state'] = 'pending') {
  return L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:${COLORS[state]};transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:700 12px system-ui">${label}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  })
}

const startIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#1d4ed8;border:3px solid #fff;box-shadow:0 0 0 2px #1d4ed8"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

/** Numbered pins joined by a line, starting from `start`. Fits itself to all points. */
export function TripMap({
  start,
  stops,
  line = true,
  returnToStart = false,
  height = 280,
}: {
  start: LatLng | null
  stops: MapStop[]
  line?: boolean
  returnToStart?: boolean
  height?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!container.current || mapRef.current) return
    const map = L.map(container.current, { zoomControl: true, attributionControl: true }).setView([16, 106], 5)
    L.tileLayer(OSM_TILES.url, { attribution: OSM_TILES.attribution, maxZoom: 19 }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()

    const path: L.LatLngTuple[] = []
    if (start) {
      L.marker([start.lat, start.lng], { icon: startIcon, keyboard: false }).addTo(layer)
      path.push([start.lat, start.lng])
    }
    for (const stop of stops) {
      L.marker([stop.lat, stop.lng], { icon: numberedPin(stop.label, stop.state), keyboard: false }).addTo(layer)
      path.push([stop.lat, stop.lng])
    }
    if (line && path.length > 1) {
      const points = returnToStart && start ? [...path, [start.lat, start.lng] as L.LatLngTuple] : path
      L.polyline(points, { color: '#0f766e', weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(layer)
    }
    if (path.length > 0) map.fitBounds(L.latLngBounds(path), { padding: [30, 30], maxZoom: 16 })
  }, [start, stops, line, returnToStart])

  return (
    <div
      ref={container}
      style={{ height }}
      className="z-0 w-full overflow-hidden rounded-xl border border-border"
      role="application"
      aria-label="Bản đồ tuyến giao"
    />
  )
}
