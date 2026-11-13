import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/Field'
import { Badge, Card, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { toMessage } from '@/lib/errors'
import { readFileBytes } from '@/lib/files'
import { STATUS_LABEL, type OrderStatus } from '@/features/orders/status'
import { applyTracking, fetchOrderStatuses, type TrackingResult } from './api'
import { detectTrackingColumns, extractTracking, parsePastedTracking, readSheetRows, type TrackingColumns, type TrackingRow } from './tracking'

export function VtpTrackingPage() {
  const shop = useShop()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [raw, setRaw] = useState<string[][] | null>(null)
  const [columns, setColumns] = useState<TrackingColumns | null>(null)
  const [pasted, setPasted] = useState('')
  const [rows, setRows] = useState<TrackingRow[]>([])
  const [result, setResult] = useState<TrackingResult | null>(null)
  const [applying, setApplying] = useState(false)

  const normalized = rows.map((r) => ({ ...r, order_code: r.order_code.trim().toUpperCase() }))
  const codes = normalized.map((r) => r.order_code)
  const statuses = useQuery({
    queryKey: ['shop', shop.id, 'vtp', 'tracking-preview', codes.join(',')],
    queryFn: () => fetchOrderStatuses(shop.id, codes),
    enabled: codes.length > 0,
  })
  const byCode = new Map((statuses.data ?? []).map((o) => [o.code.toUpperCase(), o]))

  function problem(code: string): string | null {
    const o = byCode.get(code)
    if (!statuses.data) return null
    if (!o) return 'Không tìm thấy đơn'
    if (o.delivery_method !== 'vtp') return 'Đơn không giao bằng ViettelPost'
    if (!['confirmed', 'vtp_exported', 'shipping'].includes(o.status)) return `Đơn đang ở trạng thái “${STATUS_LABEL[o.status as OrderStatus]}”`
    return null
  }
  const usable = normalized.filter((r) => problem(r.order_code) === null)

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed = await readSheetRows({ name: file.name, bytes: await readFileBytes(file), text: () => file.text() })
      const detected = detectTrackingColumns(parsed)
      setFileName(file.name)
      setRaw(parsed)
      setColumns(detected)
      setResult(null)
      setRows(detected ? extractTracking(parsed, detected) : [])
      if (!detected) toast.message('Chưa nhận ra cột mã đơn / mã vận đơn, hãy chọn tay bên dưới')
    } catch (error) {
      toast.error(await toMessage(error))
    }
  }

  function chooseColumn(which: 'orderCol' | 'trackingCol', value: number) {
    if (!raw) return
    const next: TrackingColumns = { headerRow: 0, orderCol: -1, trackingCol: -1, ...columns, [which]: value }
    setColumns(next)
    if (next.orderCol >= 0 && next.trackingCol >= 0) setRows(extractTracking(raw, next))
  }

  function usePasted() {
    setResult(null)
    setRows(parsePastedTracking(pasted))
    setRaw(null)
    setFileName('')
  }

  async function apply() {
    setApplying(true)
    try {
      const outcome = await applyTracking(shop.id, usable)
      setResult(outcome)
      setRows([])
      await queryClient.invalidateQueries({ queryKey: ['shop', shop.id] })
      toast.success(`Đã cập nhật ${outcome.applied} đơn`)
    } catch (error) {
      toast.error(await toMessage(error))
    } finally {
      setApplying(false)
    }
  }

  const width = raw ? Math.max(...raw.map((r) => r.length)) : 0

  return (
    <>
      <PageHeader title="Nhập mã vận đơn" subtitle={shop.name} back="/shop/vtp/export" />
      <PageBody className="flex flex-col gap-5 pb-32">
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Sau khi tạo đơn trên ViettelPost, tải danh sách đơn về (Excel hoặc CSV) rồi chọn ở đây. App khớp theo <strong>mã đơn của shop</strong> và điền mã vận đơn, đơn chuyển sang “Đang giao”.
          </p>
          <input ref={fileInput} type="file" accept=".xlsx,.csv,.tsv,.txt" className="hidden" aria-label="Chọn file danh sách đơn" onChange={onFile} />
          <Button variant="secondary" icon={<FileUp className="size-5" />} onClick={() => fileInput.current?.click()}>
            Chọn file từ ViettelPost
          </Button>
          {fileName && <p className="text-sm font-medium">{fileName}</p>}

          {raw && (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['orderCol', 'Cột mã đơn của shop'],
                  ['trackingCol', 'Cột mã vận đơn'],
                ] as const
              ).map(([key, label]) => (
                <SelectField key={key} label={label} value={String(columns?.[key] ?? -1)} onChange={(e) => chooseColumn(key, Number(e.target.value))}>
                  <option value="-1">Chọn cột…</option>
                  {Array.from({ length: width }, (_, i) => (
                    <option key={i} value={i}>
                      {String.fromCharCode(65 + (i % 26))}: {raw[0]?.[i] || raw[1]?.[i] || '(trống)'}
                    </option>
                  ))}
                </SelectField>
              ))}
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <p className="font-medium">Hoặc dán danh sách</p>
          <textarea
            aria-label="Dán mã đơn và mã vận đơn"
            rows={4}
            placeholder={'AN261113-001  VTP123456789\nAN261113-002  VTP987654321'}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface p-3.5 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
          <Button variant="secondary" disabled={!pasted.trim()} onClick={usePasted}>
            Đọc danh sách
          </Button>
        </Card>

        {rows.length > 0 && (
          <section>
            <SectionTitle>
              {usable.length}/{rows.length} dòng áp dụng được
            </SectionTitle>
            {statuses.isLoading ? (
              <LoadingBlock />
            ) : (
              <ul className="flex flex-col gap-2">
                {normalized.map((r, i) => {
                  const issue = problem(r.order_code)
                  return (
                    <li key={`${r.order_code}-${i}`}>
                      <Card className="flex items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{r.order_code}</p>
                          <p className="text-sm text-muted">Mã vận đơn: {r.tracking_code}</p>
                        </div>
                        {issue ? <Badge tone="danger">{issue}</Badge> : <Badge tone="success">Sẽ cập nhật</Badge>}
                      </Card>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {result && (
          <Card className="flex flex-col gap-2">
            <p className="font-semibold">Đã cập nhật {result.applied} đơn</p>
            {result.skipped.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-danger">
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    {s.code}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </PageBody>

      {rows.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto max-w-screen-sm px-4 py-3">
            <Button block loading={applying} disabled={usable.length === 0} onClick={apply}>
              Cập nhật {usable.length} đơn
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
