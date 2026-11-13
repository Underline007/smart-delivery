import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ChartColumn, FileSpreadsheet, PackageCheck, Route as RouteIcon, Truck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useShop } from '@/app/current-shop'
import { AccountSection } from '@/features/account/AccountSection'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Card, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import {
  fetchShop,
  fetchShopSettings,
  saveShopSettings,
  updateShopInfo,
} from '@/lib/api'
import type { Shop, ShopSettings } from '@/lib/types'
import { useAction } from '@/lib/useAction'

function NavRow({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 px-4 active:bg-surface-2">
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-5 text-muted" />
    </Link>
  )
}

function ShopInfoForm({ shop }: { shop: Shop }) {
  const shopId = shop.id
  const [form, setForm] = useState({
    name: shop.name,
    phone: shop.phone ?? '',
    address: shop.address ?? '',
    lat: shop.lat?.toString() ?? '',
    lng: shop.lng?.toString() ?? '',
  })

  const save = useAction(
    () =>
      updateShopInfo(shopId, {
        name: form.name,
        phone: form.phone,
        address: form.address,
        lat: form.lat ? Number(form.lat) : null,
        lng: form.lng ? Number(form.lng) : null,
      }),
    { success: 'Đã lưu thông tin cửa hàng', invalidate: [['shop', shopId], ['my-context']] },
  )

  const latInvalid = form.lat !== '' && !(Math.abs(Number(form.lat)) <= 90)
  const lngInvalid = form.lng !== '' && !(Math.abs(Number(form.lng)) <= 180)
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || latInvalid || lngInvalid) return
    save.mutate(undefined)
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <TextField label="Tên cửa hàng" value={form.name} onChange={(e) => set('name')(e.target.value)} maxLength={100} />
      <TextField
        label="Số điện thoại người gửi"
        type="tel"
        inputMode="tel"
        value={form.phone}
        onChange={(e) => set('phone')(e.target.value.replace(/[^\d]/g, ''))}
      />
      <TextField
        label="Địa chỉ lấy hàng"
        value={form.address}
        onChange={(e) => set('address')(e.target.value)}
        maxLength={300}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Vĩ độ"
          inputMode="decimal"
          value={form.lat}
          onChange={(e) => set('lat')(e.target.value)}
          error={latInvalid ? 'Từ -90 đến 90' : null}
        />
        <TextField
          label="Kinh độ"
          inputMode="decimal"
          value={form.lng}
          onChange={(e) => set('lng')(e.target.value)}
          error={lngInvalid ? 'Từ -180 đến 180' : null}
        />
      </div>
      <p className="-mt-2 text-sm text-muted">
        Toạ độ shop dùng làm điểm xuất phát khi lập chuyến giao. Chọn trên bản đồ ở màn lập chuyến.
      </p>
      <Button type="submit" variant="secondary" block loading={save.isPending}>
        Lưu thông tin
      </Button>
    </form>
  )
}

function ShopInfoSection({ shopId }: { shopId: string }) {
  const shop = useQuery({ queryKey: ['shop', shopId], queryFn: () => fetchShop(shopId) })
  if (shop.isLoading) return <LoadingBlock />
  if (!shop.data) return <ErrorBlock message="Không tải được thông tin cửa hàng" onRetry={() => shop.refetch()} />
  return <ShopInfoForm key={shop.dataUpdatedAt} shop={shop.data} />
}

function SettingsForm({ shopId, settings }: { shopId: string; settings: ShopSettings }) {
  const [form, setForm] = useState(settings)
  const save = useAction(() => saveShopSettings(shopId, form), {
    success: 'Đã lưu cài đặt',
    invalidate: [['shop', shopId, 'settings']],
  })
  const set = <K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(undefined)
      }}
      className="flex flex-col gap-4"
    >
      <SelectField
        label="Người trả cước ViettelPost"
        value={form.vtp_fee_payer}
        onChange={(e) => set('vtp_fee_payer', e.target.value as ShopSettings['vtp_fee_payer'])}
      >
        <option value="sender">Người gửi (shop)</option>
        <option value="receiver">Người nhận</option>
      </SelectField>
      <SelectField
        label="Yêu cầu khi giao"
        value={form.vtp_delivery_requirement}
        onChange={(e) =>
          set('vtp_delivery_requirement', e.target.value as ShopSettings['vtp_delivery_requirement'])
        }
      >
        <option value="no_view">Không cho xem hàng</option>
        <option value="view">Cho xem hàng, không cho thử</option>
        <option value="try">Cho thử hàng</option>
      </SelectField>
      <TextField
        label="Mã dịch vụ ViettelPost mặc định"
        value={form.vtp_service}
        onChange={(e) => set('vtp_service', e.target.value)}
        hint="Ví dụ VCN (chuyển phát nhanh). Điền đúng mã trong file mẫu của ViettelPost."
        maxLength={20}
      />
      <TextField
        label="Khối lượng bao bì (gram)"
        inputMode="numeric"
        value={String(form.packaging_weight_g)}
        onChange={(e) => set('packaging_weight_g', Number(e.target.value.replace(/\D/g, '')) || 0)}
        hint="Cộng thêm vào khối lượng hàng của mỗi đơn"
      />
      <label className="flex min-h-12 items-center gap-3">
        <input
          type="checkbox"
          className="size-5 accent-[var(--primary)]"
          checked={form.allow_negative_stock}
          onChange={(e) => set('allow_negative_stock', e.target.checked)}
        />
        <span>
          Cho phép bán khi hết hàng (tồn kho âm)
          <span className="block text-sm text-muted">Dùng cho hàng đặt trước</span>
        </span>
      </label>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="message-template" className="text-sm font-medium">
          Mẫu tin nhắn xác nhận đơn
        </label>
        <textarea
          id="message-template"
          rows={6}
          value={form.message_template}
          onChange={(e) => set('message_template', e.target.value)}
          className="w-full rounded-xl border border-border bg-surface p-3.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
        />
        <p className="text-sm text-muted">
          Biến dùng được: {'{ten}'} {'{ma_don}'} {'{san_pham}'} {'{tong}'} {'{cod}'} {'{dia_chi}'}
        </p>
      </div>
      <Button type="submit" variant="secondary" block loading={save.isPending}>
        Lưu cài đặt
      </Button>
    </form>
  )
}

export function ShopSettingsPage() {
  const shop = useShop()
  const settings = useQuery({
    queryKey: ['shop', shop.id, 'settings'],
    queryFn: () => fetchShopSettings(shop.id),
  })

  return (
    <>
      <PageHeader title="Cài đặt" subtitle={shop.name} />
      <PageBody className="flex flex-col gap-5">
        <Card className="p-0">
          <NavRow to="/shop/delivery" icon={<RouteIcon className="size-5" />} label="Chuyến giao hàng" />
          <div className="border-t border-border" />
          <NavRow to="/shop/settings/shippers" icon={<Truck className="size-5" />} label="Shipper của shop" />
          <div className="border-t border-border" />
          <NavRow to="/shop/vtp/export" icon={<FileSpreadsheet className="size-5" />} label="Xuất Excel ViettelPost" />
          <div className="border-t border-border" />
          <NavRow to="/shop/vtp/tracking" icon={<PackageCheck className="size-5" />} label="Nhập mã vận đơn" />
          <div className="border-t border-border" />
          <NavRow to="/shop/reports" icon={<ChartColumn className="size-5" />} label="Báo cáo" />
        </Card>

        <section>
          <SectionTitle>Thông tin cửa hàng</SectionTitle>
          <Card>
            <ShopInfoSection shopId={shop.id} />
          </Card>
        </section>

        <section>
          <SectionTitle>Giao hàng, kho và tin nhắn</SectionTitle>
          <Card>
            {settings.isLoading ? (
              <LoadingBlock />
            ) : settings.error || !settings.data ? (
              <ErrorBlock message="Không tải được cài đặt" onRetry={() => settings.refetch()} />
            ) : (
              <SettingsForm key={shop.id} shopId={shop.id} settings={settings.data} />
            )}
          </Card>
        </section>

        <AccountSection />
      </PageBody>
    </>
  )
}
