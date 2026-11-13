import { describe, expect, it } from 'vitest'
import {
  extractUrl,
  haversine,
  inVietnam,
  isShortMapsLink,
  navigationUrl,
  parseMapsLink,
  searchUrl,
} from './link'

describe('parseMapsLink', () => {
  it.each([
    ['https://www.google.com/maps/place/Ben+Thanh/@10.7725,106.698,17z/data=!3m1', 10.7725, 106.698],
    ['https://www.google.com/maps?q=10.7769,106.7009', 10.7769, 106.7009],
    ['https://www.google.com/maps?q=10.7769%2C106.7009', 10.7769, 106.7009],
    ['https://maps.google.com/?ll=21.0285,105.8542&z=15', 21.0285, 105.8542],
    ['https://www.google.com/maps/dir/?api=1&destination=16.0544,108.2022', 16.0544, 108.2022],
    ['https://www.google.com/maps/place/X/data=!3d10.8231!4d106.6297', 10.8231, 106.6297],
    ['10.7769, 106.7009', 10.7769, 106.7009],
    ['10.7769 106.7009', 10.7769, 106.7009],
    ['Vị trí của tôi: https://www.google.com/maps?q=10.5,106.5 cảm ơn', 10.5, 106.5],
    ['https://www.google.com/maps/@-33.8688,151.2093,15z', -33.8688, 151.2093],
  ])('reads %s', (input, lat, lng) => {
    expect(parseMapsLink(input)).toEqual({ lat, lng })
  })

  it.each([
    '',
    'hello',
    'https://maps.app.goo.gl/abc123',
    '12 Lê Lợi',
    '95.1234, 106.5',
    '10, 106',
  ])('returns null for %s', (input) => {
    expect(parseMapsLink(input)).toBeNull()
  })
})

describe('links', () => {
  it('finds a URL in a message', () => {
    expect(extractUrl('xem ở đây https://maps.app.goo.gl/xyz nhé')).toBe('https://maps.app.goo.gl/xyz')
    expect(extractUrl('không có link')).toBeNull()
  })

  it('recognises short links', () => {
    expect(isShortMapsLink('https://maps.app.goo.gl/abc')).toBe(true)
    expect(isShortMapsLink('https://goo.gl/maps/abc')).toBe(true)
    expect(isShortMapsLink('https://www.google.com/maps?q=1,2')).toBe(false)
    expect(isShortMapsLink('not a url')).toBe(false)
  })

  it('builds navigation and search URLs', () => {
    expect(navigationUrl({ lat: 10.7, lng: 106.6 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=10.7,106.6&travelmode=driving&dir_action=navigate',
    )
    expect(navigationUrl({ lat: 10.7, lng: 106.6 }, 'two-wheeler')).toContain('travelmode=two-wheeler')
    expect(searchUrl('12 Lê Lợi, Q1')).toBe(
      'https://www.google.com/maps/search/?api=1&query=12%20L%C3%AA%20L%E1%BB%A3i%2C%20Q1',
    )
  })
})

describe('geometry', () => {
  it('measures distance', () => {
    // Hà Nội ↔ TP.HCM is roughly 1.150–1.165 km in a straight line.
    const d = haversine({ lat: 21.0285, lng: 105.8542 }, { lat: 10.8231, lng: 106.6297 })
    expect(d).toBeGreaterThan(1_100_000)
    expect(d).toBeLessThan(1_200_000)
    expect(haversine({ lat: 10, lng: 106 }, { lat: 10, lng: 106 })).toBe(0)
  })

  it('knows what is inside Vietnam', () => {
    expect(inVietnam({ lat: 10.77, lng: 106.69 })).toBe(true)
    expect(inVietnam({ lat: 35, lng: 139 })).toBe(false)
  })
})
