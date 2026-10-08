import { Fragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLookups, useStore } from '../lib/store'
import { APPROVAL_METHOD_LABEL, PART_STATUS_LABEL, STATUS_LABEL, customerPhones, fmtDate, fmtDateTime, money, roTotals } from '../lib/calc'
import { Barcode } from '../components/barcode'
import { roSettlement } from '../lib/ar'
import { jobFieldsLine, jobTypeOf } from '../lib/jobs'

/** One labelled value in the info strip. Empty values print a dash so the grid never collapses. */
function Meta({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="inv-meta-cell">
      <div className="inv-label">{label}</div>
      <div className={`inv-meta-val ${mono ? 'mono' : ''}`}>{children || <span className="inv-dim">—</span>}</div>
    </div>
  )
}

const short = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`
}
const qtyFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export default function PrintRO() {
  const { id, kind } = useParams()
  const { db } = useStore()
  const L = useLookups()
  const nav = useNavigate()
  const ro = db.ros.find((r) => r.id === id)
  if (!ro) return <div className="page">Not found</div>
  const c = L.customer.get(ro.customerId)!
  const u = ro.unitId ? L.unit.get(ro.unitId) : undefined
  const jt = jobTypeOf(db.settings, ro)
  const details = jobFieldsLine(jt, ro.jobFields)
  const phones = c.isCash && ro.walkIn?.phone ? [{ label: 'Phone', value: ro.walkIn.phone }] : customerPhones(c)
  const s = db.settings
  const t = roTotals(ro, s, !!c.taxExempt)
  const tech = ro.techId ? L.staff.get(ro.techId)?.name : ''
  const counter = ro.timeline.find((e) => e.kind === 'created')?.user ?? ''
  const isTicket = kind === 'ticket'
  const closed = ro.status === 'closed'
  const title = isTicket ? (jt ? `${jt.ticketName} ticket` : 'Shop Ticket') : closed ? 'Invoice' : jt ? 'Ticket' : 'Repair Estimate'
  const cityLine = [[c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ')
  const taxPct = (s.taxRate * 100).toFixed(3).replace(/\.?0+$/, '')
  const subtotal = t.labor + t.parts + t.fees
  const now = new Date().toISOString()
  const bill = roSettlement(db, ro.id, t.total)

  return (
    <div className="inv-wrap">
      <div className="print-bar no-print">
        <button className="btn" onClick={() => nav(`/ro/${ro.id}`)}>← Back to RO</button>
        <span className="spacer" />
        {!isTicket && <button className="btn" onClick={() => nav(`/ro/${ro.id}/print/ticket`)}>Shop ticket</button>}
        {isTicket && <button className="btn" onClick={() => nav(`/ro/${ro.id}/print/invoice`)}>Customer copy</button>}
        <button className="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <div className={`doc inv ${isTicket ? 'inv-ticket' : ''}`}>
        {/* ---------- Header ---------- */}
        <header className="inv-head">
          <div className="inv-shop">
            <div className="inv-shop-name">{s.shopName}</div>
            <div className="inv-shop-lines">
              {s.shopAddress && <div>{s.shopAddress}</div>}
              <div>{[s.shopPhone && `Phone ${s.shopPhone}`, s.shopFax && `Fax ${s.shopFax}`].filter(Boolean).join('  ·  ')}</div>
            </div>
          </div>
          <div className="inv-title">
            <div className="inv-kind">{title}</div>
            <div className="inv-no mono">{ro.number}</div>
            <div className="inv-chips">
              {ro.tag && <span className="inv-chip inv-chip-tag">Tag <b>{ro.tag}</b></span>}
              {ro.warranty && <span className="inv-chip inv-chip-dark">Warranty</span>}
              {!closed && !isTicket && <span className="inv-chip">{STATUS_LABEL[ro.status]}</span>}
              {closed && !isTicket && <span className="inv-chip">Closed {fmtDate(ro.closedAt!)}</span>}
            </div>
          </div>
        </header>

        {/* ---------- Bill to / contact / unit ---------- */}
        <section className="inv-cards">
          <div className="inv-card">
            <div className="inv-label">Bill to</div>
            <div className="inv-strong">{c.isCash && ro.walkIn?.name ? ro.walkIn.name : c.name}</div>
            {c.contact1 && <div className="inv-dim">Attn: {[c.contact1, c.contact2].filter(Boolean).join(' / ')}</div>}
            {c.address && <div>{c.address}</div>}
            {c.address2 && <div>{c.address2}</div>}
            {cityLine && <div>{cityLine}</div>}
          </div>
          <div className="inv-card">
            <div className="inv-label">Contact</div>
            <dl className="inv-dl">
              {phones.map((p) => <Fragment key={p.label}><dt>{p.label}</dt><dd>{p.value}</dd></Fragment>)}
              {!phones.length && <><dt>Phone</dt><dd>—</dd></>}
              {c.email && <><dt>Email</dt><dd className="inv-break">{c.email}</dd></>}
              <dt>Tax</dt><dd>{c.taxExempt ? 'Exempt' : 'Taxable'}</dd>
              {c.category && <><dt>Type</dt><dd>{c.category}</dd></>}
            </dl>
          </div>
          <div className="inv-card inv-card-unit">
            <div className="inv-label">{u ? 'Unit' : 'Item'}</div>
            {u ? <>
              <div className="inv-strong">{u.make} {u.model}</div>
              <div className="inv-dim">{u.type}{u.color && ` · ${u.color}`}</div>
              <dl className="inv-dl" style={{ marginTop: 6 }}>
                <dt>Serial</dt><dd className="mono">{u.serial || '—'}</dd>
                {u.engineHours != null && <><dt>Hours</dt><dd>{u.engineHours}</dd></>}
              </dl>
            </> : <div className="inv-strong">{ro.item || '—'}</div>}
          </div>
        </section>

        {/* ---------- Info strip ---------- */}
        <section className="inv-meta">
          <Meta label="Customer #" mono>{c.number}</Meta>
          <Meta label="Date in">{short(ro.openedAt)}</Meta>
          <Meta label="Promised">{short(ro.promiseDate)}{jt && ro.promiseDate && ` ${new Date(ro.promiseDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}</Meta>
          <Meta label="Counter">{counter}</Meta>
          <Meta label="Salesman">{c.salesman}</Meta>
          <Meta label="Technician">{tech}</Meta>
          <Meta label="PO #" mono>{ro.poNumber}</Meta>
          <Meta label="Printed">{short(now)}</Meta>
        </section>

        {/* ---------- The job ---------- */}
        <section className="inv-job">
          <div className="inv-job-head">
            <span className="inv-job-no">Service 1</span>
            <span className="inv-job-text">{ro.complaint || 'No complaint entered'}</span>
          </div>
          {details && <div className="inv-note"><b>{jt!.name} details:</b> {details}</div>}

          {isTicket && jt ? (
            <>
              {ro.dropOffNotes && <div className="inv-note"><b>Notes:</b> {ro.dropOffNotes}</div>}
              <table className="inv-lines inv-lines-ticket">
                <thead><tr><th>Service</th><th className="r" style={{ width: 70 }}>Qty</th><th style={{ width: 120 }}>Done (initials)</th></tr></thead>
                <tbody>
                  {ro.fees.map((f) => <tr key={f.id}><td>{f.description}</td><td className="r">{f.qty ?? 1}</td><td /></tr>)}
                  {ro.parts.map((p) => <tr key={p.id}><td>{p.description} <span className="mono inv-dim">{p.partNo}</span></td><td className="r">{p.qty}</td><td /></tr>)}
                  {Array.from({ length: Math.max(0, 3 - ro.fees.length - ro.parts.length) }).map((_, i) => <tr key={i}><td /><td /><td /></tr>)}
                </tbody>
              </table>
            </>
          ) : isTicket ? (
            <>
              <div className="inv-check">
                <span>{ro.checklist.hasFuel ? '☑' : '☐'} Has fuel</span>
                <span>{ro.checklist.bladeOn ? '☑' : '☐'} Blade / bar on</span>
                <span>{ro.checklist.batteryIncluded ? '☑' : '☐'} Battery</span>
                {ro.checklist.accessories && <span>Left with unit: <b>{ro.checklist.accessories}</b></span>}
              </div>
              {ro.dropOffNotes && <div className="inv-note"><b>Drop-off notes:</b> {ro.dropOffNotes}</div>}
              <div className="inv-cc">
                <div><div className="inv-label">Cause — what you found</div><div className="inv-write">{ro.cause}</div></div>
                <div><div className="inv-label">Correction — what you did</div><div className="inv-write">{ro.correction}</div></div>
              </div>
              <table className="inv-lines inv-lines-ticket">
                <thead><tr><th>Labor</th><th style={{ width: 140 }}>Tech</th><th className="r" style={{ width: 70 }}>Hours</th></tr></thead>
                <tbody>
                  {ro.labor.map((l) => <tr key={l.id}><td>{l.description}</td><td>{l.techId ? L.staff.get(l.techId)?.name : ''}</td><td className="r">{l.hours}</td></tr>)}
                  {Array.from({ length: Math.max(0, 4 - ro.labor.length) }).map((_, i) => <tr key={i}><td /><td /><td /></tr>)}
                </tbody>
              </table>
              <table className="inv-lines inv-lines-ticket">
                <thead><tr><th style={{ width: 140 }}>Part #</th><th>Description</th><th className="r" style={{ width: 50 }}>Qty</th><th style={{ width: 110 }}>Status</th></tr></thead>
                <tbody>
                  {ro.parts.map((p) => <tr key={p.id}><td className="mono">{p.partNo}</td><td>{p.description}</td><td className="r">{p.qty}</td><td>{PART_STATUS_LABEL[p.status]}</td></tr>)}
                  {Array.from({ length: Math.max(0, 6 - ro.parts.length) }).map((_, i) => <tr key={i}><td /><td /><td /><td /></tr>)}
                </tbody>
              </table>
            </>
          ) : (
            <>
              {(ro.cause || ro.correction) && (
                <div className="inv-cc inv-cc-read">
                  {ro.cause && <div><div className="inv-label">Cause</div><div>{ro.cause}</div></div>}
                  {ro.correction && <div><div className="inv-label">Correction</div><div>{ro.correction}</div></div>}
                </div>
              )}
              <table className="inv-lines">
                <thead>
                  <tr><th>Description</th><th style={{ width: 130 }}>Reference</th><th className="r" style={{ width: 54 }}>Qty</th><th className="r" style={{ width: 84 }}>Net each</th><th className="r" style={{ width: 92 }}>Amount</th></tr>
                </thead>
                <tbody>
                  {ro.labor.length > 0 && <tr className="inv-group"><td colSpan={5}>Labor</td></tr>}
                  {ro.labor.map((l) => (
                    <tr key={l.id}><td>{l.description}</td><td className="inv-dim">{l.techId ? L.staff.get(l.techId)?.name : ''}</td>
                      <td className="r">{qtyFmt(l.hours)} h</td><td className="r">{money(l.rate)}</td><td className="r">{money(l.hours * l.rate)}</td></tr>
                  ))}
                  {ro.parts.length > 0 && <tr className="inv-group"><td colSpan={5}>Parts</td></tr>}
                  {ro.parts.map((p) => (
                    <tr key={p.id}><td>{p.description}</td><td className="mono">{p.partNo}</td>
                      <td className="r">{qtyFmt(p.qty)}</td><td className="r">{money(p.unitPrice)}</td><td className="r">{money(p.qty * p.unitPrice)}</td></tr>
                  ))}
                  {ro.fees.length > 0 && <tr className="inv-group"><td colSpan={5}>{jt ? 'Services' : 'Fees'}</td></tr>}
                  {ro.fees.map((f) => (
                    <tr key={f.id}><td>{f.description}</td><td /><td className="r">{f.qty ?? 1}</td><td className="r">{money(f.each ?? f.amount)}</td><td className="r">{money(f.amount)}</td></tr>
                  ))}
                  {!ro.labor.length && !ro.parts.length && !ro.fees.length && (
                    <tr><td colSpan={5} className="inv-dim" style={{ padding: '14px 8px' }}>No labor or parts on this order yet.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </section>

        {/* ---------- Totals + notes ---------- */}
        {!isTicket && (
          <section className="inv-bottom">
            <div className="inv-notes">
              {ro.warranty && <div className="inv-note"><b>Warranty repair.</b> {money(t.total)} is billed to the manufacturer. Nothing is due from the customer for covered work.</div>}
              {ro.approvals.length > 0 && (
                <div className="inv-note"><b>Approved:</b>{' '}
                  {ro.approvals.map((a) => `${money(a.amount)} by ${a.approvedBy} (${APPROVAL_METHOD_LABEL[a.method].toLowerCase()}, ${fmtDateTime(a.at)})`).join('; ')}
                </div>
              )}
              {!closed && <div className="inv-note">This is an estimate. If we find more wrong, we'll call for approval before going over the approved amount.</div>}
            </div>
            <div className="inv-totals">
              <div className="inv-trow"><span>Labor <span className="inv-dim">({qtyFmt(t.laborHours)} h)</span></span><span>{money(t.labor)}</span></div>
              <div className="inv-trow"><span>Parts</span><span>{money(t.parts)}</span></div>
              {t.fees > 0 && <div className="inv-trow"><span>Fees</span><span>{money(t.fees)}</span></div>}
              <div className="inv-trow inv-sub"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              <div className="inv-trow"><span>Sales tax <span className="inv-dim">{c.taxExempt ? '(exempt)' : ro.warranty ? '(warranty)' : `(${taxPct}%)`}</span></span><span>{money(t.tax)}</span></div>
              <div className="inv-grand">
                <span>{ro.warranty ? 'Due from customer' : closed ? 'Total due' : 'Estimated total'}</span>
                <span>{money(ro.warranty ? 0 : t.total)}</span>
              </div>
              {!ro.warranty && (bill.deposited > 0 || bill.onAccount > 0) && (
                <>
                  {bill.deposited > 0 && <div className="inv-trow"><span>Less deposit{bill.deposits.length > 1 ? 's' : ''} paid</span><span>−{money(bill.deposited)}</span></div>}
                  {bill.onAccount > 0 && <div className="inv-trow"><span>Less billed to your account</span><span>−{money(bill.onAccount)}</span></div>}
                  <div className="inv-trow inv-sub"><span>{closed ? 'Balance due' : 'Due at pickup'}</span><span>{money(bill.due)}</span></div>
                  {bill.leftover > 0 && <div className="inv-trow"><span className="inv-dim">Deposit left over (stays on your account)</span><span>{money(bill.leftover)}</span></div>}
                </>
              )}
            </div>
          </section>
        )}

        {/* ---------- Footer ---------- */}
        <footer className="inv-foot">
          {!isTicket && s.invoiceTerms && <div className="inv-terms">{s.invoiceTerms}</div>}
          <div className="inv-sign">
            <div className="inv-barcode">
              <Barcode value={String(ro.number)} height={30} module={1.25} />
              <div className="mono">{ro.number}{ro.tag ? `  ·  ${ro.tag}` : ''}</div>
            </div>
            {isTicket ? (
              <>
                <div className="inv-line"><span>Tech signature</span></div>
                <div className="inv-line inv-line-short"><span>Date done</span></div>
              </>
            ) : (
              <>
                <div className="inv-line"><span>Customer acknowledges receipt</span></div>
                <div className="inv-line inv-line-short"><span>Date</span></div>
              </>
            )}
          </div>
          <div className="inv-footline">
            <span>{s.shopName} · {title} #{ro.number} · {c.name}</span>
            <span>Printed {fmtDateTime(now)}</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
