import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import {
  PART_FIELDS, WG_FIELDS, CUSTOMER_FIELDS, applyParts, applyWholegoods, applyCustomers, download, findHeaderRow, guessMapping, parseFile,
  planParts, planWholegoods, planCustomers, toCSV, type Mapping, type ParsedFile, type PartsOptions, type CustomerOptions,
} from '../lib/importer'
import { money, uid } from '../lib/calc'
import { requestOverride } from '../components/override'
import { LineDot } from '../components/lines'

type Target = 'parts' | 'wholegoods' | 'customers'

export default function ImportPage() {
  const store = useStore()
  const { db, override } = store
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [target, setTarget] = useState<Target>((params.get('target') as Target) || 'parts')
  const [line, setLine] = useState(params.get('line') || db.lines[0].code)
  const [file, setFile] = useState<ParsedFile | null>(null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [headerRow, setHeaderRow] = useState(0)
  const [mapping, setMapping] = useState<Mapping>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [done, setDone] = useState<null | { updated: number; added: number }>(null)
  const [view, setView] = useState<'changes' | 'adds' | 'skipped'>('changes')
  const [opts, setOpts] = useState<Omit<PartsOptions, 'line'>>({ updatePrices: true, addNew: true, overwriteDescriptions: false, overwriteQty: false, srpMarkup: null })
  const [copts, setCopts] = useState<CustomerOptions>({ updateExisting: true, addNew: true, properCaseNames: true, keepNumbers: true })
  const inputRef = useRef<HTMLInputElement>(null)

  const fields = target === 'parts' ? PART_FIELDS : target === 'customers' ? CUSTOMER_FIELDS : WG_FIELDS
  const rows = file?.sheets[sheetIdx]?.rows ?? []
  const headers = rows[headerRow] ?? []

  const load = async (f: File) => {
    setError(''); setBusy(true); setDone(null)
    try {
      const parsed = await parseFile(f)
      if (!parsed.sheets.length || !parsed.sheets[0].rows.length) throw new Error('That file looks empty.')
      // Use the sheet with the most rows (price files sometimes have a cover sheet).
      const si = parsed.sheets.reduce((b, s, i, a) => (s.rows.length > a[b].rows.length ? i : b), 0)
      const hr = findHeaderRow(parsed.sheets[si].rows, fields)
      setFile(parsed); setSheetIdx(si); setHeaderRow(hr)
      setMapping(guessMapping(parsed.sheets[si].rows[hr] ?? [], fields))
      // If a brand name is in the file name, pre-select that line.
      const hit = db.lines.find((l) => f.name.toUpperCase().includes(l.code) || f.name.toUpperCase().includes(l.name.toUpperCase()))
      if (hit && !params.get('line') && target !== 'customers') setLine(hit.code)
    } catch (e) {
      setError((e as Error).message || 'Could not read that file.')
      setFile(null)
    } finally { setBusy(false) }
  }

  const remap = (hr: number, si = sheetIdx) => {
    setHeaderRow(hr)
    setMapping(guessMapping(file?.sheets[si]?.rows[hr] ?? [], fields))
  }

  const missingRequired = target === 'customers'
    ? ((mapping.name ?? -1) < 0 && (mapping.first ?? -1) < 0 && (mapping.last ?? -1) < 0 && (mapping.company ?? -1) < 0 ? [{ label: 'a name (full name, first/last, or company)' }] : [])
    : fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0)
  const priceMapped = target === 'parts' ? mapping.dp >= 0 || mapping.srp >= 0 : true

  const plan = useMemo(() => {
    if (!file || missingRequired.length) return null
    if (target === 'customers') return { kind: 'cust' as const, p: planCustomers(db, rows, headerRow, mapping, copts) }
    return target === 'parts'
      ? { kind: 'parts' as const, p: planParts(db, rows, headerRow, mapping, { ...opts, line }) }
      : { kind: 'wg' as const, p: planWholegoods(db, rows, headerRow, mapping, { line, updatePrices: opts.updatePrices, addNew: opts.addNew }) }
  }, [file, rows, headerRow, mapping, opts, copts, line, target, db, missingRequired.length])

  const apply = () => {
    if (!plan) return
    if (!override) { requestOverride(); return }
    const lineName = db.lines.find((l) => l.code === line)?.name ?? line
    store.mutate((d) => {
      if (plan.kind === 'parts') applyParts(d, plan.p)
      else if (plan.kind === 'cust') applyCustomers(d, plan.p)
      else applyWholegoods(d, plan.p)
      d.importLog.unshift({
        id: uid(), at: new Date().toISOString(), user: store.currentUser, target, fileName: file!.fileName, line: target === 'customers' ? '' : line,
        updated: plan.p.changes.length, added: plan.p.adds.length, unchanged: plan.p.unchanged, skipped: plan.p.skipped.length,
      })
    })
    store.audit(target === 'customers'
      ? `Imported ${file!.fileName} into customers: ${plan.p.changes.length} updated, ${plan.p.adds.length} added, ${(plan.kind === 'cust' ? plan.p.units.length : 0)} units`
      : `Imported ${file!.fileName} into ${target} (${lineName}): ${plan.p.changes.length} updated, ${plan.p.adds.length} added`)
    setDone({ updated: plan.p.changes.length, added: plan.p.adds.length })
  }

  const template = () => {
    const rowsT = target === 'parts'
      ? [['Part Number', 'Description', 'DP', 'SRP', 'Superseded By'], ['1234-567', 'Example air filter', '8.40', '13.99', '']]
      : target === 'customers'
      ? [['Customer #', 'Name', 'Company', 'Phone', 'Cell', 'Email', 'Address', 'City', 'State', 'Zip', 'Tax Exempt', 'Model', 'Serial'], ['1001', 'Jane Example', '', '(405) 555-0101', '', 'jane@example.com', '100 Main St', 'Mustang', 'OK', '73064', 'N', 'Recycler 22"', 'T123456']]
      : [['Model', 'Serial', 'Description', 'DP', 'SRP', 'Received'], ['ABC-52', 'S1234567', 'Example 52" zero-turn', '6390', '7999', '2026-10-01']]
    download(`shopline-${target}-template.csv`, toCSV(rowsT))
  }

  const step = !file ? 1 : !plan ? 2 : done ? 4 : 3

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to={target === 'parts' ? '/parts' : target === 'customers' ? '/customers' : '/wholegoods'}>{target === 'parts' ? 'Parts Inventory' : target === 'customers' ? 'Customers' : 'Wholegoods'}</Link> / Import</div>
          <h1>Import {target === 'parts' ? 'price file' : target === 'customers' ? 'customers' : 'unit list'}</h1>
          <div className="sub">{target === 'customers'
            ? 'Drop in a customer export from your old system. Customers are matched by customer #, then phone, then name, so running the same file twice won’t make duplicates. Everything stays in this browser on this computer.'
            : target === 'parts'
            ? 'Drop in a manufacturer price list. Every part number gets its DP and SRP overwritten, and new parts get added. One click, no per-line fees.'
            : 'Drop in a unit list or shipping manifest. Units are matched by serial number: new serials are added, existing ones get updated prices.'}</div>
        </div>
      </div>

      <div className="steps">
        {['Pick file', 'Check columns', 'Preview changes', 'Done'].map((s, i) => (
          <span key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>{i + 1}. {s}</span>
        ))}
      </div>

      <div className="stack">
        <section className="panel">
          <div className="panel-body row wrap" style={{ gap: 18 }}>
            <div className="field"><span>Importing into</span>
              <div className="seg">
                <button className={target === 'parts' ? 'on' : ''} onClick={() => { setTarget('parts'); setFile(null) }}>Parts</button>
                <button className={target === 'wholegoods' ? 'on' : ''} onClick={() => { setTarget('wholegoods'); setFile(null) }}>Wholegoods</button>
                <button className={target === 'customers' ? 'on' : ''} onClick={() => { setTarget('customers'); setFile(null) }}>Customers</button>
              </div></div>
            {target !== 'customers' && <label className="field" style={{ minWidth: 220 }}><span>Manufacturer line</span>
              <select className="select" value={line} onChange={(e) => setLine(e.target.value)}>
                {db.lines.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select></label>}
            <span className="spacer" />
            <button className="btn ghost sm" onClick={template}>Download a blank template</button>
          </div>
        </section>

        {/* Step 1 — file */}
        <div className={`drop ${over ? 'over' : ''}`} onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) load(f) }}>
          <input ref={inputRef} type="file" hidden accept=".csv,.txt,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = '' }} />
          {busy ? <b>Reading file…</b> : file ? (
            <div><b>{file.fileName}</b> · {(rows.length - headerRow - 1).toLocaleString()} data rows<div className="small muted">Click or drop to choose a different file</div></div>
          ) : (
            <div><b>Drop a .csv or .xlsx file here</b> or click to browse<div className="small muted" style={{ marginTop: 4 }}>Columns can be in any order with any names. You'll match them up next.</div></div>
          )}
        </div>
        {error && <div className="flag" style={{ padding: '8px 12px', fontSize: 13 }}>{error}</div>}

        {/* Step 2 — mapping */}
        {file && (
          <section className="panel">
            <div className="panel-head"><h2>Match your columns</h2><span className="spacer" />
              {file.sheets.length > 1 && (
                <select className="select" style={{ width: 200 }} value={sheetIdx} onChange={(e) => { const si = Number(e.target.value); setSheetIdx(si); const hr = findHeaderRow(file.sheets[si].rows, fields); remap(hr, si) }}>
                  {file.sheets.map((s, i) => <option key={i} value={i}>Sheet: {s.name} ({s.rows.length} rows)</option>)}
                </select>
              )}
              <label className="row small">Header row
                <input className="input" style={{ width: 64 }} type="number" min={1} value={headerRow + 1} onChange={(e) => remap(Math.max(0, Number(e.target.value) - 1))} /></label>
            </div>
            <table className="table map-table">
              <thead><tr><th style={{ width: 200 }}>ShopLine field</th><th style={{ width: 260 }}>Column in your file</th><th>First values</th></tr></thead>
              <tbody>
                {fields.map((f) => {
                  const ci = mapping[f.key] ?? -1
                  return (
                    <tr key={f.key}>
                      <td><b>{f.label}</b>{f.required && <span style={{ color: 'var(--bad)' }}> *</span>}{f.help && <div className="small muted">{f.help}</div>}</td>
                      <td><select className="select" value={ci} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}>
                        <option value={-1}>— not in file —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                      </select></td>
                      <td className="sample">{ci >= 0 ? rows.slice(headerRow + 1, headerRow + 4).map((r) => r[ci] || '∅').join('  ·  ') : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {missingRequired.length > 0 && <div className="panel-body"><div className="flag">Pick a column for {missingRequired.map((f) => f.label).join(', ')}.</div></div>}
            {target === 'parts' && !priceMapped && !missingRequired.length && <div className="panel-body"><div className="flag warn">No DP or SRP column picked, so prices won't change.</div></div>}
          </section>
        )}

        {/* Options */}
        {file && !missingRequired.length && (
          <section className="panel">
            <div className="panel-head"><h2>Options</h2></div>
            {target === 'customers' ? (
            <div className="panel-body row wrap" style={{ gap: 22 }}>
              <label className="check"><input type="checkbox" checked={copts.updateExisting} onChange={(e) => setCopts({ ...copts, updateExisting: e.target.checked })} /> Update customers already in ShopLine</label>
              <label className="check"><input type="checkbox" checked={copts.addNew} onChange={(e) => setCopts({ ...copts, addNew: e.target.checked })} /> Add new customers</label>
              <label className="check"><input type="checkbox" checked={copts.keepNumbers} onChange={(e) => setCopts({ ...copts, keepNumbers: e.target.checked })} /> Keep their customer #s</label>
              <label className="check"><input type="checkbox" checked={copts.properCaseNames} onChange={(e) => setCopts({ ...copts, properCaseNames: e.target.checked })} /> Fix ALL-CAPS names &amp; addresses (ALEX YAUK → Alex Yauk)</label>
            </div>
            ) : (
            <div className="panel-body row wrap" style={{ gap: 22 }}>
              <label className="check"><input type="checkbox" checked={opts.updatePrices} onChange={(e) => setOpts({ ...opts, updatePrices: e.target.checked })} /> Overwrite DP &amp; SRP on existing {target === 'parts' ? 'parts' : 'units'}</label>
              <label className="check"><input type="checkbox" checked={opts.addNew} onChange={(e) => setOpts({ ...opts, addNew: e.target.checked })} /> Add {target === 'parts' ? 'part numbers' : 'serials'} that aren't on file</label>
              {target === 'parts' && <>
                <label className="check"><input type="checkbox" checked={opts.overwriteDescriptions} onChange={(e) => setOpts({ ...opts, overwriteDescriptions: e.target.checked })} /> Overwrite descriptions</label>
                <label className="check" style={{ opacity: mapping.onHand >= 0 ? 1 : 0.45 }}><input type="checkbox" disabled={mapping.onHand < 0} checked={opts.overwriteQty} onChange={(e) => setOpts({ ...opts, overwriteQty: e.target.checked })} /> Overwrite on-hand quantities from file</label>
                {mapping.srp < 0 && mapping.dp >= 0 && (
                  <label className="row small">No SRP column. Set SRP = DP ×
                    <input className="input" style={{ width: 70 }} inputMode="decimal" placeholder="1.65" value={opts.srpMarkup ?? ''}
                      onChange={(e) => setOpts({ ...opts, srpMarkup: e.target.value ? Number(e.target.value) || null : null })} /></label>
                )}
              </>}
            </div>
            )}
          </section>
        )}

        {/* Step 3 — preview */}
        {plan && !done && (
          <section className="panel">
            <div className="panel-head"><h2>Preview: nothing has changed yet</h2></div>
            <div className="panel-body">
              <div className="stats" style={{ marginBottom: 6 }}>
                <div className="stat"><div className="label">Rows read</div><div className="value">{plan.p.total.toLocaleString()}</div></div>
                <div className="stat"><div className="label">Will update</div><div className="value" style={{ color: 'var(--shop)' }}>{plan.p.changes.length.toLocaleString()}</div></div>
                <div className="stat"><div className="label">Will add</div><div className="value" style={{ color: 'var(--ok)' }}>{plan.p.adds.length.toLocaleString()}</div></div>
                <div className="stat"><div className="label">Already match</div><div className="value">{plan.p.unchanged.toLocaleString()}</div></div>
                <div className="stat"><div className="label">Skipped</div><div className={`value ${plan.p.skipped.length ? 'warn' : ''}`}>{plan.p.skipped.length.toLocaleString()}</div></div>
                {plan.p.duplicates > 0 && <div className="stat"><div className="label">Duplicate rows</div><div className="value">{plan.p.duplicates.toLocaleString()}</div></div>}
              </div>
              {plan.kind === 'parts' && plan.p.changes.length > 0 && <PriceSummary changes={plan.p.changes} />}
              {plan.kind === 'cust' && <div className="small" style={{ color: 'var(--ink-2)' }}>
                {plan.p.units.length > 0 && <><b>{plan.p.units.length.toLocaleString()}</b> customer-owned units will be added from model/serial columns. </>}
                {plan.p.duplicates > 0 && <>{plan.p.duplicates.toLocaleString()} rows were extra rows for a customer already in the file (normal for equipment lists). </>}
                {plan.p.numberConflicts > 0 && <span className="flag warn">{plan.p.numberConflicts} customer #s were already taken and got new numbers</span>}
              </div>}
              <div className="seg" style={{ margin: '12px 0' }}>
                <button className={view === 'changes' ? 'on' : ''} onClick={() => setView('changes')}>Updates ({plan.p.changes.length.toLocaleString()})</button>
                <button className={view === 'adds' ? 'on' : ''} onClick={() => setView('adds')}>New ({plan.p.adds.length.toLocaleString()})</button>
                <button className={view === 'skipped' ? 'on' : ''} onClick={() => setView('skipped')}>Skipped ({plan.p.skipped.length.toLocaleString()})</button>
              </div>
              {plan.kind === 'cust' ? <CustomerPreview plan={plan.p} view={view} /> : <PreviewTable plan={plan} view={view} lineName={(c) => db.lines.find((l) => l.code === c)?.name ?? c} />}
            </div>
            <div className="modal-foot">
              {target === 'customers' ? <span className="small muted" style={{ marginRight: 'auto' }}>Customer data stays in this browser on this computer. Nothing is uploaded.</span> : <span className="small muted" style={{ marginRight: 'auto' }}>
                <LineDot color={db.lines.find((l) => l.code === line)?.color ?? '#999'} /> {db.lines.find((l) => l.code === line)?.name}{mapping.line >= 0 ? ' (or the line named in each row)' : ''}.
                {' '}Open repair orders keep the prices already quoted.
              </span>}
              <button className="btn" onClick={() => setFile(null)}>Cancel</button>
              <button className="btn primary" disabled={!plan.p.changes.length && !plan.p.adds.length} onClick={apply}>
                {!override && '🔒 '}Apply {(plan.p.changes.length + plan.p.adds.length).toLocaleString()} changes
              </button>
            </div>
          </section>
        )}

        {done && (
          <section className="panel">
            <div className="panel-body" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>Import complete</div>
              <div className="muted" style={{ margin: '6px 0 16px' }}>{done.updated.toLocaleString()} updated · {done.added.toLocaleString()} added · logged in Settings → Admin</div>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn" onClick={() => { setFile(null); setDone(null) }}>Import another file</button>
                <button className="btn primary" onClick={() => nav(target === 'parts' ? `/parts?line=${line}` : target === 'customers' ? '/customers' : `/wholegoods?line=${line}`)}>View {target === 'parts' ? 'inventory' : target}</button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function PriceSummary({ changes }: { changes: { dpDelta: number | null; srpDelta: number | null; part: { cost: number; price: number } }[] }) {
  const dp = changes.filter((c) => c.dpDelta != null)
  const up = dp.filter((c) => c.dpDelta! > 0).length
  const down = dp.filter((c) => c.dpDelta! < 0).length
  const pct = dp.filter((c) => c.part.cost > 0).map((c) => c.dpDelta! / c.part.cost)
  const avg = pct.length ? pct.reduce((a, b) => a + b, 0) / pct.length : 0
  const big = pct.filter((x) => Math.abs(x) > 0.25).length
  return (
    <div className="small" style={{ color: 'var(--ink-2)' }}>
      DP changes: <b className="delta-up">{up.toLocaleString()} up</b>, <b className="delta-down">{down.toLocaleString()} down</b>, average {avg >= 0 ? '+' : ''}{(avg * 100).toFixed(1)}%.
      {big > 0 && <> <span className="flag warn">{big} changed by more than 25%</span>. Worth a glance below (sorted biggest first).</>}
    </div>
  )
}

type AnyPlan = { kind: 'parts'; p: ReturnType<typeof planParts> } | { kind: 'wg'; p: ReturnType<typeof planWholegoods> }

function CustomerPreview({ plan, view }: { plan: ReturnType<typeof planCustomers>; view: 'changes' | 'adds' | 'skipped' }) {
  const LIMIT = 200
  if (view === 'skipped') return (
    <table className="table"><thead><tr><th style={{ width: 90 }}>Row</th><th>Reason</th></tr></thead>
      <tbody>{plan.skipped.slice(0, LIMIT).map((s, i) => <tr key={i}><td className="mono">{s.row}</td><td>{s.reason}</td></tr>)}
        {!plan.skipped.length && <tr><td colSpan={2} className="empty">Nothing skipped.</td></tr>}</tbody></table>
  )
  if (view === 'adds') return (
    <div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>Name</th><th>Category</th><th>Phones</th><th>Email</th><th>Address</th><th>Tax</th><th className="num">Units</th></tr></thead>
      <tbody>{plan.adds.slice(0, LIMIT).map((c) => (
        <tr key={c.id}><td className="mono small">{c.number}</td>
          <td><span className="cell-main">{c.name}</span>{c.isBusiness && <span className="tag" style={{ background: 'var(--shop-soft)', color: 'var(--shop)', marginLeft: 6 }}>COMMERCIAL</span>}
            {c.creditFlag && <span className="tag" style={{ background: 'var(--bad-soft)', color: 'var(--bad)', marginLeft: 6 }}>CREDIT FLAG</span>}
            {(c.contact1 || c.salesman) && <div className="small muted">{[c.contact1 && `Attn: ${c.contact1}`, c.salesman].filter(Boolean).join(' · ')}</div>}</td>
          <td className="small">{c.category ?? <span className="muted">—</span>}</td>
          <td className="small nw">{c.phone || <span className="muted">—</span>}{c.cellPhone && <div className="muted">Cell {c.cellPhone}</div>}{c.altPhone && <div className="muted">Alt {c.altPhone}</div>}</td><td className="small">{c.email}</td>
          <td className="small">{[c.address, c.address2, c.city, c.state, c.zip].filter(Boolean).join(', ')}</td>
          <td className="small">{c.taxExempt ? 'Exempt' : c.taxExempt === false ? 'Taxable' : <span className="muted">—</span>}</td>
          <td className="num">{plan.units.filter((u) => u.customerId === c.id).length || ''}</td></tr>))}
        {!plan.adds.length && <tr><td colSpan={8} className="empty">No new customers.</td></tr>}</tbody></table>
      {plan.adds.length > LIMIT && <div className="small muted" style={{ padding: 8 }}>Showing first {LIMIT} of {plan.adds.length.toLocaleString()}.</div>}</div>
  )
  return (
    <div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>Customer</th><th>What changes</th></tr></thead>
      <tbody>{plan.changes.slice(0, LIMIT).map((c) => (
        <tr key={c.id}><td className="mono small">{c.before.number}</td><td className="cell-main">{c.before.name}</td>
          <td className="small">{c.fields.map((f) => `${f}: ${String((c.before as unknown as Record<string, unknown>)[f] ?? '—') || '—'} → ${String((c.next as Record<string, unknown>)[f])}`).join(' · ')}</td></tr>))}
        {!plan.changes.length && <tr><td colSpan={3} className="empty">No existing customers change.</td></tr>}</tbody></table></div>
  )
}

function PreviewTable({ plan, view, lineName }: { plan: AnyPlan; view: 'changes' | 'adds' | 'skipped'; lineName: (c: string) => string }) {
  const LIMIT = 200
  if (view === 'skipped') {
    return (
      <table className="table"><thead><tr><th style={{ width: 90 }}>Row</th><th>Reason</th></tr></thead>
        <tbody>{plan.p.skipped.slice(0, LIMIT).map((s, i) => <tr key={i}><td className="mono">{s.row}</td><td>{s.reason}</td></tr>)}
          {!plan.p.skipped.length && <tr><td colSpan={2} className="empty">Nothing skipped.</td></tr>}</tbody></table>
    )
  }
  if (plan.kind === 'parts') {
    if (view === 'adds') return (
      <div className="table-wrap"><table className="table"><thead><tr><th>Part #</th><th>Description</th><th>Line</th><th className="num">DP</th><th className="num">SRP</th></tr></thead>
        <tbody>{plan.p.adds.slice(0, LIMIT).map((a) => <tr key={a.id}><td className="mono small">{a.partNo}</td><td>{a.description}</td><td className="small">{lineName(a.line)}</td><td className="num">{money(a.cost)}</td><td className="num">{money(a.price)}</td></tr>)}
          {!plan.p.adds.length && <tr><td colSpan={5} className="empty">No new parts.</td></tr>}</tbody></table>
        {plan.p.adds.length > LIMIT && <div className="small muted" style={{ padding: 8 }}>Showing first {LIMIT} of {plan.p.adds.length.toLocaleString()}.</div>}</div>
    )
    const sorted = [...plan.p.changes].sort((a, b) => Math.abs((b.dpDelta ?? 0) / (b.part.cost || 1)) - Math.abs((a.dpDelta ?? 0) / (a.part.cost || 1)))
    return (
      <div className="table-wrap"><table className="table"><thead><tr><th>Part #</th><th>Description</th><th className="num">DP now</th><th className="num">DP new</th><th className="num">SRP now</th><th className="num">SRP new</th><th>Other</th></tr></thead>
        <tbody>{sorted.slice(0, LIMIT).map((c) => (
          <tr key={c.part.id}>
            <td className="mono small">{c.part.partNo}</td><td className="small">{c.next.description ?? c.part.description}</td>
            <td className="num muted">{money(c.part.cost)}</td>
            <td className={`num ${c.dpDelta == null ? 'muted' : c.dpDelta > 0 ? 'delta-up' : 'delta-down'}`}>{c.next.cost != null ? money(c.next.cost) : '—'}{c.dpDelta != null && c.part.cost > 0 && <div className="small">{c.dpDelta > 0 ? '+' : ''}{((c.dpDelta / c.part.cost) * 100).toFixed(0)}%</div>}</td>
            <td className="num muted">{money(c.part.price)}</td>
            <td className={`num ${c.srpDelta == null ? 'muted' : c.srpDelta > 0 ? 'delta-up' : 'delta-down'}`}>{c.next.price != null ? money(c.next.price) : '—'}</td>
            <td className="small">{[c.next.onHand != null && `qty ${c.part.onHand}→${c.next.onHand}`, c.next.supersededBy && `→ ${c.next.supersededBy}`, c.next.bin && `bin ${c.next.bin}`].filter(Boolean).join(' · ')}</td>
          </tr>))}
          {!sorted.length && <tr><td colSpan={7} className="empty">No existing parts change.</td></tr>}</tbody></table>
        {sorted.length > LIMIT && <div className="small muted" style={{ padding: 8 }}>Showing the {LIMIT} biggest changes of {sorted.length.toLocaleString()}.</div>}</div>
    )
  }
  // wholegoods
  if (view === 'adds') return (
    <table className="table"><thead><tr><th>Model</th><th>Description</th><th>Serial</th><th>Category</th><th className="num">DP</th><th className="num">SRP</th></tr></thead>
      <tbody>{plan.p.adds.slice(0, LIMIT).map((a) => <tr key={a.id}><td className="mono small">{a.model}</td><td>{a.description}</td><td className="mono small">{a.serial || '—'}</td><td className="small">{a.category}</td><td className="num">{money(a.dp)}</td><td className="num">{money(a.srp)}</td></tr>)}
        {!plan.p.adds.length && <tr><td colSpan={6} className="empty">No new units.</td></tr>}</tbody></table>
  )
  return (
    <table className="table"><thead><tr><th>Serial</th><th>Model</th><th className="num">DP</th><th className="num">SRP</th></tr></thead>
      <tbody>{plan.p.changes.slice(0, LIMIT).map((c) => <tr key={c.wg.id}><td className="mono small">{c.wg.serial}</td><td>{c.wg.model}</td>
        <td className="num">{money(c.wg.dp)} → {money(c.next.dp ?? c.wg.dp)}</td><td className="num">{money(c.wg.srp)} → {money(c.next.srp ?? c.wg.srp)}</td></tr>)}
        {!plan.p.changes.length && <tr><td colSpan={4} className="empty">No existing units change.</td></tr>}</tbody></table>
  )
}
