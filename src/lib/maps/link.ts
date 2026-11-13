export interface LatLng {
  lat: number
  lng: number
}

function valid(lat: number, lng: number): LatLng | null {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null
}

const NUMBER = '(-?\\d{1,3}(?:\\.\\d+)?)'

const PATTERNS: RegExp[] = [
  new RegExp(`@${NUMBER},${NUMBER}`),
  new RegExp(`!3d${NUMBER}!4d${NUMBER}`),
  new RegExp(`[?&](?:q|ll|query|destination|center|sll|daddr|saddr)=${NUMBER},\\+?${NUMBER}`),
  new RegExp(`/maps/search/${NUMBER},\\+?${NUMBER}`),
  new RegExp(`/maps/place/${NUMBER},${NUMBER}`),
]

/** First http(s) URL in a pasted message. */
export function extractUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s<>"')]+/i)?.[0] ?? null
}

/** Short links (maps.app.goo.gl/…) carry no coordinates and must be resolved on the server. */
export function isShortMapsLink(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'g.co'
  } catch {
    return false
  }
}

/**
 * Reads coordinates from a Google Maps link, or from plain "10.7769, 106.7009" text.
 * Returns null when the text has no coordinates (e.g. an unresolved short link).
 */
export function parseMapsLink(input: string): LatLng | null {
  const text = input.trim()
  if (!text) return null

  const plain = text.match(new RegExp(`^${NUMBER}\\s*[,;\\s]\\s*${NUMBER}$`))
  if (plain && plain[1].includes('.') && plain[2].includes('.')) {
    return valid(Number(plain[1]), Number(plain[2]))
  }

  let decoded = extractUrl(text) ?? text
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // keep the raw text
  }
  for (const pattern of PATTERNS) {
    const match = decoded.match(pattern)
    if (match) {
      const point = valid(Number(match[1]), Number(match[2]))
      if (point) return point
    }
  }
  return null
}

/** Rough bounding box of Vietnam, to warn about obviously wrong pins. */
export function inVietnam({ lat, lng }: LatLng): boolean {
  return lat >= 8 && lat <= 24 && lng >= 102 && lng <= 110
}

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Opens turn-by-turn navigation in the Google Maps app. No API key needed. */
export function navigationUrl(to: LatLng, mode: 'driving' | 'walking' | 'bicycling' | 'two-wheeler' = 'driving'): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=${mode}&dir_action=navigate`
}

/** Opens a search for an address in Google Maps (fallback when there are no coordinates). */
export function searchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}
