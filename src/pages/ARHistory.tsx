import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../lib/store'
import { periodLabel, snapshotFor } from '../lib/ar'
import type { ArSnapshot } from '../lib/types'
import { fmtDate, fmtDateTime, money } from '../lib/calc'
import { Modal } from '../components/ui'
import { requestOverride } from '../components/override'
import { ArTabs } from './AR'

const pad = (n: number) => String(n).padStart(2, '0')
const periodOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const SEG = [
  { k: 'current', label: 'Current', cls: 'h-cur' },
  { k: 'd31', label: '31–60', cls: 'h-31' },
  { k: 'd61', label: '61–90', cls: 'h-61' },
  { k: 'd91', label: 'Over 90', cls: 'h-91' },
] as const

// Month-end A/R history: each closed month is frozen, so you can see how the book moved.
export default function ArHistory() {
  const { db, mutate, audit, currentUser, override } = useStore()
  const now = new Date()
  const thisPeriod = periodOf(now)
  const lastPeriod = periodOf(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const [pick, setPick] = useState(lastPeriod)
  const [open, setOpen] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const live = useMemo(() => snapshotFor(db, thisPeriod, '—', undefined, Date.now()), [db, thisPeriod])
  const rows: (ArSnapshot & { live?: boolean })[] = [{ ...live, live: true }, ...[...db.arHistory].sort((a, b) => b.period.localeCompare(a.period))]
  const max = Math.max(1, ...rows.map((r) => r.totals.current + r.totals.d31 + r.totals.d61 + r.totals.d91))
  const exists = db.arHistory.some((h) => h.period === pick)

  const close = (period: string) => {
    const snap = snapshotFor(db, period, currentUser)
    mutate((d) => { d.arHistory = [...d.arHistory.filter((h) => h.period !== period), snap] })
    audit(`${exists ? 'Re-closed' : 'Closed'} A/R month ${periodLabel(period)}: ${money(snap.totals.balance)} owed by ${snap.totals.accounts} accounts`)
    setConfirm(null)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Accounts Receivable</h1><div className="sub">Month-end snapshots. Closing a month freezes every balance and its aging as of the last day.</div></div>
      </div>
      <ArTabs />

      <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
        <label className="field"><span>Month to close</span><input className="input" type="month" max={lastPeriod} value={pick} onChange={(e) => setPick(e.target.value)} /></label>
        <button className="btn primary" style={{ alignSelf: 'end' }} disabled={!pick || pick > lastPeriod}
          onClick={() => (exists && !override ? requestOverride() : setConfirm(pick))}>
          {exists ? `${override ? '' : '🔒 '}Re-close ${periodLabel(pick)}` : `Close ${periodLabel(pick)}`}
        </button>
        <span className="small muted" style={{ alignSelf: 'end', paddingBottom: 8 }}>{exists ? 'Already closed. Re-closing replaces it (master override).' : 'Months can be closed late; balances are figured as of that month’s last day.'}</span>
      </div>

      <div className="row wrap small" style={{ gap: 12, marginBottom: 8 }}>
        {SEG.map((s) => <span key={s.k} className="row" style={{ gap: 4 }}><span className={`h-key ${s.cls}`} />{s.label}</span>)}
      </div>

      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>Month</th><th style={{ width: '32%' }}>Aging</th><th className="num">Owed</th><th className="num">Current</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">Over 90</th><th className="num">Past terms</th><th className="num">Accounts</th><th>Closed</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const t = r.totals
              const key = r.live ? 'live' : r.id
              return (
                <HistoryRow key={key} r={r} max={max} open={open === key} onToggle={() => setOpen(open === key ? null : key)}>
                  <td className="num" style={{ fontWeight: 600 }}>{money(t.balance)}</td>
                  <td className="num">{money(t.current)}</td><td className="num">{money(t.d31)}</td><td className="num">{money(t.d61)}</td><td className="num">{money(t.d91)}</td>
                  <td className="num">{money(t.pastDue)}</td><td className="num">{t.accounts}</td>
                  <td className="small">{r.live ? <span className="muted">Not closed (live)</span> : `${fmtDate(r.closedAt)} · ${r.user}`}</td>
                </HistoryRow>
              )
            })}
          </tbody>
        </table>
      </div>

      {confirm && (
        <Modal title={`Close ${periodLabel(confirm)}?`} onClose={() => setConfirm(null)}
          footer={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn primary" onClick={() => close(confirm)}>Close month</button></>}>
          <p style={{ marginTop: 0 }}>Freezes every account’s balance and aging as of {periodLabel(confirm)}’s last day. Later payments or voids won’t change this snapshot.</p>
        </Modal>
      )}
    </div>
  )
}

function HistoryRow({ r, max, open, onToggle, children }: { r: ArSnapshot & { live?: boolean }; max: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const t = r.totals
  return (
    <>
      <tr className="click" onClick={onToggle} aria-expanded={open}>
        <td className="nw"><b>{periodLabel(r.period)}</b>{r.live && <span className="lk-pill info" style={{ marginLeft: 6 }}>to date</span>}</td>
        <td>
          <div className="h-bar" title={`${money(t.balance)} owed`}>
            {SEG.map((s) => <span key={s.k} className={s.cls} style={{ width: `${(t[s.k] / max) * 100}%` }} />)}
          </div>
        </td>
        {children}
      </tr>
      {open && (
        <tr className="h-detail"><td colSpan={10}>
          <div className="small muted" style={{ margin: '4px 0 6px' }}>As of {fmtDateTime(r.asOf)} · {r.accounts.length} account{r.accounts.length === 1 ? '' : 's'}</div>
          <table className="table">
            <thead><tr><th>#</th><th>Customer</th><th className="num">Balance</th><th className="num">Current</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">Over 90</th></tr></thead>
            <tbody>
              {r.accounts.map((a) => (
                <tr key={a.customerId}>
                  <td className="mono small">{a.number}</td><td><Link to={`/ar/${a.customerId}`}>{a.name}</Link></td>
                  <td className="num" style={{ fontWeight: 600 }}>{money(a.balance)}</td>
                  <td className="num">{money(a.current)}</td><td className="num">{money(a.d31)}</td><td className="num">{money(a.d61)}</td><td className="num">{money(a.d91)}</td>
                </tr>
              ))}
              {!r.accounts.length && <tr><td colSpan={7} className="empty">No balances that month.</td></tr>}
            </tbody>
          </table>
        </td></tr>
      )}
    </>
  )
}
