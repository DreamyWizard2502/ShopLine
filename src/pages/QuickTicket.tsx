// "New ticket" menu and the quick-ticket form for chain, blade and tire jobs
// (and any other job type the shop sets up in Settings).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import type { Customer, JobType } from '../lib/types'
import { customerPhones, money, round2, uid } from '../lib/calc'
import { presetLines, quickComplaint } from '../lib/jobs'
import { accountFor } from '../lib/ar'
import { JobGlyph } from '../components/ui'
import { AccountWarning } from './AR'
import { CustomerPicker, formatPhone } from './NewRO'

/** The first screen of "New ticket": pick what kind of job this is. */
export function TicketMenu() {
  const { db } = useStore()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const cust = db.customers.find((c) => c.id === params.get('customer'))
  const jobs = db.settings.jobTypes.filter((j) => j.active)
  const go = (q: Record<string, string>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(q)) p.set(k, v)
    nav(`/ro/new?${p.toString()}`)
  }
  const tiles = [
    { key: 'repair', name: 'Repair order', sub: 'Unit dropped off for diagnosis or repair', icon: 'wrench' as const, go: () => go({ type: 'repair' }) },
    { key: 'estimate', name: 'Estimate', sub: 'Phone quote, unit not here yet', icon: 'estimate' as const, go: () => go({ type: 'repair', status: 'estimate' }) },
    ...jobs.map((j) => ({ key: j.code, name: j.name, sub: `${j.presets.slice(0, 2).map((p) => p.label).join(', ')}${j.presets.length > 2 ? '…' : ''}`, icon: j.icon, go: () => go({ type: j.code }) })),
  ]
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= tiles.length) { e.preventDefault(); tiles[n - 1].go() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div><h1>New ticket</h1><div className="sub">{cust ? <>For <b>{cust.name}</b> #{cust.number} · </> : null}What kind of job is it? Press a number key or tap a tile.</div></div>
      </div>
      <div className="tk-menu">
        {tiles.map((t, i) => (
          <button key={t.key} className={`tk-tile ${i < 2 ? 'tk-main' : ''}`} onClick={t.go}>
            <span className="tk-ico"><JobGlyph icon={t.icon} size={26} /></span>
            <span className="tk-name">{t.name}</span>
            <span className="tk-sub">{t.sub}</span>
            <span className="kbd tk-key">{i + 1}</span>
          </button>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 12 }}>Chain, blade and tire tickets skip diagnosis and don’t need a unit on file. Change their prices, fields and add your own job types in <Link to="/settings#job-types">Settings → Quick tickets</Link>.</div>
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
function promiseChoices() {
  const now = new Date()
  const eod = new Date(now); eod.setHours(17, 0, 0, 0)
  if (eod.getTime() - now.getTime() < 3_600_000) eod.setDate(eod.getDate() + 1)
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(9, 0, 0, 0)
  const wait = new Date(now.getTime() + 45 * 60_000)
  return [
    { label: 'While you wait', at: wait },
    { label: eod.getDate() === now.getDate() ? 'End of day' : 'Tomorrow 5 PM', at: eod },
    { label: 'Tomorrow 9 AM', at: tomorrow },
  ]
}
function defaultPromise(jt: JobType) {
  const d = new Date(Date.now() + jt.promiseHours * 3_600_000)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
  return toLocalInput(d)
}

export function QuickTicket({ jt }: { jt: JobType }) {
  const { db, createRO, createCustomer, currentUser, override, audit } = useStore()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const cash = db.customers.find((c) => c.isCash)
  const [customer, setCustomer] = useState<Customer | null>(() => db.customers.find((c) => c.id === params.get('customer')) ?? cash ?? null)
  const [picking, setPicking] = useState(false)
  const [newCust, setNewCust] = useState<null | { name: string; phone: string }>(null)
  const [walkName, setWalkName] = useState('')
  const [walkPhone, setWalkPhone] = useState('')
  const [unitId, setUnitId] = useState('')
  const [item, setItem] = useState('')
  const [fields, setFields] = useState<Record<string, string | number | boolean>>({})
  const [qty, setQty] = useState<Record<string, number>>(() => (jt.presets[0] ? { [jt.presets[0].id]: 1 } : {}))
  const [note, setNote] = useState('')
  const [promise, setPromise] = useState(() => defaultPromise(jt))
  const [tag, setTag] = useState('')
  const [techId, setTechId] = useState('')
  const [startNow, setStartNow] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [ack, setAck] = useState(false)
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) } }, [toast])

  const isCash = !!customer?.isCash
  const units = useMemo(() => (customer && !isCash ? db.units.filter((u) => u.customerId === customer.id) : []), [db.units, customer, isCash])
  const acct = customer && !isCash ? accountFor(db, customer) : null
  const needsAck = !!acct && db.settings.arWarnAtWriteUp && db.settings.arAckOverLimit && (acct.pastDue > 0 || acct.overLimit) && !override
  const lines = presetLines(jt, qty)
  const sub = round2(lines.reduce((a, l) => a + l.amount, 0))
  const exempt = !!customer?.taxExempt
  const tax = exempt ? 0 : round2(lines.filter((l) => l.taxable).reduce((a, l) => a + l.amount, 0) * db.settings.taxRate)
  // "3 chains": the most of any one service, since sharpening 3 chains and dressing 1 bar is still 3 chains
  const count = Math.max(0, ...Object.values(qty))

  const reset = () => {
    setCustomer(cash ?? null); setWalkName(''); setWalkPhone(''); setUnitId(''); setItem(''); setFields({}); setNote('')
    setQty(jt.presets[0] ? { [jt.presets[0].id]: 1 } : {}); setPromise(defaultPromise(jt)); setTag(''); setTechId(''); setStartNow(false); setAck(false)
  }

  const submit = (then: 'open' | 'print' | 'another') => {
    setError('')
    let c = customer
    if (!c && newCust) {
      if (!newCust.name.trim()) return setError('New customer needs a name.')
      c = createCustomer({ name: newCust.name.trim(), phone: newCust.phone, email: '', isBusiness: false, notes: '' })
    }
    if (!c) return setError('Pick a customer, or leave it on Cash Customer.')
    if (c.isCash && !walkName.trim()) return setError('Put a name on the ticket so you know whose it is at pickup.')
    if (jt.unitRequired && !unitId) return setError(`${jt.name} tickets need a unit on file (Settings → Quick tickets).`)
    if (!unitId && !item.trim() && !c.isCash && units.length) return setError('Pick the unit, or describe what was brought in.')
    if (!lines.length) return setError('Add at least one service with a quantity.')
    if (needsAck && !ack) return setError('This account is past due or over its limit. Check with the office, then tick the box.')
    const approvedBy = c.isCash ? walkName.trim() : (c.contact1 || c.name)
    const at = new Date().toISOString()
    const ro = createRO({
      customerId: c.id, unitId, status: startNow ? 'in_progress' : 'checked_in', warranty: false, techId: techId || null,
      promiseDate: promise ? new Date(promise).toISOString() : null,
      complaint: quickComplaint(jt, qty, ''), cause: '', correction: '', dropOffNotes: note.trim(),
      checklist: { hasFuel: false, bladeOn: false, batteryIncluded: false, accessories: '' },
      kind: jt.code, jobFields: fields, item: unitId ? undefined : item.trim() || undefined,
      walkIn: c.isCash ? { name: walkName.trim(), phone: walkPhone } : undefined,
      tag: tag.trim().toUpperCase() || undefined,
    }, {
      fees: lines,
      approvals: [{ id: uid(), amount: round2(sub + tax), approvedBy, method: 'in_person', at, recordedBy: currentUser }],
    }, `${jt.ticketName} ticket opened (${money(round2(sub + tax))} approved at the counter)`)
    if (needsAck) audit(`RO ${ro.number} written up for #${c.number} ${c.name} while past due / over limit (counter checked with the office)`)
    if (then === 'open') nav(`/ro/${ro.id}`)
    else if (then === 'print') nav(`/ro/${ro.id}/print/ticket`)
    else { reset(); setToast(`Ticket ${ro.number} saved. Ready for the next one.`) }
  }

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/ro/new">New ticket</Link> / {jt.name}</div>
          <h1 className="row" style={{ gap: 10 }}><span className="tk-ico sm"><JobGlyph icon={jt.icon} /></span>{jt.ticketName} ticket</h1>
          <div className="sub">Ticket #{db.nextRONumber} · quick write-up, no diagnosis step</div>
        </div>
      </div>

      <div className="tk-grid">
        <div className="stack">
          {/* Customer */}
          <section className="panel">
            <div className="panel-head"><h2>Customer</h2><span className="spacer" />
              {customer && !picking && <button className="btn sm" onClick={() => { setPicking(true); setNewCust(null) }}>Change</button>}
              {customer && !isCash && cash && <button className="btn sm ghost" onClick={() => { setCustomer(cash); setUnitId(''); setAck(false) }}>Use Cash Customer</button>}
            </div>
            <div className="panel-body stack">
              {picking || (!customer && !newCust) ? (
                <>
                  <CustomerPicker customers={db.customers} onPick={(c) => { setCustomer(c); setPicking(false); setUnitId(''); setAck(false) }}
                    onNew={(q) => { setCustomer(null); setPicking(false); setNewCust({ name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? formatPhone(q) : '' }) }} />
                  {customer && <div><button className="btn sm ghost" onClick={() => setPicking(false)}>← Keep {customer.name}</button></div>}
                </>
              ) : newCust ? (
                <div className="grid2">
                  <label className="field"><span>Name</span><input className="input" autoFocus value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></label>
                  <label className="field"><span>Phone</span><input className="input" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: formatPhone(e.target.value) })} /></label>
                  <div><button className="btn sm ghost" onClick={() => { setNewCust(null); setCustomer(cash ?? null) }}>← Back to Cash Customer</button></div>
                </div>
              ) : customer && (
                <>
                  <div>
                    <div className="cell-main">{customer.name} <span className="muted mono small">#{customer.number}</span></div>
                    {!isCash && <div className="cell-sub">{customerPhones(customer).map((p) => p.value).join(' · ')}</div>}
                    {!isCash && <AccountWarning c={customer} />}
                    {needsAck && <label className="check small" style={{ marginTop: 4 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I checked with the office about this account</label>}
                    {!isCash && customer.notes && <div className="small" style={{ color: 'var(--cust)' }}>{customer.notes}</div>}
                  </div>
                  {isCash && (
                    <div className="grid2">
                      <label className="field"><span>Name on ticket</span><input className="input" autoFocus value={walkName} onChange={(e) => setWalkName(e.target.value)} placeholder="Who's picking it up" /></label>
                      <label className="field"><span>Phone (to call when ready)</span><input className="input" value={walkPhone} onChange={(e) => setWalkPhone(formatPhone(e.target.value))} placeholder="(405) 555-0123" /></label>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* What came in */}
          <section className="panel">
            <div className="panel-head"><h2>What came in</h2><span className="muted small">{jt.unitRequired ? 'Unit required' : 'Unit optional'}</span></div>
            <div className="panel-body stack">
              {units.length > 0 && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {!jt.unitRequired && <button className={`chip ${!unitId ? 'on' : ''}`} onClick={() => setUnitId('')}>Not a unit on file</button>}
                  {units.map((u) => <button key={u.id} className={`chip ${unitId === u.id ? 'on' : ''}`} onClick={() => setUnitId(u.id)}>{u.make} {u.model}<span className="n">{u.type}</span></button>)}
                </div>
              )}
              {!unitId && (
                <label className="field"><span>Describe it</span>
                  <input className="input" value={item} onChange={(e) => setItem(e.target.value)}
                    placeholder={jt.code === 'chain' ? 'e.g. 3 loose chains, or Stihl MS 271 with 20 in bar' : jt.code === 'blade' ? 'e.g. 3 blades off a 52 in deck' : jt.code === 'tire' ? 'e.g. front wheel off a zero-turn' : 'What was brought in'} /></label>
              )}
              {jt.fields.length > 0 && (
                <div className="tk-fields">
                  {jt.fields.map((f) => (
                    f.type === 'yesno' ? (
                      <label key={f.key} className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={!!fields[f.key]} onChange={(e) => setFields({ ...fields, [f.key]: e.target.checked })} /> {f.label}</label>
                    ) : f.type === 'select' ? (
                      <div key={f.key} className="field"><span>{f.label}</span>
                        <div className="tk-opts">
                          {f.options.map((o) => <button key={o} className={`chip ${fields[f.key] === o ? 'on' : ''}`} onClick={() => setFields({ ...fields, [f.key]: fields[f.key] === o ? '' : o })}>{o}</button>)}
                        </div></div>
                    ) : (
                      <label key={f.key} className="field"><span>{f.label}</span>
                        <input className="input" inputMode={f.type === 'number' ? 'numeric' : undefined} placeholder={f.placeholder} value={String(fields[f.key] ?? '')}
                          onChange={(e) => setFields({ ...fields, [f.key]: f.type === 'number' ? (e.target.value.replace(/[^\d.]/g, '') ? Number(e.target.value.replace(/[^\d.]/g, '')) : '') : e.target.value })} /></label>
                    )
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Services */}
          <section className="panel">
            <div className="panel-head"><h2>Services</h2><span className="spacer" /><span className="small muted">{count} {jt.qtyLabel || 'items'}</span></div>
            <div className="tk-services">
              {jt.presets.map((p) => {
                const n = qty[p.id] ?? 0
                const set = (v: number) => setQty({ ...qty, [p.id]: Math.max(0, Math.min(999, v)) })
                return (
                  <div key={p.id} className={`tk-svc ${n ? 'on' : ''}`}>
                    <div><div className="cell-main">{p.label}</div><div className="cell-sub">{money(p.price)} each{!p.taxable && ' · not taxed'}</div></div>
                    <span className="spacer" />
                    <div className="tk-step">
                      <button className="btn sm" aria-label={`Fewer: ${p.label}`} onClick={() => set(n - 1)} disabled={!n}>−</button>
                      <input className="input num" aria-label={`Quantity: ${p.label}`} inputMode="numeric" value={n} onFocus={(e) => e.target.select()} onChange={(e) => set(Number(e.target.value.replace(/\D/g, '')) || 0)} />
                      <button className="btn sm" aria-label={`More: ${p.label}`} onClick={() => set(n + 1)}>+</button>
                    </div>
                    <span className="num tk-amt">{n ? money(n * p.price) : ''}</span>
                  </div>
                )
              })}
              {!jt.presets.length && <div className="empty">No services set up for this job type. Add them in Settings → Quick tickets.</div>}
            </div>
            <div className="panel-body" style={{ paddingTop: 10 }}>
              <label className="field"><span>Notes for the tech / ticket</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rush, leave chains loose, customer bringing new bar…" /></label>
              <div className="small muted" style={{ marginTop: 6 }}>Parts (a new chain, tube or blade) go on the ticket after it’s saved, from the parts catalog.</div>
            </div>
          </section>
        </div>

        {/* Summary rail */}
        <div className="stack tk-rail">
          <section className="panel">
            <div className="panel-head"><h3>Ticket</h3></div>
            <div className="panel-body stack" style={{ gap: 10 }}>
              <div className="totals" style={{ padding: 0 }}>
                {lines.map((l) => <Fragment key={l.description}><span className="small">{l.description} ×{l.qty}</span><span className="small">{money(l.amount)}</span></Fragment>)}
                <span>Tax {exempt && <span className="small muted">(exempt)</span>}</span><span>{money(tax)}</span>
                <span className="grand">Total</span><span className="grand">{money(sub + tax)}</span>
              </div>
              <div className="field"><span>Promised</span>
                <input className="input" type="datetime-local" value={promise} onChange={(e) => setPromise(e.target.value)} />
                <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                  {promiseChoices().map((c) => <button key={c.label} className="chip" onClick={() => setPromise(toLocalInput(c.at))}>{c.label}</button>)}
                </div>
              </div>
              <div className="grid2" style={{ gap: 8 }}>
                <label className="field"><span>Tag #</span><input className="input" value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder="e.g. C12" /></label>
                <label className="field"><span>Tech</span>
                  <select className="select" value={techId} onChange={(e) => setTechId(e.target.value)}>
                    <option value="">Anyone</option>
                    {db.staff.filter((s) => s.role === 'tech' && s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></label>
              </div>
              <label className="check"><input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} /> Doing it now (start as In Progress)</label>
              <div className="small muted">The total is recorded as approved by the customer at the counter.</div>
              {error && <div className="flag" style={{ padding: '8px 12px', fontSize: 13 }}>{error}</div>}
              <button className="btn primary" onClick={() => submit('print')}>Save &amp; print ticket</button>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn" style={{ flex: 1 }} onClick={() => submit('open')}>Save</button>
                <button className="btn" style={{ flex: 1 }} onClick={() => submit('another')}>Save &amp; next</button>
              </div>
            </div>
          </section>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
