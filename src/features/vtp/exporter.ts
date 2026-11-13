import {
  columnIndex,
  DEFAULT_MAPPING,
  DEFAULT_VALUE_LABELS,
  FIELD_BY_ID,
  STATIC_FIELD,
  type CellValue,
  type ExportOrder,
  type SenderInfo,
  type TemplateMapping,
  type ValueLabels,
} from './fields'

export interface BuildArgs {
  orders: ExportOrder[]
  sender: SenderInfo
  /** Column mapping. Defaults to the built-in generic layout. */
  mapping?: TemplateMapping
  /** The .xlsx template to fill. Without it a new workbook with the mapping's headers is made. */
  template?: Uint8Array | ArrayBuffer
}

// Fields that must stay text so Excel keeps leading zeros.
const TEXT_FIELDS = new Set(['receiver_phone', 'sender_phone', 'order_code'])

function labelsOf(mapping: TemplateMapping): ValueLabels {
  return {
    fee_payer: { ...DEFAULT_VALUE_LABELS.fee_payer, ...mapping.values?.fee_payer },
    requirement: { ...DEFAULT_VALUE_LABELS.requirement, ...mapping.values?.requirement },
  }
}

/** Value of one mapped column for one order. */
export function cellValue(
  column: TemplateMapping['columns'][number],
  order: ExportOrder,
  sender: SenderInfo,
  labels: ValueLabels,
): CellValue {
  if (column.field === STATIC_FIELD) return column.value ?? ''
  const field = FIELD_BY_ID.get(column.field)
  return field ? field.get(order, { sender, labels }) : ''
}

/**
 * Builds the .xlsx for ViettelPost's bulk import. With a template, the data is
 * written into it (keeping its formatting, lists and other sheets); without
 * one, a plain workbook with the mapping's headers is created.
 */
export async function buildWorkbook(args: BuildArgs): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs')
  const mapping = args.mapping ?? DEFAULT_MAPPING
  const labels = labelsOf(mapping)
  const workbook = new ExcelJS.Workbook()

  let sheet: import('exceljs').Worksheet | undefined
  if (args.template) {
    await workbook.xlsx.load(args.template as ArrayBuffer)
    sheet = mapping.sheet ? workbook.getWorksheet(mapping.sheet) : workbook.worksheets[0]
    if (!sheet) throw new Error(`Không tìm thấy sheet "${mapping.sheet}" trong file mẫu`)
  } else {
    sheet = workbook.addWorksheet('Đơn hàng')
    const header = sheet.getRow(mapping.headerRow)
    for (const column of mapping.columns) {
      const cell = header.getCell(columnIndex(column.col))
      cell.value = column.header ?? FIELD_BY_ID.get(column.field)?.label ?? ''
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEEEA' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
      sheet.getColumn(columnIndex(column.col)).width = Math.max(14, Math.min((column.header ?? '').length + 4, 40))
    }
    sheet.views = [{ state: 'frozen', ySplit: mapping.headerRow }]
  }

  // Style of the template's first data row, copied to the rows below it.
  const styleRow = sheet.getRow(mapping.firstDataRow)
  const styles = new Map<number, Partial<import('exceljs').Style>>()
  for (const column of mapping.columns) {
    const index = columnIndex(column.col)
    const cell = styleRow.getCell(index)
    if (cell.style && Object.keys(cell.style).length > 0) styles.set(index, { ...cell.style })
  }

  args.orders.forEach((order, i) => {
    const row = sheet.getRow(mapping.firstDataRow + i)
    for (const column of mapping.columns) {
      const index = columnIndex(column.col)
      const cell = row.getCell(index)
      if (i > 0 && styles.has(index)) cell.style = { ...styles.get(index)! }
      const value = cellValue(column, order, args.sender, labels)
      cell.value = value
      if (typeof value === 'string' && (TEXT_FIELDS.has(column.field) || /^\d/.test(value))) cell.numFmt = '@'
    }
    row.commit?.()
  })

  // A template may ship with example rows; empty the mapped cells below our data.
  if (args.template) {
    const last = sheet.rowCount
    for (let r = mapping.firstDataRow + args.orders.length; r <= last; r++) {
      const row = sheet.getRow(r)
      for (const column of mapping.columns) row.getCell(columnIndex(column.col)).value = null
    }
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** "VTP_AN_20261113_15don.xlsx" */
export function exportFileName(shopPrefix: string, count: number, today: string): string {
  return `VTP_${shopPrefix}_${today.replace(/-/g, '')}_${count}don.xlsx`
}
