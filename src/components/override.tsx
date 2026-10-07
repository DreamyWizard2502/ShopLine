import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { Modal } from './ui'

const EVT = 'shopline:request-override'

/** Ask for the manager PIN from anywhere in the app. */
export const requestOverride = () => window.dispatchEvent(new Event(EVT))

/** Mounted once in the app shell: the PIN prompt + the red banner while override is on. */
export function OverrideHost() {
  const { override, enableOverride, disableOverride } = useStore()
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [bad, setBad] = useState(false)

  useEffect(() => {
    const h = () => { setPin(''); setBad(false); setOpen(true) }
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [])

  return (
    <>
      {override && (
        <div className="override-banner no-print">
          <b>MASTER OVERRIDE ON</b>
          <span>Every lock is lifted: closed ROs, prices, quantities, imports, deletes. Everything you do is logged.</span>
          <span className="spacer" />
          <button className="btn sm" onClick={disableOverride}>Turn off</button>
        </div>
      )}
      {open && (
        <Modal title="Master override" onClose={() => setOpen(false)}
          footer={<>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" form="pin-form" type="submit">Unlock</button>
          </>}>
          <form id="pin-form" className="stack" onSubmit={(e) => {
            e.preventDefault()
            if (enableOverride(pin)) setOpen(false)
            else { setBad(true); setPin('') }
          }}>
            <div className="small muted">Manager PIN unlocks everything until you turn it off or reload. Demo PIN is <b className="mono">0000</b>; change it in Settings.</div>
            <input className="input mono" style={{ fontSize: 22, letterSpacing: '.4em', textAlign: 'center' }} type="password" inputMode="numeric"
              autoFocus value={pin} onChange={(e) => { setPin(e.target.value); setBad(false) }} aria-label="PIN" />
            {bad && <div className="flag" style={{ padding: '6px 10px' }}>Wrong PIN.</div>}
          </form>
        </Modal>
      )}
    </>
  )
}

/** Button that either does the thing (override on) or asks for the PIN first. */
export function OverrideButton({ children, onClick, className = 'btn', title }: {
  children: React.ReactNode; onClick: () => void; className?: string; title?: string
}) {
  const { override } = useStore()
  return (
    <button className={className} title={title} onClick={() => (override ? onClick() : requestOverride())}>
      {!override && <span aria-hidden style={{ fontSize: 11 }}>🔒</span>}{children}
    </button>
  )
}
