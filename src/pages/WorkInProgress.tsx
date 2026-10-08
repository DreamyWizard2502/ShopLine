import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useLookups, useStore } from '../lib/store'
import type { RepairOrder } from '../lib/types'
import {
  STATUS_LABEL, STATUS_ORDER, ageBucket, AGE_BUCKETS, daysIdle, daysOpen, fmtDate, money, roFlags, roTotals,
} from '../lib/calc'
import { Age, Flags, Icon, JobGlyph, StatusBadge } from '../components/ui'
import { jobTypeOf, unitText } from '../lib/jobs'

type QuickFilter = 'open' | 'customer' | 'parts' | 'shop' | 'ready' | 'attention' | 'zero' | 'warranty' | 'closed' | 'all'
const QUICK: { key: QuickFilter; label: string; test: (ro: RepairOrder, flags: string[]) => boolean }[] = [
  { key: 'open', label: 'All open', test: (r) => r.status !== 'closed' && !r.archived },
  { key: 'attention', label: 'Needs attention', test: (r, f) => r.status !== 'closed' && !r.archived && f.length > 0 },
  { key: 'shop', label: 'In the shop', test: (r) => !r.archived && ['checked_in', 'diagnosing', 'in_progress'].includes(r.status) },
  { key: 'customer', label: 'Waiting on customer', test: (r) => !r.archived && (r.status === 'awaiting_ok' || r.status === 'estimate') },
  { key: 'parts', label: 'Waiting on parts', test: (r) => !r.archived && r.status === 'parts_on_order' },
  { key: 'ready', label: 'Ready for pickup', test: (r) => !r.archived && r.status === 'ready' },
  { key: 'zero', label: '$0 / no estimate', test: (_r, f) => f.includes('zero') },
  { key: 'warranty', label: 'Warranty', test: (r) => r.warranty && r.status !== 'closed' && !r.archived },
  { key: 'closed', label: 'Closed', test: (r) => r.status === 'closed' },
  { key: 'all', label: 'Everything', test: (r) => !r.archived },
]

type GroupBy = 'none' | 'status' | 'customer' | 'tech' | 'age'
type SortKey = 'number' | 'customer' | 'status' | 'tech' | 'opened' | 'open' | 'idle' | 'total'

export default function WorkInProgress() {
  const { db } = useStore()
  const L = useLookups()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('filter') as QuickFilter) || 'open'
  const group = (params.get('group') as GroupBy) || 'none'
  const techFilter = params.get('tech') || ''
  const jobFilter = params.get('job') || ''
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'idle', dir: -1 })

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v); else p.delete(k)
    setParams(p, { replace: true })
  }

  // Precompute everything per RO once.
  const rows = useMemo(() => db.ros.map((ro) => {
    const c = L.customer.get(ro.customerId)
    const u = ro.unitId ? L.unit.get(ro.unitId) : undefined
    const ut = unitText(ro, u)
    const jt = jobTypeOf(db.settings, ro)
    const tech = ro.techId ? L.staff.get(ro.techId) : undefined
    const t = roTotals(ro, db.settings, !!c?.taxExempt)
    return {
      ro, c, u, ut, jt, tech, total: t.total,
      flags: roFlags(ro, db.settings),
      open: daysOpen(ro), idle: ro.status === 'closed' ? 0 : daysIdle(ro),
      haystack: [
        ro.number, c?.name, c?.phone, c?.phone.replace(/\D/g, ''), u?.serial, u?.make, u?.model, u?.type, tech?.name, ro.item, ro.walkIn?.name, ro.walkIn?.phone, jt?.name,
      ].join(' ').toLowerCase(),
    }
  }), [db.ros, db.settings, L])

  const counts = useMemo(() => Object.fromEntries(
    QUICK.map((f) => [f.key, rows.filter((r) => f.test(r.ro, r.flags)).length]),
  ), [rows])

  const visible = useMemo(() => {
    const f = QUICK.find((x) => x.key === filter) ?? QUICK[0]
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    const list = rows.filter((r) =>
      // a search looks across everything, including closed
      (terms.length ? true : f.test(r.ro, r.flags)) &&
      terms.every((t) => r.haystack.includes(t)) &&
      (!techFilter || r.ro.techId === techFilter) &&
      (!jobFilter || (jobFilter === 'repair' ? !r.ro.kind : r.ro.kind === jobFilter)))
    const val = (r: (typeof rows)[number]): string | number => {
      switch (sort.key) {
        case 'number': return r.ro.number
        case 'customer': return r.c?.name ?? ''
        case 'status': return STATUS_ORDER.indexOf(r.ro.status)
        case 'tech': return r.tech?.name ?? 'zzz'
        case 'opened': return r.ro.openedAt
        case 'open': return r.open
        case 'idle': return r.idle
        case 'total': return r.total
      }
    }
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
  }, [rows, filter, q, sort, techFilter, jobFilter])

  const groups = useMemo(() => {
    if (group === 'none') return [{ key: '', label: '', items: visible }]
    const m = new Map<string, typeof visible>()
    const keyOf = (r: (typeof visible)[number]) =>
      group === 'status' ? STATUS_LABEL[r.ro.status]
        : group === 'customer' ? (r.c?.name ?? '—')
        : group === 'tech' ? (r.tech?.name ?? 'Unassigned')
        : `${ageBucket(r.open)} days open`
    for (const r of visible) {
      const k = keyOf(r)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    const order = (k: string) =>
      group === 'status' ? STATUS_ORDER.findIndex((s) => STATUS_LABEL[s] === k)
        : group === 'age' ? AGE_BUCKETS.findIndex((b) => k.startsWith(b))
        : 0
    return [...m.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]) || (group === 'customer' ? b[1].length - a[1].length || a[0].localeCompare(b[0]) : a[0].localeCompare(b[0])))
      .map(([key, items]) => ({ key, label: key, items }))
  }, [visible, group])

  const sumTotal = visible.reduce((a, r) => a + r.total, 0)
  const th = (key: SortKey, label: string, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'customer' || key === 'tech' ? 1 : -1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )
  const techs = db.staff.filter((s) => s.role === 'tech')

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Work in Progress</h1>
          <div className="sub">{counts.open} open repair orders · {counts.attention} need attention</div>
        </div>
        <span className="spacer" />
        <Link to="/orders?tab=forgotten" className="btn">{Icon.archive} Clean up forgotten</Link>
        <Link to="/ro/new" className="btn primary">{Icon.plus} New ticket <span className="kbd" style={{ borderColor: 'rgba(255,255,255,.5)', color: '#fff' }}>N</span></Link>
      </div>

      <div className="row wrap" style={{ marginBottom: 12, gap: 12 }}>
        <label className="search">
          {Icon.search}
          <input id="wip-search" className="input" placeholder="Search RO #, customer, phone, serial, model…"
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur() }
              if (e.key === 'Enter' && visible.length === 1) nav(`/ro/${visible[0].ro.id}`)
            }} />
          {!q && <span className="kbd">/</span>}
        </label>
        <div className="row">
          <span className="small muted">Group by</span>
          <div className="seg">
            {(['none', 'status', 'customer', 'tech', 'age'] as GroupBy[]).map((g) => (
              <button key={g} className={group === g ? 'on' : ''} onClick={() => setParam('group', g === 'none' ? '' : g)}>
                {g === 'none' ? 'None' : g[0].toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <select className="select" style={{ width: 160 }} value={techFilter} onChange={(e) => setParam('tech', e.target.value)} aria-label="Filter by tech">
          <option value="">All techs</option>
          {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="select" style={{ width: 170 }} value={jobFilter} onChange={(e) => setParam('job', e.target.value)} aria-label="Filter by job type">
          <option value="">All job types</option>
          <option value="repair">Repair orders only</option>
          {db.settings.jobTypes.map((j) => <option key={j.code} value={j.code}>{j.name} tickets</option>)}
        </select>
      </div>

      <div className="chips" style={{ marginBottom: 14 }}>
        {QUICK.map((f) => (
          <button key={f.key} className={`chip ${filter === f.key && !q ? 'on' : ''}`} onClick={() => { setQ(''); setParam('filter', f.key === 'open' ? '' : f.key) }}>
            {f.label} <span className="n">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      {q && <div className="small muted" style={{ marginBottom: 8 }}>Searching all repair orders (open and closed) for “{q}” · {visible.length} match{visible.length === 1 ? '' : 'es'}{visible.length === 1 ? ' — press Enter to open' : ''}</div>}

      <div className="panel table-wrap">
        <table className="table">
          <thead>
            <tr>
              {th('number', 'RO #')}
              {th('customer', 'Customer')}
              <th>Unit</th>
              {th('status', 'Status')}
              {th('tech', 'Tech')}
              {th('opened', 'Opened')}
              {th('open', 'Open', 'num')}
              {th('idle', 'Idle', 'num')}
              {th('total', 'Total', 'num')}
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={10} className="empty">No repair orders match.</td></tr>}
            {groups.map((g) => (
              <GroupRows key={g.key} label={g.label} count={g.items.length} total={g.items.reduce((a, r) => a + r.total, 0)}>
                {g.items.map((r) => (
                  <tr key={r.ro.id} className="click" onClick={() => nav(`/ro/${r.ro.id}`)}>
                    <td className="nw"><span className="ro-num">{r.ro.number}</span>{r.jt && <span className="ob-kind" title={r.jt.name}><JobGlyph icon={r.jt.icon} size={14} />{r.jt.name}</span>}{r.ro.warranty && <> <span className="tag warranty">WTY</span></>}{r.ro.archived && <> <span className="tag" style={{ background: 'var(--done-soft)', color: 'var(--done)' }}>ARCHIVED</span></>}</td>
                    <td><div className="cell-main">{r.c?.isCash && r.ro.walkIn?.name ? r.ro.walkIn.name : r.c?.name}</div><div className="cell-sub">{r.c?.isCash ? `Cash${r.ro.walkIn?.phone ? ' · ' + r.ro.walkIn.phone : ''}` : r.c?.phone}</div></td>
                    <td><div className="cell-main">{r.ut.main}</div><div className="cell-sub">{r.ut.sub}</div></td>
                    <td><StatusBadge status={r.ro.status} /></td>
                    <td className="nw">{r.tech?.name ?? <span className="muted">—</span>}</td>
                    <td className="small nw">{fmtDate(r.ro.openedAt)}</td>
                    <td className="num"><Age days={r.open} warn={30} hot={90} /></td>
                    <td className="num">{r.ro.status === 'closed' ? <span className="muted">—</span> : <Age days={r.idle} warn={7} hot={db.settings.staleDays} />}</td>
                    <td className="num">{r.total ? money(r.total) : <span className="muted">$0.00</span>}</td>
                    <td><Flags flags={r.flags} /></td>
                  </tr>
                ))}
              </GroupRows>
            ))}
          </tbody>
          {visible.length > 0 && (
            <tfoot>
              <tr><td colSpan={8}>{visible.length} repair orders</td><td className="num">{money(sumTotal)}</td><td /></tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function GroupRows({ label, count, total, children }: { label: string; count: number; total: number; children: React.ReactNode }) {
  return (
    <>
      {label && (
        <tr className="group-row"><td colSpan={8}>{label} <span className="muted">· {count}</span></td><td className="num">{money(total)}</td><td /></tr>
      )}
      {children}
    </>
  )
}
