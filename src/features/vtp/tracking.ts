import { parseCsv } from '@/lib/csv'
import { searchKey } from '@/lib/vn/text'

/** Reads the first sheet of an .xlsx (or a CSV) into rows of plain text. */
export async function readSheetRows(file: { name: string; bytes: Uint8Array; text?: () => Promise<string> }): Promise<string[][]> {
  if (/\.(csv|tsv|txt)$/i.test(file.name)) {
    const text = file.text ? await file.text() : new TextDecoder().decode(file.bytes)
    return parseCsv(text)
  }
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(file.bytes as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []

  const rows: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value))
    rows.push(cells)
  })
  return rows.filter((r) => r.some((c) => c !== ''))
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const v = value as { richText?: { text: string }[]; text?: string; result?: unknown; hyperlink?: string }
    if (v.richText) return v.richText.map((t) => t.text).join('').trim()
    if (v.result !== undefined) return cellText(v.result)
    if (v.text !== undefined) return String(v.text).trim()
    if (value instanceof Date) return value.toISOString()
  }
  return String(value).trim()
}

export interface TrackingColumns {
  headerRow: number
  orderCol: number
  trackingCol: number
}

const ORDER_CODE = /^[A-Z0-9]{1,5}\d{6}-\d{3}$/i
const TRACKING_CODE = /^[A-Z0-9]{7,20}$/i

/**
 * Finds which columns hold the shop's own order code and the tracking code:
 * first by header text, then by what the cells look like.
 */
export function detectTrackingColumns(rows: string[][]): TrackingColumns | null {
  if (rows.length < 2) return null
  const key = (s: string) => searchKey(s).replace(/[^a-z0-9]+/g, ' ').trim()

  let orderCol = -1
  let trackingCol = -1
  let headerRow = 0
  for (let r = 0; r < Math.min(rows.length, 10) && (orderCol < 0 || trackingCol < 0); r++) {
    const headers = rows[r].map(key)
    const order = headers.findIndex((h) => /(ma don|ma tham chieu|ma khach hang|order|ma rieng|ref)/.test(h) && !/van don/.test(h))
    const tracking = headers.findIndex((h) => /(van don|bill|tracking|ma buu gui|buu gui)/.test(h))
    if (order >= 0 && tracking >= 0) {
      orderCol = order
      trackingCol = tracking
      headerRow = r
    }
  }

  if (orderCol < 0 || trackingCol < 0) {
    const width = Math.max(...rows.map((r) => r.length))
    const score = (col: number, pattern: RegExp) => rows.filter((r) => pattern.test((r[col] ?? '').trim())).length
    let bestOrder = { col: -1, n: 0 }
    for (let c = 0; c < width; c++) {
      const n = score(c, ORDER_CODE)
      if (n > bestOrder.n) bestOrder = { col: c, n }
    }
    if (bestOrder.n === 0) return null
    let bestTracking = { col: -1, n: 0 }
    for (let c = 0; c < width; c++) {
      if (c === bestOrder.col) continue
      const n = rows.filter((r) => TRACKING_CODE.test((r[c] ?? '').trim()) && !ORDER_CODE.test((r[c] ?? '').trim())).length
      if (n > bestTracking.n) bestTracking = { col: c, n }
    }
    if (bestTracking.n === 0) return null
    orderCol = bestOrder.col
    trackingCol = bestTracking.col
    headerRow = rows.findIndex((r) => !ORDER_CODE.test((r[orderCol] ?? '').trim()))
    if (headerRow < 0 || headerRow > 5) headerRow = -1
  }
  return { headerRow, orderCol, trackingCol }
}

export interface TrackingRow {
  order_code: string
  tracking_code: string
}

/** Rows below the header that have both a code and a tracking number. */
export function extractTracking(rows: string[][], columns: TrackingColumns): TrackingRow[] {
  return rows
    .slice(columns.headerRow + 1)
    .map((r) => ({ order_code: (r[columns.orderCol] ?? '').trim(), tracking_code: (r[columns.trackingCol] ?? '').trim() }))
    .filter((r) => r.order_code !== '' && r.tracking_code !== '')
}

/** Lines like "AN261113-001  VTP123456789" (any separator, any order). */
export function parsePastedTracking(text: string): TrackingRow[] {
  const rows: TrackingRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.split(/[\s,;\t]+/).filter(Boolean)
    const order = tokens.find((t) => ORDER_CODE.test(t))
    const tracking = tokens.find((t) => t !== order && /^[A-Z0-9]{7,20}$/i.test(t))
    if (order && tracking) rows.push({ order_code: order, tracking_code: tracking })
  }
  return rows
}

