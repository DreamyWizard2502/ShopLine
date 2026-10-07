import type { Line } from '../lib/types'

export function LineDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span aria-hidden style={{ display: 'inline-block', width: size, height: size, borderRadius: 2, background: color, flex: 'none' }} />
}

/** Manufacturer-line tabs with a count under each. */
export function LineTabs({ lines, value, onChange, counts, allLabel = 'All lines' }: {
  lines: Line[]; value: string; onChange: (code: string) => void; counts: Record<string, string | number>; allLabel?: string
}) {
  return (
    <div className="line-tabs" role="tablist">
      <button role="tab" aria-selected={value === ''} className={value === '' ? 'on' : ''} onClick={() => onChange('')}>
        <span className="lt-name">{allLabel}</span><span className="lt-n">{counts[''] ?? ''}</span>
      </button>
      {lines.map((l) => (
        <button key={l.code} role="tab" aria-selected={value === l.code} className={value === l.code ? 'on' : ''} onClick={() => onChange(l.code)}
          style={{ ['--lc' as string]: l.color }}>
          <span className="lt-name"><LineDot color={l.color} /> {l.name}</span><span className="lt-n">{counts[l.code] ?? 0}</span>
        </button>
      ))}
    </div>
  )
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <div className="small muted" style={{ padding: '8px 12px' }}>{total.toLocaleString()} rows</div>
  return (
    <div className="row" style={{ padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
      <span className="small muted">{total.toLocaleString()} rows</span>
      <span className="spacer" />
      <button className="btn sm" disabled={page === 0} onClick={() => onPage(0)}>«</button>
      <button className="btn sm" disabled={page === 0} onClick={() => onPage(page - 1)}>‹ Prev</button>
      <span className="small mono">{page + 1} / {pages}</span>
      <button className="btn sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next ›</button>
      <button className="btn sm" disabled={page >= pages - 1} onClick={() => onPage(pages - 1)}>»</button>
    </div>
  )
}
