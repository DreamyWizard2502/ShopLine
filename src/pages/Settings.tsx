import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { buildIndex, ensureCashCustomer, findDuplicates } from '../lib/customerSearch'
import { useStore } from '../lib/store'
import type { DB, DupSignal, DuplicateRules, Staff, Line, JobType, JobField, JobFieldType, JobIcon } from '../lib/types'
import { DEFAULT_JOB_TYPES, newJobCode } from '../lib/jobs'
import { JobGlyph } from '../components/ui'
import { fmtDateTime, uid } from '../lib/calc'
import { DB_VERSION, defaultSettings } from '../lib/seed'
import { download } from '../lib/importer'
import { DraftNumber, DraftText } from '../components/fields'
import { Modal } from '../components/ui'
import { LineDot } from '../components/lines'
import { requestOverride } from '../components/override'

export default function SettingsPage() {
  const { db, mutate, resetDemo, override, audit } = useStore()
  const s = db.settings
  const [confirmReset, setConfirmReset] = useState(false)
  const [zeroOpen, setZeroOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const loc = useLocation()
  // Links like /settings#job-types land on that panel.
  useEffect(() => {
    if (!loc.hash) return
    const t = setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    return () => clearTimeout(t)
  }, [loc.hash])
  const set = (fn: (x: typeof s) => void) => mutate((d) => { fn(d.settings) })
  const setStaff = (id: string, fn: (x: Staff) => void) => mutate((d) => { fn(d.staff.find((x) => x.id === id)!) })
  const setLine = (code: string, fn: (x: Line) => void) => mutate((d) => { fn(d.lines.find((x) => x.code === code)!) })

  const exportBackup = () => download(`shopline-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(db), 'application/json')
  const importBackup = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as DB
      if (!Array.isArray(data.ros) || !data.settings) throw new Error('bad file')
      if (data.version > DB_VERSION) throw new Error('newer')
      mutate((d) => { Object.assign(d, data) })
      setMsg(`Restored ${data.ros.length} repair orders from ${f.name}. Reload the page to finish.`)
    } catch {
      setMsg('That file is not a ShopLine backup.')
    }
  }

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Saved automatically in this browser.</div></div></div>
      <div className="stack">
        <section className="panel">
          <div className="panel-head"><h2>Shop</h2></div>
          <div className="panel-body grid2">
            <label className="field"><span>Shop name (prints on invoices)</span><DraftText value={s.shopName} onCommit={(v) => set((x) => { x.shopName = v })} /></label>
            <label className="field"><span>Phone</span><DraftText value={s.shopPhone} onCommit={(v) => set((x) => { x.shopPhone = v })} /></label>
            <label className="field"><span>Address</span><DraftText value={s.shopAddress} onCommit={(v) => set((x) => { x.shopAddress = v })} /></label>
            <label className="field"><span>Fax (optional)</span><DraftText value={s.shopFax} onCommit={(v) => set((x) => { x.shopFax = v })} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Invoice terms (prints at the bottom of every estimate &amp; invoice)</span>
              <DraftText multiline value={s.invoiceTerms} onCommit={(v) => set((x) => { x.invoiceTerms = v })} /></label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Rates &amp; tax</h2></div>
          <div className="panel-body grid3">
            <label className="field"><span>Shop labor rate ($/hr)</span><DraftNumber value={s.laborRate} decimals={2} width={120} onCommit={(v) => set((x) => { x.laborRate = v })} /></label>
            <label className="field"><span>Sales tax rate (%)</span><DraftNumber value={+(s.taxRate * 100).toFixed(4)} width={120} onCommit={(v) => set((x) => { x.taxRate = v / 100 })} /></label>
            <label className="field"><span>Shop supplies (% of labor)</span><DraftNumber value={s.shopSuppliesPct} width={120} onCommit={(v) => set((x) => { x.shopSuppliesPct = v })} /></label>
            <label className="check"><input type="checkbox" checked={s.taxLabor} onChange={(e) => set((x) => { x.taxLabor = e.target.checked })} /> Charge tax on labor</label>
          </div>
          <div className="panel-body small muted" style={{ paddingTop: 0 }}>New labor lines use the shop rate. Changing it doesn't touch existing ROs.</div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Flags</h2></div>
          <div className="panel-body grid3">
            <label className="field"><span>RO stale after (days idle)</span><DraftNumber value={s.staleDays} width={120} onCommit={(v) => set((x) => { x.staleDays = Math.round(v) })} /></label>
            <label className="field"><span>Flag parts waits over (days)</span><DraftNumber value={s.partsWaitDays} width={120} onCommit={(v) => set((x) => { x.partsWaitDays = Math.round(v) })} /></label>
            <label className="field"><span>Wholegoods aged after (days)</span><DraftNumber value={s.agedUnitDays} width={120} onCommit={(v) => set((x) => { x.agedUnitDays = Math.round(v) })} /></label>
          </div>
        </section>

        <section className="panel" id="forgotten">
          <div className="panel-head"><h2>Forgotten orders &amp; archive</h2></div>
          <div className="panel-body grid3">
            <label className="field"><span>Ready, not picked up: forgotten after (days)</span><DraftNumber value={s.pickupForgottenDays} width={120} onCommit={(v) => set((x) => { x.pickupForgottenDays = Math.max(1, Math.round(v)) })} /></label>
            <label className="field"><span>Suggest “abandoned” after (days ready)</span><DraftNumber value={s.abandonedDays} width={120} onCommit={(v) => set((x) => { x.abandonedDays = Math.max(1, Math.round(v)) })} /></label>
            <label className="field"><span>Estimate / awaiting OK: forgotten after (days)</span><DraftNumber value={s.estimateForgottenDays} width={120} onCommit={(v) => set((x) => { x.estimateForgottenDays = Math.max(1, Math.round(v)) })} /></label>
            <label className="field"><span>Archiving more than this many at once needs the master PIN</span><DraftNumber value={s.archivePinOver} step={1} width={120} onCommit={(v) => set((x) => { x.archivePinOver = Math.max(0, Math.round(v)) })} /></label>
          </div>
          <div className="panel-body small muted" style={{ paddingTop: 0 }}>Anything else open with no activity for the “stale” days above also counts as forgotten. Archived orders aren’t billed or deleted; they leave the board and can be restored from Orders → Archived.</div>
        </section>

        <JobTypesPanel />

        <DuplicateRulesPanel />

        <section className="panel">
          <div className="panel-head"><h2>Accounts receivable</h2></div>
          <div className="panel-body grid3">
            <label className="field"><span>Default terms (days until past due)</span><DraftNumber value={s.arTermsDays} width={120} onCommit={(v) => set((x) => { x.arTermsDays = Math.max(0, Math.round(v)) })} /></label>
            <label className="field"><span>Statements close on</span>
              <select className="select" value={s.statementDay} onChange={(e) => set((x) => { x.statementDay = Number(e.target.value) })}>
                <option value={0}>Last day of the month</option>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Day {d}</option>)}
              </select></label>
            <label className="field"><span>Skip statements under ($, unless there was activity)</span><DraftNumber value={s.statementMinBalance} decimals={2} width={120} onCommit={(v) => set((x) => { x.statementMinBalance = Math.max(0, v) })} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Message printed on every statement</span>
              <DraftText multiline value={s.statementMessage} onCommit={(v) => set((x) => { x.statementMessage = v })} /></label>
            <label className="check" style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={s.arWarnAtWriteUp} onChange={(e) => set((x) => { x.arWarnAtWriteUp = e.target.checked })} /> Show the account’s balance, past due and credit limit when writing up a repair order</label>
            <label className="check" style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={s.arAckOverLimit} disabled={!s.arWarnAtWriteUp} onChange={(e) => set((x) => { x.arAckOverLimit = e.target.checked })} /> Past due or over limit: the counter must tick “I checked with the office” before the RO can be created (master override skips it)</label>
          </div>
          <div className="panel-body small muted" style={{ paddingTop: 0 }}>
            A customer’s own terms (on their record) override the default. Aging is by invoice date: Current (0–30), 31–60, 61–90, Over 90. Set a customer’s A/R type to “Balance Forward” for balance-forward statements; anything else is open item.
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Manufacturer lines</h2><span className="spacer" />
            <button className="btn sm" onClick={() => mutate((d) => { d.lines.push({ code: 'NEW' + d.lines.length, name: 'New line', color: '#1c6dd0', carriesWholegoods: true }) })}>+ Add line</button></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 50 }}>Color</th><th>Name</th><th>Code</th><th className="num">Parts</th><th className="num">Units</th><th>Sells wholegoods</th></tr></thead>
              <tbody>
                {db.lines.map((l) => (
                  <tr key={l.code}>
                    <td><input type="color" value={l.color} aria-label="Line color" onChange={(e) => setLine(l.code, (x) => { x.color = e.target.value })} style={{ width: 32, height: 26, border: 0, background: 'none', padding: 0 }} /></td>
                    <td><DraftText value={l.name} ariaLabel="Line name" onCommit={(v) => v.trim() && setLine(l.code, (x) => { x.name = v.trim() })} /></td>
                    <td className="mono small">{l.code}</td>
                    <td className="num">{db.parts.filter((p) => p.line === l.code).length.toLocaleString()}</td>
                    <td className="num">{db.wholegoods.filter((w) => w.line === l.code).length}</td>
                    <td><input type="checkbox" checked={l.carriesWholegoods} onChange={(e) => setLine(l.code, (x) => { x.carriesWholegoods = e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Staff</h2><span className="spacer" />
            <button className="btn sm" onClick={() => mutate((d) => { d.staff.push({ id: uid(), name: 'New person', role: 'tech', active: true }) })}>+ Add person</button></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Role</th><th>Active</th></tr></thead>
              <tbody>
                {db.staff.map((p) => (
                  <tr key={p.id}>
                    <td><DraftText value={p.name} ariaLabel="Name" onCommit={(v) => setStaff(p.id, (x) => { x.name = v })} /></td>
                    <td><select className="select" value={p.role} onChange={(e) => setStaff(p.id, (x) => { x.role = e.target.value as Staff['role'] })}>
                      <option value="tech">Tech</option><option value="counter">Counter</option><option value="manager">Manager</option></select></td>
                    <td><input type="checkbox" checked={p.active} disabled={p.id === db.currentUserId} onChange={(e) => setStaff(p.id, (x) => { x.active = e.target.checked })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Backup</h2></div>
          <div className="panel-body stack">
            <div className="small muted">Everything lives in this browser's storage. Export a backup before clearing browser data or moving computers.</div>
            <div className="row wrap">
              <button className="btn" onClick={exportBackup}>Export backup (.json)</button>
              <button className="btn" onClick={() => fileRef.current?.click()}>Restore from backup…</button>
              <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importBackup(f); e.target.value = '' }} />
            </div>
            {msg && <div className="small">{msg}</div>}
          </div>
        </section>

        {/* Tucked away on purpose. */}
        <details className="admin">
          <summary>Admin tools: override PIN, import history, audit log, clear sample data, danger zone</summary>
          <div className="panel-body stack">
            {!override && (
              <div className="row" style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 8 }}>
                <span>🔒 These tools need master override.</span><span className="spacer" />
                <button className="btn primary sm" onClick={requestOverride}>Unlock…</button>
              </div>
            )}

            <fieldset disabled={!override} className="stack" style={{ border: 0, padding: 0, margin: 0, opacity: override ? 1 : 0.55 }}>
              <div className="grid2">
                <label className="field"><span>Manager override PIN</span>
                  <DraftText className="input mono" value={override ? s.overridePin : '••••'} onCommit={(v) => {
                    if (v.trim().length >= 4) { set((x) => { x.overridePin = v.trim() }); audit('Changed override PIN') }
                  }} /></label>
                <div className="small muted" style={{ alignSelf: 'end', paddingBottom: 8 }}>4+ characters. Anyone with the PIN can do anything, so share it carefully.</div>
              </div>

              <div>
                <h3 style={{ margin: '6px 0' }}>Import history</h3>
                <table className="table">
                  <thead><tr><th>When</th><th>Who</th><th>File</th><th>Into</th><th className="num">Updated</th><th className="num">Added</th><th className="num">Skipped</th></tr></thead>
                  <tbody>
                    {db.importLog.slice(0, 30).map((x) => (
                      <tr key={x.id}><td className="small nw">{fmtDateTime(x.at)}</td><td className="small">{x.user}</td><td className="small">{x.fileName}</td>
                        <td className="small nw"><LineDot color={db.lines.find((l) => l.code === x.line)?.color ?? '#999'} /> {db.lines.find((l) => l.code === x.line)?.name ?? x.line} {x.target}</td>
                        <td className="num">{x.updated.toLocaleString()}</td><td className="num">{x.added.toLocaleString()}</td><td className="num">{x.skipped.toLocaleString()}</td></tr>
                    ))}
                    {!db.importLog.length && <tr><td colSpan={7} className="empty">No imports yet.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div>
                <h3 style={{ margin: '6px 0' }}>Audit log <span className="small muted">(overrides, imports, quantity changes, deletes)</span></h3>
                <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
                  <table className="table">
                    <tbody>
                      {db.auditLog.slice(0, 200).map((x) => <tr key={x.id}><td className="small nw muted" style={{ width: 170 }}>{fmtDateTime(x.at)}</td><td className="small nw" style={{ width: 90 }}>{x.user}</td><td className="small">{x.action}</td></tr>)}
                      {!db.auditLog.length && <tr><td className="empty">Nothing logged yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="danger-zone stack">
                <div>
                  <h3>Zero out on-hand inventory</h3>
                  <div className="small">Sets every part's on-hand quantity to 0, for one line or all of them. Prices, part numbers and history stay. Use it when the counts are too far off to trust and you're starting a fresh physical count.</div>
                </div>
                <div className="row"><button type="button" className="btn danger" onClick={() => setZeroOpen(true)}>Zero out inventory…</button></div>
                <div>
                  <h3>Clear sample data (go live)</h3>
                  <div className="small">Empties the demo shop so you can import real customers, parts and units without fake records mixed in. Settings, lines and staff stay.</div>
                </div>
                <div className="row"><button type="button" className="btn danger" onClick={() => setClearOpen(true)}>Clear sample data…</button></div>
                <div>
                  <h3>Reset to demo data</h3>
                  <div className="small">Erases everything in this browser and reloads the sample shop.</div>
                </div>
                <div className="row"><button type="button" className="btn danger" onClick={() => setConfirmReset(true)}>Reset to demo data…</button></div>
              </div>
            </fieldset>
          </div>
        </details>
      </div>

      {zeroOpen && <ZeroModal onClose={() => setZeroOpen(false)} onBackup={exportBackup} onZero={(code) => {
        const affected = db.parts.filter((p) => (!code || p.line === code) && p.onHand !== 0).length
        mutate((d) => { for (const p of d.parts) if (!code || p.line === code) p.onHand = 0 })
        const name = code ? db.lines.find((l) => l.code === code)?.name : 'ALL lines'
        audit(`ZEROED on-hand inventory for ${name} (${affected.toLocaleString()} parts changed)`)
        setMsg(''); setZeroOpen(false)
      }} />}
      {clearOpen && <ClearModal onClose={() => setClearOpen(false)} onBackup={exportBackup} onClear={(what) => {
        mutate((d) => {
          if (what.customers) { d.customers = []; d.units = []; d.ros = []; d.nextCustomerNumber = 1001; d.nextRONumber = 10001
            d.ar = []; d.notDuplicates = []
            ensureCashCustomer(d)
            for (const w of d.wholegoods) { w.soldToCustomerId = null; w.customerUnitId = null } }
          if (what.wholegoods) d.wholegoods = []
          if (what.parts) d.parts = []
        })
        audit(`Cleared sample data: ${Object.entries(what).filter(([, v]) => v).map(([k]) => k).join(', ')}`)
        setClearOpen(false); setMsg('Sample data cleared.')
      }} />}
      {confirmReset && (
        <Modal title="Reset to demo data?" onClose={() => setConfirmReset(false)}
          footer={<><button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
            <button className="btn primary" onClick={() => { resetDemo(); setConfirmReset(false) }}>Erase and reset</button></>}>
          This erases every customer, unit, part and repair order in this browser and reloads the sample shop.
        </Modal>
      )}
    </div>
  )
}

function ZeroModal({ onClose, onZero, onBackup }: { onClose: () => void; onZero: (line: string) => void; onBackup: () => void }) {
  const { db } = useStore()
  const [line, setLine] = useState('')
  const [typed, setTyped] = useState('')
  const affected = db.parts.filter((p) => (!line || p.line === line) && p.onHand !== 0)
  const units = affected.reduce((a, p) => a + p.onHand, 0)
  return (
    <Modal title="Zero out on-hand inventory" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }} disabled={typed !== 'ZERO'} onClick={() => onZero(line)}>Zero {affected.length.toLocaleString()} parts</button></>}>
      <label className="field"><span>Which line</span>
        <select className="select" value={line} onChange={(e) => setLine(e.target.value)}>
          <option value="">All lines</option>
          {db.lines.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select></label>
      <div><b>{affected.length.toLocaleString()}</b> parts currently show <b>{units.toLocaleString()}</b> units on hand. All of them will go to 0.</div>
      <div className="row"><button className="btn sm" onClick={onBackup}>Download a backup first</button><span className="small muted">Recommended. You can restore it in Settings.</span></div>
      <label className="field"><span>Type ZERO to confirm</span><input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} /></label>
    </Modal>
  )
}

function ClearModal({ onClose, onClear, onBackup }: {
  onClose: () => void; onBackup: () => void
  onClear: (what: { customers: boolean; wholegoods: boolean; parts: boolean }) => void
}) {
  const { db } = useStore()
  const [what, setWhat] = useState({ customers: true, wholegoods: true, parts: false })
  const [typed, setTyped] = useState('')
  return (
    <Modal title="Clear sample data" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }} disabled={typed !== 'CLEAR' || !(what.customers || what.wholegoods || what.parts)} onClick={() => onClear(what)}>Clear</button></>}>
      <label className="check"><input type="checkbox" checked={what.customers} onChange={(e) => setWhat({ ...what, customers: e.target.checked })} />
        Customers, their units, and all repair orders <span className="muted small">({db.customers.length.toLocaleString()} customers · {db.ros.length} ROs)</span></label>
      <label className="check"><input type="checkbox" checked={what.wholegoods} onChange={(e) => setWhat({ ...what, wholegoods: e.target.checked })} />
        Wholegoods <span className="muted small">({db.wholegoods.length} units)</span></label>
      <label className="check"><input type="checkbox" checked={what.parts} onChange={(e) => setWhat({ ...what, parts: e.target.checked })} />
        Parts catalog <span className="muted small">({db.parts.length.toLocaleString()} parts; leave unchecked if you already imported real price files)</span></label>
      <div className="row"><button className="btn sm" onClick={onBackup}>Download a backup first</button></div>
      <label className="field"><span>Type CLEAR to confirm</span><input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} /></label>
    </Modal>
  )
}

const SIGNAL_LABEL: Record<DupSignal, string> = { name: 'Name', phone: 'Any phone number', address: 'Street address + ZIP', email: 'Email' }

/** Settings → Duplicate customers & merging. Changes apply to the look-up immediately. */
function DuplicateRulesPanel() {
  const { db, mutate, override, audit } = useStore()
  const r = db.settings.dupRules
  const set = (fn: (x: DuplicateRules) => void) => mutate((d) => { fn(d.settings.dupRules) })
  const on = (Object.keys(r.signals) as DupSignal[]).filter((k) => r.signals[k])
  const pairs = (() => {
    const m = findDuplicates(buildIndex(db), r, db.notDuplicates)
    let n = 0; for (const v of m.values()) n += v.length
    return n / 2
  })()
  return (
    <section className="panel" id="duplicates">
      <div className="panel-head"><h2>Duplicate customers &amp; merging</h2><span className="spacer" />
        <a className="btn sm" href="#/customers?attn=1">{pairs} possible duplicate pair{pairs === 1 ? '' : 's'} →</a></div>
      <div className="panel-body stack">
        <label className="check"><input type="checkbox" checked={r.enabled} onChange={(e) => set((x) => { x.enabled = e.target.checked })} /> Flag possible duplicates in the customer look-up</label>
        <fieldset disabled={!r.enabled} className="stack" style={{ border: 0, padding: 0, margin: 0, opacity: r.enabled ? 1 : 0.55 }}>
          <div>
            <div className="small" style={{ fontWeight: 600, color: 'var(--ink-2)', marginBottom: 4 }}>Compare these fields</div>
            <div className="row wrap" style={{ gap: 16 }}>
              {(Object.keys(SIGNAL_LABEL) as DupSignal[]).map((k) => (
                <label key={k} className="check"><input type="checkbox" checked={r.signals[k]} onChange={(e) => set((x) => { x.signals[k] = e.target.checked })} /> {SIGNAL_LABEL[k]}</label>
              ))}
            </div>
          </div>
          <div className="grid3">
            <label className="field"><span>Flag when at least this many match</span>
              <select className="select" value={Math.min(r.minSignals, Math.max(1, on.length))} onChange={(e) => set((x) => { x.minSignals = Number(e.target.value) })}>
                {[1, 2, 3, 4].filter((n) => n <= Math.max(1, on.length)).map((n) => <option key={n} value={n}>{n} of the {on.length} checked</option>)}
              </select></label>
            <label className="field"><span>Phone digits to compare</span>
              <select className="select" value={r.phoneDigits} onChange={(e) => set((x) => { x.phoneDigits = Number(e.target.value) as 7 | 10 })}>
                <option value={7}>Last 7 (ignore area code)</option><option value={10}>All 10</option>
              </select></label>
            <label className="field"><span>Words to ignore in names</span>
              <DraftText value={r.ignoreWords} placeholder="the, inc, llc" onCommit={(v) => set((x) => { x.ignoreWords = v })} /></label>
          </div>
          <label className="check"><input type="checkbox" checked={r.nameRequired} disabled={!r.signals.name} onChange={(e) => set((x) => { x.nameRequired = e.target.checked })} /> The name must be one of the matches <span className="muted small">(stops family members who share a phone from being flagged)</span></label>
        </fieldset>
        <div className="row wrap" style={{ gap: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <label className="check">
            <input type="checkbox" checked={r.mergeNeedsOverride} disabled={!override} onChange={(e) => { set((x) => { x.mergeNeedsOverride = e.target.checked }); audit(`Merging ${e.target.checked ? 'now needs' : 'no longer needs'} master override`) }} />
            Merging customers needs master override {!override && <span className="muted small">(turn on override to change)</span>}</label>
          <span className="spacer" />
          <span className="small muted">{db.notDuplicates.length} pair{db.notDuplicates.length === 1 ? '' : 's'} marked “not a duplicate”</span>
          <button className="btn sm" disabled={!db.notDuplicates.length} onClick={() => { mutate((d) => { d.notDuplicates = [] }); audit('Cleared all “not a duplicate” marks') }}>Clear marks</button>
          <button className="btn sm" onClick={() => mutate((d) => { d.settings.dupRules = { ...defaultSettings.dupRules, mergeNeedsOverride: d.settings.dupRules.mergeNeedsOverride } })}>Restore defaults</button>
        </div>
      </div>
    </section>
  )
}

/* ---------------- Quick tickets (job types) ---------------- */
const ICONS: JobIcon[] = ['chain', 'blade', 'tire', 'wrench', 'spark', 'tag']
const FIELD_TYPES: Record<JobFieldType, string> = { select: 'Pick list', text: 'Text', number: 'Number', yesno: 'Yes / no' }

function JobTypesPanel() {
  const { db, mutate, audit } = useStore()
  const [open, setOpen] = useState<string | null>(null)
  const jobs = db.settings.jobTypes
  const setJob = (code: string, fn: (j: JobType) => void) => mutate((d) => { fn(d.settings.jobTypes.find((j) => j.code === code)!) })
  const add = () => {
    const code = newJobCode('New job', jobs.map((j) => j.code))
    mutate((d) => { d.settings.jobTypes.push({ code, name: 'New job', ticketName: 'New job', icon: 'wrench', active: true, unitRequired: false, skipDiagnose: true, promiseHours: 24, qtyLabel: 'items', fields: [], presets: [{ id: uid(), label: 'Service', price: 10, taxable: true }] }) })
    setOpen(code)
  }
  return (
    <section className="panel" id="job-types">
      <div className="panel-head"><h2>Quick tickets</h2><span className="spacer" />
        <button className="btn sm" onClick={() => { mutate((d) => { const have = new Set(d.settings.jobTypes.map((j) => j.code)); for (const j of DEFAULT_JOB_TYPES) if (!have.has(j.code)) d.settings.jobTypes.push(structuredClone(j)) }); audit('Restored missing default job types') }}>Restore defaults</button>
        <button className="btn sm" onClick={add}>+ Add job type</button></div>
      <div className="panel-body small muted" style={{ paddingBottom: 0 }}>These are the tiles on “New ticket” next to Repair order and Estimate. Each has its own detail fields and flat-rate services. Old tickets keep the prices they were written at.</div>
      <div className="panel-body stack" style={{ gap: 8 }}>
        {jobs.map((j) => (
          <div key={j.code} className="cr-card">
            <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === j.code ? null : j.code)}>
              <span className="tk-ico sm"><JobGlyph icon={j.icon} size={18} /></span>
              <b>{j.name}</b><span className="muted small">{j.presets.length} service{j.presets.length === 1 ? '' : 's'} · {j.fields.length} field{j.fields.length === 1 ? '' : 's'}{!j.active && ' · hidden'}</span>
              <span className="spacer" /><span className="small muted">{open === j.code ? 'Close ▲' : 'Edit ▼'}</span>
            </div>
            {open === j.code && <JobEditor j={j} set={(fn) => setJob(j.code, fn)} onRemove={() => {
              const used = db.ros.some((r) => r.kind === j.code)
              if (used) { setJob(j.code, (x) => { x.active = false }); audit(`Hid job type ${j.name} (it has tickets)`); return }
              mutate((d) => { d.settings.jobTypes = d.settings.jobTypes.filter((x) => x.code !== j.code) }); audit(`Removed job type ${j.name}`); setOpen(null)
            }} used={db.ros.some((r) => r.kind === j.code)} />}
          </div>
        ))}
      </div>
    </section>
  )
}

function JobEditor({ j, set, onRemove, used }: { j: JobType; set: (fn: (j: JobType) => void) => void; onRemove: () => void; used: boolean }) {
  const setField = (i: number, fn: (f: JobField) => void) => set((x) => { fn(x.fields[i]) })
  const move = <T,>(arr: T[], i: number, d: number) => { const k = i + d; if (k < 0 || k >= arr.length) return; [arr[i], arr[k]] = [arr[k], arr[i]] }
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <div className="grid3">
        <label className="field"><span>Tile name</span><DraftText value={j.name} onCommit={(v) => v.trim() && set((x) => { x.name = v.trim() })} /></label>
        <label className="field"><span>Printed on the ticket as</span><DraftText value={j.ticketName} onCommit={(v) => v.trim() && set((x) => { x.ticketName = v.trim() })} /></label>
        <label className="field"><span>Counting word</span><DraftText value={j.qtyLabel} placeholder="chains" onCommit={(v) => set((x) => { x.qtyLabel = v.trim() })} /></label>
        <label className="field"><span>Default promise (hours)</span><DraftNumber value={j.promiseHours} step={1} width={100} onCommit={(v) => set((x) => { x.promiseHours = Math.round(v) })} /></label>
        <div className="field"><span>Icon</span><div className="row" style={{ gap: 4 }}>
          {ICONS.map((ic) => <button key={ic} className={`btn sm ${j.icon === ic ? 'primary' : ''}`} aria-label={ic} onClick={() => set((x) => { x.icon = ic })}><JobGlyph icon={ic} size={16} /></button>)}
        </div></div>
      </div>
      <div className="row wrap" style={{ gap: 16 }}>
        <label className="check"><input type="checkbox" checked={j.active} onChange={(e) => set((x) => { x.active = e.target.checked })} /> Show on New ticket</label>
        <label className="check"><input type="checkbox" checked={j.unitRequired} onChange={(e) => set((x) => { x.unitRequired = e.target.checked })} /> Needs a unit on file</label>
        <label className="check"><input type="checkbox" checked={j.skipDiagnose} onChange={(e) => set((x) => { x.skipDiagnose = e.target.checked })} /> Skip diagnose / awaiting OK / parts steps</label>
      </div>

      <div>
        <div className="row"><b className="small">Services (flat rate)</b><span className="spacer" />
          <button className="btn sm" onClick={() => set((x) => { x.presets.push({ id: uid(), label: 'New service', price: 0, taxable: true }) })}>+ Service</button></div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead><tr><th>Service</th><th className="num">Price each</th><th>Taxable</th><th /></tr></thead>
          <tbody>
            {j.presets.map((p, i) => (
              <tr key={p.id}>
                <td><DraftText value={p.label} ariaLabel="Service name" onCommit={(v) => v.trim() && set((x) => { x.presets[i].label = v.trim() })} /></td>
                <td className="num"><DraftNumber value={p.price} decimals={2} width={90} ariaLabel="Price" onCommit={(v) => set((x) => { x.presets[i].price = v })} /></td>
                <td><input type="checkbox" checked={p.taxable} aria-label="Taxable" onChange={(e) => set((x) => { x.presets[i].taxable = e.target.checked })} /></td>
                <td className="nw"><button className="btn ghost sm" aria-label="Move up" onClick={() => set((x) => move(x.presets, i, -1))}>↑</button>
                  <button className="btn ghost sm" aria-label="Remove service" onClick={() => set((x) => { x.presets.splice(i, 1) })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="row"><b className="small">Detail fields</b><span className="spacer" />
          <button className="btn sm" onClick={() => set((x) => { x.fields.push({ key: uid(), label: 'New field', type: 'text', options: [], placeholder: '' }) })}>+ Field</button></div>
        <table className="table" style={{ marginTop: 6 }}>
          <thead><tr><th>Label</th><th>Type</th><th>Choices (comma separated)</th><th /></tr></thead>
          <tbody>
            {j.fields.map((f, i) => (
              <tr key={f.key}>
                <td><DraftText value={f.label} ariaLabel="Field label" onCommit={(v) => v.trim() && setField(i, (x) => { x.label = v.trim() })} /></td>
                <td><select className="select" value={f.type} aria-label="Field type" onChange={(e) => setField(i, (x) => { x.type = e.target.value as JobFieldType })}>
                  {(Object.keys(FIELD_TYPES) as JobFieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPES[t]}</option>)}</select></td>
                <td>{f.type === 'select'
                  ? <DraftText value={f.options.join(', ')} ariaLabel="Choices" onCommit={(v) => setField(i, (x) => { x.options = v.split(',').map((o) => o.trim()).filter(Boolean) })} />
                  : f.type === 'yesno' ? <span className="muted small">—</span>
                  : <DraftText value={f.placeholder} placeholder="Hint shown in the box" ariaLabel="Hint" onCommit={(v) => setField(i, (x) => { x.placeholder = v })} />}</td>
                <td className="nw"><button className="btn ghost sm" aria-label="Move up" onClick={() => set((x) => move(x.fields, i, -1))}>↑</button>
                  <button className="btn ghost sm" aria-label="Remove field" onClick={() => set((x) => { x.fields.splice(i, 1) })}>✕</button></td>
              </tr>
            ))}
            {!j.fields.length && <tr><td colSpan={4} className="empty">No detail fields.</td></tr>}
          </tbody>
        </table>
      </div>
      <div><button className="btn ghost danger sm" onClick={onRemove}>{used ? 'Hide this job type (it has tickets)' : 'Remove this job type'}</button></div>
    </div>
  )
}
