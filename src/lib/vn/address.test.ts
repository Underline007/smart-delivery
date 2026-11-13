import { describe, expect, it } from 'vitest'
import {
  extractPhone,
  matchProvince,
  matchWards,
  parseAddress,
  splitMessage,
  type Alias,
  type Province,
  type Ward,
} from './address'

const provinces: Province[] = [
  { code: '01', name: 'Hà Nội' },
  { code: '48', name: 'Đà Nẵng' },
  { code: '79', name: 'TP. Hồ Chí Minh' },
  { code: '75', name: 'Đồng Nai' },
]
const provinceAliases: Alias[] = [
  { alias_search: 'hcm', code: '79' },
  { alias_search: 'tphcm', code: '79' },
  { alias_search: 'sai gon', code: '79' },
  { alias_search: 'binh duong', code: '79' },
  { alias_search: 'ha noi', code: '01' },
]
const wards: Ward[] = [
  { code: 'w1', province_code: '79', name: 'Phường Bến Thành' },
  { code: 'w2', province_code: '79', name: 'Phường Sài Gòn' },
  { code: 'w3', province_code: '79', name: 'Phường 1' },
  { code: 'w4', province_code: '79', name: 'Xã Tân Hiệp' },
  { code: 'w5', province_code: '79', name: 'Phường An' },
  { code: 'w6', province_code: '01', name: 'Phường Hoàn Kiếm' },
]
const wardAliases: Alias[] = [{ alias_search: 'q1', code: 'w1' }]
const catalog = { provinces, provinceAliases, wards, wardAliases }

describe('extractPhone', () => {
  it.each([
    ['gọi 0912 345 678 nhé', '0912345678'],
    ['sdt: 0912.345.678', '0912345678'],
    ['+84 912 345 678', '0912345678'],
    ['84912345678', '0912345678'],
    ['0987-654-321', '0987654321'],
  ])('finds the number in %s', (text, expected) => {
    expect(extractPhone(text)?.phone).toBe(expected)
  })

  it('ignores numbers that are not phones', () => {
    expect(extractPhone('số 12 ngõ 45')).toBeNull()
    expect(extractPhone('mã 123456789012')).toBeNull()
  })
})

describe('splitMessage', () => {
  it('splits a one-line message', () => {
    expect(splitMessage('Chị Lan 0912 345 678, 12 Lê Lợi phường Bến Thành Q1 HCM')).toEqual({
      name: 'Chị Lan',
      phone: '0912345678',
      address: '12 Lê Lợi phường Bến Thành Q1 HCM',
    })
  })

  it('splits a multi-line message', () => {
    expect(
      splitMessage('Nguyễn Văn A\n0987654321\n45 Nguyễn Huệ, P. Bến Nghé, Q1, HCM'),
    ).toEqual({
      name: 'Nguyễn Văn A',
      phone: '0987654321',
      address: '45 Nguyễn Huệ, P. Bến Nghé, Q1, HCM',
    })
  })

  it('understands labels', () => {
    expect(
      splitMessage('Tên: Trần B\nSĐT: 0901 234 567\nĐịa chỉ: 7 Trần Phú, Đà Nẵng'),
    ).toEqual({ name: 'Trần B', phone: '0901234567', address: '7 Trần Phú, Đà Nẵng' })
  })

  it('removes a phone label that sits next to the name', () => {
    expect(splitMessage('Anh Hùng sđt 0912345678 - 3 Hàng Bài Hà Nội')).toMatchObject({
      name: 'Anh Hùng',
      phone: '0912345678',
      address: '3 Hàng Bài Hà Nội',
    })
  })

  it('works when the name comes after the address', () => {
    expect(splitMessage('12 Lê Lợi, Q1, HCM\nChị Mai\n0912345678')).toEqual({
      name: 'Chị Mai',
      phone: '0912345678',
      address: '12 Lê Lợi, Q1, HCM',
    })
  })

  it('does not take an address line for the name', () => {
    expect(splitMessage('0912345678\nđường Lê Lợi phường Bến Thành')).toMatchObject({
      name: '',
      address: 'đường Lê Lợi phường Bến Thành',
    })
  })

  it('handles a message without a phone number', () => {
    expect(splitMessage('Chị Lan\n12 Lê Lợi').phone).toBe('')
  })
})

describe('matchProvince', () => {
  it('matches the full name, with or without a prefix', () => {
    expect(matchProvince('12 Lê Lợi, TP. Hồ Chí Minh', provinces, provinceAliases)?.code).toBe('79')
    expect(matchProvince('12 Lê Lợi, Ho Chi Minh', provinces, provinceAliases)?.code).toBe('79')
    expect(matchProvince('5 Trần Phú, tỉnh Đồng Nai', provinces, provinceAliases)?.code).toBe('75')
  })

  it('matches abbreviations and old provinces', () => {
    expect(matchProvince('12 Lê Lợi Q1 HCM', provinces, provinceAliases)?.code).toBe('79')
    expect(matchProvince('Thủ Dầu Một, Bình Dương', provinces, provinceAliases)?.code).toBe('79')
    expect(matchProvince('12 Lê Lợi, Sài Gòn', provinces, provinceAliases)?.code).toBe('79')
  })

  it('prefers the last mention', () => {
    expect(matchProvince('Đường Hà Nội, quận 9, Sài Gòn', provinces, provinceAliases)?.code).toBe('79')
  })

  it('returns null when there is none', () => {
    expect(matchProvince('12 Lê Lợi', provinces, provinceAliases)).toBeNull()
  })
})

describe('matchWards', () => {
  it('finds a named ward with or without the prefix', () => {
    expect(matchWards('12 Lê Lợi phường Bến Thành', wards)[0].code).toBe('w1')
    expect(matchWards('12 Lê Lợi, Bến Thành, HCM', wards)[0].code).toBe('w1')
  })

  it('needs the prefix for numbered wards', () => {
    expect(matchWards('12 Lê Lợi phường 1', wards)[0].code).toBe('w3')
    expect(matchWards('12 Lê Lợi 1', wards)).toEqual([])
  })

  it('does not match a one-word ward without a prefix', () => {
    expect(matchWards('số 5 đường An Dương', wards)).toEqual([])
    expect(matchWards('số 5 đường An Dương phường An', wards)[0].code).toBe('w5')
  })

  it('uses ward aliases', () => {
    expect(matchWards('3 Pasteur Q1', wards, wardAliases)[0].code).toBe('w1')
  })
})

describe('parseAddress', () => {
  it('splits street, ward and province', () => {
    const result = parseAddress('12 Lê Lợi phường Bến Thành Q1 HCM', catalog)
    expect(result).toMatchObject({
      detail: '12 Lê Lợi',
      provinceCode: '79',
      wardCode: 'w1',
    })
  })

  it('handles punctuation and the old three-level format', () => {
    const result = parseAddress('45 Nguyễn Huệ, P. Bến Thành, Quận 1, TP.HCM', catalog)
    expect(result.detail).toBe('45 Nguyễn Huệ')
    expect(result.provinceCode).toBe('79')
    expect(result.wardCode).toBe('w1')
  })

  it('keeps the whole text as detail when nothing matches', () => {
    expect(parseAddress('hẻm 12 đường số 5', catalog)).toMatchObject({
      detail: 'hẻm 12 đường số 5',
      provinceCode: null,
      wardCode: null,
    })
  })

  it('keeps a street called "Xa lộ"', () => {
    expect(parseAddress('Xa lộ Hà Nội, phường Bến Thành, HCM', catalog).detail).toBe('Xa lộ Hà Nội')
  })

  it('falls back to free-text ward when the catalogue lacks it', () => {
    const result = parseAddress('7 Trần Phú, phường hải châu, Đà Nẵng', { ...catalog, wards: [] })
    expect(result.provinceCode).toBe('48')
    expect(result.wardCode).toBeNull()
    expect(result.wardText).toBe('Phường Hải Châu')
    expect(result.detail).toBe('7 Trần Phú')
  })

  it('only looks at wards of the detected province', () => {
    const result = parseAddress('3 Hàng Bài, phường Hoàn Kiếm, Hà Nội', catalog)
    expect(result).toMatchObject({ provinceCode: '01', wardCode: 'w6', detail: '3 Hàng Bài' })
  })
})
