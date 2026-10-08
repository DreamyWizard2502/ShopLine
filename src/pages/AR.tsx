import { useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import type { ArEntry, ArKind, Customer, PayMethod } from '../lib/types'
import {
  AGING, KIND_LABEL, PAY_METHOD_LABEL, accountFor, allAccounts, atFromDate, isBalanceForward, isDebit, live, todayYMD, withRunningBalance, type Account,
} from '../lib/ar'
import { fmtDate, money, round2 } from '../lib/calc'
import { Icon, Modal } from '../components/ui'
import { OverrideButton, requestOverride } from '../components/override'
import { download } from '../lib/importer'
import { CustomerSearchPick } from '../components/custpick'

const parseAmt = (s: string) => Number(s.replace(/[$,\s]/g, '')) || 0

/** Tabs across the A/R section. */
export function ArTabs() {
  return (
    <div className="ar-tabs" role="tablist">
      <NavLink end to="/ar" className="ar-tab">Accounts</NavLink>
      <NavLink to="/ar/statements" className="ar-tab">Statements</NavLink>
      <NavLink to="/ar/history" className="ar-tab">Month-end history</NavLink>
    </div>
  )
}

// ---------- Overview ----------

type Sort = 'balance' | 'pastdue' | 'oldest' | 'name'

export default function ArOverview() {
  const { db } = useStore()
  const [loadSample, setLoadSample] = useState(false)
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'pastdue' | 'over' | 'credit' | 'held'>('all')
  const [sort, setSort] = useState<Sort>('balance')
  const [modal, setModal] = useState<null | ArKind>(null)
  const accounts = useMemo(() => allAccounts(db), [db])
  const byId = useMemo(() => new Map(db.customers.map((c) => [c.id, c])), [db.customers])

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...accounts.entries()]
      .map(([id, a]) => ({ c: byId.get(id)!, a }))
      .filter(({ c, a }) => c && (Math.abs(a.balance) > 0.004 || a.open.length > 0))
      .filter(({ c }) => !t || c.name.toLowerCase().includes(t) || String(c.number).startsWith(t))
      .filter(({ a }) => only === 'all' || (only === 'pastdue' ? a.pastDue > 0 : only === 'over' ? a.overLimit : only === 'held' ? a.held > 0 : a.balance < 0))
      .sort((x, y) => sort === 'name' ? x.c.name.localeCompare(y.c.name)
        : sort === 'pastdue' ? y.a.pastDue - x.a.pastDue
          : sort === 'oldest' ? (y.a.open[0]?.days ?? -1) - (x.a.open[0]?.days ?? -1)
            : y.a.balance - x.a.balance)
  }, [accounts, byId, q, only, sort])

  const tot = useMemo(() => {
    const t = { balance: 0, pastDue: 0, credit: 0, held: 0, aging: { Current: 0, '31–60': 0, '61–90': 0, 'Over 90': 0 } as Account['aging'], count: 0 }
    for (const a of accounts.values()) {
      if (a.balance > 0.004) { t.balance += a.balance; t.count++ }
      t.credit += a.unapplied
      t.held += a.held
      t.pastDue += a.pastDue
      for (const b of AGING) t.aging[b] += a.aging[b]
    }
    return t
  }, [accounts])

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Accounts Receivable</h1><div className="sub">{tot.count} account{tot.count === 1 ? '' : 's'} owe {money(round2(tot.balance))}</div></div>
        <span className="spacer" />
        <button className="btn" onClick={() => setModal('charge')}>Post charge / credit</button>
        <button className="btn primary" onClick={() => setModal('payment')}>{Icon.plus} Record payment</button>
      </div>
      <ArTabs />
      {db.ar.length === 0 && (
        <div className="ar-empty">
          <div>
            <b>No A/R in this browser yet.</b> This browser’s data was saved before A/R existed, so it has no charges, payments, statements or history.
            To try everything with sample accounts, load the sample shop. That replaces what’s saved in this browser. Or start real A/R by posting an opening balance.
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => setLoadSample(true)}>Load the sample shop…</button>
            <button className="btn" onClick={() => setModal('charge')}>Post an opening balance</button>
          </div>
        </div>
      )}

      <div className="ar-tiles">
        <Tile label="Open invoices" value={tot.aging.Current + tot.aging['31–60'] + tot.aging['61–90'] + tot.aging['Over 90']} strong />
        {AGING.map((b) => <Tile key={b} label={b === 'Current' ? 'Current (0–30)' : b} value={tot.aging[b]} warn={b === 'Over 90' || b === '61–90'} />)}
        <Tile label="Past their terms" value={tot.pastDue} warn />
        <Tile label="Unapplied credit" value={tot.credit} />
        <Tile label="Deposits held" value={tot.held} />
      </div>

      <div className="row wrap" style={{ margin: '14px 0 10px', gap: 8 }}>
        <label className="search" style={{ flex: '1 1 260px' }}>{Icon.search}<input className="input" placeholder="Find account by name or #" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {([['all', 'All balances'], ['pastdue', 'Past due'], ['over', 'Over limit'], ['credit', 'Credit balance'], ['held', 'Deposits held']] as const).map(([k, l]) => (
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
                  {isBalanceForward(c) && <span className="lk-pill" style={{ marginLeft: 6 }}>Bal. fwd</span>}
                  {a.pastDue > 0 && <span className="lk-pill bad" style={{ marginLeft: 6 }}>Past due</span>}
                  {a.overLimit && <span className="lk-pill bad" style={{ marginLeft: 6 }}>Over limit</span>}
                  {a.held > 0 && <span className="lk-pill info" style={{ marginLeft: 6 }}>Deposit {money(a.held)}</span>}</td>
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

      {modal && <EntryModal kind={modal} onClose={() => setModal(null)} />}
      {loadSample && <LoadSampleModal onClose={() => setLoadSample(false)} />}
    </div>
  )
}

/** Replace this browser's data with the sample shop (same as Settings → Reset to demo data). */
function LoadSampleModal({ onClose }: { onClose: () => void }) {
  const { db, resetDemo, override, audit } = useStore()
  const [backedUp, setBackedUp] = useState(false)
  return (
    <Modal title="Load the sample shop?" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn danger" onClick={() => {
          if (!override) { requestOverride(); return }
          audit('Replaced browser data with the sample shop (from A/R)')
          resetDemo(); onClose()
        }}>{!override && '🔒 '}Erase and load sample shop</button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}>This erases everything saved in this browser ({db.customers.length} customers, {db.ros.length} repair orders, {db.parts.length.toLocaleString()} parts) and loads the sample shop with a full A/R book: charge accounts, past-due and over-limit customers, deposits, statements and six months of history.</p>
        <p className="small muted" style={{ margin: 0 }}>If you imported real customers or price files here, download a backup first. You can restore it in Settings → Backup.</p>
        <div><button className="btn" onClick={() => { download(`shopline-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(db), 'application/json'); setBackedUp(true) }}>
          {backedUp ? '✓ Backup downloaded' : 'Download backup first'}</button></div>
        {!override && <div className="small muted">Needs master override (demo PIN 0000).</div>}
      </div>
    </Modal>
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
  const [modal, setModal] = useState<null | ArKind>(null)
  const [voiding, setVoiding] = useState<ArEntry | null>(null)
  const [applying, setApplying] = useState<ArEntry | null>(null)
  const [showVoided, setShowVoided] = useState(false)
  const entries = useMemo(() => db.ar.filter((e) => e.customerId === id), [db.ar, id])
  if (!c) return <div className="page"><h1>Customer not found</h1><Link to="/ar">Back to A/R</Link></div>
  const a = accountFor(db, c)
  const openById = new Map(a.open.map((o) => [o.entry.id, o]))
  const bf = isBalanceForward(c)

  const ledger = withRunningBalance(entries).reverse().filter(({ e }) => showVoided || live(e))
  const voidCount = entries.filter((e) => !live(e)).length
  const roOf = (roId?: string) => db.ros.find((r) => r.id === roId)
  const refOf = (cid: string) => entries.find((e) => e.id === cid)?.ref ?? '?'

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/ar">Accounts Receivable</Link> / #{c.number}</div>
          <h1>{c.name}</h1>
          <div className="sub">{bf ? 'Balance forward' : 'Open item'} · terms net {a.terms} days{c.creditLimit ? ` · limit ${money(c.creditLimit)}` : ''}</div>
        </div>
        <span className="spacer" />
        <Link className="btn" to={`/customers/${c.id}`}>Customer record</Link>
        <Link className="btn" to={`/ar/statement/${c.id}`}>Statement</Link>
        <button className="btn" onClick={() => setModal('charge')}>Charge / credit</button>
        <button className="btn" disabled={a.balance >= -0.004} title={a.balance >= -0.004 ? 'Refunds are for credit balances' : ''} onClick={() => setModal('refund')}>Refund</button>
        <button className="btn primary" disabled={c.isCash} onClick={() => setModal('payment')}>{Icon.plus} Record payment</button>
      </div>

      {a.overLimit && <div className="lk-alert" style={{ marginBottom: 12 }}>Over credit limit by {money(round2(a.balance - (c.creditLimit ?? 0)))}.</div>}

      <div className="ar-tiles">
        <Tile label={a.balance < 0 ? 'Credit balance' : 'Balance'} value={Math.abs(a.balance)} strong />
        {AGING.map((b) => <Tile key={b} label={b === 'Current' ? 'Current (0–30)' : b} value={a.aging[b]} warn={b !== 'Current'} />)}
        <Tile label={`Past net ${a.terms}`} value={a.pastDue} warn />
        {a.held > 0 && <Tile label="Deposits held" value={a.held} />}
        {a.unapplied > 0 && <Tile label="Unapplied credit" value={a.unapplied} />}
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><h2>Ledger</h2><span className="spacer" />
          {voidCount > 0 && <label className="check small"><input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> Show {voidCount} voided</label>}</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Memo / applied to</th><th className="num">Charge</th><th className="num">Payment / credit</th><th className="num">Balance</th><th className="num">Still open</th><th /></tr></thead>
            <tbody>
              {ledger.map(({ e, bal }) => {
                const o = openById.get(e.id)
                const ro = roOf(e.roId)
                const credit = !isDebit(e)
                const leftover = credit ? a.creditLeft.get(e.id) ?? 0 : 0
                const paidBy = !credit ? a.paidOn.get(e.id) : undefined
                return (
                  <tr key={e.id} className={live(e) ? '' : 'ar-void'}>
                    <td className="small nw">{fmtDate(e.at)}</td>
                    <td className="small nw">{KIND_LABEL[e.kind]}{e.deposit && ' (deposit)'}{e.partial && ' (partial)'}{e.method && <span className="muted"> · {PAY_METHOD_LABEL[e.method]}</span>}</td>
                    <td className="small">{ro ? <Link to={`/ro/${ro.id}`}>{e.ref}</Link> : e.ref}</td>
                    <td className="small muted ar-memo">
                      {e.voided ? `VOID: ${e.voided.reason}` : e.memo}
                      {live(e) && credit && !!e.applications?.length && <div>Pinned to {e.applications.map((ap) => `${refOf(ap.chargeId)} ${money(ap.amount)}`).join(', ')}</div>}
                      {live(e) && credit && leftover > 0.004 && <div className="ar-left">{money(leftover)} {e.deposit && ro && ro.status !== 'closed' ? `held for RO ${ro.number}` : 'not applied yet'}</div>}
                      {live(e) && paidBy && !bf && <div>Paid by {paidBy.map((p) => `${refOf(p.creditId)} ${money(p.amount)}`).join(', ')}</div>}
                    </td>
                    <td className="num">{isDebit(e) ? money(e.amount) : ''}</td>
                    <td className="num">{credit ? money(e.amount) : ''}</td>
                    <td className="num">{live(e) ? money(bal) : ''}</td>
                    <td className="num small">{o ? <span className={o.pastDue ? 'ar-late' : ''}>{money(o.remaining)} · {o.days}d</span> : ''}</td>
                    <td className="nw">
                      {live(e) && credit && !bf && e.kind !== 'refund' && !e.deposit && <button className="btn ghost sm" onClick={() => setApplying(e)}>Apply…</button>}
                      {live(e) && <OverrideButton className="btn ghost sm" title="Void this entry" onClick={() => setVoiding(e)}>Void</OverrideButton>}
                    </td>
                  </tr>
                )
              })}
              {!ledger.length && <tr><td colSpan={9} className="empty">No activity on this account yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {modal && <EntryModal kind={modal} customer={c} onClose={() => setModal(null)} />}
      {applying && <ApplyModal c={c} credit={applying} onClose={() => setApplying(null)} />}
      {voiding && <VoidModal e={voiding} onClose={() => setVoiding(null)} onVoid={(reason) => {
        mutate((d) => {
          const x = d.ar.find((y) => y.id === voiding.id)
          if (x) x.voided = { at: new Date().toISOString(), user: currentUser, reason }
          // A voided charge can't hold pinned money any more.
          if (isDebit(voiding)) for (const y of d.ar) if (y.applications) y.applications = y.applications.filter((ap) => ap.chargeId !== voiding.id)
        })
        audit(`Voided A/R ${voiding.kind} ${voiding.ref} ${money(voiding.amount)} on #${c.number} ${c.name}: ${reason}`)
        setVoiding(null)
      }} />}
    </div>
  )
}

// ---------- Posting ----------

/** Pick charges to pay. Returns pinned amounts; anything not pinned goes oldest first. */
function ApplyPicker({ a, amount, value, onChange, exclude }: {
  a: Account; amount: number; value: Record<string, string>; onChange: (v: Record<string, string>) => void; exclude?: string
}) {
  const open = a.open.filter((o) => o.entry.id !== exclude)
  const pinned = round2(Object.values(value).reduce((s, v) => s + parseAmt(v), 0))
  if (!open.length) return <div className="small muted">No open charges. The money will sit on the account as a credit.</div>
  return (
    <div className="ar-apply">
      <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Apply to <span className="muted" style={{ fontWeight: 400 }}>(leave blank for oldest first)</span></div>
      {open.map((o) => {
        const v = value[o.entry.id] ?? ''
        return (
          <label key={o.entry.id} className="ar-apply-row">
            <input type="checkbox" checked={!!v} onChange={(e) => {
              const next = { ...value }
              if (e.target.checked) next[o.entry.id] = String(round2(Math.min(o.remaining, Math.max(0, amount - pinned))) || o.remaining)
              else delete next[o.entry.id]
              onChange(next)
            }} />
            <span className="ar-apply-ref">{o.entry.ref}</span>
            <span className="small muted">{fmtDate(o.entry.at)} · {o.days}d</span>
            <span className="small mono">open {money(o.remaining)}</span>
            <input className="input mono" inputMode="decimal" aria-label={`Amount for ${o.entry.ref}`} disabled={!v} value={v}
              onChange={(e) => onChange({ ...value, [o.entry.id]: e.target.value })} />
          </label>
        )
      })}
      <div className="small" style={{ color: pinned > amount + 0.004 ? 'var(--bad)' : 'var(--ink-3)' }}>
        Pinned {money(pinned)} of {money(amount)}{pinned > amount + 0.004 ? ' — more than the payment' : amount - pinned > 0.004 ? ` · ${money(round2(amount - pinned))} goes oldest first` : ''}
      </div>
    </div>
  )
}

const toApps = (v: Record<string, string>) =>
  Object.entries(v).map(([chargeId, s]) => ({ chargeId, amount: round2(parseAmt(s)) })).filter((x) => x.amount > 0)

export function EntryModal({ kind: initialKind, customer, onClose, roId }: { kind: ArKind; customer?: Customer; onClose: () => void; roId?: string }) {
  const { db, postAr, audit } = useStore()
  const [c, setC] = useState<Customer | undefined>(customer)
  const [kind, setKind] = useState<ArKind>(initialKind)
  const [amountText, setAmountText] = useState('')
  const amount = parseAmt(amountText)
  const [date, setDate] = useState(todayYMD())
  const [ref, setRef] = useState('')
  const [memo, setMemo] = useState('')
  const [method, setMethod] = useState<PayMethod>('check')
  const [apps, setApps] = useState<Record<string, string>>({})
  const acct = c ? accountFor(db, c) : null
  const bf = c ? isBalanceForward(c) : false
  const pinned = round2(Object.values(apps).reduce((s, v) => s + parseAmt(v), 0))
  const ok = c && !c.isCash && amount > 0 && date && pinned <= amount + 0.004
  const title = kind === 'payment' ? 'Record payment' : kind === 'credit' ? 'Post credit' : kind === 'refund' ? 'Refund to customer' : 'Post charge'
  const save = () => {
    if (!ok || !c) return
    const applications = (kind === 'payment' || kind === 'credit') && !bf ? toApps(apps) : []
    const e = postAr({
      customerId: c.id, kind, at: atFromDate(date), amount: round2(amount), memo: memo.trim(),
      ref: ref.trim() || (kind === 'payment' ? PAY_METHOD_LABEL[method] : kind === 'credit' ? 'Credit memo' : kind === 'refund' ? 'Refund' : 'Manual charge'),
      ...(kind === 'payment' || kind === 'refund' ? { method } : {}),
      ...(applications.length ? { applications } : {}),
      ...(roId ? { roId } : {}),
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
              {acct && <div className="small muted">Balance {money(acct.balance)}{acct.pastDue ? ` · ${money(acct.pastDue)} past due` : ''}{bf ? ' · balance forward' : ''}</div>}</div>
            <span className="spacer" />{!customer && <button className="btn ghost sm" onClick={() => { setC(undefined); setApps({}) }}>Change</button>}
          </div>
        ) : <CustomerSearchPick onPick={setC} autoFocus />}
        {(initialKind === 'charge' || initialKind === 'credit') && (
          <div className="seg" role="group" aria-label="Type">
            <button className={kind === 'charge' ? 'on' : ''} onClick={() => setKind('charge')}>Charge (they owe more)</button>
            <button className={kind === 'credit' ? 'on' : ''} onClick={() => setKind('credit')}>Credit (they owe less)</button>
          </div>
        )}
        <div className="grid2" style={{ gap: 8 }}>
          <label className="field"><span>Amount</span><input className="input mono" inputMode="decimal" placeholder="0.00" autoFocus={!!customer} value={amountText} onChange={(e) => setAmountText(e.target.value)} /></label>
          <label className="field"><span>Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {(kind === 'payment' || kind === 'refund') && (
            <label className="field"><span>Method</span>
              <select className="select" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                {(Object.keys(PAY_METHOD_LABEL) as PayMethod[]).map((m) => <option key={m} value={m}>{PAY_METHOD_LABEL[m]}</option>)}
              </select></label>
          )}
          <label className="field"><span>{kind === 'payment' || kind === 'refund' ? 'Check # / reference' : 'Reference'}</span>
            <input className="input" value={ref} placeholder={kind === 'charge' ? 'Opening balance, invoice #…' : ''} onChange={(e) => setRef(e.target.value)} /></label>
        </div>
        <label className="field"><span>Memo</span><input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        {(kind === 'payment' || kind === 'credit') && acct && !bf && amount > 0 && <ApplyPicker a={acct} amount={amount} value={apps} onChange={setApps} />}
        {(kind === 'payment' || kind === 'credit') && bf && <div className="small muted">Balance-forward account: payments reduce the total balance, oldest first.</div>}
        {kind === 'payment' && acct && amount > Math.max(0, acct.balance) + 0.004 && (
          <div className="small" style={{ color: 'var(--cust)' }}>That’s more than they owe. The extra stays on the account as a credit balance.</div>
        )}
        {kind === 'refund' && acct && amount > Math.max(0, -acct.balance) + 0.004 && (
          <div className="small" style={{ color: 'var(--bad)' }}>That’s more than their credit balance of {money(Math.max(0, -acct.balance))}. The difference will show as owed.</div>
        )}
      </div>
    </Modal>
  )
}

/** Re-pin an existing payment or credit to specific charges. */
function ApplyModal({ c, credit, onClose }: { c: Customer; credit: ArEntry; onClose: () => void }) {
  const { db, mutate, audit } = useStore()
  // Figure what's open if this payment's pins are removed, so its own money is available again.
  const without = { ...db, ar: db.ar.map((e) => (e.id === credit.id ? { ...e, applications: [] } : e)) }
  const a = accountFor(without, c)
  const [apps, setApps] = useState<Record<string, string>>(() =>
    Object.fromEntries((credit.applications ?? []).map((x) => [x.chargeId, String(x.amount)])))
  const pinned = round2(Object.values(apps).reduce((s, v) => s + parseAmt(v), 0))
  return (
    <Modal title={`Apply ${KIND_LABEL[credit.kind].toLowerCase()} ${credit.ref}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={pinned > credit.amount + 0.004} onClick={() => {
          const applications = toApps(apps)
          mutate((d) => { const x = d.ar.find((y) => y.id === credit.id); if (x) x.applications = applications })
          audit(`Applied ${credit.ref} (${money(credit.amount)}) on #${c.number}: ${applications.length ? applications.map((x) => `${db.ar.find((e) => e.id === x.chargeId)?.ref} ${money(x.amount)}`).join(', ') : 'oldest first'}`)
          onClose()
        }}>Save</button></>}>
      <div className="stack">
        <div className="small muted">{money(credit.amount)} from {fmtDate(credit.at)}. Pin it to the invoices the customer said it was for; anything not pinned pays the oldest charges.</div>
        <ApplyPicker a={a} amount={credit.amount} value={apps} onChange={setApps} />
      </div>
    </Modal>
  )
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
  const a = accountFor(db, c)
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row"><span className="muted small">Balance</span><span className="spacer" /><b className="mono">{money(a.balance)}</b></div>
      {a.pastDue > 0 && <div className="row"><span className="small" style={{ color: 'var(--bad)' }}>Past due</span><span className="spacer" /><span className="mono" style={{ color: 'var(--bad)' }}>{money(a.pastDue)}</span></div>}
      {a.held > 0 && <div className="row"><span className="small muted">Deposits held</span><span className="spacer" /><span className="mono">{money(a.held)}</span></div>}
      {a.overLimit && <div className="small" style={{ color: 'var(--bad)', fontWeight: 600 }}>Over credit limit</div>}
      <div className="small muted">{entries.filter(live).length} ledger entr{entries.filter(live).length === 1 ? 'y' : 'ies'}{a.lastPayment ? ` · last paid ${fmtDate(a.lastPayment.at)}` : ''}</div>
      <div className="row"><Link className="btn sm" to={`/ar/${c.id}`}>Open account</Link><Link className="btn sm" to={`/ar/statement/${c.id}`}>Statement</Link></div>
    </div>
  )
}

/** Balance / past-due / limit warning for write-up screens. Returns null when there's nothing to say. */
export function AccountWarning({ c, compact }: { c: Customer; compact?: boolean }) {
  const { db } = useStore()
  if (!db.settings.arWarnAtWriteUp || c.isCash) return null
  const a = accountFor(db, c)
  const bad = a.pastDue > 0 || a.overLimit
  if (!bad && a.balance < 0.005 && a.held < 0.005) return null
  const bits = [
    a.balance > 0.004 && `owes ${money(a.balance)}`,
    a.pastDue > 0 && `${money(a.pastDue)} past net ${a.terms}`,
    a.overLimit && `over the ${money(c.creditLimit!)} limit`,
    a.balance < -0.004 && `has a ${money(-a.balance)} credit`,
    a.held > 0 && `${money(a.held)} deposit held`,
  ].filter(Boolean).join(' · ')
  return (
    <div className={`ar-warn ${bad ? 'bad' : ''} ${compact ? 'compact' : ''}`}>
      {bad ? '⚠ ' : ''}Account {bits}. <Link to={`/ar/${c.id}`}>View account</Link>
    </div>
  )
}
