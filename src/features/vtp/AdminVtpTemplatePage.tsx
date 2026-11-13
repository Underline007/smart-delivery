import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileUp } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Badge, Card, SectionTitle } from '@/components/ui/misc'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { toMessage } from '@/lib/errors'
import { bytesToBase64, downloadFile, readFileBytes } from '@/lib/files'
import { fetchVtpTemplate, saveVtpTemplate } from './api'
import { buildWorkbook } from './exporter'
import {
  columnLetters,
  DEFAULT_MAPPING,
  DEFAULT_VALUE_LABELS,
  FIELDS,
  STATIC_FIELD,
  suggestField,
  type ColumnSpec,
  type ExportOrder,
  type TemplateMapping,
} from './fields'
import { cellText } from './tracking'

interface Loaded {
  name: string
  bytes: Uint8Array
  sheets: string[]
  /** Text of each sheet's first rows, for the preview and header detection. */
  preview: Record<string, string[][]>
}

const PREVIEW_ROWS = 15

async function loadWorkbook(file: File): Promise<Loaded> {
  const bytes = await readFileBytes(file)
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes as unknown as ArrayBuffer)
  const preview: Record<string, string[][]> = {}
  for (const sheet of wb.worksheets) {
    const rows: string[][] = []
    for (let r = 1; r <= Math.min(sheet.rowCount, PREVIEW_ROWS); r++) {
      const row = sheet.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= Math.max(sheet.columnCount, 1); c++) cells.push(cellText(row.getCell(c).value))
      rows.push(cells)
    }
    preview[sheet.name] = rows
  }
  return { name: file.name, bytes, sheets: wb.worksheets.map((s) => s.name), preview }
}

/** First row (within the preview) that has at least 3 filled cells: probably the header. */
function guessHeaderRow(rows: string[][]): number {
  const index = rows.findIndex((r) => r.filter(Boolean).length >= 3)
  return index >= 0 ? index + 1 : 1
}

const SAMPLE_ORDER: ExportOrder = {
  index: 1,
  code: 'AN261113-001',
  receiverName: 'Nguyễn Thị Lan',
  receiverPhone: '0912345678',
  receiverAddress: '12 Lê Lợi',
  receiverWard: 'Phường Bến Thành',
  receiverDistrict: '',
  receiverProvince: 'TP. Hồ Chí Minh',
  receiverFullAddress: '12 Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
  productName: 'Áo thun (Đỏ / M) x2',
  productQty: 2,
  weightG: 600,
  goodsValue: 300000,
  cod: 330000,
  service: 'VCN',
  feePayer: 'sender',
  deliveryRequirement: 'no_view',
  note: 'File thử, không tải lên ViettelPost',
}

export function AdminVtpTemplatePage() {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const current = useQuery({ queryKey: ['vtp-template'], queryFn: fetchVtpTemplate })
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [sheet, setSheet] = useState('')
  const [headerRow, setHeaderRow] = useState(1)
  const [firstDataRow, setFirstDataRow] = useState(2)
  const [columns, setColumns] = useState<ColumnSpec[]>([])
  const [labels, setLabels] = useState(DEFAULT_VALUE_LABELS)
  const [maxName, setMaxName] = useState(200)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const rows = loaded?.preview[sheet] ?? []

  function buildColumns(sheetRows: string[][], header: number): ColumnSpec[] {
    const cells = sheetRows[header - 1] ?? []
    return cells
      .map((text, i): ColumnSpec | null => {
        if (!text) return null
        const field = suggestField(text)
        return { col: columnLetters(i + 1), field: field ?? '', header: text }
      })
      .filter((c): c is ColumnSpec => c !== null)
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const wb = await loadWorkbook(file)
      const first = wb.sheets[0] ?? ''
      const header = guessHeaderRow(wb.preview[first] ?? [])
      setLoaded(wb)
      setSheet(first)
      setHeaderRow(header)
      setFirstDataRow(header + 1)
      setColumns(buildColumns(wb.preview[first] ?? [], header))
    } catch (error) {
      toast.error(`Không đọc được file: ${await toMessage(error)}. Hãy dùng file .xlsx (mở file .xls bằng Excel rồi lưu lại thành .xlsx).`)
    }
  }

  function changeSheet(name: string) {
    if (!loaded) return
    const header = guessHeaderRow(loaded.preview[name] ?? [])
    setSheet(name)
    setHeaderRow(header)
    setFirstDataRow(header + 1)
    setColumns(buildColumns(loaded.preview[name] ?? [], header))
  }

  function changeHeaderRow(value: number) {
    setHeaderRow(value)
    setFirstDataRow(value + 1)
    setColumns(buildColumns(rows, value))
  }

  const patch = (col: string, update: Partial<ColumnSpec>) =>
    setColumns((all) => all.map((c) => (c.col === col ? { ...c, ...update } : c)))

  const mapping: TemplateMapping = {
    sheet: sheet || null,
    headerRow,
    firstDataRow,
    maxProductNameLength: maxName,
    columns: columns.filter((c) => c.field),
    values: labels,
  }

  async function save() {
    if (!loaded) return
    if (mapping.columns.length === 0) {
      toast.error('Chọn dữ liệu cho ít nhất một cột')
      return
    }
    setSaving(true)
    try {
      await saveVtpTemplate({ name: loaded.name, b64: bytesToBase64(loaded.bytes), mapping })
      toast.success('Đã lưu mẫu Excel ViettelPost')
      setLoaded(null)
      await queryClient.invalidateQueries({ queryKey: ['vtp-template'] })
    } catch (error) {
      toast.error(await toMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    try {
      await saveVtpTemplate({ name: null, b64: null, mapping: null })
      toast.success('Đã chuyển về bố cục mặc định')
      setResetting(false)
      await queryClient.invalidateQueries({ queryKey: ['vtp-template'] })
    } catch (error) {
      toast.error(await toMessage(error))
    }
  }

  async function sample() {
    try {
      const bytes = await buildWorkbook({
        orders: [SAMPLE_ORDER],
        sender: { name: 'Shop mẫu', phone: '0987654321', address: '1 Nguyễn Huệ' },
        mapping: current.data?.mapping ?? DEFAULT_MAPPING,
        template: current.data?.b64 ? Uint8Array.from(atob(current.data.b64), (c) => c.charCodeAt(0)) : undefined,
      })
      downloadFile('VTP_file_thu.xlsx', bytes)
    } catch (error) {
      toast.error(await toMessage(error))
    }
  }

  const unmapped = columns.filter((c) => !c.field).length

  return (
    <>
      <PageHeader title="Mẫu Excel ViettelPost" back="/admin/settings" />
      <PageBody className="flex flex-col gap-5 pb-32">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <p className="flex-1 font-semibold">Mẫu đang dùng</p>
            {current.data?.mapping ? <Badge tone="success">Đã có mẫu</Badge> : <Badge tone="warning">Bố cục mặc định</Badge>}
          </div>
          <p className="text-sm text-muted">
            {current.data?.mapping
              ? `${current.data.name ?? 'Mẫu tuỳ chỉnh'} · ${current.data.mapping.columns.length} cột đã gán · phiên bản ${current.data.version}`
              : 'Chưa tải file mẫu thật. App tạo file Excel với các cột chung, có thể ViettelPost không nhận hết. Hãy tải file mẫu “Tạo đơn hàng loạt” từ tài khoản ViettelPost lên.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={sample}>
              Tải file thử
            </Button>
            {current.data?.mapping && (
              <Button size="sm" variant="danger-soft" onClick={() => setResetting(true)}>
                Dùng bố cục mặc định
              </Button>
            )}
          </div>
        </Card>

        <Card className="flex flex-col gap-3">
          <p className="font-semibold">Tải file mẫu mới</p>
          <p className="text-sm text-muted">Chọn file .xlsx mẫu của ViettelPost. File được lưu trong hệ thống và điền dữ liệu đơn vào đúng các cột bạn chọn dưới đây.</p>
          <input ref={fileInput} type="file" accept=".xlsx" className="hidden" aria-label="Chọn file mẫu Excel" onChange={onFile} />
          <Button variant="secondary" icon={<FileUp className="size-5" />} onClick={() => fileInput.current?.click()}>
            Chọn file .xlsx
          </Button>
        </Card>

        {loaded && (
          <>
            <section className="flex flex-col gap-3">
              <SectionTitle>1. Vị trí dữ liệu</SectionTitle>
              <Card className="flex flex-col gap-4">
                <p className="text-sm font-medium">{loaded.name}</p>
                {loaded.sheets.length > 1 && (
                  <SelectField label="Sheet nhập đơn" value={sheet} onChange={(e) => changeSheet(e.target.value)}>
                    {loaded.sheets.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </SelectField>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="Dòng tiêu đề" inputMode="numeric" value={String(headerRow)} onChange={(e) => changeHeaderRow(Math.max(Number(e.target.value.replace(/\D/g, '')) || 1, 1))} />
                  <TextField label="Dòng điền đơn đầu tiên" inputMode="numeric" value={String(firstDataRow)} onChange={(e) => setFirstDataRow(Math.max(Number(e.target.value.replace(/\D/g, '')) || 1, 1))} />
                </div>
                <div className="-mx-1 overflow-x-auto px-1">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="border border-border bg-surface-2 px-1" />
                        {(rows[0] ?? []).map((_, i) => (
                          <th key={i} className="border border-border bg-surface-2 px-2 py-1">
                            {columnLetters(i + 1)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, r) => (
                        <tr key={r} className={r + 1 === headerRow ? 'bg-primary-soft' : r + 1 === firstDataRow ? 'bg-warning-soft' : ''}>
                          <th className="border border-border bg-surface-2 px-2">{r + 1}</th>
                          {row.map((cell, c) => (
                            <td key={c} className="max-w-32 truncate border border-border px-2 py-1">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">Dòng xanh là tiêu đề, dòng vàng là nơi bắt đầu điền đơn.</p>
              </Card>
            </section>

            <section className="flex flex-col gap-3">
              <SectionTitle>2. Mỗi cột chứa gì</SectionTitle>
              {columns.length === 0 ? (
                <p className="rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">Dòng tiêu đề {headerRow} đang trống. Hãy đổi “Dòng tiêu đề”.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {columns.map((column) => (
                    <li key={column.col}>
                      <Card className="flex flex-col gap-2 py-3">
                        <p className="text-sm">
                          <strong>Cột {column.col}</strong> · {column.header}
                        </p>
                        <select
                          aria-label={`Dữ liệu cho cột ${column.col}`}
                          value={column.field}
                          onChange={(e) => patch(column.col, { field: e.target.value })}
                          className="h-11 rounded-xl border border-border bg-surface px-3"
                        >
                          <option value="">(Bỏ trống)</option>
                          {FIELDS.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                          <option value={STATIC_FIELD}>Giá trị cố định…</option>
                        </select>
                        {column.field === STATIC_FIELD && (
                          <TextField label="Giá trị cố định" value={column.value ?? ''} onChange={(e) => patch(column.col, { value: e.target.value })} />
                        )}
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
              {unmapped > 0 && <p className="px-1 text-sm text-muted">{unmapped} cột để trống sẽ không được điền (giữ nguyên như trong mẫu).</p>}
            </section>

            <section className="flex flex-col gap-3">
              <SectionTitle>3. Cách ghi giá trị</SectionTitle>
              <Card className="flex flex-col gap-4">
                <p className="text-sm text-muted">Nếu mẫu có danh sách thả xuống, điền đúng chữ (hoặc mã) mà ViettelPost dùng.</p>
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="Người gửi trả cước" value={labels.fee_payer.sender} onChange={(e) => setLabels((l) => ({ ...l, fee_payer: { ...l.fee_payer, sender: e.target.value } }))} />
                  <TextField label="Người nhận trả cước" value={labels.fee_payer.receiver} onChange={(e) => setLabels((l) => ({ ...l, fee_payer: { ...l.fee_payer, receiver: e.target.value } }))} />
                </div>
                {(['no_view', 'view', 'try'] as const).map((key) => (
                  <TextField
                    key={key}
                    label={{ no_view: 'Không cho xem hàng', view: 'Cho xem hàng, không cho thử', try: 'Cho thử hàng' }[key]}
                    value={labels.requirement[key]}
                    onChange={(e) => setLabels((l) => ({ ...l, requirement: { ...l.requirement, [key]: e.target.value } }))}
                  />
                ))}
                <TextField label="Độ dài tối đa của “Tên hàng hoá”" inputMode="numeric" value={String(maxName)} onChange={(e) => setMaxName(Math.max(Number(e.target.value.replace(/\D/g, '')) || 50, 20))} hint="Tên dài hơn sẽ được rút gọn: “… +2 SP khác”" />
              </Card>
            </section>
          </>
        )}
      </PageBody>

      {loaded && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-screen-sm gap-2 px-4 py-3">
            <Button variant="secondary" block onClick={() => setLoaded(null)}>
              Bỏ
            </Button>
            <Button block loading={saving} onClick={save}>
              Lưu mẫu
            </Button>
          </div>
        </div>
      )}

      <ConfirmSheet open={resetting} title="Dùng bố cục mặc định?" confirmLabel="Xoá mẫu" danger onClose={() => setResetting(false)} onConfirm={reset}>
        File mẫu và cách gán cột đang lưu sẽ bị xoá. Các shop sẽ xuất file theo bố cục Excel chung.
      </ConfirmSheet>
    </>
  )
}
