import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import type { ArEntry, ArKind, Customer, PayMethod } from '../lib/types'
import { AGING, KIND_LABEL, PAY_METHOD_LABEL, accountOf, allAccounts, live, withRunningBalance, type Account } from '../lib/ar'
import { fmtDate, money, round2 } from '../lib/calc'
import { Icon, Modal } from '../components/ui'
import { OverrideButton } from '../components/override'
import { CustomerSearchPick } from '../components/custpick'

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// ---------- Overview ----------

type Sort = 'balance' | 'pastdue' | 'oldest' | 'name'

export default function ArOverview() {
  const { db } = useStore()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'pastdue' | 'over' | 'credit'>('all')
  const [sort, setSort] = useState<Sort>('balance')
  const [pay, setPay] = useState(false)
  const [post, setPost] = useState(false)
  const accounts = useMemo(() => allAccounts(db), [db])
  const byId = useMemo(() => new Map(db.customers.map((c) => [c.id, c])), [db.customers])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...accounts.entries()]
      .map(([id, a]) => ({ c: byId.get(id)!, a }))
      .filter(({ c, a }) => c && Math.abs(a.balance) > 0.004)
      .filter(({ c }) => !t || c.name.toLowerCase().includes(t) || String(c.number).startsWith(t))
      .filter(({ a }) => only === 'all' || (only === 'pastdue' ? a.pastDue > 0 : only === 'over' ? a.overLimit : a.balance < 0))
      .sort((x, y) => sort === 'name' ? x.c.name.localeCompare(y.c.name)
        : sort === 'pastdue' ? y.a.pastDue - x.a.pastDue
          : sort === 'oldest' ? (y.a.open[0]?.days ?? -1) - (x.a.open[0]?.days ?? -1)
            : y.a.balance - x.a.balance)
  }, [accounts, byId, q, only, sort])

  const tot = useMemo(() => {
    const t = { balance: 0, pastDue: 0, credit: 0, aging: { Current: 0, '31–60': 0, '61–90': 0, 'Over 90': 0 } as Account['aging'], count: 0 }
    for (const a of accounts.values()) {
      if (a.balance > 0.004) { t.balance += a.balance; t.count++ }
      if (a.balance < -0.004) t.credit += -a.balance
      t.pastDue += a.pastDue
      for (const b of AGING) t.aging[b] += a.aging[b]
    }
    return t
  }, [accounts])

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Accounts Receivable</h1><div className="sub">{tot.count} account{tot.count === 1 ? '' : 's'} owe {money(round2(tot.balance))} · open item, oldest charge paid first</div></div>
        <span className="spacer" />
        <button className="btn" onClick={() => setPost(true)}>Post charge / credit</button>
        <button className="btn primary" onClick={() => setPay(true)}>{Icon.plus} Record payment</button>
      </div>

      <div className="ar-tiles">
        <Tile label="Total owed" value={tot.balance} strong />
        {AGING.map((b) => <Tile key={b} label={b === 'Current' ? 'Current (0–30)' : b} value={tot.aging[b]} warn={b === 'Over 90' || b === '61–90'} />)}
        <Tile label="Past their terms" value={tot.pastDue} warn />
        <Tile label="Credit balances" value={tot.credit} />
      </div>

      <div className="row wrap" style={{ margin: '14px 0 10px', gap: 8 }}>
        <label className="search" style={{ flex: '1 1 260px' }}>{Icon.search}<input className="input" placeholder="Find account by name or #" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {([['all', 'All balances'], ['pastdue', 'Past due'], ['over', 'Over limit'], ['credit', 'Credit balance']] as const).map(([k, l]) => (
          <button key={k} className={`lk-chip ${only === k ? 'on' : ''}`} onClick={() => setOnly(k)}>{l}</button>
        ))}
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="balance">Largest balance</option><option value="pastdue">Most past due</option><option value="oldest">Oldest open charge</option><option value="name">Name A–Z</option>
        </select>
      </div>

      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>#</th><th>Customer</th><th className="num">Balance</th>{AGING.map((b) => <th key={b} className="num">{b}</th>)}<th>Oldest open</th><th>Last payment</th><th className="num">Limit</th></tr></thead>
          <tbody>
            {rows.map(({ c, a }) => (
              <tr key={c.id} className="click" onClick={() => nav(`/ar/${c.id}`)}>
                <td className="mono small">{c.number}</td>
                <td><span className="cell-main">{c.name}</span>
                  {a.pastDue > 0 && <span className="lk-pill bad" style={{ marginLeft: 6 }}>Past due</span>}
                  {a.overLimit && <span className="lk-pill bad" style={{ marginLeft: 6 }}>Over limit</span>}</td>
                <td className="num" style={{ fontWeight: 600 }}>{money(a.balance)}</td>
                {AGING.map((b) => <td key={b} className={`num ${a.aging[b] ? '' : 'muted'}`}>{a.aging[b] ? money(a.aging[b]) : '—'}</td>)}
                <td className="small">{a.open[0] ? `${a.open[0].days} days` : '—'}</td>
                <td className="small">{a.lastPayment ? `${fmtDate(a.lastPayment.at)} · ${money(a.lastPayment.amount)}` : '—'}</td>
                <td className="num small">{c.creditLimit ? money(c.creditLimit) : '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="empty">{accounts.size ? 'No accounts match.' : 'No A/R yet. Close a repair order and use “Charge to account”, or post an opening balance.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {pay && <EntryModal kind="payment" onClose={() => setPay(false)} />}
      {post && <EntryModal kind="charge" onClose={() => setPost(false)} />}
    </div>
  )
}

function Tile({ label, value, strong, warn }: { label: string; value: number; strong?: boolean; warn?: boolean }) {
  return (
    <div className={`ar-tile ${strong ? 'strong' : ''} ${warn && value > 0.004 ? 'warn' : ''}`}>
      <div className="small muted">{label}</div>
      <div className="ar-tile-v mono">{money(round2(value))}</div>
    </div>
  )
}

// ---------- One customer's account ----------

export function ArAccount() {
  const { id } = useParams()
  const { db, mutate, audit, currentUser } = useStore()
  const c = db.customers.find((x) => x.id === id)
  const [modal, setModal] = useState<null | 'payment' | 'charge'>(null)
  const [voiding, setVoiding] = useState<ArEntry | null>(null)
  const [showVoided, setShowVoided] = useState(false)
  const entries = useMemo(() => db.ar.filter((e) => e.customerId === id), [db.ar, id])
  if (!c) return <div className="page"><h1>Customer not found</h1><Link to="/ar">Back to A/R</Link></div>
  const a = accountOf(entries, c, db.settings)
  const openById = new Map(a.open.map((o) => [o.entry.id, o]))

  // Running balance is figured oldest first, then shown newest first.
  const ledger = withRunningBalance(entries).reverse().filter(({ e }) => showVoided || live(e))
  const voidCount = entries.filter((e) => !live(e)).length
  const roNum = (roId?: string) => db.ros.find((r) => r.id === roId)

  return (
    <div className="page" style={{ maxWidth: 1150 }}>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/ar">Accounts Receivable</Link> / #{c.number}</div>
          <h1>{c.name}</h1>
          <div className="sub">{c.arType ?? 'Open item'} · terms net {a.terms} days{c.creditLimit ? ` · limit ${money(c.creditLimit)}` : ''}</div>
        </div>
        <span className="spacer" />
        <Link className="btn" to={`/customers/${c.id}`}>Customer record</Link>
        <button className="btn" onClick={() => setModal('charge')}>Post charge / credit</button>
        <button className="btn primary" disabled={c.isCash} onClick={() => setModal('payment')}>{Icon.plus} Record payment</button>
      </div>

      {a.overLimit && <div className="lk-alert" style={{ marginBottom: 12 }}>Over credit limit by {money(round2(a.balance - (c.creditLimit ?? 0)))}.</div>}

      <div className="ar-tiles">
        <Tile label={a.balance < 0 ? 'Credit balance' : 'Balance'} value={Math.abs(a.balance)} strong />
        {AGING.map((b) => <Tile key={b} label={b === 'Current' ? 'Current (0–30)' : b} value={a.aging[b]} warn={b !== 'Current'} />)}
        <Tile label={`Past net ${a.terms}`} value={a.pastDue} warn />
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><h2>Ledger</h2><span className="spacer" />
          {voidCount > 0 && <label className="check small"><input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> Show {voidCount} voided</label>}</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Memo</th><th className="num">Charge</th><th className="num">Payment / credit</th><th className="num">Balance</th><th className="num">Still open</th><th /></tr></thead>
            <tbody>
              {ledger.map(({ e, bal }) => {
                const o = openById.get(e.id)
                const ro = roNum(e.roId)
                return (
                  <tr key={e.id} className={live(e) ? '' : 'ar-void'}>
                    <td className="small nw">{fmtDate(e.at)}</td>
                    <td className="small">{KIND_LABEL[e.kind]}{e.method && <span className="muted"> · {PAY_METHOD_LABEL[e.method]}</span>}</td>
                    <td className="small">{ro ? <Link to={`/ro/${ro.id}`}>{e.ref}</Link> : e.ref}</td>
                    <td className="small muted">{e.voided ? `VOID: ${e.voided.reason}` : e.memo}</td>
                    <td className="num">{e.kind === 'charge' ? money(e.amount) : ''}</td>
                    <td className="num">{e.kind !== 'charge' ? money(e.amount) : ''}</td>
                    <td className="num">{live(e) ? money(bal) : ''}</td>
                    <td className="num small">{o ? <span className={o.pastDue ? 'ar-late' : ''}>{money(o.remaining)} · {o.days}d</span> : ''}</td>
                    <td>{live(e) && <OverrideButton className="btn ghost sm" title="Void this entry" onClick={() => setVoiding(e)}>Void</OverrideButton>}</td>
                  </tr>
                )
              })}
              {!ledger.length && <tr><td colSpan={9} className="empty">No activity on this account yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {modal && <EntryModal kind={modal} customer={c} onClose={() => setModal(null)} />}
      {voiding && <VoidModal e={voiding} onClose={() => setVoiding(null)} onVoid={(reason) => {
        mutate((d) => { const x = d.ar.find((y) => y.id === voiding.id); if (x) x.voided = { at: new Date().toISOString(), user: currentUser, reason } })
        audit(`Voided A/R ${voiding.kind} ${voiding.ref} ${money(voiding.amount)} on #${c.number} ${c.name}: ${reason}`)
        setVoiding(null)
      }} />}
    </div>
  )
}

// ---------- Posting ----------

function EntryModal({ kind: initialKind, customer, onClose }: { kind: ArKind; customer?: Customer; onClose: () => void }) {
  const { db, postAr, audit } = useStore()
  const [c, setC] = useState<Customer | undefined>(customer)
  const [kind, setKind] = useState<ArKind>(initialKind)
  const [amountText, setAmountText] = useState('')
  const amount = Number(amountText.replace(/[$,\s]/g, '')) || 0
  const [date, setDate] = useState(today())
  const [ref, setRef] = useState('')
  const [memo, setMemo] = useState('')
  const [method, setMethod] = useState<PayMethod>('check')
  const acct = c ? accountOf(db.ar.filter((e) => e.customerId === c.id), c, db.settings) : null
  const ok = c && !c.isCash && amount > 0 && date && (kind !== 'payment' || method)
  const title = kind === 'payment' ? 'Record payment' : kind === 'credit' ? 'Post credit' : 'Post charge'
  const save = () => {
    if (!ok || !c) return
    const at = date === today() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString()
    const e = postAr({
      customerId: c.id, kind, at, amount: round2(amount), memo: memo.trim(),
      ref: ref.trim() || (kind === 'payment' ? PAY_METHOD_LABEL[method] : kind === 'credit' ? 'Credit memo' : 'Manual charge'),
      ...(kind === 'payment' ? { method } : {}),
    })
    audit(`A/R ${kind} ${money(e.amount)} on #${c.number} ${c.name} (${e.ref})`)
    onClose()
  }
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={save}>{title}</button></>}>
      <div className="stack">
        {c ? (
          <div className="row" style={{ background: 'var(--panel-2)', padding: '8px 10px', borderRadius: 8 }}>
            <div><div className="cell-main">{c.name} <span className="mono small muted">#{c.number}</span></div>
              {acct && <div className="small muted">Balance {money(acct.balance)}{acct.pastDue ? ` · ${money(acct.pastDue)} past due` : ''}</div>}</div>
            <span className="spacer" />{!customer && <button className="btn ghost sm" onClick={() => setC(undefined)}>Change</button>}
          </div>
        ) : <CustomerSearchPick onPick={setC} autoFocus />}
        {initialKind !== 'payment' && (
          <div className="seg" role="group" aria-label="Type">
            <button className={kind === 'charge' ? 'on' : ''} onClick={() => setKind('charge')}>Charge (they owe more)</button>
            <button className={kind === 'credit' ? 'on' : ''} onClick={() => setKind('credit')}>Credit (they owe less)</button>
          </div>
        )}
        <div className="grid2" style={{ gap: 8 }}>
          <label className="field"><span>Amount</span><input className="input mono" inputMode="decimal" placeholder="0.00" value={amountText} onChange={(e) => setAmountText(e.target.value)} /></label>
          <label className="field"><span>Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {kind === 'payment' && (
            <label className="field"><span>Method</span>
              <select className="select" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                {(Object.keys(PAY_METHOD_LABEL) as PayMethod[]).map((m) => <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>)}
              </select></label>
          )}
          <label className="field"><span>{kind === 'payment' ? 'Check # / reference' : 'Reference'}</span>
            <input className="input" value={ref} placeholder={kind === 'charge' ? 'Opening balance, invoice #…' : ''} onChange={(e) => setRef(e.target.value)} /></label>
        </div>
        <label className="field"><span>Memo</span><input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        {kind === 'payment' && acct && acct.open.length > 0 && amount > 0 && (
          <div className="small muted">Applies to the oldest charges first: {applyPreview(acct, amount)}.</div>
        )}
        {kind === 'payment' && acct && amount > Math.max(0, acct.balance) + 0.004 && (
          <div className="small" style={{ color: 'var(--cust)' }}>That’s more than they owe. The extra stays on the account as a credit balance.</div>
        )}
      </div>
    </Modal>
  )
}

function applyPreview(a: Account, amount: number) {
  let left = amount
  const parts: string[] = []
  for (const o of a.open) {
    if (left <= 0.004) break
    const x = Math.min(left, o.remaining)
    parts.push(`${o.entry.ref} ${money(round2(x))}${x < o.remaining - 0.004 ? ' (partial)' : ''}`)
    left = round2(left - x)
  }
  return parts.join(', ')
}

function VoidModal({ e, onClose, onVoid }: { e: ArEntry; onClose: () => void; onVoid: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return (
    <Modal title={`Void ${KIND_LABEL[e.kind].toLowerCase()}?`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={!reason.trim()} onClick={() => onVoid(reason.trim())}>Void entry</button></>}>
      <p style={{ marginTop: 0 }}>{e.ref} · {money(e.amount)} on {fmtDate(e.at)}. The line stays on the ledger, crossed out, and stops counting toward the balance.</p>
      <label className="field"><span>Reason (required)</span><input className="input" autoFocus value={reason} onChange={(x) => setReason(x.target.value)} /></label>
    </Modal>
  )
}

/** Small account summary for the customer record. */
export function AccountSummary({ c }: { c: Customer }) {
  const { db } = useStore()
  const entries = db.ar.filter((e) => e.customerId === c.id)
  const a = accountOf(entries, c, db.settings)
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row"><span className="muted small">Balance</span><span className="spacer" /><b className="mono">{money(a.balance)}</b></div>
      {a.pastDue > 0 && <div className="row"><span className="small" style={{ color: 'var(--bad)' }}>Past due</span><span className="spacer" /><span className="mono" style={{ color: 'var(--bad)' }}>{money(a.pastDue)}</span></div>}
      {a.overLimit && <div className="small" style={{ color: 'var(--bad)', fontWeight: 600 }}>Over credit limit</div>}
      <div className="small muted">{entries.filter(live).length} ledger entr{entries.filter(live).length === 1 ? 'y' : 'ies'}{a.lastPayment ? ` · last paid ${fmtDate(a.lastPayment.at)}` : ''}</div>
      <Link className="btn sm" to={`/ar/${c.id}`} style={{ alignSelf: 'flex-start' }}>Open account</Link>
    </div>
  )
}
