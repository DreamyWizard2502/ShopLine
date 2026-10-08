import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import { CUSTOMER_CATEGORIES, fmtDate, money, roTotals } from '../lib/calc'
import {
  ATTENTION_LABEL, attentionOf, buildIndex, findDuplicates, searchCustomers, statementDelivery,
  type Attention, type CustEntry, type Dup, type Hit,
} from '../lib/customerSearch'
import { Icon, Modal, StatusBadge } from '../components/ui'
import { formatPhone } from './NewRO'

const PAGE = 50
const MAX_CHIPS = 6

// Customer look-up: search-first finder with a live preview of the selected customer.
// Layout follows the approved "ShopLine Customer Lookup" mockup.
export default function Customers() {
  const { db, createCustomer } = useStore()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  // Search text lives in local state (instant typing) and is mirrored to the URL so Back restores it.
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const cat = params.get('cat') ?? ''
  const fOpen = params.get('open') === '1'
  const fExempt = params.get('exempt') === '1'
  const fAttn = params.get('attn') === '1'
  const selParam = params.get('sel')
  const [limit, setLimit] = useState(PAGE)
  const [adding, setAdding] = useState<null | { name: string; phone: string }>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** Update URL state (so Back from a record returns to the same search). */
  const setP = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next, { replace: true })
  }
  useEffect(() => setLimit(PAGE), [q, cat, fOpen, fExempt, fAttn])

  const entries = useMemo(() => buildIndex(db), [db])
  const cash = entries.find((e) => e.c.isCash)
  const people = useMemo(() => entries.filter((e) => !e.c.isCash), [entries])
  const dups = useMemo(() => findDuplicates(people), [people])
  const attn = useMemo(() => new Map(people.map((e) => [e.c.id, attentionOf(e, dups)])), [people, dups])

  const categories = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of people) if (e.c.category) m.set(e.c.category, (m.get(e.c.category) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [people])

  const hits = useMemo(() => searchCustomers(people, q).filter(({ e }) =>
    (!cat || (cat === '—' ? !e.c.category : e.c.category === cat)) &&
    (!fOpen || e.open > 0) &&
    (!fExempt || e.c.taxExempt) &&
    (!fAttn || (attn.get(e.c.id)?.length ?? 0) > 0)), [people, q, cat, fOpen, fExempt, fAttn, attn])

  const shown = hits.slice(0, limit)
  const selIdx = Math.max(0, shown.findIndex((h) => h.e.c.id === selParam))
  const sel: Hit | undefined = shown[selIdx]
  const select = (i: number) => {
    const h = shown[Math.max(0, Math.min(shown.length - 1, i))]
    if (h) setP({ sel: h.e.c.id })
  }
  // Keep the highlighted row on screen while arrowing.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selIdx])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(selIdx + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(selIdx - 1) }
    else if (e.key === 'Enter' && sel) { e.preventDefault(); nav(e.shiftKey ? `/ro/new?customer=${sel.e.c.id}` : `/customers/${sel.e.c.id}`) }
    else if (e.key === 'Escape' && q) { e.preventDefault(); setQ(''); setP({ q: null, sel: null }) }
  }

  const chipCats = categories.slice(0, MAX_CHIPS)
  const moreCats = categories.slice(MAX_CHIPS)
  const anyFilter = !!(cat || fOpen || fExempt || fAttn)
  const attnCount = useMemo(() => [...attn.values()].filter((a) => a.length).length, [attn])
  const prefillNew = () => {
    const t = q.trim()
    const looksPhone = /^[\d\s()+\-.]+$/.test(t) && t.replace(/\D/g, '').length >= 7
    setAdding({ name: looksPhone ? '' : t, phone: looksPhone ? formatPhone(t) : '' })
  }

  return (
    <div className="page lk">
      <div className="page-head">
        <div><h1>Customers</h1><div className="sub">{people.length.toLocaleString()} customers · {db.units.length.toLocaleString()} units on file</div></div>
        <span className="spacer" />
        <Link className="btn" to="/import?target=customers">Import</Link>
        <button className="btn primary" onClick={() => setAdding({ name: '', phone: '' })}>{Icon.plus} New customer</button>
      </div>

      <div className="lk-omni">
        {Icon.search}
        <label htmlFor="lk-q" className="sr-only">Search customers</label>
        <input id="lk-q" ref={inputRef} autoFocus autoComplete="off" spellCheck={false} value={q}
          placeholder="Name, any phone, customer #, contact, email, address, serial number…"
          onChange={(e) => { setQ(e.target.value); setP({ q: e.target.value || null, sel: null }) }} onKeyDown={onKey}
          aria-controls="lk-results" aria-activedescendant={sel ? `lk-r-${sel.e.c.id}` : undefined} />
        {q && <button className="btn ghost sm" onClick={() => { setQ(''); setP({ q: null, sel: null }); inputRef.current?.focus() }} aria-label="Clear search">✕</button>}
        <span className="lk-count mono">{hits.length.toLocaleString()} of {people.length.toLocaleString()}</span>
      </div>

      <div className="lk-chips" role="group" aria-label="Filters">
        <button className={`lk-chip ${!cat ? 'on' : ''}`} onClick={() => setP({ cat: null, sel: null })}>All</button>
        {chipCats.map(([k, n]) => (
          <button key={k} className={`lk-chip ${cat === k ? 'on' : ''}`} onClick={() => setP({ cat: cat === k ? null : k, sel: null })}>
            {k} <span className="lk-chip-n">{n.toLocaleString()}</span>
          </button>
        ))}
        {moreCats.length > 0 && (
          <select className={`lk-chip lk-more ${moreCats.some(([k]) => k === cat) || cat === '—' ? 'on' : ''}`} aria-label="More categories"
            value={moreCats.some(([k]) => k === cat) || cat === '—' ? cat : ''} onChange={(e) => setP({ cat: e.target.value || null, sel: null })}>
            <option value="">More…</option>
            {moreCats.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
            <option value="—">No category</option>
          </select>
        )}
        <span className="lk-sep" />
        <Toggle on={fOpen} onClick={() => setP({ open: fOpen ? null : '1', sel: null })}>Has open order</Toggle>
        <Toggle on={fExempt} onClick={() => setP({ exempt: fExempt ? null : '1', sel: null })}>Tax exempt</Toggle>
        <Toggle on={fAttn} onClick={() => setP({ attn: fAttn ? null : '1', sel: null })}>Needs attention{attnCount > 0 && <span className="lk-chip-n">{attnCount}</span>}</Toggle>
      </div>

      <div className="lk-body">
        <section className="lk-results" aria-label="Results">
          {cash && !anyFilter && (
            <Link className="lk-cash" to={`/ro/new?customer=${cash.c.id}`}>
              <span className="mono muted">#{cash.c.number}</span>
              <b>Cash Customer</b>
              <span className="muted">Walk-in sale, no record kept</span>
              <span className="lk-cash-use">Use →</span>
            </Link>
          )}

          <div className="lk-list" id="lk-results" role="listbox" aria-label="Customers" ref={listRef}>
            {shown.map((h, i) => (
              <ResultRow key={h.e.c.id} h={h} on={i === selIdx} attn={attn.get(h.e.c.id) ?? []}
                onPick={() => { select(i); inputRef.current?.focus() }} onOpen={() => nav(`/customers/${h.e.c.id}`)} />
            ))}
            {!hits.length && (
              <div className="lk-empty">
                <div className="lk-empty-title">No customers match</div>
                <div>Try fewer words, or part of a phone number.{' '}
                  <button className="linkish" onClick={prefillNew}>Create a new customer{q.trim() && ` for “${q.trim()}”`}</button></div>
              </div>
            )}
          </div>
          {hits.length > shown.length && (
            <button className="btn lk-more-btn" onClick={() => setLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, hits.length - shown.length)} more ({(hits.length - shown.length).toLocaleString()} left)
            </button>
          )}
          <div className="lk-help small muted">
            <span className="kbd">↑</span> <span className="kbd">↓</span> move · <span className="kbd">Enter</span> open record · <span className="kbd">Shift</span>+<span className="kbd">Enter</span> new repair order · <span className="kbd">Esc</span> clear.
            Search checks names, every phone number, contacts, email, address and unit serials at once.
          </div>
        </section>

        <aside className="lk-preview panel" aria-label="Customer preview">
          {sel ? <Preview e={sel.e} attn={attn.get(sel.e.c.id) ?? []} dups={dups.get(sel.e.c.id) ?? []} people={people} />
            : <div className="empty">Select a customer to see their details.</div>}
        </aside>
      </div>

      {adding && <NewCustomerModal initial={adding} onClose={() => setAdding(null)}
        onSave={(v) => { const c = createCustomer({ ...v, notes: '' }); nav(`/customers/${c.id}`) }} />}
    </div>
  )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`lk-chip lk-toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>{children}</button>
}

const initials = (name: string) =>
  name.split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

const ATTN_CLASS: Record<Attention, string> = { credit: 'bad', duplicate: 'warn', no_phone: 'warn' }

function Pills({ c, attn }: { c: CustEntry['c']; attn: Attention[] }) {
  return (
    <>
      {c.category && <span className="lk-pill">{c.category}</span>}
      {c.taxExempt && <span className="lk-pill info">Tax exempt</span>}
      {attn.map((a) => <span key={a} className={`lk-pill ${ATTN_CLASS[a]}`}>{ATTENTION_LABEL[a]}</span>)}
    </>
  )
}

function ResultRow({ h, on, attn, onPick, onOpen }: { h: Hit; on: boolean; attn: Attention[]; onPick: () => void; onOpen: () => void }) {
  const { e, match } = h
  const reach = [...e.phones.map((p) => p.value), e.c.city].filter(Boolean).join('  ·  ')
  return (
    <div id={`lk-r-${e.c.id}`} role="option" aria-selected={on} className={`lk-row ${on ? 'on' : ''}`}
      onClick={onPick} onDoubleClick={onOpen}>
      <div className="lk-avatar" aria-hidden="true">{initials(e.c.name)}</div>
      <div className="lk-row-main">
        <div className="lk-row-top">
          <span className="lk-name">{e.c.name}</span>
          <span className="mono small muted">#{e.c.number}</span>
          <Pills c={e.c} attn={attn} />
        </div>
        <div className="lk-row-sub">{reach || <span className="muted">No phone or address on file</span>}</div>
        {match && <div className="lk-match">{match}</div>}
      </div>
      <div className="lk-row-side mono">
        <div>{e.units.length} unit{e.units.length === 1 ? '' : 's'}</div>
        <div className={e.open ? 'lk-open' : ''}>{e.open} open</div>
        <div>{e.last ? fmtDate(e.last) : 'No visits'}</div>
      </div>
    </div>
  )
}

function Preview({ e, attn, dups, people }: { e: CustEntry; attn: Attention[]; dups: Dup[]; people: CustEntry[] }) {
  const { db } = useStore()
  const nav = useNavigate()
  const c = e.c
  const ros = useMemo(() => db.ros.filter((r) => r.customerId === c.id).sort((a, b) => b.openedAt.localeCompare(a.openedAt)), [db.ros, c.id])
  const lifetime = ros.filter((r) => r.status === 'closed').reduce((a, r) => a + roTotals(r, db.settings, !!c.taxExempt).total, 0)
  const unitById = new Map(e.units.map((u) => [u.id, u]))
  const visits = (uid: string) => ros.filter((r) => r.unitId === uid).length
  const byId = (id: string) => people.find((p) => p.c.id === id)?.c
  const acct: [string, string][] = [
    ['Tax', c.taxExempt ? 'Exempt' : 'Taxable'],
    ['Pricing', c.priceLevel ?? 'Retail'],
    ['Statements', statementDelivery(c.deliveryCode) ?? '—'],
    ['A/R type', c.arType ?? '—'],
    ['Salesman', c.salesman ?? '—'],
    ['Account', c.isBusiness ? 'Commercial' : 'Personal'],
    ['Customer since', fmtDate(c.createdAt)],
    ['Lifetime', money(lifetime)],
  ]

  return (
    <div className="lk-p">
      <div className="lk-p-head">
        <div className="lk-p-title">
          <div>
            <div className="mono small muted">Customer #{c.number}</div>
            <h2>{c.name}</h2>
          </div>
          <Link className="btn" to={`/customers/${c.id}`}>Open record</Link>
        </div>
        <div className="lk-p-pills"><Pills c={c} attn={attn.filter((a) => a !== 'duplicate')} /></div>
        <div className="lk-p-actions">
          <Link className="btn primary lk-big" to={`/ro/new?customer=${c.id}`}>{Icon.plus} New repair order</Link>
          <Link className="btn lk-big" to={`/ro/new?customer=${c.id}&status=estimate`}>New estimate</Link>
        </div>
      </div>

      {dups.map((d) => {
        const o = byId(d.otherId)
        if (!o) return null
        return (
          <div key={d.otherId} className="lk-dup">
            <div><b>Possible duplicate.</b> #{o.number} {o.name} has the {d.reason}.</div>
            <Link className="btn sm" to={`/customers/${o.id}`}>Open #{o.number}</Link>
          </div>
        )
      })}

      <div className="lk-p-body">
        {c.creditFlag && <div className="lk-alert">Credit flag on this account. Check with the office before starting work.</div>}

        <section>
          <h3>Reach them</h3>
          <dl className="lk-kv">
            {e.phones.map((p) => <div key={p.label + p.value}><dt>{p.label}</dt><dd><a className="mono" href={`tel:${p.digits}`}>{p.value}</a></dd></div>)}
            {!e.phones.length && <div><dt>Phone</dt><dd className="muted">None on file</dd></div>}
            <div><dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="muted">None on file</span>}</dd></div>
            <div><dt>Address</dt><dd>{e.addrLine || <span className="muted">None on file</span>}</dd></div>
          </dl>
        </section>

        {e.contacts.length > 0 && (
          <section>
            <h3>Contacts</h3>
            <dl className="lk-kv">
              {e.contacts.map((n, i) => <div key={n + i}><dt>Contact {i + 1}</dt><dd>{n}</dd></div>)}
            </dl>
          </section>
        )}

        <section>
          <h3>Equipment on file <span className="muted">{e.units.length || ''}</span></h3>
          {e.units.length ? (
            <div className="lk-units">
              {e.units.slice(0, 5).map((u) => (
                <div key={u.id} className="lk-unit">
                  <span className="cell-main">{u.make} {u.model}</span>
                  <span className="small muted">{u.type}</span>
                  {u.serial && <span className="mono small muted">S/N {u.serial}</span>}
                  <span className="small muted lk-unit-meta">{u.engineHours != null && `${u.engineHours} hrs · `}{visits(u.id)} visit{visits(u.id) === 1 ? '' : 's'}</span>
                </div>
              ))}
              {e.units.length > 5 && <Link className="small" to={`/customers/${c.id}`}>+ {e.units.length - 5} more on the record</Link>}
            </div>
          ) : <div className="small muted">No equipment recorded yet.</div>}
        </section>

        <section>
          <h3>Recent orders <span className="muted">{ros.length || ''}</span></h3>
          {ros.length ? (
            <div className="lk-ros">
              {ros.slice(0, 4).map((r) => {
                const u = unitById.get(r.unitId)
                return (
                  <button key={r.id} className="lk-ro" onClick={() => nav(`/ro/${r.id}`)}>
                    <span className="ro-num">{r.number}</span>
                    <span className="small muted">{fmtDate(r.openedAt)}</span>
                    <span className="lk-ro-d">{u ? `${u.make} ${u.model}` : ''}{r.complaint && <span className="muted"> — {r.complaint}</span>}</span>
                    <StatusBadge status={r.status} />
                    <span className="mono small lk-ro-t">{money(roTotals(r, db.settings, !!c.taxExempt).total)}</span>
                  </button>
                )
              })}
            </div>
          ) : <div className="small muted">No repair orders yet.</div>}
        </section>

        <section>
          <h3>Notes <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>shown at write-up</span></h3>
          {c.notes ? <div className="lk-note">{c.notes}</div> : <div className="small muted">No notes yet.</div>}
        </section>

        <section>
          <h3>Account</h3>
          <div className="lk-acct">
            {acct.map(([k, v]) => <div key={k}><div className="small muted">{k}</div><div className="lk-acct-v">{v}</div></div>)}
          </div>
        </section>
      </div>
    </div>
  )
}

type NewCust = { name: string; phone: string; cellPhone?: string; email: string; isBusiness: boolean; category?: string; contact1?: string }
function NewCustomerModal({ initial, onClose, onSave }: { initial: { name: string; phone: string }; onClose: () => void; onSave: (v: NewCust) => void }) {
  const [v, setV] = useState<NewCust>({ name: initial.name, phone: initial.phone, cellPhone: '', email: '', isBusiness: false, category: '', contact1: '' })
  const ok = v.name.trim() && v.phone.replace(/\D/g, '').length === 10
  return (
    <Modal title="New customer" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={() => onSave({ ...v, name: v.name.trim(), cellPhone: v.cellPhone || undefined, category: v.category?.trim() || undefined, contact1: v.contact1?.trim() || undefined })}>Create</button></>}>
      <label className="field"><span>Name</span><input className="input" autoFocus={!initial.name} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <label className="field"><span>Phone</span><input className="input" autoFocus={!!initial.name} value={v.phone} onChange={(e) => setV({ ...v, phone: formatPhone(e.target.value) })} /></label>
      <label className="field"><span>Cell phone (optional)</span><input className="input" value={v.cellPhone} onChange={(e) => setV({ ...v, cellPhone: formatPhone(e.target.value) })} /></label>
      <label className="field"><span>Email</span><input className="input" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
      <div className="grid2" style={{ gap: 8 }}>
        <label className="field"><span>Category</span><input className="input" list="new-cust-cats" placeholder="Personal Use" value={v.category}
          onChange={(e) => setV({ ...v, category: e.target.value, isBusiness: !!e.target.value && !/personal/i.test(e.target.value) })} /></label>
        <label className="field"><span>Contact (business)</span><input className="input" value={v.contact1} onChange={(e) => setV({ ...v, contact1: e.target.value })} /></label>
      </div>
      <datalist id="new-cust-cats">{CUSTOMER_CATEGORIES.map((x) => <option key={x} value={x} />)}</datalist>
      <label className="check"><input type="checkbox" checked={v.isBusiness} onChange={(e) => setV({ ...v, isBusiness: e.target.checked })} /> Commercial account</label>
    </Modal>
  )
}
