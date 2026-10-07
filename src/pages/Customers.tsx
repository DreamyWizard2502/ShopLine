import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { CUSTOMER_CATEGORIES, fmtDate } from '../lib/calc'
import { Icon, Modal } from '../components/ui'
import { formatPhone } from './NewRO'
import { Pager } from '../components/lines'

const PAGE = 100

export default function Customers() {
  const { db, createCustomer } = useStore()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [cat, setCat] = useState('')
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [q, cat])
  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of db.customers) if (c.category) m.set(c.category, (m.get(c.category) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [db.customers])

  // Index units and ROs by customer once — a real customer list can be 10k+.
  const idx = useMemo(() => {
    const units = new Map<string, typeof db.units>()
    for (const u of db.units) { const a = units.get(u.customerId); if (a) a.push(u); else units.set(u.customerId, [u]) }
    const ros = new Map<string, { open: number; total: number; last: string | null }>()
    for (const r of db.ros) {
      const x = ros.get(r.customerId) ?? { open: 0, total: 0, last: null }
      x.total++; if (r.status !== 'closed') x.open++
      if (!x.last || r.openedAt > x.last) x.last = r.openedAt
      ros.set(r.customerId, x)
    }
    return { units, ros }
  }, [db.units, db.ros])

  const rows = useMemo(() => {
    const t = q.toLowerCase().trim()
    const digits = t.replace(/\D/g, '')
    return db.customers
      .map((c) => {
        const units = idx.units.get(c.id) ?? []
        const r = idx.ros.get(c.id)
        return { c, units, open: r?.open ?? 0, total: r?.total ?? 0, last: r?.last ?? null }
      })
      .filter(({ c }) => !cat || (cat === '—' ? !c.category : c.category === cat))
      .filter(({ c, units }) => !t || c.name.toLowerCase().includes(t) || String(c.number) === t ||
        (digits.length >= 3 && [c.phone, c.altPhone, c.cellPhone].some((p) => (p ?? '').replace(/\D/g, '').includes(digits))) ||
        (c.email && c.email.toLowerCase().includes(t)) ||
        [c.address, c.address2, c.city, c.contact1, c.contact2].some((x) => (x ?? '').toLowerCase().includes(t)) ||
        units.some((u) => u.serial.toLowerCase().includes(t) || `${u.make} ${u.model}`.toLowerCase().includes(t)))
      .sort((a, b) => a.c.name.localeCompare(b.c.name))
  }, [db.customers, idx, q, cat])
  const pages = Math.ceil(rows.length / PAGE)

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Customers &amp; Units</h1><div className="sub">{db.customers.length} customers · {db.units.length} units on file</div></div>
        <span className="spacer" />
        <Link className="btn" to="/import?target=customers">Import customers</Link>
        <button className="btn primary" onClick={() => setAdding(true)}>{Icon.plus} New customer</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <label className="search" style={{ display: 'block', flex: 1 }}>
          {Icon.search}
          <input className="input" autoFocus placeholder="Search name, any phone, customer #, contact, email, address, serial, model…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {categories.length > 0 && (
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
            <option value="—">No category</option>
          </select>
        )}
      </div>
      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th>Name</th><th>Category</th><th>Phone</th><th>Units</th><th className="num">Open ROs</th><th className="num">All ROs</th><th>Last visit</th></tr></thead>
          <tbody>
            {rows.slice(page * PAGE, page * PAGE + PAGE).map(({ c, units, open, total, last }) => (
              <tr key={c.id} className="click" onClick={() => nav(`/customers/${c.id}`)}>
                <td className="mono small">{c.number}</td>
                <td>
                  <span className="cell-main">{c.name}</span>
                  {c.creditFlag && <span className="tag" style={{ background: 'var(--bad-soft)', color: 'var(--bad)', marginLeft: 6 }}>CREDIT FLAG</span>}
                  {c.taxExempt && <span className="tag" style={{ background: 'var(--ok-soft)', color: 'var(--ok)', marginLeft: 6 }}>EXEMPT</span>}
                  {c.contact1 && <div className="small muted">Attn: {c.contact1}</div>}
                </td>
                <td className="small">{c.category ?? (c.isBusiness ? 'Commercial' : <span className="muted">—</span>)}</td>
                <td className="nw">{c.phone || c.cellPhone || <span className="muted">—</span>}</td>
                <td className="small muted">{units.map((u) => u.type).slice(0, 3).join(', ')}{units.length > 3 && ` +${units.length - 3}`}</td>
                <td className="num">{open || <span className="muted">0</span>}</td>
                <td className="num">{total}</td>
                <td className="small">{fmtDate(last)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="empty">No customers match.</td></tr>}
          </tbody>
        </table>
        <Pager page={page} pages={pages} total={rows.length} onPage={setPage} />
      </div>
      {adding && <NewCustomerModal onClose={() => setAdding(false)} onSave={(v) => { const c = createCustomer({ ...v, notes: '' }); nav(`/customers/${c.id}`) }} />}
    </div>
  )
}

type NewCust = { name: string; phone: string; cellPhone?: string; email: string; isBusiness: boolean; category?: string; contact1?: string }
function NewCustomerModal({ onClose, onSave }: { onClose: () => void; onSave: (v: NewCust) => void }) {
  const [v, setV] = useState<NewCust>({ name: '', phone: '', cellPhone: '', email: '', isBusiness: false, category: '', contact1: '' })
  const ok = v.name.trim() && v.phone.replace(/\D/g, '').length === 10
  return (
    <Modal title="New customer" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => onSave({ ...v, name: v.name.trim(), cellPhone: v.cellPhone || undefined, category: v.category?.trim() || undefined, contact1: v.contact1?.trim() || undefined })}>Create</button></>}>
      <label className="field"><span>Name</span><input className="input" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <label className="field"><span>Phone</span><input className="input" value={v.phone} onChange={(e) => setV({ ...v, phone: formatPhone(e.target.value) })} /></label>
      <label className="field"><span>Cell phone (optional)</span><input className="input" value={v.cellPhone} onChange={(e) => setV({ ...v, cellPhone: formatPhone(e.target.value) })} /></label>
      <label className="field"><span>Email</span><input className="input" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
      <div className="grid2" style={{ gap: 8 }}>
        <label className="field"><span>Category</span><input className="input" list="new-cust-cats" placeholder="Personal Use" value={v.category}
          onChange={(e) => setV({ ...v, category: e.target.value, isBusiness: !!e.target.value && !/personal/i.test(e.target.value) })} /></label>
        <label className="field"><span>Contact (business)</span><input className="input" value={v.contact1} onChange={(e) => setV({ ...v, contact1: e.target.value })} /></label>
      </div>
      <datalist id="new-cust-cats">{CUSTOMER_CATEGORIES.map((x) => <option key={x} value={x} />)}</datalist>
      <label className="check"><input type="checkbox" checked={v.isBusiness} onChange={(e) => setV({ ...v, isBusiness: e.target.checked })} /> Commercial account</label>
    </Modal>
  )
}
