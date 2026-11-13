import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Card, SectionTitle } from '@/components/ui/misc'
import { catalogCounts, fetchProvinces, upsertAliases, upsertWards } from '@/features/customers/api'
import { parseWardRows, type WardImport } from '@/lib/catalog-import'
import { parseCsv } from '@/lib/csv'
import { toMessage } from '@/lib/errors'
import { formatNumber } from '@/lib/format'
import { useAction } from '@/lib/useAction'

const BATCH = 500

export function AdminCatalogPage() {
  const queryClient = useQueryClient()
  const counts = useQuery({ queryKey: ['catalog', 'counts'], queryFn: catalogCounts })
  const provinces = useQuery({ queryKey: ['catalog', 'provinces'], queryFn: fetchProvinces, staleTime: Infinity })
  const fileInput = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<(WardImport & { fileName: string }) | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [alias, setAlias] = useState('')
  const [aliasProvince, setAliasProvince] = useState('')

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !provinces.data) return
    const rows = parseCsv(await file.text())
    setPreview({ ...parseWardRows(rows, provinces.data), fileName: file.name })
  }

  async function runImport() {
    if (!preview) return
    try {
      for (let i = 0; i < preview.wards.length; i += BATCH) {
        setProgress(i)
        await upsertWards(preview.wards.slice(i, i + BATCH))
      }
      toast.success(`Đã nhập ${formatNumber(preview.wards.length)} xã/phường`)
      setPreview(null)
      await queryClient.invalidateQueries({ queryKey: ['catalog'] })
    } catch (error) {
      toast.error(await toMessage(error))
    } finally {
      setProgress(null)
    }
  }

  const addAlias = useAction(
    () => upsertAliases([{ alias: alias.trim(), province_code: aliasProvince }]),
    {
      success: 'Đã thêm tên gọi khác',
      invalidate: [['catalog', 'province-aliases']],
      onSuccess: () => setAlias(''),
    },
  )

  return (
    <>
      <PageHeader title="Danh mục tỉnh / xã" back="/admin/settings" />
      <PageBody className="flex flex-col gap-5">
        <Card className="grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="text-3xl font-bold tabular-nums">{counts.data?.provinces ?? '–'}</p>
            <p className="text-sm text-muted">Tỉnh / thành</p>
          </div>
          <div>
            <p className="text-3xl font-bold tabular-nums">{counts.data ? formatNumber(counts.data.wards) : '–'}</p>
            <p className="text-sm text-muted">Phường / xã</p>
          </div>
        </Card>

        <section>
          <SectionTitle>Nhập danh sách phường / xã</SectionTitle>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Chọn file CSV có 3 cột: mã xã/phường, tên xã/phường, tỉnh/thành (mã tỉnh hoặc tên tỉnh). Nên dùng đúng danh
              mục trong file mẫu của ViettelPost để file Excel xuất ra khớp tên. Nhập lại nhiều lần được, mã trùng sẽ được cập nhật.
            </p>
            <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden" onChange={onFile} aria-label="Chọn file CSV" />
            <Button variant="secondary" icon={<FileUp className="size-5" />} disabled={!provinces.data} onClick={() => fileInput.current?.click()}>
              Chọn file CSV
            </Button>

            {preview && (
              <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3">
                <p className="font-medium">{preview.fileName}</p>
                <p className="text-sm">
                  <strong>{formatNumber(preview.wards.length)}</strong> dòng hợp lệ
                  {preview.errors.length > 0 && <span className="text-danger"> · {preview.errors.length} dòng lỗi</span>}
                </p>
                {preview.errors.length > 0 && (
                  <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm text-danger">
                    {preview.errors.slice(0, 50).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" block onClick={() => setPreview(null)}>
                    Bỏ
                  </Button>
                  <Button block disabled={preview.wards.length === 0} loading={progress !== null} onClick={runImport}>
                    {progress !== null ? `Đang nhập ${formatNumber(progress)}…` : 'Nhập vào hệ thống'}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle>Tên gọi khác của tỉnh</SectionTitle>
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Tên cũ hoặc cách viết tắt khách hay dùng (ví dụ “Thủ Dầu Một” → TP. Hồ Chí Minh). App dùng để tự nhận tỉnh
              khi dán tin nhắn. Đã có sẵn các tỉnh cũ đã sáp nhập.
            </p>
            <TextField label="Tên gọi" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={60} />
            <SelectField label="Thuộc tỉnh" value={aliasProvince} onChange={(e) => setAliasProvince(e.target.value)}>
              <option value="">Chọn tỉnh/thành…</option>
              {provinces.data?.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <Button variant="secondary" disabled={!alias.trim() || !aliasProvince} loading={addAlias.isPending} onClick={() => addAlias.mutate(undefined)}>
              Thêm
            </Button>
          </Card>
        </section>
      </PageBody>
    </>
  )
}
