import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import type { UnitType } from '../lib/types'
import { CUSTOMER_CATEGORIES, fmtDate, money, roTotals } from '../lib/calc'
import { Modal, StatusBadge, Icon } from '../components/ui'
import { DraftNumber, DraftText } from '../components/fields'
import { UnitForm, formatPhone } from './NewRO'
import { AccountSummary } from './AR'

export default function CustomerDetail() {
  const { id } = useParams()
  const { db, mutate, createUnit } = useStore()
  const nav = useNavigate()
  const [addUnit, setAddUnit] = useState(false)
  const [unitDraft, setUnitDraft] = useState({ type: 'Push Mower' as UnitType, make: '', model: '', serial: '', engineHours: '' })
  const c = db.customers.find((x) => x.id === id)
  if (!c) return <div className="page"><h1>Customer not found</h1><Link to="/customers">Back</Link></div>

  const units = db.units.filter((u) => u.customerId === c.id)
  const ros = db.ros.filter((r) => r.customerId === c.id).sort((a, b) => b.openedAt.localeCompare(a.openedAt))
  const lifetime = ros.filter((r) => r.status === 'closed').reduce((a, r) => a + roTotals(r, db.settings, !!c.taxExempt).total, 0)
  const set = (fn: (cc: NonNullable<typeof c>) => void) => mutate((d) => { fn(d.customers.find((x) => x.id === c.id)!) })

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/customers">Customers</Link> / #{c.number}</div>
          <h1>{c.name}</h1>
          <CustomerChips c={c} />
          <div className="sub">Customer since {fmtDate(c.createdAt)} · {ros.length} repair orders · {money(lifetime)} lifetime</div>
          {!!c.mergedFrom?.length && <div className="small muted">Formerly {c.mergedFrom.map((m) => `#${m.number}`).join(', ')} (merged)</div>}
        </div>
        <span className="spacer" />
        {!c.isCash && <Link className="btn" to={`/customers/merge?keep=${c.id}`}>Merge…</Link>}
        <Link className="btn primary" to={`/ro/new?customer=${c.id}`}>{Icon.plus} New RO for this customer</Link>
      </div>

      <div className="ro-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h2>Units</h2><span className="spacer" /><button className="btn sm" onClick={() => setAddUnit(true)}>+ Add unit</button></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Type</th><th>Make / model</th><th>Serial</th><th className="num">Hours</th><th className="num">Visits</th></tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td>{u.type}</td><td className="cell-main">{u.make} {u.model}</td><td className="mono small">{u.serial || '—'}</td>
                      <td className="num">{u.engineHours ?? '—'}</td><td className="num">{ros.filter((r) => r.unitId === u.id).length}</td>
                    </tr>
                  ))}
                  {!units.length && <tr><td colSpan={5} className="empty">No units on file.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Repair history</h2></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>RO #</th><th>Opened</th><th>Unit</th><th>Complaint</th><th>Status</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {ros.map((r) => {
                    const u = db.units.find((x) => x.id === r.unitId)
                    return (
                      <tr key={r.id} className="click" onClick={() => nav(`/ro/${r.id}`)}>
                        <td className="ro-num">{r.number}</td><td className="small">{fmtDate(r.openedAt)}</td>
                        <td className="small">{u?.make} {u?.model}</td>
                        <td className="small" style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.complaint}</td>
                        <td><StatusBadge status={r.status} /></td><td className="num">{money(roTotals(r, db.settings, !!c.taxExempt).total)}</td>
                      </tr>
                    )
                  })}
                  {!ros.length && <tr><td colSpan={6} className="empty">No repair orders yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="stack">
          {!c.isCash && (
            <section className="panel">
              <div className="panel-head"><h3>Charge account</h3></div>
              <div className="panel-body stack">
                <AccountSummary c={c} />
                <div className="grid2" style={{ gap: 8 }}>
                  <label className="field"><span>Credit limit ($, 0 = none)</span><DraftNumber value={c.creditLimit ?? 0} decimals={2} width={120} onCommit={(v) => set((x) => { x.creditLimit = v > 0 ? v : undefined })} /></label>
                  <label className="field"><span>Terms (days, 0 = shop default)</span><DraftNumber value={c.termsDays ?? 0} width={120} onCommit={(v) => set((x) => { x.termsDays = v > 0 ? Math.round(v) : undefined })} /></label>
                </div>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h3>Contact</h3></div>
            <div className="panel-body stack">
              <label className="field"><span>Name</span><DraftText value={c.name} onCommit={(v) => v.trim() && set((x) => { x.name = v.trim() })} /></label>
              <div className="grid2" style={{ gap: 8 }}>
                <label className="field"><span>Phone</span><DraftText value={c.phone} onCommit={(v) => set((x) => { x.phone = v.trim() ? formatPhone(v) : '' })} /></label>
                <label className="field"><span>Cell phone</span><DraftText value={c.cellPhone ?? ''} onCommit={(v) => set((x) => { x.cellPhone = v.trim() ? formatPhone(v) : undefined })} /></label>
                <label className="field"><span>Alt phone</span><DraftText value={c.altPhone ?? ''} onCommit={(v) => set((x) => { x.altPhone = v.trim() ? formatPhone(v) : undefined })} /></label>
                <label className="field"><span>Email</span><DraftText value={c.email} onCommit={(v) => set((x) => { x.email = v.trim() })} /></label>
                <label className="field"><span>Contact 1</span><DraftText value={c.contact1 ?? ''} placeholder="Who to ask for" onCommit={(v) => set((x) => { x.contact1 = v.trim() || undefined })} /></label>
                <label className="field"><span>Contact 2</span><DraftText value={c.contact2 ?? ''} onCommit={(v) => set((x) => { x.contact2 = v.trim() || undefined })} /></label>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Address</h3></div>
            <div className="panel-body stack">
              <label className="field"><span>Address line 1</span><DraftText value={c.address ?? ''} onCommit={(v) => set((x) => { x.address = v.trim() || undefined })} /></label>
              <label className="field"><span>Address line 2</span><DraftText value={c.address2 ?? ''} placeholder="Suite, c/o, attention…" onCommit={(v) => set((x) => { x.address2 = v.trim() || undefined })} /></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 84px', gap: 8 }}>
                <label className="field"><span>City</span><DraftText value={c.city ?? ''} onCommit={(v) => set((x) => { x.city = v.trim() || undefined })} /></label>
                <label className="field"><span>State</span><DraftText value={c.state ?? ''} onCommit={(v) => set((x) => { x.state = v.trim().toUpperCase() || undefined })} /></label>
                <label className="field"><span>ZIP</span><DraftText value={c.zip ?? ''} onCommit={(v) => set((x) => { x.zip = v.trim() || undefined })} /></label>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h3>Account</h3></div>
            <div className="panel-body stack">
              <div className="grid2" style={{ gap: 8 }}>
                <label className="field"><span>Category</span><DraftText value={c.category ?? ''} placeholder="Personal Use" listId="cust-categories" onCommit={(v) => set((x) => { x.category = v.trim() || undefined })} /></label>
                <label className="field"><span>Salesman</span><DraftText value={c.salesman ?? ''} placeholder="House Account" onCommit={(v) => set((x) => { x.salesman = v.trim() || undefined })} /></label>
                <label className="field"><span>Price level</span><DraftText value={c.priceLevel ?? ''} placeholder="Retail Pricing" onCommit={(v) => set((x) => { x.priceLevel = v.trim() || undefined })} /></label>
                <label className="field"><span>A/R type</span><DraftText value={c.arType ?? ''} placeholder="Open Item" onCommit={(v) => set((x) => { x.arType = v.trim() || undefined })} /></label>
                <label className="field"><span>Delivery code</span><DraftText value={c.deliveryCode ?? ''} onCommit={(v) => set((x) => { x.deliveryCode = v.trim() || undefined })} /></label>
              </div>
              <datalist id="cust-categories">{CUSTOMER_CATEGORIES.map((x) => <option key={x} value={x} />)}</datalist>
              <label className="check"><input type="checkbox" checked={!!c.taxExempt} onChange={(e) => set((x) => { x.taxExempt = e.target.checked })} /> Tax exempt</label>
              <label className="check"><input type="checkbox" checked={c.isBusiness} onChange={(e) => set((x) => { x.isBusiness = e.target.checked })} /> Commercial account</label>
              <label className="check"><input type="checkbox" checked={!!c.creditFlag} onChange={(e) => set((x) => { x.creditFlag = e.target.checked })} /> Credit flag <span className="muted small">(warns at write-up)</span></label>
              <label className="field"><span>Notes (shown at write-up)</span><DraftText multiline value={c.notes} onCommit={(v) => set((x) => { x.notes = v })} /></label>
            </div>
          </section>
        </div>
      </div>

      {addUnit && (
        <Modal title="Add unit" onClose={() => setAddUnit(false)}
          footer={<><button className="btn" onClick={() => setAddUnit(false)}>Cancel</button>
            <button className="btn primary" disabled={!unitDraft.make.trim() || !unitDraft.model.trim()} onClick={() => {
              createUnit({ customerId: c.id, type: unitDraft.type, make: unitDraft.make.trim(), model: unitDraft.model.trim(), serial: unitDraft.serial.trim(), engineHours: unitDraft.engineHours ? Number(unitDraft.engineHours) : null })
              setAddUnit(false); setUnitDraft({ type: 'Push Mower', make: '', model: '', serial: '', engineHours: '' })
            }}>Add unit</button></>}>
          <UnitForm value={unitDraft} onChange={setUnitDraft} />
        </Modal>
      )}
    </div>
  )
}

export function CustomerChips({ c }: { c: { category?: string; isBusiness: boolean; taxExempt?: boolean; creditFlag?: boolean } }) {
  if (!c.category && !c.isBusiness && !c.taxExempt && !c.creditFlag) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0' }}>
      {c.category && <span className="tag">{c.category.toUpperCase()}</span>}
      {c.isBusiness && <span className="tag" style={{ background: 'var(--shop-soft)', color: 'var(--shop)' }}>COMMERCIAL</span>}
      {c.taxExempt && <span className="tag" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>TAX EXEMPT</span>}
      {c.creditFlag && <span className="tag" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>CREDIT FLAG</span>}
    </div>
  )
}
