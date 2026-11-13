import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64 } from './files'

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes, including large ones', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256)
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes))
  })

  it('handles an empty array', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('')
    expect(base64ToBytes('').length).toBe(0)
  })

  it('matches the standard encoding', () => {
    expect(bytesToBase64(new TextEncoder().encode('Hello'))).toBe('SGVsbG8=')
  })
})
