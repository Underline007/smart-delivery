import { describe, expect, it } from 'vitest'
import { parseWardRows } from './catalog-import'
import { parseCsv } from './csv'

const provinces = [
  { code: '79', name: 'TP. Hồ Chí Minh' },
  { code: '01', name: 'Hà Nội' },
]

describe('parseCsv', () => {
  it('reads commas, quotes and CRLF', () => {
    expect(parseCsv('a,b,c\r\n1,"x, y",3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', '3'],
    ])
  })

  it('detects semicolons and tabs, and strips the BOM', () => {
    expect(parseCsv('﻿a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles escaped quotes and skips blank lines', () => {
    expect(parseCsv('a,b\n"say ""hi""",2\n\n')).toEqual([['a', 'b'], ['say "hi"', '2']])
  })
})

describe('parseWardRows', () => {
  it('reads a file with Vietnamese headers and province names', () => {
    const rows = parseCsv(
      'Mã xã,Tên xã,Tỉnh/Thành phố\n26734,Phường Bến Thành,Thành phố Hồ Chí Minh\n00001,Phường Hoàn Kiếm,Hà Nội',
    )
    expect(parseWardRows(rows, provinces)).toEqual({
      wards: [
        { code: '26734', province_code: '79', name: 'Phường Bến Thành' },
        { code: '00001', province_code: '01', name: 'Phường Hoàn Kiếm' },
      ],
      errors: [],
    })
  })

  it('accepts a province code and English headers', () => {
    const rows = parseCsv('ward_code,ward_name,province_code\n26734,Phường Bến Thành,79')
    expect(parseWardRows(rows, provinces).wards).toEqual([
      { code: '26734', province_code: '79', name: 'Phường Bến Thành' },
    ])
  })

  it('reports bad rows without dropping good ones', () => {
    const rows = parseCsv(
      'code,name,province\n1,A,79\n2,B,Atlantis\n,C,79\n1,D,79',
    )
    const result = parseWardRows(rows, provinces)
    expect(result.wards).toHaveLength(1)
    expect(result.errors).toEqual([
      'Dòng 3: không nhận ra tỉnh "Atlantis"',
      'Dòng 4: thiếu mã, tên hoặc tỉnh',
      'Dòng 5: mã "1" bị trùng',
    ])
  })

  it('explains missing columns', () => {
    const result = parseWardRows(parseCsv('foo,bar\n1,2'), provinces)
    expect(result.wards).toEqual([])
    expect(result.errors[0]).toContain('Không nhận ra cột')
  })

  it('rejects an empty file', () => {
    expect(parseWardRows([['code', 'name', 'province']], provinces).errors).toHaveLength(1)
  })
})
