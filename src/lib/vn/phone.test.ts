import { describe, expect, it } from 'vitest'
import { formatVnPhone, normalizeVnMobile, phoneToLoginEmail, zaloLink } from './phone'

describe('normalizeVnMobile', () => {
  it.each([
    ['0912345678', '0912345678'],
    ['0912 345 678', '0912345678'],
    ['0912.345.678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0387-654-321', '0387654321'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeVnMobile(input)).toBe(expected)
  })

  it.each([
    ['', 'empty'],
    ['091234567', 'too short'],
    ['09123456789', 'too long'],
    ['0212345678', 'not a mobile prefix'],
    ['1912345678', 'no leading zero'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizeVnMobile(input)).toBeNull()
  })

  it('handles null and undefined', () => {
    expect(normalizeVnMobile(null)).toBeNull()
    expect(normalizeVnMobile(undefined)).toBeNull()
  })
})

describe('formatVnPhone', () => {
  it('groups a 10-digit number', () => {
    expect(formatVnPhone('0912345678')).toBe('0912 345 678')
  })

  it('leaves other values unchanged', () => {
    expect(formatVnPhone('abc')).toBe('abc')
  })
})

describe('links', () => {
  it('builds the internal login email', () => {
    expect(phoneToLoginEmail('0912345678', 'example.invalid')).toBe('0912345678@example.invalid')
  })

  it('builds a Zalo link', () => {
    expect(zaloLink('0912345678')).toBe('https://zalo.me/0912345678')
  })
})
