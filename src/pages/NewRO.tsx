import { useMemo, useRef, useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import { CUSTOMER_CATEGORIES, customerPhones } from '../lib/calc'
import { accountFor } from '../lib/ar'
import { AccountWarning } from './AR'
import { QuickTicket, TicketMenu } from './QuickTicket'
import type { Customer, Unit, UnitType, ROStatus } from '../lib/types'

export const UNIT_TYPES: UnitType[] = ['Push Mower', 'Self-Propelled Mower', 'Zero-Turn Mower', 'Riding Mower', 'Chainsaw',
  'String Trimmer', 'Backpack Blower', 'Handheld Blower', 'Hedge Trimmer', 'Edger', 'Pressure Washer', 'Generator', 'Tiller']

export function formatPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 10)
  if (d.length < 4) return d
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

/** "New ticket": a menu of job kinds, then either the full repair write-up or a quick ticket. */
export default function NewRO() {
  const { db } = useStore()
  const [params] = useSearchParams()
  const type = params.get('type')
  const status = params.get('status')
  if (!type && !status) return <TicketMenu />
  const jt = type && type !== 'repair' ? db.settings.jobTypes.find((j) => j.code === type) : undefined
  if (jt) return <QuickTicket key={jt.code} jt={jt} />
  return <RepairWriteUp key={status ?? 'repair'} />
}

function RepairWriteUp() {
  const { db, createRO, createCustomer, createUnit, override, audit } = useStore()
  const nav = useNavigate()
  const [params] = useSearchParams()

  const [customer, setCustomer] = useState<Customer | null>(() => db.customers.find((c) => c.id === params.get('customer')) ?? null)
  const [newCust, setNewCust] = useState<null | { name: string; phone: string; cellPhone: string; email: string; isBusiness: boolean; category: string; contact1: string }>(null)
  const [unitId, setUnitId] = useState<string>('')
  const [newUnit, setNewUnit] = useState<null | { type: UnitType; make: string; model: string; serial: string; engineHours: string }>(null)

  const [status, setStatus] = useState<ROStatus>(() => (params.get('status') === 'estimate' ? 'estimate' : 'checked_in'))
  const [complaint, setComplaint] = useState('')
  const [dropOffNotes, setDropOffNotes] = useState('')
  const [promiseDate, setPromiseDate] = useState('')
  const [warranty, setWarranty] = useState(false)
  const [techId, setTechId] = useState('')
  const [checklist, setChecklist] = useState({ hasFuel: false, bladeOn: true, batteryIncluded: false, accessories: '' })
  const [error, setError] = useState('')
  const [ack, setAck] = useState(false)
  const acct = customer && !customer.isCash ? accountFor(db, customer) : null
  const needsAck = !!acct && db.settings.arWarnAtWriteUp && db.settings.arAckOverLimit && (acct.pastDue > 0 || acct.overLimit) && !override

  const custUnits = useMemo(() => db.units.filter((u) => u.customerId === customer?.id), [db.units, customer])
  useEffect(() => {
    if (custUnits.length === 1) setUnitId(custUnits[0].id)
    else setUnitId('')
    setNewUnit(customer && custUnits.length === 0 ? { type: 'Push Mower', make: '', model: '', serial: '', engineHours: '' } : null)
  }, [customer, custUnits])

  const submit = () => {
    setError('')
    let c = customer
    if (!c && newCust) {
      if (!newCust.name.trim() || newCust.phone.replace(/\D/g, '').length < 10) return setError('New customer needs a name and a 10-digit phone number.')
      c = createCustomer({ ...newCust, name: newCust.name.trim(), notes: '', cellPhone: newCust.cellPhone || undefined, category: newCust.category.trim() || undefined, contact1: newCust.contact1.trim() || undefined })
    }
    if (!c) return setError('Pick or add a customer.')
    if (needsAck && !ack) return setError('This account is past due or over its limit. Check with the office, then tick the box under the customer.')
    let u: Unit | undefined = db.units.find((x) => x.id === unitId)
    if (newUnit) {
      if (!newUnit.make.trim() || !newUnit.model.trim()) return setError('New unit needs a make and model.')
      u = createUnit({
        customerId: c.id, type: newUnit.type, make: newUnit.make.trim(), model: newUnit.model.trim(),
        serial: newUnit.serial.trim().toUpperCase(), engineHours: newUnit.engineHours ? Number(newUnit.engineHours) : null,
      })
    }
    if (!u) return setError('Pick or add the unit being serviced.')
    if (!complaint.trim()) return setError('Describe the complaint — what the customer says is wrong.')
    const ro = createRO({
      customerId: c.id, unitId: u.id, status, warranty, techId: techId || null,
      promiseDate: promiseDate ? new Date(promiseDate + 'T17:00:00').toISOString() : null,
      complaint: complaint.trim(), cause: '', correction: '', dropOffNotes: dropOffNotes.trim(), checklist,
    })
    if (needsAck) audit(`RO ${ro.number} written up for #${c.number} ${c.name} while past due / over limit (counter checked with the office)`)
    nav(`/ro/${ro.id}`)
  }

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div><div className="small muted"><Link to="/ro/new">New ticket</Link> / {status === 'estimate' ? 'Estimate' : 'Repair order'}</div><h1>{status === 'estimate' ? 'New Estimate' : 'New Repair Order'}</h1><div className="sub">RO #{db.nextRONumber} · write-up</div></div>
      </div>

      <div className="stack">
        {/* 1. Customer */}
        <section className="panel">
          <div className="panel-head"><h2>1 · Customer</h2></div>
          <div className="panel-body">
            {customer ? (
              <div className="row">
                <div><div className="cell-main">{customer.name} <span className="muted mono small">#{customer.number}</span></div>
                  <div className="cell-sub">{customerPhones(customer).map((p) => `${p.label === 'Phone' ? '' : p.label + ' '}${p.value}`).join(' · ')}{customer.email && ` · ${customer.email}`}</div>
                  {(customer.contact1 || customer.category) && <div className="cell-sub">{[customer.category, customer.contact1 && `Attn: ${customer.contact1}`].filter(Boolean).join(' · ')}</div>}
                  {customer.creditFlag && <div className="small" style={{ color: 'var(--bad)', fontWeight: 600 }}>⚠ Credit flag on this account. Check with the office before starting work.</div>}
                  <AccountWarning c={customer} />
                  {needsAck && (
                    <label className="check small" style={{ marginTop: 4 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I checked with the office about this account</label>
                  )}
                  {customer.taxExempt && <div className="small" style={{ color: 'var(--ok)' }}>Tax exempt</div>}
                  {customer.notes && <div className="small" style={{ color: 'var(--cust)' }}>{customer.notes}</div>}</div>
                <span className="spacer" />
                <button className="btn sm" onClick={() => { setCustomer(null); setAck(false) }}>Change</button>
              </div>
            ) : newCust ? (
              <div className="stack">
                <div className="grid2">
                  <label className="field"><span>Name</span><input className="input" autoFocus value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></label>
                  <label className="field"><span>Phone</span><input className="input" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: formatPhone(e.target.value) })} placeholder="(405) 555-0123" /></label>
                  <label className="field"><span>Cell phone (optional)</span><input className="input" value={newCust.cellPhone} onChange={(e) => setNewCust({ ...newCust, cellPhone: formatPhone(e.target.value) })} /></label>
                  <label className="field"><span>Email (optional)</span><input className="input" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} /></label>
                  <label className="field"><span>Category</span><input className="input" list="newro-cats" placeholder="Personal Use" value={newCust.category}
                    onChange={(e) => setNewCust({ ...newCust, category: e.target.value, isBusiness: !!e.target.value && !/personal/i.test(e.target.value) })} /></label>
                  <label className="field"><span>Contact (business)</span><input className="input" value={newCust.contact1} onChange={(e) => setNewCust({ ...newCust, contact1: e.target.value })} /></label>
                  <datalist id="newro-cats">{CUSTOMER_CATEGORIES.map((x) => <option key={x} value={x} />)}</datalist>
                  <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={newCust.isBusiness} onChange={(e) => setNewCust({ ...newCust, isBusiness: e.target.checked })} /> Commercial account</label>
                </div>
                <div><button className="btn sm ghost" onClick={() => setNewCust(null)}>← Search existing customers instead</button></div>
              </div>
            ) : (
              <CustomerPicker customers={db.customers} onPick={setCustomer}
                onNew={(name) => setNewCust({ name: /\d/.test(name) ? '' : name, phone: /\d/.test(name) ? formatPhone(name) : '', cellPhone: '', email: '', isBusiness: false, category: '', contact1: '' })} />
            )}
          </div>
        </section>

        {/* 2. Unit */}
        <section className="panel" style={{ opacity: customer || newCust ? 1 : 0.5 }}>
          <div className="panel-head"><h2>2 · Unit</h2></div>
          <div className="panel-body">
            {!customer && !newCust && <div className="muted">Pick a customer first.</div>}
            {customer && custUnits.length > 0 && !newUnit && (
              <div className="stack" style={{ gap: 6 }}>
                {custUnits.map((u) => (
                  <label key={u.id} className="check panel" style={{ padding: '8px 12px', borderColor: unitId === u.id ? 'var(--accent)' : undefined }}>
                    <input type="radio" name="unit" checked={unitId === u.id} onChange={() => setUnitId(u.id)} />
                    <span className="cell-main">{u.make} {u.model}</span>
                    <span className="muted small">{u.type} · <span className="mono">{u.serial || 'no serial'}</span>{u.engineHours != null && ` · ${u.engineHours} hrs`}</span>
                  </label>
                ))}
                <div><button className="btn sm" onClick={() => setNewUnit({ type: 'Push Mower', make: '', model: '', serial: '', engineHours: '' })}>+ Add a different unit</button></div>
              </div>
            )}
            {(newUnit || (newCust && !customer)) && (
              <UnitForm value={newUnit ?? { type: 'Push Mower', make: '', model: '', serial: '', engineHours: '' }} onChange={setNewUnit}
                onCancel={customer && custUnits.length ? () => setNewUnit(null) : undefined} />
            )}
          </div>
        </section>

        {/* 3. Job */}
        <section className="panel">
          <div className="panel-head"><h2>3 · The job</h2></div>
          <div className="panel-body stack">
            <div className="row wrap" style={{ gap: 16 }}>
              <div className="seg">
                <button className={status === 'checked_in' ? 'on' : ''} onClick={() => setStatus('checked_in')}>Unit dropped off</button>
                <button className={status === 'estimate' ? 'on' : ''} onClick={() => setStatus('estimate')}>Phone quote / estimate only</button>
              </div>
              <label className="check"><input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} /> Warranty job</label>
            </div>
            <label className="field"><span>Complaint — in the customer's words</span>
              <textarea className="textarea" value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="e.g. Won't start after sitting all winter. Smokes when it does run." /></label>
            <div className="grid3">
              <label className="field"><span>Promise date</span><input type="date" className="input" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} /></label>
              <label className="field"><span>Assign tech (optional)</span>
                <select className="select" value={techId} onChange={(e) => setTechId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {db.staff.filter((s) => s.role === 'tech' && s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></label>
              <label className="field"><span>Left with unit</span><input className="input" value={checklist.accessories} onChange={(e) => setChecklist({ ...checklist, accessories: e.target.value })} placeholder="Bagger, key, charger…" /></label>
            </div>
            {status === 'checked_in' && (
              <div className="row wrap" style={{ gap: 18 }}>
                <span className="small muted">Drop-off check:</span>
                <label className="check"><input type="checkbox" checked={checklist.hasFuel} onChange={(e) => setChecklist({ ...checklist, hasFuel: e.target.checked })} /> Has fuel</label>
                <label className="check"><input type="checkbox" checked={checklist.bladeOn} onChange={(e) => setChecklist({ ...checklist, bladeOn: e.target.checked })} /> Blade/bar on</label>
                <label className="check"><input type="checkbox" checked={checklist.batteryIncluded} onChange={(e) => setChecklist({ ...checklist, batteryIncluded: e.target.checked })} /> Battery included</label>
              </div>
            )}
            <label className="field"><span>Drop-off notes</span>
              <input className="input" value={dropOffNotes} onChange={(e) => setDropOffNotes(e.target.value)} placeholder="Best way to reach them, deadlines, anything the tech should know" /></label>
          </div>
        </section>

        {error && <div className="flag" style={{ padding: '8px 12px', fontSize: 13 }}>{error}</div>}
        <div className="row">
          <span className="spacer" />
          <button className="btn" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn primary" onClick={submit}>Open RO #{db.nextRONumber}</button>
        </div>
      </div>
    </div>
  )
}

export function CustomerPicker({ customers, onPick, onNew }: { customers: Customer[]; onPick: (c: Customer) => void; onNew: (q: string) => void }) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => {
    const t = q.toLowerCase().trim()
    if (!t) return []
    const digits = t.replace(/\D/g, '')
    return customers.filter((c) =>
      c.name.toLowerCase().includes(t) || String(c.number) === t ||
      (digits.length >= 3 && [c.phone, c.cellPhone, c.altPhone].some((p) => (p ?? '').replace(/\D/g, '').includes(digits))) ||
      (t.length >= 3 && [c.contact1, c.contact2].some((x) => (x ?? '').toLowerCase().includes(t))),
    ).slice(0, 8)
  }, [q, customers])
  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => setHi(0), [q])
  return (
    <div className="picker">
      <input ref={ref} className="input" placeholder="Search by name, any phone, contact, or customer #" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); if (matches[hi]) onPick(matches[hi]); else if (q) onNew(q) }
        }} />
      {q && (
        <div className="picker-list">
          {matches.map((c, i) => (
            <div key={c.id} className={`picker-item ${i === hi ? 'hi' : ''}`} onMouseDown={() => onPick(c)} onMouseEnter={() => setHi(i)}>
              <span className="cell-main">{c.name}</span><span className="muted small">{c.phone || c.cellPhone}</span>
              {c.contact1 && <span className="muted small">· {c.contact1}</span>}
              {c.creditFlag && <span className="small" style={{ color: 'var(--bad)', fontWeight: 600 }}>credit flag</span>}
              <span className="spacer" /><span className="mono small muted">#{c.number}</span>
            </div>
          ))}
          <div className={`picker-item ${hi === matches.length ? 'hi' : ''}`} onMouseDown={() => onNew(q)} onMouseEnter={() => setHi(matches.length)}>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>+ New customer “{q}”</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function UnitForm({ value, onChange, onCancel }: {
  value: { type: UnitType; make: string; model: string; serial: string; engineHours: string }
  onChange: (v: { type: UnitType; make: string; model: string; serial: string; engineHours: string }) => void
  onCancel?: () => void
}) {
  return (
    <div className="stack">
      <div className="grid3">
        <label className="field"><span>Type</span>
          <select className="select" value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value as UnitType })}>
            {UNIT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select></label>
        <label className="field"><span>Make</span><input className="input" value={value.make} onChange={(e) => onChange({ ...value, make: e.target.value })} placeholder="Toro, Stihl, Exmark…" /></label>
        <label className="field"><span>Model</span><input className="input" value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} /></label>
        <label className="field"><span>Serial #</span><input className="input mono" value={value.serial} onChange={(e) => onChange({ ...value, serial: e.target.value.toUpperCase() })} /></label>
        <label className="field"><span>Engine hours (if it has a meter)</span><input className="input" inputMode="numeric" value={value.engineHours} onChange={(e) => onChange({ ...value, engineHours: e.target.value.replace(/[^\d.]/g, '') })} /></label>
      </div>
      {onCancel && <div><button className="btn sm ghost" onClick={onCancel}>← Pick an existing unit instead</button></div>}
    </div>
  )
}
