import type { LatLng } from './maps/link'

/** Current GPS position, or null when unavailable, denied or too slow. Never throws. */
export function getPosition(timeoutMs = 8000): Promise<LatLng | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    )
  })
}
