import { useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import { forgottenOf } from '../lib/orders'
import { OrdersBrowser, type OrdersTab } from '../components/orders'

const TABS: OrdersTab[] = ['open', 'forgotten', 'closed', 'archived', 'all']

/** Every order in one place: open, forgotten, invoice history and the archive, with bulk select. */
export default function Orders() {
  const { db } = useStore()
  const [params] = useSearchParams()
  const t = params.get('tab') as OrdersTab | null
  const forgotten = db.ros.filter((r) => forgottenOf(r, db.settings)).length
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Orders</h1><div className="sub">{forgotten ? `${forgotten} forgotten order${forgotten === 1 ? '' : 's'} to sort out. ` : ''}Tick boxes like email to archive, reassign or export in bulk.</div></div>
      </div>
      <OrdersBrowser key={t ?? 'open'} tabs={TABS} initialTab={t && TABS.includes(t) ? t : 'open'} />
    </div>
  )
}
