import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { buildIndex, searchCustomers } from '../lib/customerSearch'
import type { Customer } from '../lib/types'

/** Search-as-you-type customer chooser (same matching as the look-up). */
export function CustomerSearchPick({ onPick, exclude = [], placeholder = 'Search name, phone, customer #…', autoFocus }: {
  onPick: (c: Customer) => void; exclude?: string[]; placeholder?: string; autoFocus?: boolean
}) {
  const { db } = useStore()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const ex = exclude.join('|')
  const entries = useMemo(() => buildIndex(db).filter((e) => !e.c.isCash && !ex.split('|').includes(e.c.id)), [db, ex])
  const hits = useMemo(() => (q.trim() ? searchCustomers(entries, q).slice(0, 8) : []), [entries, q])
  const pick = (c: Customer) => { onPick(c); setQ(''); setI(0) }
  return (
    <div className="cpick">
      <input className="input" value={q} placeholder={placeholder} autoFocus={autoFocus} aria-label="Find customer"
        onChange={(e) => { setQ(e.target.value); setI(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(hits.length - 1, x + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
          if (e.key === 'Enter' && hits[i]) { e.preventDefault(); pick(hits[i].e.c) }
        }} />
      {hits.length > 0 && (
        <div className="cpick-list" role="listbox">
          {hits.map((h, k) => (
            <button type="button" key={h.e.c.id} role="option" aria-selected={k === i} className={k === i ? 'on' : ''} onClick={() => pick(h.e.c)}>
              <span className="mono small muted">#{h.e.c.number}</span> <b>{h.e.c.name}</b>
              <span className="small muted"> {h.e.phones[0]?.value ?? ''}{h.e.c.city ? ` · ${h.e.c.city}` : ''}</span>
              {h.match && <div className="lk-match">{h.match}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
