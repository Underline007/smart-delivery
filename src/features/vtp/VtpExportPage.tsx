import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Share2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { catalogCounts, fetchProvinces } from '@/features/customers/api'
import { listOrders } from '@/features/orders/api'
import { fetchShop } from '@/lib/api'
import { toMessage } from '@/lib/errors'
import { base64ToBytes, downloadFile, shareFile } from '@/lib/files'
import { cn } from '@/lib/cn'
import { formatDateTime, formatMoney, formatWeight, todayVn } from '@/lib/format'
import {
  cancelBatch,
  createBatch,
  fetchOrdersByIds,
  fetchOrdersOfBatch,
  fetchVtpTemplate,
  fetchWardNames,
  listBatches,
  type Batch,
} from './api'
import { buildWorkbook, exportFileName } from './exporter'
import { DEFAULT_MAPPING } from './fields'
import { toExportOrder, validateForVtp } from './prepare'

export function VtpExportPage() {
  const shop = useShop()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const idsParam = params.get('orders')
  const ids = useMemo(() => (idsParam ? idsParam.split(',').filter(Boolean) : []), [idsParam])

  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<{ fileName: string; bytes: Uint8Array; count: number } | null>(null)
  const [cancelling, setCancelling] = useState<Batch | null>(null)

  const orders = useQuery({
    queryKey: ['shop', shop.id, 'vtp', 'orders', idsParam ?? 'all'],
    queryFn: () => (ids.length > 0 ? fetchOrdersByIds(ids) : listOrders(shop.id, { statuses: ['confirmed'], method: 'vtp' })),
  })
  const template = useQuery({ queryKey: ['vtp-template'], queryFn: fetchVtpTemplate })
  const shopInfo = useQuery({ queryKey: ['shop', shop.id], queryFn: () => fetchShop(shop.id) })
  const counts = useQuery({ queryKey: ['catalog', 'counts'], queryFn: catalogCounts })
  const provinces = useQuery({ queryKey: ['catalog', 'provinces'], queryFn: fetchProvinces, staleTime: Infinity })
  const wardCodes = useMemo(
    () => [...new Set((orders.data ?? []).map((o) => o.ship_ward_code).filter((c): c is string => Boolean(c)))],
    [orders.data],
  )
  const wards = useQuery({
    queryKey: ['catalog', 'ward-names', wardCodes.join(',')],
    queryFn: () => fetchWardNames(wardCodes),
    enabled: orders.isSuccess,
  })
  const batches = useQuery({ queryKey: ['shop', shop.id, 'vtp', 'batches'], queryFn: () => listBatches(shop.id) })

  const mapping = template.data?.mapping ?? DEFAULT_MAPPING
  const names = useMemo(
    () => ({
      provinces: new Map((provinces.data ?? []).map((p) => [p.code, p.name])),
      wards: new Map((wards.data ?? []).map((w) => [w.code, w.name])),
    }),
    [provinces.data, wards.data],
  )
  const ready = orders.isSuccess && template.isSuccess && shopInfo.isSuccess && provinces.isSuccess && wards.isSuccess

  const rows = (orders.data ?? []).map((order) => ({
    order,
    check: validateForVtp(order, { wardCatalogLoaded: (counts.data?.wards ?? 0) > 0 }),
  }))
  const selected = rows.filter((r) => !excluded.has(r.order.id))
  const blocked = selected.filter((r) => r.check.errors.length > 0)

  async function generate(source: Parameters<typeof toExportOrder>[0][]) {
    const info = shopInfo.data!
    return buildWorkbook({
      orders: source.map((o, i) => toExportOrder(o, i + 1, names, mapping.maxProductNameLength)),
      sender: { name: info.name, phone: info.phone ?? '', address: info.address ?? '' },
      mapping,
      template: template.data?.b64 ? base64ToBytes(template.data.b64) : undefined,
    })
  }

  async function exportNow() {
    setWorking(true)
    try {
      const chosen = selected.map((r) => r.order)
      const fileName = exportFileName(shop.order_prefix, chosen.length, todayVn())
      const bytes = await generate(chosen)
      // The batch is recorded first: if this fails nothing is downloaded and no order changes.
      await createBatch(shop.id, chosen.map((o) => o.id), fileName, template.data?.version ?? null)
      downloadFile(fileName, bytes)
      setResult({ fileName, bytes, count: chosen.length })
      await queryClient.invalidateQueries({ queryKey: ['shop', shop.id] })
    } catch (error) {
      toast.error(await toMessage(error))
    } finally {
      setWorking(false)
    }
  }

  async function redownload(batch: Batch) {
    try {
      const batchOrders = await fetchOrdersOfBatch(batch.id)
      if (batchOrders.length === 0) {
        toast.error('Các đơn của lô này đã chuyển sang bước khác nên không tạo lại được file')
        return
      }
      downloadFile(batch.file_name, await generate(batchOrders))
    } catch (error) {
      toast.error(await toMessage(error))
    }
  }

  async function doCancel() {
    if (!cancelling) return
    try {
      const n = await cancelBatch(shop.id, cancelling.id)
      toast.success(`Đã huỷ lô, ${n} đơn trở về “Đã xác nhận”`)
      setCancelling(null)
      await queryClient.invalidateQueries({ queryKey: ['shop', shop.id] })
    } catch (error) {
      toast.error(await toMessage(error))
    }
  }

  const toggle = (id: string) =>
    setExcluded((all) => {
      const next = new Set(all)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <PageHeader title="Xuất Excel ViettelPost" subtitle={shop.name} back="/shop/orders" />
      <PageBody className="flex flex-col gap-5 pb-32">
        {result ? (
          <Card className="flex flex-col gap-3 border-success bg-success-soft">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-6" />
              <p className="font-semibold">Đã xuất {result.count} đơn</p>
            </div>
            <p className="text-sm">
              File <strong>{result.fileName}</strong> đã được tải về. Các đơn chuyển sang “Đã xuất file VTP”.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => downloadFile(result.fileName, result.bytes)}>
                Tải lại
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Share2 className="size-4" />}
                onClick={async () => {
                  if (!(await shareFile(result.fileName, result.bytes))) toast.message('Thiết bị không hỗ trợ chia sẻ file, hãy dùng nút Tải lại')
                }}
              >
                Chia sẻ
              </Button>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>Mở viettelpost.vn, đăng nhập, chọn <strong>Tạo đơn → Nhập Excel</strong>.</li>
              <li>Chọn file vừa xuất và kiểm tra các dòng báo lỗi (nếu có).</li>
              <li>
                Sau khi tạo đơn, tải danh sách đơn từ ViettelPost rồi{' '}
                <Link to="/shop/vtp/tracking" className="font-semibold underline">
                  nhập mã vận đơn
                </Link>
                .
              </li>
            </ol>
          </Card>
        ) : null}

        {!template.data?.mapping && template.isSuccess && (
          <p className="flex gap-2 rounded-xl bg-warning-soft px-3.5 py-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Chưa có file mẫu ViettelPost nên đang dùng bố cục Excel chung. Nhờ admin tải file mẫu thật lên ở Cài đặt → Mẫu Excel ViettelPost để file khớp 100%.
          </p>
        )}

        <section>
          <SectionTitle>Đơn sẽ xuất</SectionTitle>
          {!ready && !orders.error ? (
            <LoadingBlock />
          ) : orders.error ? (
            <ErrorBlock message="Không tải được danh sách đơn" onRetry={() => orders.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState icon={<FileSpreadsheet className="size-7" />} title="Không có đơn nào để xuất">
              Chỉ xuất được đơn giao bằng ViettelPost ở trạng thái “Đã xác nhận”.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map(({ order, check }) => {
                const on = !excluded.has(order.id)
                return (
                  <li key={order.id}>
                    <Card className={cn('flex flex-col gap-2', !on && 'opacity-60', on && check.errors.length > 0 && 'border-danger')}>
                      <button type="button" className="flex items-start gap-3 text-left" onClick={() => toggle(order.id)} aria-pressed={on}>
                        <span
                          className={cn(
                            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 text-xs',
                            on ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                          )}
                          aria-hidden
                        >
                          {on && '✓'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {order.code} · {order.ship_name || '—'}
                          </p>
                          <p className="truncate text-sm text-muted">{order.ship_full_text || 'Chưa có địa chỉ'}</p>
                          <p className="text-sm text-muted">
                            {formatWeight(order.weight_g)} · Thu {formatMoney(order.cod_amount)}
                          </p>
                        </div>
                      </button>
                      {check.errors.map((e) => (
                        <p key={e} className="text-sm text-danger">
                          ✕ {e}
                        </p>
                      ))}
                      {check.warnings.map((w) => (
                        <p key={w} className="text-sm text-warning">
                          ⚠ {w}
                        </p>
                      ))}
                      {check.errors.length > 0 && (
                        <Link to={`/shop/orders/${order.id}`} className="text-sm font-semibold text-primary">
                          Mở đơn để sửa (bấm “Mở lại để sửa”) →
                        </Link>
                      )}
                    </Card>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle
            action={
              <Link to="/shop/vtp/tracking" className="text-sm font-semibold text-primary">
                Nhập mã vận đơn
              </Link>
            }
          >
            Các lần xuất trước
          </SectionTitle>
          {batches.data?.length === 0 ? (
            <p className="px-1 text-sm text-muted">Chưa xuất lần nào.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {batches.data?.map((batch) => (
                <li key={batch.id}>
                  <Card className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{batch.file_name}</p>
                      <p className="text-sm text-muted">
                        {batch.order_count} đơn · {formatDateTime(batch.created_at)}
                      </p>
                    </div>
                    {batch.cancelled_at ? (
                      <Badge tone="neutral">Đã huỷ</Badge>
                    ) : (
                      <div className="flex gap-1">
                        <Button size="sm" variant="secondary" aria-label={`Tải lại ${batch.file_name}`} icon={<Download className="size-4" />} onClick={() => redownload(batch)} />
                        <Button size="sm" variant="danger-soft" onClick={() => setCancelling(batch)}>
                          Huỷ lô
                        </Button>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageBody>

      {rows.length > 0 && !result && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto max-w-screen-sm px-4 py-3">
            {blocked.length > 0 && <p className="mb-2 text-sm text-danger">{blocked.length} đơn còn lỗi, bỏ chọn hoặc sửa trước khi xuất.</p>}
            <Button
              block
              icon={<FileSpreadsheet className="size-5" />}
              loading={working}
              disabled={!ready || selected.length === 0 || blocked.length > 0}
              onClick={exportNow}
            >
              Tạo file Excel ({selected.length} đơn)
            </Button>
          </div>
        </div>
      )}

      <ConfirmSheet
        open={Boolean(cancelling)}
        title="Huỷ lô xuất?"
        confirmLabel="Huỷ lô"
        danger
        onClose={() => setCancelling(null)}
        onConfirm={doCancel}
      >
        Các đơn trong lô chưa có mã vận đơn sẽ trở về “Đã xác nhận” để xuất lại. Nhớ xoá file này khỏi ViettelPost nếu đã tải lên.
      </ConfirmSheet>
    </>
  )
}
