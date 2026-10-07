import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLookups, useStore } from '../lib/store'
import type { Customer, UnitType, Wholegood, WholegoodStatus } from '../lib/types'
import { daysBetween, fmtDate, money, round2, uid } from '../lib/calc'
import { download, toCSV } from '../lib/importer'
import { Icon, Modal } from '../components/ui'
import { LineDot, LineTabs, Pager } from '../components/lines'
import { CustomerPicker, UNIT_TYPES, formatPhone } from './NewRO'

const WG_STATUS: Record<WholegoodStatus, { label: string; cls: string }> = {
  on_order: { label: 'On Order', cls: 'vendor' },
  in_stock: { label: 'In Stock', cls: 'shop' },
  demo: { label: 'Demo', cls: 'customer' },
  sold: { label: 'Sold', cls: 'done' },
}
type StatusFilter = 'stock' | 'on_order' | 'sold' | 'all'
type View = 'units' | 'models'
const PAGE = 100

/** Days on hand: received → sold (or today). */
export const daysHere = (w: Wholegood) => (w.receivedAt ? daysBetween(w.receivedAt, w.soldAt ?? Date.now()) : null)

export default function Wholegoods() {
  const { db, mutate, override, audit } = useStore()
  const L = useLookups()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const line = params.get('line') ?? ''
  const [status, setStatus] = useState<StatusFilter>('stock')
  const [view, setView] = useState<View>('units')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [edit, setEdit] = useState<Wholegood | 'new' | null>(null)
  const [selling, setSelling] = useState<Wholegood | null>(null)
  const [sort, setSort] = useState<{ key: 'days' | 'model' | 'stock' | 'dp' | 'srp' | 'received'; dir: 1 | -1 }>({ key: 'days', dir: -1 })
  useEffect(() => setPage(0), [line, status, q])
  const aged = db.settings.agedUnitDays
  const lineName = (c: string) => L.line.get(c)?.name ?? c
  const wgLines = db.lines.filter((l) => l.carriesWholegoods)

  const counts = useMemo(() => {
    const m: Record<string, number> = { '': 0 }
    for (const w of db.wholegoods) if (w.status === 'in_stock' || w.status === 'demo') { m[''] = (m[''] ?? 0) + 1; m[w.line] = (m[w.line] ?? 0) + 1 }
    return m
  }, [db.wholegoods])

  const inLine = useMemo(() => db.wholegoods.filter((w) => !line || w.line === line), [db.wholegoods, line])

  const stats = useMemo(() => {
    const stock = inLine.filter((w) => w.status === 'in_stock' || w.status === 'demo')
    const days = stock.map((w) => daysHere(w) ?? 0)
    const sold90 = inLine.filter((w) => w.status === 'sold' && w.soldAt && daysBetween(w.soldAt) <= 90)
    const fpDue = stock.filter((w) => w.floorPlan && w.floorPlanDue && daysBetween(Date.now(), w.floorPlanDue) <= 30)
    return {
      units: stock.length,
      dp: stock.reduce((a, w) => a + w.dp, 0),
      srp: stock.reduce((a, w) => a + w.srp, 0),
      avgDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0,
      aged: days.filter((d) => d >= aged).length,
      onOrder: inLine.filter((w) => w.status === 'on_order').length,
      sold90: sold90.length,
      gross90: sold90.reduce((a, w) => a + ((w.soldPrice ?? w.srp) - w.dp), 0),
      fpDue: fpDue.length,
    }
  }, [inLine, aged])

  const rows = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    const list = inLine.filter((w) => {
      if (status === 'stock' && !(w.status === 'in_stock' || w.status === 'demo')) return false
      if (status === 'on_order' && w.status !== 'on_order') return false
      if (status === 'sold' && w.status !== 'sold') return false
      if (!terms.length) return true
      const cust = w.soldToCustomerId ? L.customer.get(w.soldToCustomerId)?.name ?? '' : ''
      const h = `${w.stockNo} ${w.model} ${w.description} ${w.serial} ${w.category} ${cust}`.toLowerCase()
      return terms.every((t) => h.includes(t))
    })
    const val = (w: Wholegood): string | number => {
      switch (sort.key) {
        case 'days': return daysHere(w) ?? -1
        case 'model': return w.model
        case 'stock': return Number(w.stockNo) || 0
        case 'dp': return w.dp
        case 'srp': return w.srp
        case 'received': return w.receivedAt ?? ''
      }
    }
    return list.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir })
  }, [inLine, status, q, sort, L])

  // "By model" view: what's moving, what's sitting — the reorder conversation.
  const models = useMemo(() => {
    const m = new Map<string, { line: string; model: string; description: string; inStock: number; onOrder: number; sold90: number; oldest: number; dp: number; srp: number }>()
    for (const w of inLine) {
      const k = w.line + '|' + w.model
      const r = m.get(k) ?? { line: w.line, model: w.model, description: w.description, inStock: 0, onOrder: 0, sold90: 0, oldest: 0, dp: w.dp, srp: w.srp }
      if (w.status === 'in_stock' || w.status === 'demo') { r.inStock++; r.oldest = Math.max(r.oldest, daysHere(w) ?? 0) }
      if (w.status === 'on_order') r.onOrder++
      if (w.status === 'sold' && w.soldAt && daysBetween(w.soldAt) <= 90) r.sold90++
      m.set(k, r)
    }
    return [...m.values()].sort((a, b) => a.line.localeCompare(b.line) || b.sold90 - a.sold90 || a.model.localeCompare(b.model))
  }, [inLine])

  const pages = Math.ceil(rows.length / PAGE)
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE)
  const th = (key: typeof sort.key, label: string, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'model' ? 1 : -1 }))}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )

  const exportCSV = () => {
    const header = ['Line', 'Stock #', 'Model', 'Description', 'Category', 'Serial', 'Year', 'Condition', 'Status', 'DP', 'SRP', 'Received', 'Days Here', 'Floor Plan Due', 'Sold', 'Sold Price', 'Sold To']
    const data = rows.map((w) => [lineName(w.line), w.stockNo, w.model, w.description, w.category, w.serial, w.year, w.condition, WG_STATUS[w.status].label, w.dp, w.srp,
      w.receivedAt?.slice(0, 10) ?? '', daysHere(w), w.floorPlanDue?.slice(0, 10) ?? '', w.soldAt?.slice(0, 10) ?? '', w.soldPrice, w.soldToCustomerId ? L.customer.get(w.soldToCustomerId)?.name ?? '' : ''])
    download(`shopline-wholegoods-${line || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([header, ...data]))
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Wholegoods</h1><div className="sub">Units for sale by manufacturer line · serials, days on hand, floor plan</div></div>
        <span className="spacer" />
        <button className="btn" onClick={exportCSV}>Export CSV</button>
        <Link className="btn" to={`/import?target=wholegoods${line ? `&line=${line}` : ''}`}>Import unit list</Link>
        <button className="btn primary" onClick={() => setEdit('new')}>{Icon.plus} Add unit</button>
      </div>

      <LineTabs lines={wgLines} value={line} onChange={(c) => setParams(c ? { line: c } : {}, { replace: true })}
        counts={Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, `${v} in stock`]))} />

      <div className="stats">
        <div className="stat"><div className="label">In stock</div><div className="value">{stats.units}</div></div>
        <div className="stat"><div className="label">Money on the floor (DP)</div><div className="value">{money(stats.dp).replace(/\.\d\d$/, '')}</div></div>
        <div className="stat"><div className="label">At SRP</div><div className="value">{money(stats.srp).replace(/\.\d\d$/, '')}</div></div>
        <div className="stat"><div className="label">Avg days here</div><div className="value">{stats.avgDays.toFixed(0)}</div></div>
        <div className="stat"><div className="label">Aged {aged}+ days</div><div className={`value ${stats.aged ? 'bad' : ''}`}>{stats.aged}</div></div>
        <div className="stat"><div className="label">Floor plan due ≤30d</div><div className={`value ${stats.fpDue ? 'warn' : ''}`}>{stats.fpDue}</div></div>
        <div className="stat"><div className="label">On order</div><div className="value">{stats.onOrder}</div></div>
        <div className="stat"><div className="label">Sold, 90 days</div><div className="value">{stats.sold90} <span className="small muted">· {money(stats.gross90).replace(/\.\d\d$/, '')} gross</span></div></div>
      </div>

      <div className="row wrap" style={{ marginBottom: 12, gap: 12 }}>
        <div className="seg">
          <button className={view === 'units' ? 'on' : ''} onClick={() => setView('units')}>Units</button>
          <button className={view === 'models' ? 'on' : ''} onClick={() => setView('models')}>By model</button>
        </div>
        {view === 'units' && <>
          <label className="search">{Icon.search}<input className="input" placeholder="Search serial, model, stock #, customer…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="seg">
            {([['stock', 'In stock'], ['on_order', 'On order'], ['sold', 'Sold'], ['all', 'All']] as [StatusFilter, string][]).map(([k, l]) => (
              <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
            ))}
          </div>
        </>}
      </div>

      {view === 'models' ? (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr>{!line && <th>Line</th>}<th>Model</th><th>Description</th><th className="num">In stock</th><th className="num">On order</th><th className="num">Sold 90d</th><th className="num">Oldest (days)</th><th className="num">DP</th><th className="num">SRP</th><th className="num">Margin</th></tr></thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.line + m.model}>
                  {!line && <td className="nw small"><span className="row" style={{ gap: 5 }}><LineDot color={L.line.get(m.line)?.color ?? '#999'} />{lineName(m.line)}</span></td>}
                  <td className="mono small">{m.model}</td><td>{m.description}</td>
                  <td className="num" style={{ fontWeight: 600, color: m.inStock === 0 && m.sold90 > 0 ? 'var(--bad)' : undefined }}>{m.inStock}</td>
                  <td className="num">{m.onOrder || <span className="muted">0</span>}</td>
                  <td className="num">{m.sold90 || <span className="muted">0</span>}</td>
                  <td className="num"><span className={`age ${m.oldest >= aged ? 'hot' : m.oldest >= aged / 2 ? 'warm' : ''}`}>{m.inStock ? m.oldest : '—'}</span></td>
                  <td className="num">{money(m.dp)}</td><td className="num">{money(m.srp)}</td>
                  <td className="num small">{m.srp ? (((m.srp - m.dp) / m.srp) * 100).toFixed(0) : 0}%</td>
                </tr>
              ))}
              {!models.length && <tr><td colSpan={10} className="empty">No units in this line yet.</td></tr>}
            </tbody>
          </table>
          <div className="small muted" style={{ padding: '8px 12px' }}>Red “in stock” = sold one recently and have none on the floor. Probably time to reorder.</div>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr>
              {th('stock', 'Stock #')}{!line && <th>Line</th>}{th('model', 'Model')}<th>Serial</th><th>Status</th>
              {th('received', 'Received')}{th('days', 'Days here', 'num')}{th('dp', 'DP', 'num')}{th('srp', 'SRP', 'num')}<th className="num">Margin</th><th>Floor plan / sold</th>
            </tr></thead>
            <tbody>
              {shown.map((w) => {
                const d = daysHere(w)
                const fpDays = w.floorPlanDue ? daysBetween(Date.now(), w.floorPlanDue) : null
                const cust = w.soldToCustomerId ? L.customer.get(w.soldToCustomerId) : undefined
                return (
                  <tr key={w.id} className="click" onClick={() => setEdit(w)}>
                    <td className="mono small">{w.stockNo}{w.condition === 'used' && <> <span className="tag" style={{ background: 'var(--cust-soft)', color: 'var(--cust)' }}>USED</span></>}</td>
                    {!line && <td className="nw small"><span className="row" style={{ gap: 5 }}><LineDot color={L.line.get(w.line)?.color ?? '#999'} />{lineName(w.line)}</span></td>}
                    <td style={{ minWidth: 280 }}><div className="cell-main">{w.model} <span className="muted small">{w.year}</span></div><div className="cell-sub">{w.description}</div></td>
                    <td className="mono small">{w.serial || <span className="muted">not assigned</span>}</td>
                    <td><span className={`status ${WG_STATUS[w.status].cls}`}>{WG_STATUS[w.status].label}</span></td>
                    <td className="small nw">{w.receivedAt ? fmtDate(w.receivedAt) : <span className="muted">ordered {fmtDate(w.orderedAt)}</span>}</td>
                    <td className="num">{d == null ? <span className="muted">—</span> : <span className={`age ${w.status !== 'sold' && d >= aged ? 'hot' : w.status !== 'sold' && d >= aged / 2 ? 'warm' : ''}`}>{d}</span>}</td>
                    <td className="num">{money(w.dp)}</td>
                    <td className="num">{money(w.soldPrice ?? w.srp)}</td>
                    <td className="num small">{(((w.soldPrice ?? w.srp) - w.dp) / ((w.soldPrice ?? w.srp) || 1) * 100).toFixed(0)}%</td>
                    <td className="small">
                      {w.status === 'sold' ? <>{fmtDate(w.soldAt)}{cust && <> · <span className="cell-main">{cust.name}</span></>}</>
                        : w.floorPlan && fpDays != null ? <span style={{ color: fpDays <= 30 ? 'var(--bad)' : undefined, fontWeight: fpDays <= 30 ? 600 : 400 }}>{fpDays < 0 ? `FP PAST DUE ${-fpDays}d` : `FP due ${fmtDate(w.floorPlanDue)}${fpDays <= 30 ? ` (${fpDays}d)` : ''}`}</span>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={11} className="empty">No units match.</td></tr>}
            </tbody>
          </table>
          <Pager page={page} pages={pages} total={rows.length} onPage={setPage} />
        </div>
      )}

      {edit && <UnitModal
        wg={edit === 'new' ? null : edit} defaultLine={line || wgLines[0]?.code || 'OTHER'} lines={wgLines} override={override}
        onClose={() => setEdit(null)}
        onSell={(w) => { setEdit(null); setSelling(w) }}
        onOpenCustomer={(id) => nav(`/customers/${id}`)}
        onSave={(w, isNew) => {
          mutate((d) => {
            if (isNew) d.wholegoods.push(w)
            else { const i = d.wholegoods.findIndex((x) => x.id === w.id); if (i >= 0) d.wholegoods[i] = w }
          })
          if (isNew) audit(`Added unit ${w.model} ${w.serial} (stock #${w.stockNo})`)
          setEdit(null)
        }}
        onDelete={(w) => { mutate((d) => { d.wholegoods = d.wholegoods.filter((x) => x.id !== w.id) }); audit(`Deleted unit stock #${w.stockNo} ${w.model} ${w.serial}`); setEdit(null) }}
        nextStock={String(Math.max(5000, ...db.wholegoods.map((w) => Number(w.stockNo) || 0)) + 1)}
      />}

      {selling && <SellModal wg={selling} customers={db.customers} onClose={() => setSelling(null)}
        onSell={({ customer, newCustomer, price, date }) => {
          mutate((d) => {
            // keep all ids local to the updater — React may run it twice in dev
            let custId = customer?.id ?? null
            if (!custId && newCustomer) {
              const c: Customer = { id: uid(), number: d.nextCustomerNumber++, name: newCustomer.name, phone: newCustomer.phone, email: '', isBusiness: false, notes: '', createdAt: new Date().toISOString() }
              d.customers.push(c); custId = c.id
            }
            const w = d.wholegoods.find((x) => x.id === selling.id)!
            let unitId: string | null = null
            if (custId) {
              unitId = uid()
              d.units.push({ id: unitId, customerId: custId, type: w.category, make: lineName(w.line), model: w.model, serial: w.serial, engineHours: null })
            }
            Object.assign(w, { status: 'sold', soldAt: date, soldPrice: price, soldToCustomerId: custId, customerUnitId: unitId, floorPlan: false })
          })
          audit(`Sold stock #${selling.stockNo} ${selling.model} for ${money(price)}`)
          setSelling(null)
        }} />}
    </div>
  )
}

function UnitModal({ wg, defaultLine, lines, override, onClose, onSave, onDelete, onSell, onOpenCustomer, nextStock }: {
  wg: Wholegood | null; defaultLine: string; lines: { code: string; name: string }[]; override: boolean
  onClose: () => void; onSave: (w: Wholegood, isNew: boolean) => void; onDelete: (w: Wholegood) => void
  onSell: (w: Wholegood) => void; onOpenCustomer: (id: string) => void; nextStock: string
}) {
  const isNew = !wg
  const [w, setW] = useState<Wholegood>(() => wg ? { ...wg } : {
    id: uid(), line: defaultLine, stockNo: nextStock, category: 'Zero-Turn Mower', model: '', description: '', serial: '', year: new Date().getFullYear(),
    condition: 'new', status: 'in_stock', dp: 0, srp: 0, orderedAt: null, receivedAt: new Date().toISOString(), floorPlan: false, floorPlanDue: null,
    soldAt: null, soldPrice: null, soldToCustomerId: null, customerUnitId: null, notes: '',
  })
  const locked = w.status === 'sold' && wg?.status === 'sold' && !override
  const up = (patch: Partial<Wholegood>) => setW((x) => ({ ...x, ...patch }))
  const dateVal = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
  const fromDate = (v: string) => (v ? new Date(v + 'T12:00:00').toISOString() : null)
  const valid = w.model.trim() && w.stockNo.trim()

  return (
    <Modal title={isNew ? 'Add unit' : `Stock #${wg!.stockNo} · ${wg!.model}`} onClose={onClose}
      footer={<>
        {!isNew && override && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(w)}>Delete unit</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        {!isNew && (w.status === 'in_stock' || w.status === 'demo') && <button className="btn" onClick={() => onSell(w)}>Mark sold…</button>}
        {!isNew && w.status === 'on_order' && <button className="btn" onClick={() => onSave({ ...w, status: 'in_stock', receivedAt: new Date().toISOString() }, false)}>Mark received today</button>}
        <button className="btn primary" disabled={!valid || locked} onClick={() => onSave({ ...w, model: w.model.trim(), serial: w.serial.trim().toUpperCase() }, isNew)}>Save</button>
      </>}>
      {locked && <div className="small" style={{ color: 'var(--cust)' }}>🔒 Sold units are locked. Turn on master override to change a sold record.</div>}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="grid2">
          <label className="field"><span>Line</span><select className="select" value={w.line} onChange={(e) => up({ line: e.target.value })}>{lines.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></label>
          <label className="field"><span>Category</span><select className="select" value={w.category} onChange={(e) => up({ category: e.target.value as UnitType })}>{UNIT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="field"><span>Model #</span><input className="input mono" autoFocus={isNew} value={w.model} onChange={(e) => up({ model: e.target.value })} /></label>
          <label className="field"><span>Serial #</span><input className="input mono" value={w.serial} onChange={(e) => up({ serial: e.target.value.toUpperCase() })} /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Description</span><input className="input" value={w.description} onChange={(e) => up({ description: e.target.value })} placeholder='e.g. 52" Kawasaki FR' /></label>
          <label className="field"><span>Stock #</span><input className="input mono" value={w.stockNo} onChange={(e) => up({ stockNo: e.target.value })} /></label>
          <div className="grid2" style={{ gap: 8 }}>
            <label className="field"><span>Year</span><input className="input" inputMode="numeric" value={w.year} onChange={(e) => up({ year: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
            <label className="field"><span>Condition</span><select className="select" value={w.condition} onChange={(e) => up({ condition: e.target.value as 'new' | 'used' })}><option value="new">New</option><option value="used">Used</option></select></label>
          </div>
          <label className="field"><span>DP (dealer cost)</span><input className="input" inputMode="decimal" value={w.dp} onChange={(e) => up({ dp: round2(Number(e.target.value.replace(/[^\d.]/g, '')) || 0) })} /></label>
          <label className="field"><span>SRP</span><input className="input" inputMode="decimal" value={w.srp} onChange={(e) => up({ srp: round2(Number(e.target.value.replace(/[^\d.]/g, '')) || 0) })} /></label>
          <label className="field"><span>Status</span>
            <select className="select" value={w.status} onChange={(e) => { const s = e.target.value as WholegoodStatus; up({ status: s, receivedAt: s === 'on_order' ? null : w.receivedAt ?? new Date().toISOString() }) }}>
              <option value="on_order">On order</option><option value="in_stock">In stock</option><option value="demo">Demo</option>
              {(w.status === 'sold' || override) && <option value="sold">Sold</option>}
            </select></label>
          <label className="field"><span>{w.status === 'on_order' ? 'Ordered' : 'Received'}</span>
            <input type="date" className="input" value={dateVal(w.status === 'on_order' ? w.orderedAt : w.receivedAt)} onChange={(e) => up(w.status === 'on_order' ? { orderedAt: fromDate(e.target.value) } : { receivedAt: fromDate(e.target.value) })} /></label>
        </div>
        <div className="row wrap" style={{ gap: 16 }}>
          <label className="check"><input type="checkbox" checked={w.floorPlan} onChange={(e) => up({ floorPlan: e.target.checked, floorPlanDue: e.target.checked ? w.floorPlanDue ?? new Date(Date.now() + 270 * 86_400_000).toISOString() : null })} /> On floor plan</label>
          {w.floorPlan && <label className="row small">Payoff due <input type="date" className="input" style={{ width: 160 }} value={dateVal(w.floorPlanDue)} onChange={(e) => up({ floorPlanDue: fromDate(e.target.value) })} /></label>}
        </div>
        <label className="field"><span>Notes</span><input className="input" value={w.notes} onChange={(e) => up({ notes: e.target.value })} /></label>
        {w.status === 'sold' && (
          <div className="small">Sold {fmtDate(w.soldAt)} for <b>{money(w.soldPrice ?? 0)}</b>
            {w.soldToCustomerId && <> · <button type="button" className="btn sm" onClick={() => onOpenCustomer(w.soldToCustomerId!)}>Open customer</button></>}</div>
        )}
      </fieldset>
    </Modal>
  )
}

function SellModal({ wg, customers, onClose, onSell }: {
  wg: Wholegood; customers: Customer[]; onClose: () => void
  onSell: (v: { customer: Customer | null; newCustomer: { name: string; phone: string } | null; price: number; date: string }) => void
}) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [newCust, setNewCust] = useState<{ name: string; phone: string } | null>(null)
  const [price, setPrice] = useState(wg.srp.toFixed(2))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const p = Number(price)
  const ok = p > 0 && (customer || (newCust && newCust.name.trim() && newCust.phone.replace(/\D/g, '').length === 10))
  return (
    <Modal title={`Sell ${wg.model} · S/N ${wg.serial || '—'}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={() => onSell({ customer, newCustomer: newCust, price: round2(p), date: new Date(date + 'T12:00:00').toISOString() })}>Record sale</button></>}>
      <div className="field"><span>Customer</span>
        {customer ? <div className="row"><b>{customer.name}</b><span className="muted small">{customer.phone}</span><span className="spacer" /><button className="btn sm" onClick={() => setCustomer(null)}>Change</button></div>
          : newCust ? <div className="grid2">
              <input className="input" placeholder="Name" autoFocus value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
              <input className="input" placeholder="(405) 555-0123" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: formatPhone(e.target.value) })} />
            </div>
          : <CustomerPicker customers={customers} onPick={setCustomer} onNew={(q) => setNewCust({ name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? formatPhone(q) : '' })} />}
      </div>
      <div className="grid2">
        <label className="field"><span>Sale price</span><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        <label className="field"><span>Date</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      {p > 0 && <div className="small">Gross: <b style={{ color: p - wg.dp > 0 ? 'var(--ok)' : 'var(--bad)' }}>{money(p - wg.dp)}</b> ({(((p - wg.dp) / p) * 100).toFixed(0)}%) · days on hand: {daysHere(wg) ?? '—'}</div>}
      <div className="small muted">The unit is added to the customer's record, so their first service visit already knows the serial.</div>
    </Modal>
  )
}
