import type { Province } from './vn/address'
import { searchKey } from './vn/text'

export interface WardRow {
  code: string
  province_code: string
  name: string
}

export interface WardImport {
  wards: WardRow[]
  errors: string[]
}

type Matcher = (words: string[]) => boolean

function findColumn(headers: string[], ...matchers: Matcher[]): number {
  const tokens = headers.map((h) => searchKey(h).replace(/[^a-z0-9]+/g, ' ').trim().split(' '))
  for (const match of matchers) {
    const index = tokens.findIndex(match)
    if (index >= 0) return index
  }
  return -1
}

const has = (words: string[], ...options: string[]) => options.some((o) => words.includes(o))
const WARD = ['xa', 'phuong', 'ward']
const CODE = ['ma', 'code']
const PROVINCE = ['tinh', 'province', 'city']

const stripProvincePrefix = (key: string) => key.replace(/^(thanh pho|tinh|tp)\s+/, '').trim()

/**
 * Turns the rows of a ward CSV into rows for admin_upsert_wards.
 * Columns are recognised by their header: a ward code, a ward name and a province
 * (code or name). Province names are matched with or without "Tỉnh / TP.".
 */
export function parseWardRows(rows: string[][], provinces: Province[]): WardImport {
  const errors: string[] = []
  if (rows.length < 2) return { wards: [], errors: ['File không có dòng dữ liệu nào'] }

  const headers = rows[0]
  const codeCol = findColumn(
    headers,
    (w) => has(w, ...CODE) && has(w, ...WARD),
    (w) => w.length === 1 && has(w, ...CODE),
  )
  const nameCol = findColumn(
    headers,
    (w) => has(w, 'ten', 'name') && has(w, ...WARD),
    (w) => has(w, ...WARD) && !has(w, ...CODE),
    (w) => w.length === 1 && has(w, 'ten', 'name'),
  )
  const provinceCol = findColumn(
    headers,
    (w) => has(w, ...CODE) && has(w, ...PROVINCE),
    (w) => has(w, ...PROVINCE) || (has(w, 'thanh') && has(w, 'pho')),
  )

  if (codeCol < 0 || nameCol < 0 || provinceCol < 0) {
    const missing = [
      codeCol < 0 && 'mã xã/phường',
      nameCol < 0 && 'tên xã/phường',
      provinceCol < 0 && 'tỉnh/thành',
    ].filter(Boolean)
    return { wards: [], errors: [`Không nhận ra cột: ${missing.join(', ')}. Kiểm tra dòng tiêu đề.`] }
  }

  const byCode = new Set(provinces.map((p) => p.code))
  const byName = new Map(provinces.map((p) => [stripProvincePrefix(searchKey(p.name).replace(/[^a-z0-9]+/g, ' ').trim()), p.code]))

  const wards: WardRow[] = []
  const seen = new Set<string>()
  rows.slice(1).forEach((row, i) => {
    const line = i + 2
    const code = row[codeCol]?.trim()
    const name = row[nameCol]?.trim()
    const provinceValue = row[provinceCol]?.trim()
    if (!code || !name || !provinceValue) {
      errors.push(`Dòng ${line}: thiếu mã, tên hoặc tỉnh`)
      return
    }
    const provinceCode = byCode.has(provinceValue)
      ? provinceValue
      : byName.get(stripProvincePrefix(searchKey(provinceValue).replace(/[^a-z0-9]+/g, ' ').trim()))
    if (!provinceCode) {
      errors.push(`Dòng ${line}: không nhận ra tỉnh "${provinceValue}"`)
      return
    }
    if (seen.has(code)) {
      errors.push(`Dòng ${line}: mã "${code}" bị trùng`)
      return
    }
    seen.add(code)
    wards.push({ code, province_code: provinceCode, name })
  })

  return { wards, errors }
}
