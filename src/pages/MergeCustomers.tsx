import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import type { Customer } from '../lib/types'
import { MERGE_FIELDS, defaultPicks, mergeCustomers, mergeImpact, showField, type Picks, type Side } from '../lib/merge'
import { fmtDate } from '../lib/calc'
import { Modal } from '../components/ui'
import { requestOverride } from '../components/override'
import { CustomerSearchPick } from '../components/custpick'

// Merge two customer records into one. The "keep" record survives with its number;
// the other record's units, repair orders, sold wholegoods and A/R move onto it.
export default function MergeCustomers() {
  const { db, mutate, audit, override, currentUser } = useStore()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const keep = db.customers.find((c) => c.id === params.get('keep'))
  const other = db.customers.find((c) => c.id === params.get('remove'))
  const setIds = (k?: string, r?: string) => {
    const p = new URLSearchParams()
    if (k) p.set('keep', k)
    if (r) p.set('remove', r)
    setParams(p, { replace: true })
  }

  const pairId = `${keep?.id}|${other?.id}`
  const [picksFor, setPicksFor] = useState<{ id: string; picks: Picks } | null>(null)
  const picks: Picks = useMemo(() => {
    if (!keep || !other) return {}
    return picksFor?.id === pairId ? picksFor.picks : defaultPicks(keep, other)
  }, [keep, other, picksFor, pairId])
  const choose = (k: keyof Picks, side: Side) => setPicksFor({ id: pairId, picks: { ...picks, [k]: side } })

  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const needsOverride = db.settings.dupRules.mergeNeedsOverride && !override
  const ready = keep && other && keep.id !== other.id && !keep.isCash && !other.isCash

  const differing = keep && other ? MERGE_FIELDS.filter((f) => showField(keep, f.key) !== showField(other, f.key)) : []
  const same = MERGE_FIELDS.length - differing.length
  const impact = other ? mergeImpact(db, other.id) : null

  const doMerge = () => {
    if (!keep || !other) return
    try {
      let line = ''
      mutate((d) => { line = mergeCustomers(d, keep.id, other.id, picks, currentUser + (override ? ' (override)' : '')) })
      audit(line)
      nav(`/customers/${keep.id}`)
    } catch (e) { setError((e as Error).message); setConfirm(false) }
  }

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/customers">Customers</Link> / Merge</div>
          <h1>Merge customers</h1>
          <div className="sub">The record on the left stays. Everything from the record on the right moves onto it, then the right one is removed.</div>
        </div>
        <span className="spacer" />
        <Link className="btn" to="/settings#duplicates">Duplicate rules</Link>
      </div>

      <div className="mg-pair">
        <Slot title="Keep this record" c={keep} onClear={() => setIds(undefined, other?.id)} onPick={(c) => setIds(c.id, other?.id)} exclude={other ? [other.id] : []} />
        <button className="btn mg-swap" disabled={!keep || !other} onClick={() => setIds(other?.id, keep?.id)} aria-label="Swap which record is kept">⇄ Swap</button>
        <Slot title="Merge away (removed)" c={other} onClear={() => setIds(keep?.id)} onPick={(c) => setIds(keep?.id, c.id)} exclude={keep ? [keep.id] : []} away />
      </div>

      {(keep?.isCash || other?.isCash) && <div className="lk-alert" style={{ marginTop: 12 }}>The Cash Customer can’t be merged.</div>}

      {ready && (
        <>
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>Choose what to keep</h2><span className="spacer" /><span className="small muted">{same} field{same === 1 ? '' : 's'} already match</span></div>
            <div className="table-wrap">
              <table className="table mg-table">
                <thead><tr><th>Field</th><th>#{keep.number} (keep)</th><th>#{other.number} (merge away)</th></tr></thead>
                <tbody>
                  {differing.map((f) => (
                    <tr key={f.key}>
                      <td className="small" style={{ fontWeight: 600 }}>{f.label}</td>
                      {(['keep', 'other'] as Side[]).map((side) => {
                        const v = showField(side === 'keep' ? keep : other, f.key)
                        return (
                          <td key={side}>
                            <label className={`mg-opt ${picks[f.key] === side ? 'on' : ''}`}>
                              <input type="radio" name={f.key} checked={picks[f.key] === side} onChange={() => choose(f.key, side)} />
                              <span>{v || <span className="muted">(blank)</span>}</span>
                            </label>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {!differing.length && <tr><td colSpan={3} className="empty">Every field matches.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head"><h2>What happens</h2></div>
            <div className="panel-body">
              <ul className="mg-list">
                <li>Moves <b>{impact!.units}</b> unit{impact!.units === 1 ? '' : 's'}, <b>{impact!.ros}</b> repair order{impact!.ros === 1 ? '' : 's'}, <b>{impact!.wholegoods}</b> sold wholegood{impact!.wholegoods === 1 ? '' : 's'} and <b>{impact!.ar}</b> A/R entr{impact!.ar === 1 ? 'y' : 'ies'} to #{keep.number}.</li>
                <li>Phone numbers #{keep.number} doesn’t already have fill its empty phone slots; any left over go into its notes.</li>
                <li>Both records’ notes are kept. The earlier “customer since” date is kept ({fmtDate(keep.createdAt < other.createdAt ? keep.createdAt : other.createdAt)}).</li>
                <li>#{other.number} is removed. Searching <span className="mono">{other.number}</span> still finds #{keep.number}, and the merge is written to the audit log.</li>
                <li>This can’t be undone. Export a backup in Settings first if you’re unsure.</li>
              </ul>
              {error && <div className="lk-alert">{error}</div>}
              <div className="row" style={{ marginTop: 12 }}>
                <span className="spacer" />
                <button className="btn primary" onClick={() => (needsOverride ? requestOverride() : setConfirm(true))}>
                  {needsOverride && <span aria-hidden style={{ fontSize: 11 }}>🔒 </span>}Merge #{other.number} into #{keep.number}
                </button>
              </div>
              {needsOverride && <div className="small muted" style={{ textAlign: 'right', marginTop: 6 }}>Merging needs master override (Settings → Duplicate customers &amp; merging).</div>}
            </div>
          </section>
        </>
      )}

      {confirm && keep && other && (
        <Modal title="Merge customers?" onClose={() => setConfirm(false)}
          footer={<><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className="btn primary" onClick={doMerge}>Merge</button></>}>
          <p style={{ marginTop: 0 }}>#{other.number} {other.name} will be merged into #{keep.number} {keep.name} and removed. This can’t be undone.</p>
        </Modal>
      )}
    </div>
  )
}

function Slot({ title, c, onPick, onClear, exclude, away }: {
  title: string; c?: Customer; onPick: (c: Customer) => void; onClear: () => void; exclude: string[]; away?: boolean
}) {
  const { db } = useStore()
  return (
    <section className={`panel mg-slot ${away ? 'away' : ''}`}>
      <div className="panel-head"><h3>{title}</h3>{c && <><span className="spacer" /><button className="btn ghost sm" onClick={onClear}>Change</button></>}</div>
      <div className="panel-body">
        {c ? (
          <div className="stack" style={{ gap: 4 }}>
            <div className="mono small muted">Customer #{c.number}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{c.name}</div>
            <div className="small">{[c.phone, c.cellPhone, c.altPhone].filter(Boolean).join(' · ') || <span className="muted">No phone</span>}</div>
            <div className="small muted">{[c.address, c.city].filter(Boolean).join(', ') || 'No address'}</div>
            <div className="small muted">
              {db.units.filter((u) => u.customerId === c.id).length} units · {db.ros.filter((r) => r.customerId === c.id).length} ROs · since {fmtDate(c.createdAt)}
            </div>
          </div>
        ) : <CustomerSearchPick onPick={onPick} exclude={exclude} />}
      </div>
    </section>
  )
}
