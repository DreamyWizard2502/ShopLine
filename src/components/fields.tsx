import { useEffect, useState } from 'react'

/** Text field that keeps its own draft and saves on blur — no save on every keystroke. */
export function DraftText({ value, onCommit, multiline, placeholder, className, ariaLabel, disabled, style, listId }: {
  value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string; className?: string; ariaLabel?: string
  disabled?: boolean; style?: React.CSSProperties; listId?: string
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => { if (v !== value) onCommit(v) }
  return multiline ? (
    <textarea className={className ?? 'textarea'} value={v} placeholder={placeholder} aria-label={ariaLabel}
      disabled={disabled} style={style} onChange={(e) => setV(e.target.value)} onBlur={commit} />
  ) : (
    <input className={className ?? 'input'} value={v} placeholder={placeholder} aria-label={ariaLabel}
      disabled={disabled} style={style} list={listId} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}

/** Number field with the same draft/commit behaviour. Accepts "1.5", ".3", etc. */
export function DraftNumber({ value, onCommit, step = 0.1, min = 0, ariaLabel, width = 80, decimals }: {
  value: number; onCommit: (v: number) => void; step?: number; min?: number; ariaLabel?: string; width?: number; decimals?: number
}) {
  const show = (n: number) => (decimals != null ? n.toFixed(decimals) : String(n))
  const [v, setV] = useState(show(value))
  useEffect(() => setV(show(value)), [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < min) { setV(show(value)); return }
    if (n !== value) onCommit(n)
    else setV(show(value))
  }
  return (
    <input className="input num" style={{ width }} inputMode="decimal" aria-label={ariaLabel} value={v} step={step}
      onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} onBlur={commit}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}
