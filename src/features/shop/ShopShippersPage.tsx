import { useQuery } from '@tanstack/react-query'
import { Phone, Truck, UserMinus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useShop } from '@/app/current-shop'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { SearchInput } from '@/components/ui/Field'
import { Badge, Card, EmptyState, ErrorBlock, LoadingBlock, SectionTitle } from '@/components/ui/misc'
import { Sheet } from '@/components/ui/Sheet'
import { addShopShipper, listShopMembers, removeShopShipper, searchShippers } from '@/lib/api'
import type { ShopMember } from '@/lib/types'
import { useAction } from '@/lib/useAction'
import { useDebounced } from '@/lib/useDebounced'
import { formatVnPhone } from '@/lib/vn/phone'

function AddShipperSheet({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim())
  const results = useQuery({
    queryKey: ['shop', shopId, 'shipper-search', debounced],
    queryFn: () => searchShippers(shopId, debounced),
    placeholderData: (previous) => previous,
  })
  const add = useAction((userId: string) => addShopShipper(shopId, userId), {
    success: 'Đã thêm shipper vào cửa hàng',
    invalidate: [['shop', shopId, 'members'], ['shop', shopId, 'shipper-search']],
  })

  return (
    <Sheet open onClose={onClose} title="Thêm shipper">
      <div className="flex flex-col gap-3">
        <SearchInput
          placeholder="Tìm theo tên hoặc số điện thoại"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.isLoading ? (
          <LoadingBlock />
        ) : results.data?.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Không tìm thấy shipper. Nhờ admin tạo tài khoản shipper nếu chưa có.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {results.data?.map((shipper) => (
              <li key={shipper.id}>
                <Card className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{shipper.full_name}</p>
                    <p className="text-sm text-muted">{formatVnPhone(shipper.phone)}</p>
                  </div>
                  {shipper.is_member ? (
                    <Badge tone="success">Đã thêm</Badge>
                  ) : (
                    <Button
                      size="sm"
                      icon={<UserPlus className="size-4" />}
                      loading={add.isPending && add.variables === shipper.id}
                      onClick={() => add.mutate(shipper.id)}
                    >
                      Thêm
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}

export function ShopShippersPage() {
  const shop = useShop()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<ShopMember | null>(null)

  const members = useQuery({
    queryKey: ['shop', shop.id, 'members'],
    queryFn: () => listShopMembers(shop.id),
  })
  const shippers = (members.data ?? []).filter((m) => m.role === 'shipper')
  const active = shippers.filter((m) => m.active)
  const former = shippers.filter((m) => !m.active)

  const remove = useAction((userId: string) => removeShopShipper(shop.id, userId), {
    success: 'Đã bỏ shipper khỏi cửa hàng',
    invalidate: [['shop', shop.id, 'members'], ['shop', shop.id, 'shipper-search']],
    onSuccess: () => setRemoving(null),
  })

  return (
    <>
      <PageHeader
        title="Shipper của shop"
        back="/shop/settings"
        actions={
          <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
            Thêm
          </Button>
        }
      />
      <PageBody>
        {members.isLoading ? (
          <LoadingBlock />
        ) : members.error ? (
          <ErrorBlock message="Không tải được danh sách shipper" onRetry={() => members.refetch()} />
        ) : active.length === 0 ? (
          <EmptyState
            icon={<Truck className="size-7" />}
            title="Shop chưa có shipper"
            action={<Button onClick={() => setAdding(true)}>Thêm shipper</Button>}
          >
            Chọn shipper từ danh sách chung do admin tạo. Một shipper có thể giao cho nhiều shop.
          </EmptyState>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {active.map((member) => (
                <li key={member.user_id}>
                  <Card className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{member.full_name}</p>
                      <a
                        href={`tel:${member.phone}`}
                        className="mt-0.5 inline-flex items-center gap-1 text-sm text-primary"
                      >
                        <Phone className="size-3.5" />
                        {formatVnPhone(member.phone)}
                      </a>
                      {!member.account_active && <Badge tone="danger">Tài khoản bị khoá</Badge>}
                    </div>
                    <Button
                      size="sm"
                      variant="danger-soft"
                      icon={<UserMinus className="size-4" />}
                      onClick={() => setRemoving(member)}
                    >
                      Bỏ
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
            {former.length > 0 && (
              <section className="mt-5">
                <SectionTitle>Đã bỏ khỏi shop</SectionTitle>
                <ul className="flex flex-col gap-1 px-1 text-sm text-muted">
                  {former.map((m) => (
                    <li key={m.user_id}>
                      {m.full_name} · {formatVnPhone(m.phone)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </PageBody>

      {adding && <AddShipperSheet shopId={shop.id} onClose={() => setAdding(false)} />}
      <ConfirmSheet
        open={Boolean(removing)}
        title="Bỏ shipper khỏi shop?"
        confirmLabel="Bỏ khỏi shop"
        danger
        loading={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.user_id)}
      >
        {removing?.full_name} sẽ không nhận được chuyến giao mới của <strong>{shop.name}</strong>.
        Lịch sử các chuyến cũ vẫn được giữ.
      </ConfirmSheet>
    </>
  )
}
