import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLookups, useStore } from '../lib/store'
import {
  AGE_BUCKETS, STATUS_LABEL, STATUS_ORDER, STATUS_WAITING_ON, ageBucket, daysBetween, daysIdle, daysOpen, money, roFlags, roTotals,
} from '../lib/calc'
import { Age, Flags, StatusBadge } from '../components/ui'

const FAMILY_COLOR = { shop: 'var(--shop)', customer: 'var(--cust)', vendor: 'var(--vendor)', done: 'var(--done)' }

export default function Dashboard() {
  const { db } = useStore()
  const L = useLookups()
  const nav = useNavigate()
  const s = db.settings

  const d = useMemo(() => {
    const rows = db.ros.map((ro) => ({ ro, t: roTotals(ro, s), flags: roFlags(ro, s) }))
    const open = rows.filter((r) => r.ro.status !== 'closed' && !r.ro.archived)
    const closed30 = rows.filter((r) => r.ro.closedAt && daysBetween(r.ro.closedAt) <= 30)
    const sum = (xs: typeof rows) => xs.reduce((a, r) => a + r.t.total, 0)

    const byStatus = STATUS_ORDER.filter((st) => st !== 'closed').map((st) => {
      const xs = open.filter((r) => r.ro.status === st)
      return { st, n: xs.length, value: sum(xs) }
    })
    const byAge = AGE_BUCKETS.map((b) => ({ b, n: open.filter((r) => ageBucket(daysOpen(r.ro)) === b).length }))
    const techs = db.staff.filter((x) => x.role === 'tech').map((tch) => {
      const xs = open.filter((r) => r.ro.techId === tch.id)
      const hours = xs.reduce((a, r) => a + (['ready'].includes(r.ro.status) ? 0 : r.t.laborHours), 0)
      return { tch, n: xs.length, hours }
    })
    const unassigned = open.filter((r) => !r.ro.techId).length

    const approvedNotDone = open.filter((r) => ['parts_on_order', 'in_progress'].includes(r.ro.status))
    const waitingOk = open.filter((r) => ['awaiting_ok', 'estimate'].includes(r.ro.status))
    const ready = open.filter((r) => r.ro.status === 'ready')
    const attention = open.filter((r) => r.flags.length).sort((a, b) => daysIdle(b.ro) - daysIdle(a.ro))
    const avgOpen = open.length ? open.reduce((a, r) => a + daysOpen(r.ro), 0) / open.length : 0

    return {
      open, closed30, sum, byStatus, byAge, techs, unassigned, approvedNotDone, waitingOk, ready, attention, avgOpen,
      closedRevenue: sum(closed30),
      closedLabor: closed30.reduce((a, r) => a + r.t.labor, 0),
      closedParts: closed30.reduce((a, r) => a + r.t.parts, 0),
    }
  }, [db.ros, db.staff, s])

  const maxStatus = Math.max(1, ...d.byStatus.map((x) => x.n))
  const maxAge = Math.max(1, ...d.byAge.map((x) => x.n))
  const maxTech = Math.max(1, ...d.techs.map((x) => x.hours))

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Shop Dashboard</h1><div className="sub">Repair-order health as of {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div></div>
      </div>

      <div className="kpis">
        <Link to="/" className="panel kpi" style={{ textDecoration: 'none' }}>
          <div className="label">Open repair orders</div><div className="value">{d.open.length}</div>
          <div className="hint">avg {d.avgOpen.toFixed(0)} days open</div>
        </Link>
        <div className="panel kpi">
          <div className="label">Value of open work</div><div className="value">{money(d.sum(d.open))}</div>
          <div className="hint">estimates + work in shop</div>
        </div>
        <Link to="/?filter=attention" className="panel kpi" style={{ textDecoration: 'none' }}>
          <div className="label">Need attention</div><div className="value" style={{ color: d.attention.length ? 'var(--bad)' : undefined }}>{d.attention.length}</div>
          <div className="hint">stale, $0, late, or over approval</div>
        </Link>
        <div className="panel kpi">
          <div className="label">Closed, last 30 days</div><div className="value">{money(d.closedRevenue)}</div>
          <div className="hint">{d.closed30.length} ROs · labor {money(d.closedLabor)} · parts {money(d.closedParts)}</div>
        </div>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head"><h2>Where the money is stuck</h2></div>
          <div className="panel-body">
            {[
              { label: 'Waiting on customer OK', xs: d.waitingOk, color: 'var(--cust)', to: '/?filter=customer', hint: 'Call these people.' },
              { label: 'Approved, not finished', xs: d.approvedNotDone, color: 'var(--shop)', to: '/?filter=parts', hint: 'Parts on order + in progress.' },
              { label: 'Done, not picked up', xs: d.ready, color: 'var(--ok)', to: '/?filter=ready', hint: 'Finished work you haven’t been paid for.' },
            ].map((x) => {
              const v = d.sum(x.xs)
              const max = Math.max(1, d.sum(d.waitingOk), d.sum(d.approvedNotDone), d.sum(d.ready))
              return (
                <div key={x.label} className="bar-row click" onClick={() => nav(x.to)} title={x.hint}>
                  <span>{x.label}<div className="small muted">{x.xs.length} ROs</div></span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(v / max) * 100}%`, background: x.color }} /></div>
                  <span className="num mono">{money(v).replace(/\.\d\d$/, '')}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Open ROs by status</h2><span className="spacer" />
            <span className="small muted row" style={{ gap: 10 }}>
              <span><b style={{ color: 'var(--shop)' }}>●</b> shop</span><span><b style={{ color: 'var(--cust)' }}>●</b> customer</span><span><b style={{ color: 'var(--vendor)' }}>●</b> vendor</span>
            </span></div>
          <div className="panel-body">
            {d.byStatus.map((x) => (
              <div key={x.st} className="bar-row click" onClick={() => nav('/?group=status')}>
                <span>{STATUS_LABEL[x.st]}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(x.n / maxStatus) * 100}%`, background: FAMILY_COLOR[STATUS_WAITING_ON[x.st]] }} /></div>
                <span className="num mono">{x.n}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Aging — days since opened</h2></div>
          <div className="panel-body">
            {d.byAge.map((x, i) => (
              <div key={x.b} className="bar-row click" onClick={() => nav('/?group=age')}>
                <span>{x.b} days</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(x.n / maxAge) * 100}%`, background: ['#9aa5b1', '#d69e2e', '#dd6b20', 'var(--bad)'][i] }} /></div>
                <span className="num mono">{x.n}</span>
              </div>
            ))}
            <div className="small muted" style={{ marginTop: 8 }}>Anything past 30 days is usually a forgotten estimate or a unit nobody picked up.</div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Tech workload</h2><span className="spacer" /><span className="small muted">booked labor hours on open jobs</span></div>
          <div className="panel-body">
            {d.techs.map((x) => (
              <div key={x.tch.id} className="bar-row click" onClick={() => nav(`/?tech=${x.tch.id}`)}>
                <span>{x.tch.name}<div className="small muted">{x.n} open ROs</div></span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(x.hours / maxTech) * 100}%`, background: 'var(--shop)' }} /></div>
                <span className="num mono">{x.hours.toFixed(1)} h</span>
              </div>
            ))}
            {d.unassigned > 0 && <div className="small" style={{ marginTop: 8, color: 'var(--cust)' }}>{d.unassigned} open RO{d.unassigned === 1 ? '' : 's'} not assigned to a tech.</div>}
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><h2>Needs attention</h2><span className="spacer" /><Link to="/?filter=attention" className="small">See all {d.attention.length} →</Link></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>RO #</th><th>Customer</th><th>Status</th><th className="num">Idle</th><th className="num">Total</th><th>Why</th></tr></thead>
            <tbody>
              {d.attention.slice(0, 10).map((r) => (
                <tr key={r.ro.id} className="click" onClick={() => nav(`/ro/${r.ro.id}`)}>
                  <td className="ro-num">{r.ro.number}</td>
                  <td>{L.customer.get(r.ro.customerId)?.name}</td>
                  <td><StatusBadge status={r.ro.status} /></td>
                  <td className="num"><Age days={daysIdle(r.ro)} warn={7} hot={s.staleDays} /></td>
                  <td className="num">{money(r.t.total)}</td>
                  <td><Flags flags={r.flags} /></td>
                </tr>
              ))}
              {!d.attention.length && <tr><td colSpan={6} className="empty">Nothing flagged. Nice.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
