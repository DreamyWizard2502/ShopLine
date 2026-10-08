// Orders browser: open orders, the forgotten queue, invoice history and the archive,
// with email-style selection (checkboxes, shift-click, "select all that match") and bulk actions.
// Used on the Orders page and on a customer's Open orders / Invoice history tabs.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLookups, useStore } from '../lib/store'
import type { ArchiveReason, RepairOrder, ROStatus } from '../lib/types'
import { STATUS_LABEL, STATUS_ORDER, daysBetween, daysIdle, fmtDate, money, roTotals, uid } from '../lib/calc'
import { jobTypeOf, unitText } from '../lib/jobs'
import {
  ARCHIVE_REASON_LABEL, FORGOTTEN_LABEL, FORGOTTEN_ORDER, archiveBlocker, archiveOrders, forgottenOf, isOpenRO, numberList, restoreOrders,
  type Forgotten, type ForgottenKind,
} from '../lib/orders'
import { download } from '../lib/importer'
import { Age, JobGlyph, Modal, StatusBadge } from './ui'
import { requestOverride } from './override'

export type OrdersTab = 'open' | 'forgotten' | 'closed' | 'archived' | 'all'
const TAB_LABEL: Record<OrdersTab, string> = { open: 'Open', forgotten: 'Forgotten', closed: 'Invoice history', archived: 'Archived', all: 'Everything' }
const STEP = 100

interface Row {
  ro: RepairOrder
  cust: string
  custNo: number | null
  unit: { main: string; sub: string }
  total: number
  idle: number
  forgot: Forgotten | null
  hay: string
}

export function OrdersBrowser({ customerId, tabs, initialTab, title }: { customerId?: string; tabs: OrdersTab[]; initialTab?: OrdersTab; title?: string }) {
  const { db, mutate, audit, currentUser } = useStore()
  const L = useLookups()
  const nav = useNavigate()
  const s = db.settings
  const [tab, setTab] = useState<OrdersTab>(initialTab ?? tabs[0])
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [tech, setTech] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [minAmt, setMinAmt] = useState('')
  const [warranty, setWarranty] = useState('')
  const [limit, setLimit] = useState(STEP)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const last = useRef<number | null>(null)
  const [archiving, setArchiving] = useState<string[] | null>(null)
  const [undo, setUndo] = useState<{ batch: string; ids: string[]; text: string } | null>(null)
  const [toast, setToast] = useState('')
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) } }, [toast])
  useEffect(() => { if (undo) { const t = setTimeout(() => setUndo(null), 12000); return () => clearTimeout(t) } }, [undo])

  // Changing what's shown clears the selection (like email).
  const reset = () => { setSel(new Set()); last.current = null; setLimit(STEP) }
  const change = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); reset() }

  const all = useMemo<Row[]>(() => db.ros.filter((r) => !customerId || r.customerId === customerId).map((ro) => {
    const c = L.customer.get(ro.customerId)
    const u = ro.unitId ? L.unit.get(ro.unitId) : undefined
    const unit = unitText(ro, u)
    const cust = c?.isCash && ro.walkIn?.name ? `${ro.walkIn.name} (cash)` : c?.name ?? '—'
    return {
      ro, cust, custNo: c?.number ?? null, unit,
      total: roTotals(ro, s, !!c?.taxExempt).total,
      idle: ro.status === 'closed' ? 0 : daysIdle(ro),
      forgot: forgottenOf(ro, s),
      hay: [ro.number, cust, c?.phone, c?.phone.replace(/\D/g, ''), ro.walkIn?.phone, unit.main, unit.sub, ro.complaint, ro.tag, ro.poNumber,
        ...ro.parts.map((p) => p.partNo)].join(' ').toLowerCase(),
    }
  }), [db.ros, customerId, L, s])

  const inTab = (r: Row, t: OrdersTab) =>
    t === 'open' ? isOpenRO(r.ro) : t === 'forgotten' ? !!r.forgot : t === 'closed' ? r.ro.status === 'closed' && !r.ro.archived : t === 'archived' ? !!r.ro.archived : true
  const counts = useMemo(() => Object.fromEntries(tabs.map((t) => [t, all.filter((r) => inTab(r, t)).length])), [all, tabs]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    const min = Number(minAmt) || 0
    const dateOf = (r: Row) => (tab === 'closed' ? r.ro.closedAt ?? r.ro.openedAt : tab === 'archived' ? r.ro.archived?.at ?? r.ro.openedAt : r.ro.openedAt).slice(0, 10)
    const list = all.filter((r) => inTab(r, tab)
      && (!kind || (kind === 'repair' ? !r.ro.kind : r.ro.kind === kind))
      && (!tech || r.ro.techId === tech)
      && (!warranty || (warranty === 'yes') === r.ro.warranty)
      && (!from || dateOf(r) >= from) && (!to || dateOf(r) <= to)
      && (!min || r.total >= min)
      && terms.every((t) => r.hay.includes(t)))
    if (tab === 'forgotten') return list.sort((a, b) => FORGOTTEN_ORDER.indexOf(a.forgot!.kind) - FORGOTTEN_ORDER.indexOf(b.forgot!.kind) || b.idle - a.idle)
    if (tab === 'closed') return list.sort((a, b) => (b.ro.closedAt ?? '').localeCompare(a.ro.closedAt ?? ''))
    if (tab === 'archived') return list.sort((a, b) => (b.ro.archived?.at ?? '').localeCompare(a.ro.archived?.at ?? ''))
    return list.sort((a, b) => b.idle - a.idle || b.ro.number - a.ro.number)
  }, [all, tab, kind, tech, warranty, from, to, minAmt, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = visible.slice(0, limit)
  const selected = visible.filter((r) => sel.has(r.ro.id))
  const pageAll = shown.length > 0 && shown.every((r) => sel.has(r.ro.id))
  const everything = visible.length > 0 && selected.length === visible.length

  const toggle = (i: number, shift: boolean) => {
    const next = new Set(sel)
    const id = shown[i].ro.id
    const on = !next.has(id)
    if (shift && last.current != null) {
      const [a, b] = [Math.min(last.current, i), Math.max(last.current, i)]
      for (let k = a; k <= b; k++) { if (on) next.add(shown[k].ro.id); else next.delete(shown[k].ro.id) }
    } else if (on) next.add(id); else next.delete(id)
    last.current = i
    setSel(next)
  }
  const selectRows = (rows: Row[], on: boolean) => {
    const next = new Set(sel)
    for (const r of rows) { if (on) next.add(r.ro.id); else next.delete(r.ro.id) }
    setSel(next)
  }

  // ---- bulk actions ----
  const selOpen = selected.filter((r) => isOpenRO(r.ro))
  const selArchived = selected.filter((r) => r.ro.archived)
  const bulkStatus = (st: ROStatus) => {
    mutate((d) => {
      for (const r of selOpen) {
        const ro = d.ros.find((x) => x.id === r.ro.id)!
        if (ro.status === st) continue
        ro.status = st; ro.updatedAt = new Date().toISOString()
        ro.timeline.push({ id: uid(), at: ro.updatedAt, kind: 'status', text: `Status → ${STATUS_LABEL[st]} (bulk)`, user: currentUser })
      }
    })
    audit(`Bulk status → ${STATUS_LABEL[st]} on ${selOpen.length} orders: RO ${numberList(selOpen.map((r) => r.ro.number))}`)
    setToast(`${selOpen.length} set to ${STATUS_LABEL[st]}`)
  }
  const bulkTech = (id: string) => {
    const name = L.staff.get(id)?.name ?? 'nobody'
    mutate((d) => {
      for (const r of selOpen) {
        const ro = d.ros.find((x) => x.id === r.ro.id)!
        ro.techId = id || null; ro.updatedAt = new Date().toISOString()
        ro.timeline.push({ id: uid(), at: ro.updatedAt, kind: 'edit', text: `Assigned to ${name} (bulk)`, user: currentUser })
      }
    })
    audit(`Bulk assigned ${selOpen.length} orders to ${name}`)
    setToast(`${selOpen.length} assigned to ${name}`)
  }
  const restore = () => {
    const ids = selArchived.map((r) => r.ro.id)
    mutate((d) => { restoreOrders(d, ids, currentUser) })
    audit(`Restored ${ids.length} orders from the archive: RO ${numberList(selArchived.map((r) => r.ro.number))}`)
    setToast(`${ids.length} restored to the board`); reset()
  }
  const exportCsv = () => {
    const rows = (selected.length ? selected : visible)
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['RO', 'Job', 'Customer', 'Customer #', 'Unit / item', 'Status', 'Opened', 'Closed', 'Idle days', 'Total', 'Forgotten', 'Archived', 'Archive reason', 'Complaint']
    const body = rows.map((r) => [r.ro.number, jobTypeOf(s, r.ro)?.name ?? 'Repair', r.cust, r.custNo, `${r.unit.main} ${r.unit.sub}`.trim(), STATUS_LABEL[r.ro.status],
      r.ro.openedAt.slice(0, 10), r.ro.closedAt?.slice(0, 10) ?? '', r.idle, r.total.toFixed(2), r.forgot?.why ?? '', r.ro.archived?.at.slice(0, 10) ?? '',
      r.ro.archived ? ARCHIVE_REASON_LABEL[r.ro.archived.reason] : '', r.ro.complaint])
    download(`shopline-orders-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...body].map((x) => x.map(esc).join(',')).join('\n'), 'text/csv')
  }

  const startArchive = () => setArchiving(selected.map((r) => r.ro.id))
  const archiveList = archiving ? archiving.map((id) => db.ros.find((r) => r.id === id)!).filter(Boolean) : []
  const suggestion = (() => {
    const sugg = new Set(archiveList.map((ro) => forgottenOf(ro, s)?.suggest).filter(Boolean))
    return sugg.size === 1 ? [...sugg][0] as ArchiveReason : undefined
  })()

  const sumTotal = visible.reduce((a, r) => a + r.total, 0)
  const techs = db.staff.filter((x) => x.role === 'tech')
  const showCust = !customerId
  const cols = showCust ? 8 : 7 // total columns, checkbox included
  const dateLabel = tab === 'closed' ? 'Closed' : tab === 'archived' ? 'Archived' : 'Opened'
  const groups: { key: ForgottenKind | ''; rows: { r: Row; i: number }[] }[] = tab === 'forgotten'
    ? FORGOTTEN_ORDER.map((k) => ({ key: k, rows: shown.map((r, i) => ({ r, i })).filter(({ r }) => r.forgot?.kind === k) })).filter((g) => g.rows.length)
    : [{ key: '', rows: shown.map((r, i) => ({ r, i })) }]
  const allOfGroup = (k: ForgottenKind) => visible.filter((r) => r.forgot?.kind === k)

  return (
    <div className="ob">
      {title && <h2 style={{ margin: '0 0 10px', fontSize: 15 }}>{title}</h2>}
      {tabs.length > 1 && (
        <div className="ob-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); reset() }}>
              {TAB_LABEL[t]} <span className="n">{counts[t]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="row wrap ob-filters">
        <input className="input" style={{ flex: '1 1 220px' }} placeholder={customerId ? 'Search RO #, unit, complaint, part #…' : 'Search RO #, customer, phone, unit, complaint, part #…'}
          value={q} onChange={(e) => change(setQ)(e.target.value)} />
        <select className="select" value={kind} onChange={(e) => change(setKind)(e.target.value)} aria-label="Job type">
          <option value="">All job types</option><option value="repair">Repair orders</option>
          {s.jobTypes.map((j) => <option key={j.code} value={j.code}>{j.name}</option>)}
        </select>
        {tab !== 'closed' && tab !== 'archived' && (
          <select className="select" value={tech} onChange={(e) => change(setTech)(e.target.value)} aria-label="Tech">
            <option value="">All techs</option>{techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <label className="row small muted" style={{ gap: 4 }}>{dateLabel}
          <input className="input" type="date" value={from} onChange={(e) => change(setFrom)(e.target.value)} aria-label={`${dateLabel} from`} />
          –<input className="input" type="date" value={to} onChange={(e) => change(setTo)(e.target.value)} aria-label={`${dateLabel} to`} /></label>
        {tab === 'closed' && <>
          <input className="input" style={{ width: 96 }} inputMode="decimal" placeholder="Min $" value={minAmt} onChange={(e) => change(setMinAmt)(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Minimum total" />
          <select className="select" value={warranty} onChange={(e) => change(setWarranty)(e.target.value)} aria-label="Warranty"><option value="">Warranty + customer pay</option><option value="yes">Warranty only</option><option value="no">Customer pay only</option></select>
        </>}
      </div>

      {tab === 'forgotten' && (
        <div className="small muted" style={{ margin: '0 0 8px' }}>
          Ready and not picked up for {s.pickupForgottenDays}+ days (suggested “abandoned” at {s.abandonedDays}), estimates or OKs untouched {s.estimateForgottenDays}+ days, or no activity in {s.staleDays}+ days. Change these in <Link to="/settings#forgotten">Settings</Link>.
        </div>
      )}

      {/* Gmail-style "select all that match" */}
      {pageAll && visible.length > shown.length && !everything && (
        <div className="ob-selall">All {shown.length} shown are selected. <button className="linkish" onClick={() => selectRows(visible, true)}>Select all {visible.length} that match</button></div>
      )}
      {everything && visible.length > 1 && (
        <div className="ob-selall">All {visible.length} orders that match are selected. <button className="linkish" onClick={() => setSel(new Set())}>Clear selection</button></div>
      )}

      <div className="panel table-wrap">
        <table className="table ob-table">
          <thead>
            <tr>
              <th className="ob-cb"><input type="checkbox" aria-label="Select all shown" checked={pageAll} ref={(el) => { if (el) el.indeterminate = !pageAll && shown.some((r) => sel.has(r.ro.id)) }}
                onChange={() => selectRows(shown, !pageAll)} disabled={!shown.length} /></th>
              <th>RO #</th>{showCust && <th>Customer</th>}<th>Unit / item</th><th>{tab === 'archived' ? 'Reason' : 'Status'}</th>
              <th>{dateLabel}</th><th className="num">{tab === 'closed' ? '' : 'Idle'}</th><th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {!visible.length && <tr><td colSpan={cols} className="empty">{tab === 'forgotten' ? 'Nothing forgotten. Nice.' : 'No orders match.'}</td></tr>}
            {groups.map((g) => (
              <Fragment key={g.key || 'all'}>
                {g.key && (() => {
                  const rows = allOfGroup(g.key)
                  const on = rows.every((r) => sel.has(r.ro.id))
                  return (
                    <tr className="group-row ob-group">
                      <td className="ob-cb"><input type="checkbox" aria-label={`Select all: ${FORGOTTEN_LABEL[g.key]}`} checked={on} onChange={() => selectRows(rows, !on)} /></td>
                      <td colSpan={cols - 1}>{FORGOTTEN_LABEL[g.key]} <span className="muted">· {rows.length}</span>
                        <button className="linkish small" style={{ marginLeft: 8 }} onClick={() => selectRows(rows, !on)}>{on ? 'Unselect these' : `Select these ${rows.length}`}</button></td>
                    </tr>
                  )
                })()}
                {g.rows.map(({ r, i }) => {
                  const jt = jobTypeOf(s, r.ro)
                  const on = sel.has(r.ro.id)
                  const date = tab === 'closed' ? r.ro.closedAt : tab === 'archived' ? r.ro.archived?.at ?? null : r.ro.openedAt
                  return (
                    <tr key={r.ro.id} className={`click ${on ? 'ob-on' : ''}`} onClick={() => nav(`/ro/${r.ro.id}`)}>
                      <td className="ob-cb" onClick={(e) => { e.stopPropagation(); toggle(i, e.shiftKey) }}>
                        <input type="checkbox" aria-label={`Select RO ${r.ro.number}`} checked={on} readOnly /></td>
                      <td className="nw"><span className="ro-num">{r.ro.number}</span>
                        {jt && <span className="ob-kind" title={jt.name}><JobGlyph icon={jt.icon} size={14} />{jt.name}</span>}
                        {r.ro.warranty && <> <span className="tag warranty">WTY</span></>}</td>
                      {showCust && <td><div className="cell-main">{r.cust}</div>{r.custNo && <div className="cell-sub mono">#{r.custNo}</div>}</td>}
                      <td><div className="cell-main">{r.unit.main}</div><div className="cell-sub">{r.forgot && tab !== 'archived' ? <span style={{ color: 'var(--cust)' }}>{r.forgot.why}</span> : r.unit.sub || r.ro.complaint.slice(0, 60)}</div></td>
                      <td>{r.ro.archived ? <span className="small">{ARCHIVE_REASON_LABEL[r.ro.archived.reason]}<div className="cell-sub">was {STATUS_LABEL[r.ro.status]}</div></span> : <StatusBadge status={r.ro.status} />}</td>
                      <td className="small nw">{fmtDate(date)}{tab === 'closed' && <div className="row" style={{ gap: 6, marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
                        <Link className="small" to={`/ro/${r.ro.id}/print/invoice`}>Reprint</Link>
                        <RepeatLink ro={r.ro} /></div>}</td>
                      <td className="num">{tab === 'closed' ? <span className="muted small">{daysBetween(r.ro.openedAt, r.ro.closedAt ?? Date.now())}d in shop</span> : r.ro.archived ? <span className="muted">—</span> : <Age days={r.idle} warn={7} hot={s.staleDays} />}</td>
                      <td className="num">{money(r.total)}</td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
          {visible.length > 0 && (
            <tfoot><tr><td /><td colSpan={cols - 2}>{visible.length} order{visible.length === 1 ? '' : 's'}{visible.length > shown.length && ` · showing ${shown.length}`}</td><td className="num">{money(sumTotal)}</td></tr></tfoot>
          )}
        </table>
      </div>
      {visible.length > shown.length && <div style={{ textAlign: 'center', marginTop: 10 }}><button className="btn" onClick={() => setLimit(limit + STEP)}>Show {Math.min(STEP, visible.length - shown.length)} more</button></div>}
      <div className="small muted" style={{ marginTop: 8 }}>Tip: tick one box, then shift-click another to select everything between.</div>

      {selected.length > 0 && (
        <div className="ob-bulk no-print" role="toolbar" aria-label="Bulk actions">
          <b>{selected.length} selected</b>
          {selOpen.length > 0 && <button className="btn primary sm" onClick={startArchive}>Archive {selOpen.length < selected.length ? selOpen.length : ''}…</button>}
          {selArchived.length > 0 && <button className="btn primary sm" onClick={restore}>Restore {selArchived.length}</button>}
          {selOpen.length > 0 && (
            <select className="select sm" value="" onChange={(e) => e.target.value && bulkTech(e.target.value === '-' ? '' : e.target.value)} aria-label="Assign tech">
              <option value="">Assign tech…</option><option value="-">Unassigned</option>{techs.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {selOpen.length > 0 && (
            <select className="select sm" value="" onChange={(e) => e.target.value && bulkStatus(e.target.value as ROStatus)} aria-label="Set status">
              <option value="">Set status…</option>{STATUS_ORDER.filter((x) => x !== 'closed').map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
            </select>
          )}
          <button className="btn sm" onClick={exportCsv}>Export CSV</button>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {archiving && (
        <ArchiveModal ids={archiving} suggest={suggestion}
          blocked={archiveList.map((ro) => ({ ro, why: archiveBlocker(db, ro) })).filter((x): x is { ro: RepairOrder; why: string } => !!x.why)}
          onClose={() => setArchiving(null)}
          onDone={(res) => {
            setArchiving(null); reset()
            if (res) setUndo({ batch: res.batch, ids: res.ids, text: `Archived ${res.ids.length} order${res.ids.length === 1 ? '' : 's'}.` })
          }} />
      )}
      {undo && (
        <div className="toast ob-undo">{undo.text}
          <button className="btn sm" onClick={() => {
            mutate((d) => { restoreOrders(d, undo.ids.filter((id) => d.ros.find((r) => r.id === id)?.archived?.batch === undo.batch), currentUser, 'Archive undone', true) })
            audit(`Undid archive of ${undo.ids.length} orders`)
            setUndo(null); setToast('Undone. They’re back on the board.')
          }}>Undo</button></div>
      )}
      {toast && !undo && <div className="toast">{toast}</div>}
    </div>
  )
}

function RepeatLink({ ro }: { ro: RepairOrder }) {
  const { repeatRO, audit } = useStore()
  const nav = useNavigate()
  return <button className="linkish small" title="Open a new order with the same customer, unit and lines at today's prices"
    onClick={() => { const n = repeatRO(ro.id); if (n) { audit(`Opened RO ${n.number} as a repeat of RO ${ro.number}`); nav(`/ro/${n.id}`) } }}>Repeat</button>
}

/** Confirm an archive: reason, note, parts, and the master PIN for big batches. */
export function ArchiveModal({ ids, blocked, suggest, onClose, onDone }: {
  ids: string[]; blocked: { ro: RepairOrder; why: string }[]; suggest?: ArchiveReason
  onClose: () => void; onDone: (res: { batch: string; ids: string[] } | null) => void
}) {
  const { db, mutate, audit, currentUser, override } = useStore()
  const [reason, setReason] = useState<ArchiveReason>(suggest ?? 'abandoned')
  const [note, setNote] = useState('')
  const [partsUsed, setPartsUsed] = useState(false)
  const blockedIds = new Set(blocked.map((b) => b.ro.id))
  const ok = ids.map((id) => db.ros.find((r) => r.id === id)!).filter((ro) => ro && !blockedIds.has(ro.id) && isOpenRO(ro))
  const stocked = ok.reduce((a, ro) => a + ro.parts.filter((p) => p.partId).reduce((x, p) => x + p.qty, 0), 0)
  const needPin = ok.length > db.settings.archivePinOver && !override
  const go = () => {
    if (needPin) { requestOverride(); return }
    // State updates may run later, so the batch id is made here rather than read back.
    const batch = uid()
    mutate((d) => { archiveOrders(d, ok.map((r) => r.id), { reason, note, partsUsed, user: currentUser + (override ? ' (override)' : ''), batch }) })
    audit(`Archived ${ok.length} order${ok.length === 1 ? '' : 's'} (${ARCHIVE_REASON_LABEL[reason]}${note.trim() ? `: ${note.trim()}` : ''}${partsUsed ? ', parts taken out of stock' : ''}): RO ${numberList(ok.map((r) => r.number))}`)
    onDone({ batch, ids: ok.map((r) => r.id) })
  }
  const byStatus = Object.entries(ok.reduce<Record<string, number>>((m, ro) => { m[STATUS_LABEL[ro.status]] = (m[STATUS_LABEL[ro.status]] ?? 0) + 1; return m }, {}))
  return (
    <Modal title={ok.length === 1 ? `Archive RO ${ok[0].number}?` : `Archive ${ok.length} orders?`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok.length} onClick={go}>{needPin ? `🔒 Enter master PIN to archive ${ok.length}` : `Archive ${ok.length}`}</button></>}>
      <div className="stack">
        {ok.length > 1 && <div className="small">{byStatus.map(([k, n]) => `${n} ${k}`).join(' · ')}</div>}
        <div className="small muted">Archived orders leave the board, the dashboard and every count. They aren’t billed or deleted, and you can restore them any time from Orders → Archived.</div>
        <label className="field"><span>Reason</span>
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value as ArchiveReason)}>
            {(Object.keys(ARCHIVE_REASON_LABEL) as ArchiveReason[]).map((k) => <option key={k} value={k}>{ARCHIVE_REASON_LABEL[k]}{k === suggest ? ' (suggested)' : ''}</option>)}
          </select></label>
        <label className="field"><span>Note (optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called twice, left voicemail…" /></label>
        {stocked > 0 && (
          <label className="check"><input type="checkbox" checked={partsUsed} onChange={(e) => setPartsUsed(e.target.checked)} />
            <span>Parts were used (installed on the unit or scrapped). Take {stocked} stocked part{stocked === 1 ? '' : 's'} out of inventory. <span className="muted">Leave unticked if they’re back on the shelf.</span></span></label>
        )}
        {needPin && <div className="flag warn" style={{ padding: '6px 10px' }}>Archiving more than {db.settings.archivePinOver} orders at once needs the master PIN.</div>}
        {blocked.length > 0 && (
          <div className="small" style={{ color: 'var(--cust)' }}>
            <b>{blocked.length} can’t be archived</b> and will be skipped: {blocked.slice(0, 6).map((b) => `RO ${b.ro.number} (${b.why.toLowerCase()})`).join(', ')}{blocked.length > 6 && '…'}. Settle money on account first.
          </div>
        )}
      </div>
    </Modal>
  )
}
