import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import {
  AGING, KIND_LABEL, isDebit, lastCycleClose, previousCycleClose, statementCandidates, statementFor, type Statement,
} from '../lib/ar'
import { addressLine, statementDelivery } from '../lib/customerSearch'
import { fmtDate, fmtDateTime, money, round2, uid } from '../lib/calc'
import { ArTabs } from './AR'

const dateLabel = (ymd: string) => fmtDate(new Date(`${ymd}T12:00:00`).toISOString())

// ---------- Statement run (pick who gets one, print the batch) ----------

export default function ArStatements() {
  const { db, mutate, audit, currentUser } = useStore()
  const nav = useNavigate()
  const [date, setDate] = useState(() => lastCycleClose(db.settings))
  const list = useMemo(() => statementCandidates(db, date), [db, date])
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [deliv, setDeliv] = useState<'all' | 'paper' | 'other'>('all')
  const isPaper = (code?: string) => !code || /^p$/i.test(code)
  const shown = list.filter((s) => deliv === 'all' || (deliv === 'paper') === isPaper(s.c.deliveryCode))
  const chosen = shown.filter((s) => !skip.has(s.c.id))
  const total = round2(chosen.reduce((a, s) => a + s.due, 0))
  const runs = db.statementRuns.filter((r) => r.date === date)

  const print = () => {
    const ids = chosen.map((s) => s.c.id)
    mutate((d) => { d.statementRuns.unshift({ id: uid(), date, at: new Date().toISOString(), user: currentUser, customerIds: ids }) })
    audit(`Statement run for ${dateLabel(date)}: ${ids.length} statement${ids.length === 1 ? '' : 's'}, ${money(total)} due`)
    nav(`/ar/statements/print?date=${date}&ids=${ids.join(',')}`)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Accounts Receivable</h1><div className="sub">Statements close on {db.settings.statementDay ? `the ${ordinal(db.settings.statementDay)} of the month` : 'the last day of the month'} (change in Settings)</div></div>
      </div>
      <ArTabs />

      <div className="row wrap" style={{ gap: 12, marginBottom: 12 }}>
        <label className="field"><span>Statement date</span><input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setSkip(new Set()) }} /></label>
        <div className="small muted" style={{ alignSelf: 'end', paddingBottom: 8 }}>Period {dateLabel(previousCycleClose(db.settings, date))} – {dateLabel(date)}</div>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Delivery" style={{ alignSelf: 'end' }}>
          <button className={deliv === 'all' ? 'on' : ''} onClick={() => setDeliv('all')}>All</button>
          <button className={deliv === 'paper' ? 'on' : ''} onClick={() => setDeliv('paper')}>Paper</button>
          <button className={deliv === 'other' ? 'on' : ''} onClick={() => setDeliv('other')}>Other delivery</button>
        </div>
        <button className="btn primary" style={{ alignSelf: 'end' }} disabled={!chosen.length} onClick={print}>Print {chosen.length} statement{chosen.length === 1 ? '' : 's'}</button>
      </div>
      {runs.length > 0 && <div className="ar-warn" style={{ marginBottom: 12 }}>Already printed for this date {runs.length === 1 ? 'once' : `${runs.length} times`} (last {fmtDateTime(runs[0].at)} by {runs[0].user}).</div>}

      <div className="panel table-wrap">
        <table className="table">
          <thead><tr>
            <th style={{ width: 32 }}><input type="checkbox" aria-label="Select all" checked={shown.length > 0 && chosen.length === shown.length}
              onChange={(e) => setSkip(e.target.checked ? new Set() : new Set(shown.map((s) => s.c.id)))} /></th>
            <th>#</th><th>Customer</th><th>Type</th><th>Delivery</th><th className="num">Previous</th><th className="num">Activity</th><th className="num">Amount due</th><th className="num">Past due</th><th /></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.c.id}>
                <td><input type="checkbox" aria-label={`Include ${s.c.name}`} checked={!skip.has(s.c.id)} onChange={(e) => {
                  const n = new Set(skip); if (e.target.checked) n.delete(s.c.id); else n.add(s.c.id); setSkip(n)
                }} /></td>
                <td className="mono small">{s.c.number}</td>
                <td className="cell-main">{s.c.name}{!addressLine(s.c) && <span className="lk-pill warn" style={{ marginLeft: 6 }}>No address</span>}</td>
                <td className="small">{s.balanceForward ? 'Balance fwd' : 'Open item'}</td>
                <td className="small">{statementDelivery(s.c.deliveryCode) ?? <span className="muted">Paper (default)</span>}</td>
                <td className="num">{money(s.previous)}</td>
                <td className="num small">{s.activity.length}</td>
                <td className="num" style={{ fontWeight: 600 }}>{s.acct.balance < 0 ? `${money(-s.acct.balance)} CR` : money(s.due)}</td>
                <td className={`num ${s.pastDue ? '' : 'muted'}`} style={s.pastDue ? { color: 'var(--bad)' } : undefined}>{s.pastDue ? money(s.pastDue) : '—'}</td>
                <td><Link className="btn ghost sm" to={`/ar/statement/${s.c.id}?date=${date}`}>Preview</Link></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={10} className="empty">No statements for this date. Accounts under {money(db.settings.statementMinBalance)} with no activity are skipped.</td></tr>}
          </tbody>
          {chosen.length > 0 && <tfoot><tr><td colSpan={7} className="small muted">{chosen.length} selected</td><td className="num" style={{ fontWeight: 700 }}>{money(total)}</td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><h2>Statement runs</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Statement date</th><th>Printed</th><th>By</th><th className="num">Statements</th><th /></tr></thead>
            <tbody>
              {db.statementRuns.slice(0, 24).map((r) => (
                <tr key={r.id}>
                  <td>{dateLabel(r.date)}</td><td className="small">{fmtDateTime(r.at)}</td><td className="small">{r.user}</td>
                  <td className="num">{r.customerIds.length}</td>
                  <td><Link className="btn ghost sm" to={`/ar/statements/print?date=${r.date}&ids=${r.customerIds.join(',')}`}>Reprint</Link></td>
                </tr>
              ))}
              {!db.statementRuns.length && <tr><td colSpan={5} className="empty">No statements printed yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const ordinal = (n: number) => {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** Balance-forward lines: previous balance, then each line with the running total. */
function bfRowsOf(s: Statement) {
  const out: { e: Statement['activity'][number]; bal: number }[] = []
  let run = s.previous
  for (const e of s.activity) { run = round2(run + (isDebit(e) ? e.amount : -e.amount)); out.push({ e, bal: run }) }
  return out
}

// ---------- Printing ----------

/** /ar/statements/print?date=&ids= — a batch, one statement per page. */
export function StatementBatchPrint() {
  const { db } = useStore()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const date = params.get('date') ?? lastCycleClose(db.settings)
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean)
  const list = ids.map((id) => db.customers.find((c) => c.id === id)).filter(Boolean).map((c) => statementFor(db, c!, date))
  return (
    <div className="inv-wrap">
      <div className="print-bar no-print">
        <button className="btn" onClick={() => nav('/ar/statements')}>← Statements</button>
        <span className="small muted" style={{ alignSelf: 'center' }}>{list.length} statement{list.length === 1 ? '' : 's'} · {dateLabel(date)}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      {list.map((s) => <StatementDoc key={s.c.id} s={s} />)}
      {!list.length && <div className="page">Nothing to print.</div>}
    </div>
  )
}

/** /ar/statement/:id?date= — one customer, any date. */
export function StatementSinglePrint() {
  const { id } = useParams()
  const { db } = useStore()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? lastCycleClose(db.settings)
  const c = db.customers.find((x) => x.id === id)
  if (!c) return <div className="page">Customer not found. <Link to="/ar">Back</Link></div>
  const s = statementFor(db, c, date)
  return (
    <div className="inv-wrap">
      <div className="print-bar no-print">
        <button className="btn" onClick={() => nav(`/ar/${c.id}`)}>← Account</button>
        <label className="row small" style={{ gap: 6 }}>Statement date
          <input className="input" type="date" value={date} onChange={(e) => setParams({ date: e.target.value }, { replace: true })} /></label>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <StatementDoc s={s} />
    </div>
  )
}

function StatementDoc({ s }: { s: Statement }) {
  const { db } = useStore()
  const st = db.settings
  const c = s.c
  const credits = s.activity.filter((e) => !isDebit(e))
  const cityLine = [[c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ')
  const bfRows = bfRowsOf(s)
  const amountDue = s.acct.balance

  return (
    <div className="doc stmt">
      <header className="inv-head">
        <div className="inv-shop">
          <div className="inv-shop-name">{st.shopName}</div>
          <div className="inv-shop-lines">
            {st.shopAddress && <div>{st.shopAddress}</div>}
            <div>{[st.shopPhone && `Phone ${st.shopPhone}`, st.shopFax && `Fax ${st.shopFax}`].filter(Boolean).join('  ·  ')}</div>
          </div>
        </div>
        <div className="inv-title">
          <div className="inv-kind">Statement</div>
          <div className="inv-no mono">{dateLabel(s.date)}</div>
          <div className="inv-chips"><span className="inv-chip">Account {c.number}</span><span className="inv-chip">{s.balanceForward ? 'Balance forward' : 'Open item'}</span></div>
        </div>
      </header>

      <section className="stmt-top">
        <div>
          <div className="inv-label">Bill to</div>
          <div className="stmt-addr">
            <b>{c.name}</b>
            {c.contact1 && <div>Attn: {c.contact1}</div>}
            {c.address && <div>{c.address}</div>}
            {c.address2 && <div>{c.address2}</div>}
            {cityLine && <div>{cityLine}</div>}
          </div>
        </div>
        <div className="stmt-due">
          <div className="inv-label">{amountDue < 0 ? 'Credit on account' : 'Amount due'}</div>
          <div className="stmt-due-v mono">{money(Math.abs(amountDue))}</div>
          <div className="small">Terms: net {s.acct.terms} days</div>
          {s.pastDue > 0 && <div className="stmt-pastdue">Past due: {money(s.pastDue)}</div>}
        </div>
      </section>

      {s.balanceForward ? (
        <table className="stmt-table">
          <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th className="num">Charges</th><th className="num">Payments / credits</th><th className="num">Balance</th></tr></thead>
          <tbody>
            <tr className="stmt-prev"><td>{dateLabel(s.from)}</td><td colSpan={4}>Previous balance</td><td className="num">{money(s.previous)}</td></tr>
            {bfRows.map(({ e, bal }) => (
              <tr key={e.id}><td>{fmtDate(e.at)}</td><td>{e.ref}</td><td>{KIND_LABEL[e.kind]}{e.memo ? ` · ${e.memo}` : ''}</td>
                <td className="num">{isDebit(e) ? money(e.amount) : ''}</td><td className="num">{!isDebit(e) ? money(e.amount) : ''}</td><td className="num">{money(bal)}</td></tr>
            ))}
            {!bfRows.length && <tr><td colSpan={6} className="inv-dim">No activity this period.</td></tr>}
          </tbody>
        </table>
      ) : (
        <>
          <div className="stmt-h">Open invoices as of {dateLabel(s.date)}</div>
          <table className="stmt-table">
            <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th className="num">Original</th><th className="num">Paid</th><th className="num">Open</th><th className="num">Age</th></tr></thead>
            <tbody>
              {s.acct.open.map((o) => (
                <tr key={o.entry.id} className={o.pastDue ? 'stmt-late' : ''}>
                  <td>{fmtDate(o.entry.at)}</td><td>{o.entry.ref}</td><td>{o.entry.memo || KIND_LABEL[o.entry.kind]}</td>
                  <td className="num">{money(o.entry.amount)}</td><td className="num">{money(round2(o.entry.amount - o.remaining))}</td>
                  <td className="num"><b>{money(o.remaining)}</b></td><td className="num">{o.days}d</td>
                </tr>
              ))}
              {!s.acct.open.length && <tr><td colSpan={7} className="inv-dim">Nothing open. Thank you!</td></tr>}
            </tbody>
          </table>
          {credits.length > 0 && (
            <>
              <div className="stmt-h">Payments and credits received {dateLabel(s.from)} – {dateLabel(s.date)}</div>
              <table className="stmt-table">
                <tbody>
                  {credits.map((e) => (
                    <tr key={e.id}><td>{fmtDate(e.at)}</td><td>{e.ref}</td><td>{KIND_LABEL[e.kind]}{e.deposit ? ' (deposit)' : ''}{e.memo ? ` · ${e.memo}` : ''}</td><td className="num">−{money(e.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {s.acct.held > 0 && <div className="small" style={{ marginTop: 6 }}>Deposits held for work in progress: {money(s.acct.held)} (applied when that work is billed).</div>}
          {s.acct.unapplied > 0 && <div className="small" style={{ marginTop: 6 }}>Unapplied credit on account: {money(s.acct.unapplied)}.</div>}
        </>
      )}

      <div className="stmt-aging">
        {AGING.map((b) => <div key={b}><div className="inv-label">{b === 'Current' ? 'Current' : `${b} days`}</div><div className="mono">{money(s.acct.aging[b])}</div></div>)}
        <div className="stmt-aging-total"><div className="inv-label">{amountDue < 0 ? 'Credit' : 'Amount due'}</div><div className="mono">{money(Math.abs(amountDue))}</div></div>
      </div>

      {st.statementMessage && <div className="stmt-msg">{st.statementMessage}</div>}

      <div className="stmt-stub">
        <div className="stmt-cut">✂ Please detach and return this portion with your payment</div>
        <div className="stmt-stub-grid">
          <div><div className="inv-label">Remit to</div><b>{st.shopName}</b><div>{st.shopAddress}</div></div>
          <div><div className="inv-label">Account</div><div className="mono">{c.number}</div><div>{c.name}</div></div>
          <div><div className="inv-label">Statement date</div><div>{dateLabel(s.date)}</div></div>
          <div><div className="inv-label">Amount due</div><div className="mono" style={{ fontWeight: 700 }}>{money(Math.max(0, amountDue))}</div></div>
          <div className="stmt-enclosed"><div className="inv-label">Amount enclosed</div><div className="stmt-blank">$</div></div>
        </div>
      </div>
    </div>
  )
}

