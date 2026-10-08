import { Fragment, useMemo, useRef, useState, useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLookups, useStore } from '../lib/store'
import type { ApprovalMethod, Part, PartLineStatus, ROStatus, RepairOrder } from '../lib/types'
import {
  APPROVAL_METHOD_LABEL, PART_STATUS_LABEL, STATUS_LABEL, daysIdle, daysOpen, fmtDate, fmtDateTime,
  customerPhones, money, roFlags, roTotals, round2, uid,
} from '../lib/calc'
import { Flags, Modal, StatusBadge } from '../components/ui'
import { DraftNumber, DraftText } from '../components/fields'
import { normPartNo } from '../lib/importer'
import { atFromDate, roBilling, roSettlement, todayYMD } from '../lib/ar'
import { AccountWarning } from './AR'
import { jobTypeOf, statusesFor } from '../lib/jobs'
import { ARCHIVE_REASON_LABEL, archiveBlocker, restoreOrders } from '../lib/orders'
import { ArchiveModal } from '../components/orders'
import { JobGlyph } from '../components/ui'

export default function RODetail() {
  const { id } = useParams()
  const store = useStore()
  const { db, updateRO } = store
  const L = useLookups()
  const nav = useNavigate()
  const ro = db.ros.find((r) => r.id === id)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<ROStatus | null>(null)
  const [toast, setToast] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [archiving, setArchiving] = useState(false)
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2200); return () => clearTimeout(t) } }, [toast])

  if (!ro) return <div className="page"><h1>Repair order not found</h1><Link to="/">Back to Work in Progress</Link></div>

  const c = L.customer.get(ro.customerId)!
  const u = L.unit.get(ro.unitId)
  const jt = jobTypeOf(db.settings, ro)
  const pipeline = statusesFor(db.settings, ro)
  const s = db.settings
  const t = roTotals(ro, s, !!c.taxExempt)
  const flags = roFlags(ro, s)
  const approved = ro.approvals.reduce((m, a) => Math.max(m, a.amount), 0)
  const techs = db.staff.filter((x) => x.role === 'tech' && (x.active || x.id === ro.techId))
  const closed = ro.status === 'closed'
  const locked = (closed || !!ro.archived) && !store.override
  const edit = (fn: (r: RepairOrder) => void) => updateRO(ro.id, fn)
  const bill = roBilling(db, ro.id)
  const unbilled = round2(t.total - bill.billed)

  // Pull stocked parts out of inventory when the job is closed out.
  const closeOut = () => store.mutate((d) => {
    for (const line of ro.parts) {
      const p = line.partId ? d.parts.find((x) => x.id === line.partId) : undefined
      if (p) p.onHand = Math.max(0, p.onHand - line.qty)
    }
  })

  // Status changes with guard rails (master override skips them).
  const requestStatus = (next: ROStatus) => {
    if (next === ro.status) return
    const needsOk = next === 'in_progress' && !ro.warranty && t.total > 0 && t.total > approved + 0.01
    if (!store.override && (needsOk || next === 'closed')) { setPendingStatus(next); return }
    if (next === 'closed') { closeOut(); store.setStatus(ro.id, next); setToast('Closed'); return }
    store.setStatus(ro.id, next)
    setToast(`Status set to ${STATUS_LABEL[next]}`)
  }
  const confirmStatus = () => {
    if (!pendingStatus) return
    if (pendingStatus === 'closed') closeOut()
    store.setStatus(ro.id, pendingStatus)
    setToast(`Status set to ${STATUS_LABEL[pendingStatus]}`)
    setPendingStatus(null)
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="ro-head">
        <div>
          <div className="small muted"><Link to="/">Work in Progress</Link> / {jt ? `${jt.ticketName} ticket` : 'Repair Order'}</div>
          <div className="row" style={{ gap: 12 }}>
            {jt && <span className="tk-ico sm" title={jt.name}><JobGlyph icon={jt.icon} /></span>}
            <span className="big">{jt ? 'Ticket' : 'RO'} {ro.number}</span>
            {ro.archived && <span className="tag" style={{ background: 'var(--done-soft)', color: 'var(--done)' }}>ARCHIVED</span>}
            <StatusBadge status={ro.status} />
            {ro.warranty && <span className="tag warranty">WARRANTY</span>}
          </div>
          <div style={{ marginTop: 4 }}><Flags flags={flags} /></div>
          <div style={{ marginTop: 6 }}><AccountWarning c={c} compact /></div>
        </div>
        <span className="spacer" />
        <div className="row wrap">
          <Link className="btn" to={`/ro/${ro.id}/print/ticket`}>Print shop ticket</Link>
          <Link className="btn" to={`/ro/${ro.id}/print/invoice`}>{closed ? 'Print invoice' : 'Print estimate'}</Link>
          {ro.status === 'ready' && <button className="btn primary" onClick={() => requestStatus('closed')}>Close &amp; invoice</button>}
          {closed && !c.isCash && !ro.warranty && unbilled > 0.004 && (
            <button className="btn" onClick={() => {
              store.postAr({ customerId: c.id, kind: 'charge', at: ro.closedAt ?? new Date().toISOString(), amount: unbilled, ref: `RO ${ro.number}`,
                memo: bill.billed ? `Repair order invoice, balance after ${money(bill.billed)} billed earlier` : 'Repair order invoice', roId: ro.id })
              store.audit(`Charged RO ${ro.number} (${money(unbilled)}) to #${c.number} ${c.name}'s account`)
              setToast('Charged to account')
            }}>Charge {bill.billed ? 'the rest ' : ''}to account · {money(unbilled)}</button>
          )}
          {bill.billed > 0 && (
            <Link className={`btn ${closed && Math.abs(unbilled) > 0.004 && unbilled < 0 ? 'danger' : ''}`} to={`/ar/${c.id}`}
              title={unbilled < -0.004 ? 'More was billed than the RO total. Void a charge on the account and re-bill.' : 'View on the customer account'}>
              On account {money(bill.billed)}{unbilled < -0.004 && ' — over-billed'}
            </Link>
          )}
          {closed && <button className="btn" onClick={() => requestStatus('ready')}>Reopen</button>}
          {closed && <button className="btn" onClick={() => { const n = store.repeatRO(ro.id); if (n) { store.audit(`Opened RO ${n.number} as a repeat of RO ${ro.number}`); nav(`/ro/${n.id}`) } }} title="New order with the same customer, unit and lines at today's prices">Repeat job</button>}
          {!closed && !ro.archived && <button className="btn ghost" onClick={() => setArchiving(true)} title="Put this order away without billing it">{'Archive…'}</button>}
        </div>
      </div>

      {ro.archived && (
        <div className="ar-empty" style={{ marginBottom: 12 }}>
          <div><b>Archived {fmtDate(ro.archived.at)}</b> by {ro.archived.by}: {ARCHIVE_REASON_LABEL[ro.archived.reason]}{ro.archived.note && ` · “${ro.archived.note}”`}.
            {ro.archived.partsUsed && ' Its stocked parts were taken out of inventory.'} It’s off the board and out of every count until it’s restored.</div>
          <div><button className="btn primary" onClick={() => {
            store.mutate((d) => { restoreOrders(d, [ro.id], store.currentUser) })
            store.audit(`Restored RO ${ro.number} from the archive`)
            setToast('Restored to the board')
          }}>Restore to the board</button></div>
        </div>
      )}

      {/* Status pipeline */}
      <div className="pipeline" role="group" aria-label="Status" style={{ ['--steps' as string]: pipeline.length }}>
        {pipeline.map((st, i) => {
          const cur = pipeline.indexOf(ro.status)
          return (
            <button key={st} className={i === cur ? 'cur' : i < cur ? 'past' : ''} disabled={!!ro.archived && !store.override} onClick={() => requestStatus(st)} title={`Set status: ${STATUS_LABEL[st]}`}>
              {STATUS_LABEL[st]}
            </button>
          )
        })}
      </div>

      <div className="ro-grid">
        <div className="stack">
          {jt && <JobDetailsPanel ro={ro} locked={locked} edit={edit} />}
          {/* 3 C's */}
          <section className="panel">
            <div className="panel-head"><h2>{jt ? 'Work requested · Notes · Done' : 'Complaint · Cause · Correction'}</h2></div>
            <div className="panel-body ccc">
              <label className="field"><span>Complaint</span>
                <DraftText multiline value={ro.complaint} onCommit={(v) => edit((r) => { r.complaint = v })} /></label>
              <label className="field"><span>Cause</span>
                <DraftText multiline value={ro.cause} placeholder="What the tech found" onCommit={(v) => edit((r) => { r.cause = v })} /></label>
              <label className="field"><span>Correction</span>
                <DraftText multiline value={ro.correction} placeholder="What was done to fix it" onCommit={(v) => edit((r) => { r.correction = v })} /></label>
            </div>
          </section>

          <LaborPanel ro={ro} techs={techs} rate={s.laborRate} edit={edit} />
          <PartsPanel ro={ro} catalog={db.parts} edit={edit} />
          <FeesPanel ro={ro} laborTotal={t.labor} pct={s.shopSuppliesPct} edit={edit} />
        </div>

        {/* Right rail */}
        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h3>Totals</h3></div>
            <div className="panel-body totals">
              <span>Labor <span className="muted small">({round2(t.laborHours)} hrs)</span></span><span>{money(t.labor)}</span>
              <span>Parts</span><span>{money(t.parts)}</span>
              <span>Fees</span><span>{money(t.fees)}</span>
              <span>Tax <span className="muted small">{ro.warranty ? '(warranty — none)' : c.taxExempt ? '(customer tax exempt)' : `(${(s.taxRate * 100).toFixed(3).replace(/0+$/, '')}% of ${money(t.taxable)})`}</span></span><span>{money(t.tax)}</span>
              <span className="grand">Total</span><span className="grand">{money(t.total)}</span>
              {!ro.warranty && (
                <>
                  <span className="small muted">Approved</span>
                  <span className="small" style={{ color: approved + 0.01 >= t.total ? 'var(--ok)' : 'var(--bad)', fontWeight: 600 }}>
                    {approved ? money(approved) : 'None'}
                  </span>
                </>
              )}
            </div>
          </section>

          {!c.isCash && !ro.warranty && <RoAccountPanel roId={ro.id} roNumber={ro.number} closed={closed} total={t.total} customerId={c.id} onToast={setToast} />}

          {!ro.warranty && (
            <section className="panel">
              <div className="panel-head"><h3>Customer approval</h3><span className="spacer" />
                <button className="btn sm" onClick={() => setApprovalOpen(true)} disabled={locked}>Record approval</button></div>
              <div className="panel-body">
                {ro.approvals.length === 0 ? <div className="muted small">No approval on file. Record one before starting work.</div> : (
                  <ul className="timeline">
                    {[...ro.approvals].reverse().map((a) => (
                      <li key={a.id} className="approval"><div>
                        <b>{money(a.amount)}</b> by {a.approvedBy} · {APPROVAL_METHOD_LABEL[a.method]}
                        <div className="meta">{fmtDateTime(a.at)} · recorded by {a.recordedBy}</div>
                      </div></li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h3>Job info</h3></div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Customer</dt><dd><Link to={`/customers/${c.id}`}><b>{c.name}</b></Link> <span className="muted mono small">#{c.number}</span></dd>
                {c.creditFlag && <><dt /><dd><span className="tag" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>CREDIT FLAG</span></dd></>}
                {customerPhones(c).map((p) => <Fragment key={p.label}><dt>{p.label === 'Phone' ? 'Phone' : p.label}</dt><dd><a href={`tel:${p.value.replace(/\D/g, '')}`}>{p.value}</a></dd></Fragment>)}
                {c.contact1 && <><dt>Contact</dt><dd>{[c.contact1, c.contact2].filter(Boolean).join(' / ')}</dd></>}
                {c.email && <><dt>Email</dt><dd>{c.email}</dd></>}
                {ro.walkIn && <><dt>Ticket name</dt><dd><b>{ro.walkIn.name}</b>{ro.walkIn.phone && <> · <a href={`tel:${ro.walkIn.phone.replace(/\D/g, '')}`}>{ro.walkIn.phone}</a></>}</dd></>}
                {u ? <>
                  <dt>Unit</dt><dd>{u.make} {u.model}<div className="small muted">{u.type}{u.color && ` · ${u.color}`}</div></dd>
                  <dt>Serial</dt><dd className="mono">{u.serial || '—'}</dd>
                  {u.engineHours != null && <><dt>Hours</dt><dd>{u.engineHours}</dd></>}
                  {u.bin && <><dt>Stored</dt><dd>{u.bin}</dd></>}
                </> : <><dt>Item</dt><dd><DraftText value={ro.item ?? ''} disabled={locked} placeholder="What was brought in" style={{ padding: '3px 6px' }} onCommit={(v) => edit((r) => { r.item = v.trim() || undefined })} /></dd></>}
                <dt>Tech</dt><dd>
                  <select className="select" style={{ padding: '3px 6px' }} value={ro.techId ?? ''} disabled={locked}
                    onChange={(e) => updateRO(ro.id, (r) => { r.techId = e.target.value || null }, { kind: 'edit', text: `Assigned to ${L.staff.get(e.target.value)?.name ?? 'nobody'}` })}>
                    <option value="">Unassigned</option>
                    {techs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select></dd>
                <dt>Promise</dt><dd>
                  {jt ? (
                    <input type="datetime-local" className="input" style={{ padding: '3px 6px' }} disabled={locked}
                      value={ro.promiseDate ? localDT(ro.promiseDate) : ''}
                      onChange={(e) => edit((r) => { r.promiseDate = e.target.value ? new Date(e.target.value).toISOString() : null })} />
                  ) : (
                  <input type="date" className="input" style={{ padding: '3px 6px' }} disabled={locked}
                    value={ro.promiseDate ? ro.promiseDate.slice(0, 10) : ''}
                    onChange={(e) => edit((r) => { r.promiseDate = e.target.value ? new Date(e.target.value + 'T17:00:00').toISOString() : null })} />)}</dd>
                <dt>Tag #</dt><dd><DraftText value={ro.tag ?? ''} disabled={locked} placeholder="e.g. E71" style={{ padding: '3px 6px', width: 120 }}
                  onCommit={(v) => edit((r) => { r.tag = v.trim().toUpperCase() })} /></dd>
                <dt>PO #</dt><dd><DraftText value={ro.poNumber ?? ''} disabled={locked} placeholder="optional" style={{ padding: '3px 6px', width: 160 }}
                  onCommit={(v) => edit((r) => { r.poNumber = v.trim() })} /></dd>
                <dt>Opened</dt><dd>{fmtDate(ro.openedAt)} <span className="muted small">({daysOpen(ro)}d)</span></dd>
                <dt>Last activity</dt><dd>{fmtDate(ro.updatedAt)} <span className="muted small">({daysIdle(ro)}d ago)</span></dd>
                {ro.closedAt && <><dt>Closed</dt><dd>{fmtDate(ro.closedAt)}</dd></>}
                <dt>Warranty</dt><dd><label className="check"><input type="checkbox" checked={ro.warranty} disabled={locked}
                  onChange={(e) => updateRO(ro.id, (r) => { r.warranty = e.target.checked }, { kind: 'edit', text: e.target.checked ? 'Marked as warranty' : 'Warranty flag removed' })} /> Bill to manufacturer</label></dd>
              </dl>
              {!jt && <div className="small" style={{ marginTop: 10 }}>
                <b>Drop-off:</b>{' '}
                {[ro.checklist.hasFuel ? 'has fuel' : 'no fuel', ro.checklist.bladeOn ? 'blade/bar on' : 'blade/bar off',
                  ro.checklist.batteryIncluded && 'battery included', ro.checklist.accessories && `left: ${ro.checklist.accessories}`].filter(Boolean).join(' · ')}
                {ro.dropOffNotes && <div style={{ color: 'var(--cust)', marginTop: 4 }}>{ro.dropOffNotes}</div>}
              </div>}
              {jt && ro.dropOffNotes && <div className="small" style={{ color: 'var(--cust)', marginTop: 10 }}>{ro.dropOffNotes}</div>}
            </div>
          </section>

          <Timeline ro={ro} onNote={(text) => { store.addNote(ro.id, text); setToast('Note added') }} />
          {store.override && <button className="btn ghost danger sm" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirmDelete(true)}>Delete this repair order</button>}
          {closed && !store.override && <div className="small muted">🔒 Closed ROs are locked. Master override unlocks editing.</div>}
        </div>
      </div>

      {approvalOpen && <ApprovalModal defaultAmount={t.total} customerName={c.isBusiness ? '' : c.name.split(' ')[0]}
        onClose={() => setApprovalOpen(false)}
        onSave={(a) => {
          updateRO(ro.id, (r) => { r.approvals.push({ ...a, id: uid(), at: new Date().toISOString(), recordedBy: store.currentUser }) },
            { kind: 'approval', text: `Customer approved ${money(a.amount)} (${APPROVAL_METHOD_LABEL[a.method].toLowerCase()}, ${a.approvedBy})` })
          setApprovalOpen(false); setToast('Approval recorded')
        }} />}

      {pendingStatus && (
        <Modal title={pendingStatus === 'closed' ? `Close RO ${ro.number}?` : 'No approval for this amount'} onClose={() => setPendingStatus(null)}
          footer={<>
            <button className="btn" onClick={() => setPendingStatus(null)}>Cancel</button>
            {pendingStatus === 'in_progress' && <button className="btn" onClick={() => { setPendingStatus(null); setApprovalOpen(true) }}>Record approval first</button>}
            <button className="btn primary" onClick={confirmStatus}>{pendingStatus === 'closed' ? `Close — ${money(t.total)}` : 'Start anyway'}</button>
          </>}>
          {pendingStatus === 'closed' ? (
            <div>
              This finalizes the invoice at <b>{money(t.total)}</b> and takes {ro.parts.filter((p) => p.partId).reduce((a, p) => a + p.qty, 0)} stocked part(s) out of inventory.
              {ro.parts.some((p) => p.status === 'ordered' || p.status === 'back_ordered') && <div className="flag" style={{ marginTop: 10 }}>Some parts are still marked ordered/back-ordered.</div>}
              {!ro.correction.trim() && <div className="flag warn" style={{ marginTop: 10 }}>The correction (C3) is blank — the customer's invoice won't say what was done.</div>}
            </div>
          ) : (
            <div>The job totals <b>{money(t.total)}</b> but the customer has approved {approved ? <b>{money(approved)}</b> : 'nothing'}. Starting work without approval is how shops eat repair bills.</div>
          )}
        </Modal>
      )}
      {confirmDelete && (
        <Modal title={`Delete RO ${ro.number}?`} onClose={() => setConfirmDelete(false)}
          footer={<><button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn primary" onClick={() => { store.mutate((d) => { d.ros = d.ros.filter((r) => r.id !== ro.id) }); store.audit(`Deleted RO ${ro.number}`); nav('/') }}>Delete</button></>}>
          This removes the repair order and its history for good. Usually you want to close it instead.
        </Modal>
      )}
      {archiving && <ArchiveModal ids={[ro.id]} blocked={archiveBlocker(db, ro) ? [{ ro, why: archiveBlocker(db, ro)! }] : []}
        onClose={() => setArchiving(false)} onDone={() => { setArchiving(false); setToast('Archived') }} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

const localDT = (iso: string) => {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------------- Quick-ticket details ---------------- */
function JobDetailsPanel({ ro, locked, edit }: { ro: RepairOrder; locked: boolean; edit: (fn: (r: RepairOrder) => void) => void }) {
  const { db } = useStore()
  const jt = jobTypeOf(db.settings, ro)
  if (!jt) return null
  const f = ro.jobFields ?? {}
  const set = (k: string, v: string | number | boolean) => edit((r) => { r.jobFields = { ...(r.jobFields ?? {}), [k]: v } })
  return (
    <section className="panel">
      <div className="panel-head"><h2>{jt.name} details</h2></div>
      <div className="panel-body tk-fields">
        {jt.fields.map((x) => x.type === 'yesno' ? (
          <label key={x.key} className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" disabled={locked} checked={!!f[x.key]} onChange={(e) => set(x.key, e.target.checked)} /> {x.label}</label>
        ) : x.type === 'select' ? (
          <label key={x.key} className="field"><span>{x.label}</span>
            <select className="select" disabled={locked} value={String(f[x.key] ?? '')} onChange={(e) => set(x.key, e.target.value)}>
              <option value="">—</option>{x.options.map((o) => <option key={o}>{o}</option>)}
              {f[x.key] && !x.options.includes(String(f[x.key])) && <option>{String(f[x.key])}</option>}
            </select></label>
        ) : (
          <label key={x.key} className="field"><span>{x.label}</span>
            <DraftText value={String(f[x.key] ?? '')} disabled={locked} placeholder={x.placeholder}
              onCommit={(v) => set(x.key, x.type === 'number' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : v.trim())} /></label>
        ))}
        {!jt.fields.length && <div className="muted small">No detail fields for this job type.</div>}
      </div>
    </section>
  )
}

/* ---------------- Labor ---------------- */
function LaborPanel({ ro, techs, rate, edit }: { ro: RepairOrder; techs: { id: string; name: string }[]; rate: number; edit: (fn: (r: RepairOrder) => void) => void }) {
  const closed = ro.status === 'closed' && !useStore().override
  const add = (description = '', hours = 0.5) =>
    edit((r) => { r.labor.push({ id: uid(), description, techId: r.techId, hours, rate }) })
  const total = ro.labor.reduce((a, l) => a + l.hours * l.rate, 0)
  return (
    <section className="panel">
      <div className="panel-head"><h2>Labor</h2><span className="spacer" />
        {!closed && <>
          <button className="btn sm ghost" onClick={() => add('Diagnosis', 0.5)}>+ Diagnosis 0.5</button>
          <button className="btn sm" onClick={() => add()}>+ Labor line</button>
        </>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Description</th><th>Tech</th><th className="num">Hours</th><th className="num">Rate</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>
            {ro.labor.length === 0 && <tr><td colSpan={6} className="empty">No labor yet.</td></tr>}
            {ro.labor.map((l, i) => (
              <tr key={l.id}>
                <td style={{ width: '45%' }}>{closed ? l.description : <DraftText value={l.description} placeholder="What's being done" ariaLabel="Labor description" onCommit={(v) => edit((r) => { r.labor[i].description = v })} />}</td>
                <td>{closed ? techs.find((x) => x.id === l.techId)?.name : (
                  <select className="select" value={l.techId ?? ''} aria-label="Tech" onChange={(e) => edit((r) => { r.labor[i].techId = e.target.value || null })}>
                    <option value="">—</option>{techs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>)}</td>
                <td className="num">{closed ? l.hours : <DraftNumber value={l.hours} width={64} ariaLabel="Hours" onCommit={(v) => edit((r) => { r.labor[i].hours = v })} />}</td>
                <td className="num">{closed ? money(l.rate) : <DraftNumber value={l.rate} width={72} decimals={2} ariaLabel="Rate" onCommit={(v) => edit((r) => { r.labor[i].rate = v })} />}</td>
                <td className="num">{money(l.hours * l.rate)}</td>
                <td>{!closed && <button className="btn ghost sm" aria-label="Remove labor line" onClick={() => edit((r) => { r.labor.splice(i, 1) })}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
          {ro.labor.length > 0 && <tfoot><tr><td colSpan={2}>Labor total</td><td className="num">{round2(ro.labor.reduce((a, l) => a + l.hours, 0))}</td><td /><td className="num">{money(total)}</td><td /></tr></tfoot>}
        </table>
      </div>
    </section>
  )
}

/* ---------------- Parts ---------------- */
function PartsPanel({ ro, catalog, edit }: { ro: RepairOrder; catalog: Part[]; edit: (fn: (r: RepairOrder) => void) => void }) {
  const closed = ro.status === 'closed' && !useStore().override
  const total = ro.parts.reduce((a, p) => a + p.qty * p.unitPrice, 0)
  const addFromCatalog = (p: Part) => edit((r) => {
    const existing = r.parts.find((x) => x.partId === p.id)
    if (existing) { existing.qty += 1; return }
    r.parts.push({ id: uid(), partId: p.id, partNo: p.partNo, description: p.description, qty: 1, unitPrice: p.price, status: p.onHand > 0 ? 'in_stock' : 'ordered' })
  })
  const addSpecial = (text: string) => edit((r) => {
    r.parts.push({ id: uid(), partId: null, partNo: 'SPECIAL', description: text, qty: 1, unitPrice: 0, status: 'ordered' })
  })
  return (
    <section className="panel">
      <div className="panel-head"><h2>Parts</h2><span className="spacer" />
        {!closed && <div style={{ width: 340 }}><PartSearch catalog={catalog} onPick={addFromCatalog} onSpecial={addSpecial} /></div>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Part #</th><th>Description</th><th className="num">Qty</th><th className="num">Each</th><th>Status</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>
            {ro.parts.length === 0 && <tr><td colSpan={7} className="empty">No parts yet. Search the catalog above, or type a description to add a special-order part.</td></tr>}
            {ro.parts.map((p, i) => (
              <tr key={p.id}>
                <td className="mono small">{p.partNo}</td>
                <td>{closed || p.partId ? p.description : <DraftText value={p.description} ariaLabel="Part description" onCommit={(v) => edit((r) => { r.parts[i].description = v })} />}</td>
                <td className="num">{closed ? p.qty : <DraftNumber value={p.qty} step={1} width={56} ariaLabel="Quantity" onCommit={(v) => edit((r) => { r.parts[i].qty = v })} />}</td>
                <td className="num">{closed ? money(p.unitPrice) : <DraftNumber value={p.unitPrice} decimals={2} width={76} ariaLabel="Unit price" onCommit={(v) => edit((r) => { r.parts[i].unitPrice = v })} />}</td>
                <td>{closed ? PART_STATUS_LABEL[p.status] : (
                  <select className="select" value={p.status} aria-label="Part status" style={{ color: p.status === 'back_ordered' ? 'var(--bad)' : p.status === 'ordered' ? 'var(--vendor)' : undefined }}
                    onChange={(e) => edit((r) => { r.parts[i].status = e.target.value as PartLineStatus })}>
                    {(Object.keys(PART_STATUS_LABEL) as PartLineStatus[]).map((k) => <option key={k} value={k}>{PART_STATUS_LABEL[k]}</option>)}
                  </select>)}</td>
                <td className="num">{money(p.qty * p.unitPrice)}</td>
                <td>{!closed && <button className="btn ghost sm" aria-label="Remove part" onClick={() => edit((r) => { r.parts.splice(i, 1) })}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
          {ro.parts.length > 0 && <tfoot><tr><td colSpan={5}>Parts total</td><td className="num">{money(total)}</td><td /></tr></tfoot>}
        </table>
      </div>
    </section>
  )
}

function PartSearch({ catalog, onPick, onSpecial }: { catalog: Part[]; onPick: (p: Part) => void; onSpecial: (text: string) => void }) {
  const { db } = useStore()
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  // Built once per catalog change; typing "11236401700" finds "1123 640 1700".
  const hay = useMemo(() => catalog.map((p) => `${p.partNo} ${normPartNo(p.partNo)} ${p.description} ${p.vendor} ${p.line}`.toLowerCase()), [catalog])
  const matches = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    const out: Part[] = []
    for (let i = 0; i < catalog.length && out.length < 10; i++) if (terms.every((t) => hay[i].includes(t))) out.push(catalog[i])
    return out
  }, [q, catalog, hay])
  useEffect(() => setHi(0), [q])
  const done = () => { setQ(''); ref.current?.focus() }
  return (
    <div className="picker">
      <input ref={ref} className="input" placeholder="+ Add part: search # or description" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
          if (e.key === 'Escape') setQ('')
          if (e.key === 'Enter' && q) { e.preventDefault(); if (matches[hi]) onPick(matches[hi]); else onSpecial(q); done() }
        }} />
      {q && (
        <div className="picker-list">
          {matches.map((p, i) => (
            <div key={p.id} className={`picker-item ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); onPick(p); done() }}>
              <span className="mono small">{p.partNo}</span><span>{p.description}</span>
              <span className="small muted">{db.lines.find((l) => l.code === p.line)?.name}</span><span className="spacer" />
              <span className="small" style={{ color: p.onHand ? 'var(--ok)' : 'var(--bad)' }}>{p.onHand} on hand</span>
              <span className="num small">{money(p.price)}</span>
            </div>
          ))}
          <div className={`picker-item ${hi === matches.length ? 'hi' : ''}`} onMouseEnter={() => setHi(matches.length)} onMouseDown={(e) => { e.preventDefault(); onSpecial(q); done() }}>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>+ Special-order part “{q}”</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Fees ---------------- */
function FeesPanel({ ro, laborTotal, pct, edit }: { ro: RepairOrder; laborTotal: number; pct: number; edit: (fn: (r: RepairOrder) => void) => void }) {
  const closed = ro.status === 'closed' && !useStore().override
  const supplies = ro.fees.find((f) => f.description === 'Shop supplies')
  const suppliesAmt = round2(laborTotal * pct / 100)
  return (
    <section className="panel">
      <div className="panel-head"><h2>Fees</h2><span className="spacer" />
        {!closed && pct > 0 && (supplies
          ? Math.abs(supplies.amount - suppliesAmt) > 0.005 && <button className="btn sm ghost" onClick={() => edit((r) => { r.fees.find((f) => f.id === supplies.id)!.amount = suppliesAmt })}>Recalc shop supplies → {money(suppliesAmt)}</button>
          : laborTotal > 0 && <button className="btn sm ghost" onClick={() => edit((r) => { r.fees.push({ id: uid(), description: 'Shop supplies', amount: suppliesAmt, taxable: true }) })}>+ Shop supplies ({pct}% of labor)</button>)}
        {!closed && <button className="btn sm" onClick={() => edit((r) => { r.fees.push({ id: uid(), description: '', amount: 0, taxable: true }) })}>+ Fee</button>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Description</th><th>Taxable</th><th className="num">Qty × each</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>
            {ro.fees.length === 0 && <tr><td colSpan={5} className="empty">No fees.</td></tr>}
            {ro.fees.map((f, i) => (
              <tr key={f.id}>
                <td style={{ width: '60%' }}>{closed ? f.description : <DraftText value={f.description} placeholder="Disposal, pickup/delivery, rush…" ariaLabel="Fee description" onCommit={(v) => edit((r) => { r.fees[i].description = v })} />}</td>
                <td><input type="checkbox" checked={f.taxable} disabled={closed} aria-label="Taxable" onChange={(e) => edit((r) => { r.fees[i].taxable = e.target.checked })} /></td>
                <td className="num">{f.qty != null && f.each != null ? (closed ? `${f.qty} × ${money(f.each)}` : (
                  <span className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                    <DraftNumber value={f.qty} step={1} width={52} ariaLabel="Quantity" onCommit={(v) => edit((r) => { const x = r.fees[i]; x.qty = Math.round(v); x.amount = round2(x.qty * (x.each ?? 0)) })} />
                    <span className="muted">×</span>
                    <DraftNumber value={f.each} decimals={2} width={72} ariaLabel="Each" onCommit={(v) => edit((r) => { const x = r.fees[i]; x.each = v; x.amount = round2((x.qty ?? 1) * v) })} />
                  </span>)) : <span className="muted">—</span>}</td>
                <td className="num">{closed || f.qty != null ? money(f.amount) : <DraftNumber value={f.amount} decimals={2} width={80} ariaLabel="Fee amount" onCommit={(v) => edit((r) => { r.fees[i].amount = v })} />}</td>
                <td>{!closed && <button className="btn ghost sm" aria-label="Remove fee" onClick={() => edit((r) => { r.fees.splice(i, 1) })}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ---------------- Timeline ---------------- */
function Timeline({ ro, onNote }: { ro: RepairOrder; onNote: (t: string) => void }) {
  const [note, setNote] = useState('')
  return (
    <section className="panel">
      <div className="panel-head"><h3>Timeline</h3></div>
      <div className="panel-body stack">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (note.trim()) { onNote(note.trim()); setNote('') } }}>
          <input className="input" placeholder="Add a note (called customer, waiting on…)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn" type="submit" disabled={!note.trim()}>Add</button>
        </form>
        <ul className="timeline">
          {[...ro.timeline].reverse().map((e) => (
            <li key={e.id} className={e.kind}><div>{e.text}<div className="meta">{fmtDateTime(e.at)} · {e.user}</div></div></li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ---------------- Approval modal ---------------- */
function ApprovalModal({ defaultAmount, customerName, onClose, onSave }: {
  defaultAmount: number; customerName: string; onClose: () => void
  onSave: (a: { amount: number; approvedBy: string; method: ApprovalMethod }) => void
}) {
  const [amount, setAmount] = useState(defaultAmount.toFixed(2))
  const [by, setBy] = useState(customerName)
  const [method, setMethod] = useState<ApprovalMethod>('phone')
  const valid = Number(amount) > 0 && by.trim()
  return (
    <Modal title="Record customer approval" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave({ amount: round2(Number(amount)), approvedBy: by.trim(), method })}>Save approval</button></>}>
      <label className="field"><span>Approved amount (up to)</span>
        <input className="input num" style={{ textAlign: 'left' }} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></label>
      <label className="field"><span>Approved by</span><input className="input" autoFocus value={by} onChange={(e) => setBy(e.target.value)} placeholder="Who said yes" /></label>
      <div className="field"><span>How</span>
        <div className="seg">
          {(Object.keys(APPROVAL_METHOD_LABEL) as ApprovalMethod[]).map((m) => (
            <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{APPROVAL_METHOD_LABEL[m]}</button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/** Deposits taken and partial bills for one RO, on the customer's A/R account. */
function RoAccountPanel({ roId, roNumber, closed, total, customerId, onToast }: {
  roId: string; roNumber: number; closed: boolean; total: number; customerId: string; onToast: (t: string) => void
}) {
  const { db, postAr, audit } = useStore()
  const c = db.customers.find((x) => x.id === customerId)!
  const b = roSettlement(db, roId, total)
  const [deposit, setDeposit] = useState(false)
  const [partial, setPartial] = useState(false)
  const due = round2(total - b.billed)
  return (
    <section className="panel">
      <div className="panel-head"><h3>Account &amp; deposits</h3><span className="spacer" />
        <Link className="small" to={`/ar/${c.id}`}>Account</Link></div>
      <div className="panel-body stack" style={{ gap: 8 }}>
        <div className="totals" style={{ padding: 0 }}>
          <span>Deposits taken</span><span>{money(b.deposited)}</span>
          <span>Billed to account</span><span>{money(b.billed)}</span>
          <span className="small muted">{closed ? 'Not billed yet' : 'Left to bill at close'}</span><span className="small">{money(Math.max(0, due))}</span>
          {(b.deposited > 0 || b.billed > 0) && <><span className="small muted">{closed ? 'Balance due' : 'Owed at pickup'}</span><span className="small" style={{ fontWeight: 600 }}>{money(b.due)}</span></>}
          {b.leftover > 0 && <><span className="small muted">Deposit left over</span><span className="small">{money(b.leftover)}</span></>}
        </div>
        {[...b.deposits, ...b.charges].sort((x, y) => x.at.localeCompare(y.at)).map((e) => (
          <div key={e.id} className="small row" style={{ gap: 6 }}>
            <span className="muted nw">{fmtDate(e.at)}</span>
            <span>{e.kind === 'charge' ? (e.partial ? 'Partial bill' : 'Billed') : `Deposit · ${e.method ?? ''}`}</span>
            <span className="spacer" /><span className="mono">{money(e.amount)}</span>
          </div>
        ))}
        {!closed && (
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setDeposit(true)}>Take deposit</button>
            <button className="btn sm" onClick={() => setPartial(true)}>Bill part now</button>
          </div>
        )}
        <div className="small muted">{closed ? 'Use “Charge to account” at the top to bill what’s left.' : 'Deposits are held for this RO and come off the bill when it’s charged. Partial bills charge the account now; the rest is billed at close.'}</div>
      </div>
      {deposit && <DepositModal c={c} roId={roId} roNumber={roNumber} onClose={() => setDeposit(false)} onDone={(amt) => { onToast(`Deposit ${money(amt)} taken`); setDeposit(false) }} />}
      {partial && <PartialModal max={Math.max(0, due)} onClose={() => setPartial(false)} onSave={(amt, memo) => {
        postAr({ customerId: c.id, kind: 'charge', at: new Date().toISOString(), amount: amt, ref: `RO ${roNumber}`, memo: memo || 'Progress bill', roId, partial: true })
        audit(`Partial bill on RO ${roNumber}: ${money(amt)} to #${c.number} ${c.name}`)
        onToast(`Billed ${money(amt)} to account`); setPartial(false)
      }} />}
    </section>
  )
}

function DepositModal({ c, roId, roNumber, onClose, onDone }: { c: { id: string; number: number; name: string }; roId: string; roNumber: number; onClose: () => void; onDone: (amt: number) => void }) {
  const { postAr, audit } = useStore()
  const [amt, setAmt] = useState('')
  const [method, setMethod] = useState<'cash' | 'check' | 'card' | 'other'>('card')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(todayYMD())
  const n = Number(amt.replace(/[$,\s]/g, '')) || 0
  return (
    <Modal title={`Take deposit · RO ${roNumber}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={n <= 0} onClick={() => {
        postAr({ customerId: c.id, kind: 'payment', at: atFromDate(date), amount: round2(n), ref: ref.trim() || `Deposit RO ${roNumber}`, memo: `Deposit on RO ${roNumber}`, roId, deposit: true, method })
        audit(`Deposit ${money(n)} on RO ${roNumber} from #${c.number} ${c.name}`)
        onDone(n)
      }}>Take deposit</button></>}>
      <div className="grid2" style={{ gap: 8 }}>
        <label className="field"><span>Amount</span><input className="input mono" inputMode="decimal" autoFocus placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
        <label className="field"><span>Method</span><select className="select" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          <option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="other">Other</option></select></label>
        <label className="field"><span>Check # / reference</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="field"><span>Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>Held on {c.name}’s account for this RO. It comes off the bill when the RO is charged, and prints on the invoice.</div>
    </Modal>
  )
}

function PartialModal({ max, onClose, onSave }: { max: number; onClose: () => void; onSave: (amt: number, memo: string) => void }) {
  const [amt, setAmt] = useState('')
  const [memo, setMemo] = useState('')
  const n = Number(amt.replace(/[$,\s]/g, '')) || 0
  return (
    <Modal title="Bill part of this RO now" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={n <= 0} onClick={() => onSave(round2(n), memo.trim())}>Charge to account</button></>}>
      <div className="stack">
        <label className="field"><span>Amount (up to {money(max)} so far)</span><input className="input mono" inputMode="decimal" autoFocus placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
        <label className="field"><span>What it’s for</span><input className="input" placeholder="Parts ordered, first half of labor…" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        {n > max + 0.004 && <div className="small" style={{ color: 'var(--cust)' }}>More than the RO total so far. That’s allowed, but the final bill will come out negative unless more work is added.</div>}
      </div>
    </Modal>
  )
}

