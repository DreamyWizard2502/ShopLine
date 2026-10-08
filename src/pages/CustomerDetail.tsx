import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import type { Contact, Customer, NoteKind, ShipTo, Unit, UnitType } from '../lib/types'
import { CUSTOMER_CATEGORIES, fmtDate, fmtDateTime, money, roTotals } from '../lib/calc'
import { CONTACT_TYPES, NOTE_KIND_LABEL, addNote, blankContact, blankShipTo, contactsOf, ensureContacts, sortedNotes, syncLegacyContacts } from '../lib/customerRecord'
import { isOpenRO } from '../lib/orders'
import { Modal, Icon } from '../components/ui'
import { DraftNumber, DraftText } from '../components/fields'
import { OrdersBrowser } from '../components/orders'
import { UnitForm, formatPhone } from './NewRO'
import { AccountSummary } from './AR'

type Tab = 'overview' | 'contacts' | 'shipto' | 'units' | 'open' | 'history' | 'notes'

export default function CustomerDetail() {
  const { id } = useParams()
  const { db, mutate } = useStore()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'overview'
  const c = db.customers.find((x) => x.id === id)
  if (!c) return <div className="page"><h1>Customer not found</h1><Link to="/customers">Back</Link></div>

  const units = db.units.filter((u) => u.customerId === c.id)
  const ros = db.ros.filter((r) => r.customerId === c.id)
  const lifetime = ros.filter((r) => r.status === 'closed').reduce((a, r) => a + roTotals(r, db.settings, !!c.taxExempt).total, 0)
  const set = (fn: (cc: Customer) => void) => mutate((d) => { fn(d.customers.find((x) => x.id === c.id)!) })
  const go = (t: Tab) => { const p = new URLSearchParams(params); if (t === 'overview') p.delete('tab'); else p.set('tab', t); setParams(p, { replace: true }) }
  const TABS: [Tab, string, number | null][] = [
    ['overview', 'Overview', null],
    ['contacts', 'Contacts', contactsOf(c).length],
    ['shipto', 'Ship-to', c.shipTos?.length ?? 0],
    ['units', 'Units', units.length],
    ['open', 'Open orders', ros.filter(isOpenRO).length],
    ['history', 'Invoice history', ros.filter((r) => r.status === 'closed').length],
    ['notes', 'Notes', c.noteLog?.length ?? 0],
  ]

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/customers">Customers</Link> / #{c.number}</div>
          <h1>{c.name}</h1>
          <CustomerChips c={c} />
          <div className="sub">Customer since {fmtDate(c.createdAt)} · {ros.length} orders · {money(lifetime)} lifetime</div>
          {!!c.mergedFrom?.length && <div className="small muted">Formerly {c.mergedFrom.map((m) => `#${m.number}`).join(', ')} (merged)</div>}
        </div>
        <span className="spacer" />
        {!c.isCash && <Link className="btn" to={`/ar/${c.id}`}>Account</Link>}
        {!c.isCash && <Link className="btn" to={`/customers/merge?keep=${c.id}`}>Merge…</Link>}
        <Link className="btn primary" to={`/ro/new?customer=${c.id}`}>{Icon.plus} New ticket</Link>
      </div>

      <div className="ob-tabs cr-tabs" role="tablist">
        {TABS.map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
            {label}{n != null && <span className="n">{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview c={c} set={set} go={go} />}
      {tab === 'contacts' && <ContactsTab c={c} />}
      {tab === 'shipto' && <ShipToTab c={c} />}
      {tab === 'units' && <UnitsTab c={c} units={units} />}
      {tab === 'open' && <OrdersBrowser key="open" customerId={c.id} tabs={['open', 'forgotten', 'archived']} />}
      {tab === 'history' && <OrdersBrowser key="history" customerId={c.id} tabs={['closed']} />}
      {tab === 'notes' && <NotesTab c={c} />}
    </div>
  )
}

/* ---------------- Overview: the editable header record ---------------- */
function Overview({ c, set, go }: { c: Customer; set: (fn: (cc: Customer) => void) => void; go: (t: Tab) => void }) {
  const { db } = useStore()
  const pinned = sortedNotes(c).slice(0, 3)
  const open = db.ros.filter((r) => r.customerId === c.id && isOpenRO(r)).sort((a, b) => b.openedAt.localeCompare(a.openedAt))
  const people = contactsOf(c)
  return (
    <div className="ro-grid">
      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h3>Contact</h3></div>
          <div className="panel-body stack">
            <label className="field"><span>Name</span><DraftText value={c.name} onCommit={(v) => v.trim() && set((x) => { x.name = v.trim() })} /></label>
            <div className="grid2" style={{ gap: 8 }}>
              <label className="field"><span>Phone</span><DraftText value={c.phone} onCommit={(v) => set((x) => { x.phone = v.trim() ? formatPhone(v) : '' })} /></label>
              <label className="field"><span>Cell phone</span><DraftText value={c.cellPhone ?? ''} onCommit={(v) => set((x) => { x.cellPhone = v.trim() ? formatPhone(v) : undefined })} /></label>
              <label className="field"><span>Alt phone</span><DraftText value={c.altPhone ?? ''} onCommit={(v) => set((x) => { x.altPhone = v.trim() ? formatPhone(v) : undefined })} /></label>
              <label className="field"><span>Email</span><DraftText value={c.email} onCommit={(v) => set((x) => { x.email = v.trim() })} /></label>
            </div>
            <div className="small">
              <b>People:</b> {people.length ? people.map((p) => `${p.name}${p.type ? ` (${p.type})` : ''}`).join(', ') : <span className="muted">none yet</span>}
              {' '}<button className="linkish small" onClick={() => go('contacts')}>{people.length ? 'Edit contacts' : 'Add a contact'}</button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Billing address</h3><span className="spacer" /><button className="linkish small" onClick={() => go('shipto')}>Ship-to addresses ({c.shipTos?.length ?? 0})</button></div>
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
          <div className="panel-head"><h3>Open orders</h3><span className="spacer" /><button className="linkish small" onClick={() => go('open')}>All open orders</button></div>
          <div className="panel-body stack" style={{ gap: 6 }}>
            {open.slice(0, 5).map((r) => (
              <Link key={r.id} to={`/ro/${r.id}`} className="row small" style={{ textDecoration: 'none' }}>
                <span className="ro-num">{r.number}</span><span className="muted">{fmtDate(r.openedAt)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.complaint}</span>
              </Link>
            ))}
            {!open.length && <div className="small muted">Nothing open.</div>}
          </div>
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h3>Notes</h3><span className="spacer" /><button className="linkish small" onClick={() => go('notes')}>Notes log ({c.noteLog?.length ?? 0})</button></div>
          <div className="panel-body stack" style={{ gap: 8 }}>
            <label className="field"><span>Alert shown at write-up</span><DraftText multiline value={c.notes} placeholder="Shown in orange whenever someone writes up a ticket for this customer" onCommit={(v) => set((x) => { x.notes = v })} /></label>
            {pinned.map((n) => <div key={n.id} className={`cr-note ${n.pinned ? 'pinned' : ''}`}><div>{n.text}</div><div className="meta">{n.pinned && '📌 '}{NOTE_KIND_LABEL[n.kind]} · {fmtDate(n.at)} · {n.user}</div></div>)}
          </div>
        </section>

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
          <div className="panel-head"><h3>Account settings</h3></div>
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
          </div>
        </section>
      </div>
    </div>
  )
}

/* ---------------- Contacts ---------------- */
function ContactsTab({ c }: { c: Customer }) {
  const { mutate, audit } = useStore()
  const list = contactsOf(c)
  const edit = (fn: (list: Contact[], cc: Customer) => void) => mutate((d) => {
    const cc = d.customers.find((x) => x.id === c.id)!
    const l = ensureContacts(cc)
    fn(l, cc)
    syncLegacyContacts(cc)
  })
  const setOne = (i: number, fn: (x: Contact) => void) => edit((l) => { fn(l[i]) })
  return (
    <div className="stack">
      <div className="row"><div className="small muted">The primary contact prints as “Attn:” on invoices and statements. “Can approve” means they may OK work over the phone.</div>
        <span className="spacer" /><button className="btn primary sm" onClick={() => edit((l) => { l.push({ ...blankContact(), primary: l.length === 0 }) })}>+ Add contact</button></div>
      <datalist id="contact-types">{CONTACT_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="cr-list">
        {list.map((p, i) => (
          <div key={p.id} className={`cr-card ${p.primary ? 'primary' : ''}`}>
            <div className="grid3">
              <label className="field"><span>Name</span><DraftText value={p.name} placeholder="Full name" onCommit={(v) => setOne(i, (x) => { x.name = v.trim() })} /></label>
              <label className="field"><span>Role</span><DraftText value={p.type} listId="contact-types" placeholder="Owner, Office…" onCommit={(v) => setOne(i, (x) => { x.type = v.trim() })} /></label>
              <label className="field"><span>Email</span><DraftText value={p.email} onCommit={(v) => setOne(i, (x) => { x.email = v.trim() })} /></label>
              <label className="field"><span>Phone</span><DraftText value={p.phone} onCommit={(v) => setOne(i, (x) => { x.phone = v.trim() ? formatPhone(v) : '' })} /></label>
              <label className="field"><span>Cell</span><DraftText value={p.cell} onCommit={(v) => setOne(i, (x) => { x.cell = v.trim() ? formatPhone(v) : '' })} /></label>
              <label className="field"><span>Notes</span><DraftText value={p.notes} placeholder="Best time to call…" onCommit={(v) => setOne(i, (x) => { x.notes = v })} /></label>
            </div>
            <div className="row wrap" style={{ gap: 16, marginTop: 8 }}>
              <label className="check"><input type="radio" name="primary" checked={p.primary} onChange={() => edit((l) => { l.forEach((x, k) => { x.primary = k === i }) })} /> Primary</label>
              <label className="check"><input type="checkbox" checked={p.canApprove} onChange={(e) => setOne(i, (x) => { x.canApprove = e.target.checked })} /> Can approve work</label>
              {(p.cell || p.phone) && <a className="small" href={`tel:${(p.cell || p.phone).replace(/\D/g, '')}`}>Call {p.cell || p.phone}</a>}
              {p.email && <a className="small" href={`mailto:${p.email}`}>Email</a>}
              <span className="spacer" />
              <button className="btn ghost danger sm" onClick={() => { edit((l) => { const wasPrimary = l[i].primary; l.splice(i, 1); if (wasPrimary && l[0]) l[0].primary = true }); audit(`Removed contact ${p.name || '(blank)'} from #${c.number} ${c.name}`) }}>Remove</button>
            </div>
          </div>
        ))}
        {!list.length && <div className="panel panel-body muted">No contacts yet. Add the people who drop off, pick up or pay.</div>}
      </div>
    </div>
  )
}

/* ---------------- Ship-to ---------------- */
function ShipToTab({ c }: { c: Customer }) {
  const { mutate } = useStore()
  const list = c.shipTos ?? []
  const edit = (fn: (l: ShipTo[]) => void) => mutate((d) => { const cc = d.customers.find((x) => x.id === c.id)!; cc.shipTos ??= []; fn(cc.shipTos) })
  const setOne = (i: number, fn: (x: ShipTo) => void) => edit((l) => { fn(l[i]) })
  return (
    <div className="stack">
      <div className="row"><div className="small muted">Other places this customer’s equipment lives or gets delivered: yards, job sites, a second property. The billing address stays on Overview.</div>
        <span className="spacer" /><button className="btn primary sm" onClick={() => edit((l) => { l.push({ ...blankShipTo(), isDefault: l.length === 0 }) })}>+ Add address</button></div>
      <div className="cr-list">
        {list.map((a, i) => (
          <div key={a.id} className={`cr-card ${a.isDefault ? 'primary' : ''}`}>
            <div className="grid3">
              <label className="field"><span>Label</span><DraftText value={a.label} placeholder="North yard" onCommit={(v) => setOne(i, (x) => { x.label = v.trim() })} /></label>
              <label className="field"><span>Address</span><DraftText value={a.address} onCommit={(v) => setOne(i, (x) => { x.address = v.trim() })} /></label>
              <label className="field"><span>Address line 2</span><DraftText value={a.address2} onCommit={(v) => setOne(i, (x) => { x.address2 = v.trim() })} /></label>
              <label className="field"><span>City</span><DraftText value={a.city} onCommit={(v) => setOne(i, (x) => { x.city = v.trim() })} /></label>
              <div className="grid2" style={{ gap: 8 }}>
                <label className="field"><span>State</span><DraftText value={a.state} onCommit={(v) => setOne(i, (x) => { x.state = v.trim().toUpperCase() })} /></label>
                <label className="field"><span>ZIP</span><DraftText value={a.zip} onCommit={(v) => setOne(i, (x) => { x.zip = v.trim() })} /></label>
              </div>
              <label className="field"><span>Phone there</span><DraftText value={a.phone} onCommit={(v) => setOne(i, (x) => { x.phone = v.trim() ? formatPhone(v) : '' })} /></label>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label className="check"><input type="radio" name="default-shipto" checked={a.isDefault} onChange={() => edit((l) => { l.forEach((x, k) => { x.isDefault = k === i }) })} /> Default delivery address</label>
              {a.address && <a className="small" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${encodeURIComponent([a.address, a.city, a.state, a.zip].filter(Boolean).join(', '))}`}>Map</a>}
              <span className="spacer" />
              <button className="btn ghost danger sm" onClick={() => edit((l) => { l.splice(i, 1) })}>Remove</button>
            </div>
          </div>
        ))}
        {!list.length && <div className="panel panel-body muted">No ship-to addresses.</div>}
      </div>
    </div>
  )
}

/* ---------------- Units ---------------- */
function UnitsTab({ c, units }: { c: Customer; units: Unit[] }) {
  const { db, createUnit } = useStore()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ type: 'Push Mower' as UnitType, make: '', model: '', serial: '', engineHours: '' })
  const visits = (uid: string) => db.ros.filter((r) => r.unitId === uid)
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="stack">
      <div className="row"><span className="spacer" /><button className="btn primary sm" onClick={() => setAdding(true)}>+ Add unit</button></div>
      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>Type</th><th>Make / model</th><th>Serial</th><th>Coverage</th><th>Stored</th><th className="num">Hours</th><th className="num">Visits</th><th>Last in</th><th /></tr></thead>
          <tbody>
            {units.map((u) => {
              const v = visits(u.id)
              const lastIn = v.map((r) => r.openedAt).sort().pop()
              const wty = u.warrantyUntil && u.warrantyUntil >= today
              const esp = u.espUntil && u.espUntil >= today
              return (
                <tr key={u.id}>
                  <td>{u.type}</td>
                  <td><div className="cell-main">{u.make} {u.model}</div><div className="cell-sub">{[u.color, u.engineModel].filter(Boolean).join(' · ')}</div></td>
                  <td className="mono small">{u.serial || '—'}</td>
                  <td className="small">{wty ? <span className="tag warranty">WARRANTY to {fmtDate(u.warrantyUntil! + 'T12:00')}</span> : u.warrantyUntil ? <span className="muted">Warranty ended</span> : ''}
                    {esp && <div><span className="tag" style={{ background: 'var(--shop-soft)', color: 'var(--shop)' }}>ESP to {fmtDate(u.espUntil! + 'T12:00')}</span></div>}</td>
                  <td className="small">{u.bin ?? ''}</td>
                  <td className="num">{u.engineHours ?? '—'}</td><td className="num">{v.length}</td>
                  <td className="small">{lastIn ? fmtDate(lastIn) : '—'}</td>
                  <td><button className="btn sm" onClick={() => setEditing(u.id)}>Details</button></td>
                </tr>
              )
            })}
            {!units.length && <tr><td colSpan={9} className="empty">No units on file.</td></tr>}
          </tbody>
        </table>
      </div>
      {adding && (
        <Modal title="Add unit" onClose={() => setAdding(false)}
          footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn primary" disabled={!draft.make.trim() || !draft.model.trim()} onClick={() => {
              createUnit({ customerId: c.id, type: draft.type, make: draft.make.trim(), model: draft.model.trim(), serial: draft.serial.trim(), engineHours: draft.engineHours ? Number(draft.engineHours) : null })
              setAdding(false); setDraft({ type: 'Push Mower', make: '', model: '', serial: '', engineHours: '' })
            }}>Add unit</button></>}>
          <UnitForm value={draft} onChange={setDraft} />
        </Modal>
      )}
      {editing && <UnitDetails id={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function UnitDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const { db, mutate } = useStore()
  const u = db.units.find((x) => x.id === id)
  if (!u) return null
  const set = (fn: (x: Unit) => void) => mutate((d) => { fn(d.units.find((x) => x.id === id)!) })
  const str = (k: keyof Unit, label: string, ph = '', mono = false) => (
    <label className="field"><span>{label}</span><DraftText value={String(u[k] ?? '')} placeholder={ph} className={`input ${mono ? 'mono' : ''}`}
      onCommit={(v) => set((x) => { (x as unknown as Record<string, unknown>)[k] = v.trim() || undefined })} /></label>
  )
  const date = (k: 'purchaseDate' | 'warrantyUntil' | 'espUntil', label: string) => (
    <label className="field"><span>{label}</span><input className="input" type="date" value={u[k] ?? ''} onChange={(e) => set((x) => { x[k] = e.target.value || undefined })} /></label>
  )
  return (
    <Modal title={`${u.make} ${u.model}`} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="stack">
        <div className="grid3">
          {str('make', 'Make')}{str('model', 'Model')}
          <label className="field"><span>Serial #</span><DraftText value={u.serial} className="input mono" onCommit={(v) => set((x) => { x.serial = v.trim().toUpperCase() })} /></label>
          {str('color', 'Color', 'Orange')}
          <label className="field"><span>Engine hours</span><DraftNumber value={u.engineHours ?? 0} width={110} onCommit={(v) => set((x) => { x.engineHours = v || null })} /></label>
          {str('bin', 'Stored at (bin / yard spot)', 'Bay 2')}
          {str('engineModel', 'Engine model', 'Kawasaki FX730V')}{str('engineSerial', 'Engine serial #', '', true)}
          {str('vin', 'VIN / PIN', '', true)}{str('licenseTag', 'License / trailer tag', '', true)}
          {date('purchaseDate', 'Purchased')}{date('warrantyUntil', 'Warranty until')}
          {date('espUntil', 'Extended plan (ESP) until')}{str('espProvider', 'ESP provider')}
        </div>
        <label className="field"><span>Unit notes</span><DraftText multiline value={u.notes ?? ''} onCommit={(v) => set((x) => { x.notes = v.trim() || undefined })} /></label>
      </div>
    </Modal>
  )
}

/* ---------------- Notes log ---------------- */
function NotesTab({ c }: { c: Customer }) {
  const { db, mutate, currentUser } = useStore()
  const [text, setText] = useState('')
  const [kind, setKind] = useState<NoteKind>('general')
  const [roId, setRoId] = useState('')
  const [filter, setFilter] = useState<NoteKind | ''>('')
  const ros = db.ros.filter((r) => r.customerId === c.id).sort((a, b) => b.openedAt.localeCompare(a.openedAt))
  const notes = sortedNotes(c).filter((n) => !filter || n.kind === filter)
  const edit = (fn: (cc: Customer) => void) => mutate((d) => { fn(d.customers.find((x) => x.id === c.id)!) })
  return (
    <div className="ro-grid">
      <div className="stack">
        <section className="panel">
          <div className="panel-body stack" style={{ gap: 8 }}>
            <textarea className="textarea" placeholder="Called about…, prefers…, unhappy with…" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="row wrap" style={{ gap: 8 }}>
              <div className="seg">{(Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{NOTE_KIND_LABEL[k]}</button>)}</div>
              <select className="select" style={{ width: 'auto' }} value={roId} onChange={(e) => setRoId(e.target.value)} aria-label="About order">
                <option value="">Not about an order</option>{ros.slice(0, 30).map((r) => <option key={r.id} value={r.id}>RO {r.number} · {fmtDate(r.openedAt)}</option>)}
              </select>
              <span className="spacer" />
              <button className="btn primary" disabled={!text.trim()} onClick={() => { edit((cc) => { addNote(cc, { kind, text, user: currentUser, roId: roId || undefined }) }); setText(''); setRoId('') }}>Add note</button>
            </div>
          </div>
        </section>
        <div className="chips">
          <button className={`chip ${!filter ? 'on' : ''}`} onClick={() => setFilter('')}>All <span className="n">{c.noteLog?.length ?? 0}</span></button>
          {(Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map((k) => {
            const n = (c.noteLog ?? []).filter((x) => x.kind === k).length
            return n ? <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{NOTE_KIND_LABEL[k]} <span className="n">{n}</span></button> : null
          })}
        </div>
        <section className="panel"><div className="panel-body stack" style={{ gap: 10 }}>
          {notes.map((n) => {
            const ro = n.roId ? db.ros.find((r) => r.id === n.roId) : undefined
            return (
              <div key={n.id} className={`cr-note ${n.pinned ? 'pinned' : ''}`}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
                <div className="meta row wrap" style={{ gap: 8 }}>
                  <span>{n.pinned && '📌 '}{NOTE_KIND_LABEL[n.kind]} · {fmtDateTime(n.at)} · {n.user}</span>
                  {ro && <Link to={`/ro/${ro.id}`}>RO {ro.number}</Link>}
                  <span className="spacer" />
                  <button className="linkish small" onClick={() => edit((cc) => { const x = cc.noteLog?.find((y) => y.id === n.id); if (x) x.pinned = !x.pinned })}>{n.pinned ? 'Unpin' : 'Pin'}</button>
                  <button className="linkish small" style={{ color: 'var(--bad)' }} onClick={() => edit((cc) => { cc.noteLog = cc.noteLog?.filter((y) => y.id !== n.id) })}>Delete</button>
                </div>
              </div>
            )
          })}
          {!notes.length && <div className="muted">No notes{filter ? ' of this kind' : ''} yet.</div>}
        </div></section>
      </div>
      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h3>Alert shown at write-up</h3></div>
          <div className="panel-body"><DraftText multiline value={c.notes} onCommit={(v) => edit((cc) => { cc.notes = v })} />
            <div className="small muted" style={{ marginTop: 6 }}>Pinned notes show on the Overview. The alert shows in orange on every new ticket.</div></div>
        </section>
      </div>
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
