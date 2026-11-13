import { Construction } from 'lucide-react'
import { PageBody } from '@/components/layout/AppShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from './misc'

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <PageBody>
        <EmptyState icon={<Construction className="size-7" />} title="Tính năng đang được phát triển">
          Mục này sẽ có ở giai đoạn sau theo kế hoạch.
        </EmptyState>
      </PageBody>
    </>
  )
}
