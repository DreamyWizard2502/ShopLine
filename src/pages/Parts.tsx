import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import type { Part } from '../lib/types'
import { daysBetween, fmtDate, money, uid } from '../lib/calc'
import { normPartNo, toCSV, download } from '../lib/importer'
import { DraftNumber, DraftText } from '../components/fields'
import { Icon, Modal } from '../components/ui'
import { LineTabs, Pager, LineDot } from '../components/lines'
import { OverrideButton } from '../components/override'

type StockFilter = 'all' | 'in' | 'out' | 'short' | 'stale'
const PAGE = 100

export default function Parts() {
  const { db, mutate, override, audit } = useStore()
  const [params, setParams] = useSearchParams()
  const line = params.get('line') ?? ''
  const [q, setQ] = useState('')
  const [stock, setStock] = useState<StockFilter>('all')
  const [page, setPage] = useState(0)
  const [adjust, setAdjust] = useState<Part | null>(null)
  useEffect(() => setPage(0), [line, q, stock])

  // Units committed to open ROs, so "on hand" isn't the whole story.
  const committed = useMemo(() => {
    const m = new Map<string, number>()
    for (const ro of db.ros) if (ro.status !== 'closed' && !ro.archived) for (const p of ro.parts) if (p.partId) m.set(p.partId, (m.get(p.partId) ?? 0) + p.qty)
    return m
  }, [db.ros])

  // Search haystack built once per catalog change (fast even with 50k+ parts).
  const hay = useMemo(() => db.parts.map((p) => `${p.partNo} ${normPartNo(p.partNo)} ${p.description} ${p.bin} ${p.supersededBy}`.toLowerCase()), [db.parts])

  const perLine = useMemo(() => {
    const m: Record<string, { skus: number; units: number; dp: number; srp: number; zero: number }> = { '': { skus: 0, units: 0, dp: 0, srp: 0, zero: 0 } }
    for (const l of db.lines) m[l.code] = { skus: 0, units: 0, dp: 0, srp: 0, zero: 0 }
    for (const p of db.parts) {
      for (const k of ['', p.line]) {
        const s = (m[k] ??= { skus: 0, units: 0, dp: 0, srp: 0, zero: 0 })
        s.skus++; s.units += Math.max(0, p.onHand); s.dp += Math.max(0, p.onHand) * p.cost; s.srp += Math.max(0, p.onHand) * p.price
        if (p.onHand <= 0) s.zero++
      }
    }
    return m
  }, [db.parts, db.lines])

  const rows = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    const out: Part[] = []
    db.parts.forEach((p, i) => {
      if (line && p.line !== line) return
      if (terms.length && !terms.every((t) => hay[i].includes(t))) return
      const avail = p.onHand - (committed.get(p.id) ?? 0)
      if (stock === 'in' && p.onHand <= 0) return
      if (stock === 'out' && p.onHand > 0) return
      if (stock === 'short' && avail >= 0) return
      if (stock === 'stale' && p.priceUpdatedAt && daysBetween(p.priceUpdatedAt) < 365) return
      out.push(p)
    })
    return out.sort((a, b) => a.partNo.localeCompare(b.partNo))
  }, [db.parts, hay, line, q, stock, committed])

  const pages = Math.ceil(rows.length / PAGE)
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE)
  const set = (id: string, fn: (p: Part) => void) => mutate((d) => { const p = d.parts.find((x) => x.id === id); if (p) fn(p) })
  const lineName = (code: string) => db.lines.find((l) => l.code === code)?.name ?? code
  const stats = perLine[line] ?? perLine['']
  const lastImport = db.importLog.find((x) => x.target === 'parts' && (!line || x.line === line))

  const exportCSV = () => {
    const header = ['Line', 'Part Number', 'Description', 'Bin', 'DP', 'SRP', 'On Hand', 'Superseded By', 'Price Updated']
    const data = rows.map((p) => [lineName(p.line), p.partNo, p.description, p.bin, p.cost, p.price, p.onHand, p.supersededBy, p.priceUpdatedAt?.slice(0, 10) ?? ''])
    download(`shopline-parts-${line || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`, toCSV([header, ...data]))
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Parts Inventory</h1>
          <div className="sub">{db.parts.length.toLocaleString()} parts across {db.lines.length} lines · DP = dealer price, SRP = what we sell it for</div></div>
        <span className="spacer" />
        <button className="btn" onClick={exportCSV}>Export CSV</button>
        <OverrideButton className="btn" onClick={() => {
          const part: Part = { id: uid(), line: line || 'OTHER', partNo: 'NEW-PART', description: 'New part', vendor: lineName(line || 'OTHER'), cost: 0, price: 0, onHand: 0, bin: '', supersededBy: '', priceUpdatedAt: null }
          mutate((d) => { d.parts.unshift(part) }); setQ('NEW-PART'); audit(`Added part NEW-PART to ${lineName(part.line)}`)
        }}>{Icon.plus} Add part</OverrideButton>
        <Link className="btn primary" to={`/import?target=parts${line ? `&line=${line}` : ''}`}>Import price file</Link>
      </div>

      <LineTabs lines={db.lines} value={line} onChange={(c) => setParams(c ? { line: c } : {}, { replace: true })}
        counts={Object.fromEntries(Object.entries(perLine).map(([k, v]) => [k, `${v.skus.toLocaleString()} parts`]))} />

      <div className="stats">
        <div className="stat"><div className="label">Parts</div><div className="value">{stats.skus.toLocaleString()}</div></div>
        <div className="stat"><div className="label">Units on hand</div><div className="value">{stats.units.toLocaleString()}</div></div>
        <div className="stat"><div className="label">Value at DP</div><div className="value">{money(stats.dp)}</div></div>
        <div className="stat"><div className="label">Value at SRP</div><div className="value">{money(stats.srp)}</div></div>
        <div className="stat"><div className="label">Zero / negative</div><div className="value warn">{stats.zero.toLocaleString()}</div></div>
        <div className="stat"><div className="label">Last price import</div><div className="value" style={{ fontSize: 14, paddingTop: 4 }}>{lastImport ? `${fmtDate(lastImport.at)} · ${lastImport.fileName}` : 'Never'}</div></div>
      </div>

      <div className="row wrap" style={{ marginBottom: 12, gap: 12 }}>
        <label className="search">{Icon.search}<input className="input" placeholder="Search part #, description, bin, supersession…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className="seg">
          {([['all', 'All'], ['in', 'In stock'], ['out', 'Out of stock'], ['short', 'Short for open ROs'], ['stale', 'Price > 1 yr old']] as [StockFilter, string][]).map(([k, l]) => (
            <button key={k} className={stock === k ? 'on' : ''} onClick={() => setStock(k)}>{l}</button>
          ))}
        </div>
      </div>
      {!override && <div className="small muted" style={{ marginBottom: 8 }}>🔒 Prices and quantities are locked. Use <b>Adjust</b> to receive or count a part, or turn on master override to edit anything inline.</div>}

      <div className="panel table-wrap">
        <table className="table">
          <thead><tr>
            <th>Part #</th><th>Description</th>{!line && <th>Line</th>}<th>Bin</th>
            <th className="num">DP</th><th className="num">SRP</th><th className="num">Margin</th>
            <th className="num">On hand</th><th className="num">On ROs</th><th className="num">Avail.</th><th>Price updated</th><th />
          </tr></thead>
          <tbody>
            {shown.map((p) => {
              const com = committed.get(p.id) ?? 0
              const avail = p.onHand - com
              const margin = p.price ? (p.price - p.cost) / p.price : 0
              return (
                <tr key={p.id}>
                  <td className="mono small nw">{override ? <DraftText className="input mono" value={p.partNo} ariaLabel="Part number" onCommit={(v) => set(p.id, (x) => { x.partNo = v.toUpperCase() })} /> : p.partNo}
                    {p.supersededBy && <div className="small" style={{ color: 'var(--vendor)' }}>→ {p.supersededBy}</div>}</td>
                  <td>{override ? <DraftText value={p.description} ariaLabel="Description" onCommit={(v) => set(p.id, (x) => { x.description = v })} /> : p.description}</td>
                  {!line && <td className="nw small"><span className="row" style={{ gap: 5 }}><LineDot color={db.lines.find((l) => l.code === p.line)?.color ?? '#999'} />{lineName(p.line)}</span></td>}
                  <td style={{ width: 90 }}><DraftText value={p.bin} placeholder="—" ariaLabel="Bin" onCommit={(v) => set(p.id, (x) => { x.bin = v.toUpperCase() })} /></td>
                  <td className="num">{override ? <DraftNumber value={p.cost} decimals={2} width={76} ariaLabel="DP" onCommit={(v) => set(p.id, (x) => { x.cost = v; x.priceUpdatedAt = new Date().toISOString() })} /> : money(p.cost)}</td>
                  <td className="num">{override ? <DraftNumber value={p.price} decimals={2} width={76} ariaLabel="SRP" onCommit={(v) => set(p.id, (x) => { x.price = v; x.priceUpdatedAt = new Date().toISOString() })} /> : money(p.price)}</td>
                  <td className="num small" style={{ color: margin < 0.25 ? 'var(--bad)' : 'var(--ink-2)' }}>{(margin * 100).toFixed(0)}%</td>
                  <td className="num">{override ? <DraftNumber value={p.onHand} step={1} width={60} min={-9999} ariaLabel="On hand" onCommit={(v) => set(p.id, (x) => { x.onHand = Math.round(v) })} /> : p.onHand}</td>
                  <td className="num">{com || <span className="muted">0</span>}</td>
                  <td className="num" style={{ fontWeight: 600, color: avail < 0 ? 'var(--bad)' : avail === 0 ? 'var(--cust)' : 'var(--ok)' }}>{avail}</td>
                  <td className="small nw" style={{ color: p.priceUpdatedAt && daysBetween(p.priceUpdatedAt) > 365 ? 'var(--cust)' : undefined }}>{fmtDate(p.priceUpdatedAt)}</td>
                  <td className="nw">
                    <button className="btn sm" onClick={() => setAdjust(p)}>Adjust</button>
                    {override && <button className="btn sm ghost danger" aria-label="Delete part" onClick={() => { mutate((d) => { d.parts = d.parts.filter((x) => x.id !== p.id) }); audit(`Deleted part ${p.partNo} (${lineName(p.line)})`) }}>✕</button>}
                  </td>
                </tr>
              )
            })}
            {!rows.length && <tr><td colSpan={12} className="empty">No parts match.</td></tr>}
          </tbody>
        </table>
        <Pager page={page} pages={pages} total={rows.length} onPage={setPage} />
      </div>

      {adjust && <AdjustModal part={adjust} onClose={() => setAdjust(null)} onSave={(qty, reason) => {
        set(adjust.id, (x) => { x.onHand = qty })
        audit(`Qty ${adjust.partNo}: ${adjust.onHand} → ${qty} (${reason})`)
        setAdjust(null)
      }} />}
    </div>
  )
}

function AdjustModal({ part, onClose, onSave }: { part: Part; onClose: () => void; onSave: (qty: number, reason: string) => void }) {
  const [mode, setMode] = useState<'receive' | 'count'>('receive')
  const [n, setN] = useState('')
  const num = Number(n)
  const next = mode === 'receive' ? part.onHand + num : num
  const ok = n !== '' && Number.isFinite(num)
  return (
    <Modal title={`Adjust ${part.partNo}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={() => onSave(Math.round(next), mode === 'receive' ? `received ${num}` : 'physical count')}>Save</button></>}>
      <div className="small muted">{part.description} · currently <b>{part.onHand}</b> on hand</div>
      <div className="seg">
        <button className={mode === 'receive' ? 'on' : ''} onClick={() => setMode('receive')}>Receive (add)</button>
        <button className={mode === 'count' ? 'on' : ''} onClick={() => setMode('count')}>Physical count (set)</button>
      </div>
      <label className="field"><span>{mode === 'receive' ? 'Quantity received (negative to remove)' : 'Counted on the shelf'}</span>
        <input className="input" autoFocus inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/[^\d-]/g, ''))} /></label>
      {ok && <div>New on hand: <b>{Math.round(next)}</b></div>}
    </Modal>
  )
}
