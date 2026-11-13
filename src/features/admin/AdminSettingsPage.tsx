import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FileSpreadsheet, MapPinned, ScrollText } from 'lucide-react'
import { Link } from 'react-router'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { SelectField } from '@/components/ui/Field'
import { Card, SectionTitle } from '@/components/ui/misc'
import { fetchSystemSettings, saveSystemSettings } from '@/lib/api'
import { AccountSection } from '@/features/account/AccountSection'
import { useAction } from '@/lib/useAction'

function NavRow({ to, icon, label, hint }: { to: string; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <Link to={to} className="flex min-h-16 items-center gap-3 px-4 py-2 active:bg-surface-2">
      <span className="text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        <span className="block truncate text-sm text-muted">{hint}</span>
      </span>
      <ChevronRight className="size-5 text-muted" />
    </Link>
  )
}

export function AdminSettingsPage() {
  const settings = useQuery({ queryKey: ['system-settings'], queryFn: fetchSystemSettings })
  const save = useAction(saveSystemSettings, {
    success: 'Đã lưu',
    invalidate: [['system-settings']],
  })

  return (
    <>
      <PageHeader title="Cài đặt" />
      <PageBody className="flex flex-col gap-5">
        <Card className="p-0">
          <NavRow
            to="/admin/catalog"
            icon={<MapPinned className="size-5" />}
            label="Danh mục tỉnh / xã"
            hint="Nhập danh mục theo file mẫu ViettelPost"
          />
          <div className="border-t border-border" />
          <NavRow
            to="/admin/vtp-template"
            icon={<FileSpreadsheet className="size-5" />}
            label="Mẫu Excel ViettelPost"
            hint="Tải file mẫu lên và chọn cột"
          />
          <div className="border-t border-border" />
          <NavRow
            to="/admin/audit"
            icon={<ScrollText className="size-5" />}
            label="Nhật ký thao tác"
            hint="Ai đã làm gì, lúc nào"
          />
        </Card>

        <section>
          <SectionTitle>Bản đồ</SectionTitle>
          <Card>
            <SelectField
              label="Nhà cung cấp bản đồ"
              value={settings.data?.map_provider ?? 'osm'}
              disabled={!settings.data || save.isPending}
              onChange={(e) => save.mutate({ map_provider: e.target.value as 'osm' | 'google' })}
              hint="OpenStreetMap miễn phí, không cần thẻ. Google cần khai báo thẻ thanh toán và khoá API (xem docs/SETUP.md)."
            >
              <option value="osm">OpenStreetMap (không cần thẻ)</option>
              <option value="google" disabled>
                Google Maps (chưa hỗ trợ trong bản này)
              </option>
            </SelectField>
          </Card>
        </section>

        <AccountSection />
      </PageBody>
    </>
  )
}
