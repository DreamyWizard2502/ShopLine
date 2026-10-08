// App state: one in-memory database, saved to the browser's IndexedDB.
// The rest of the app only talks to this file, so swapping in a real
// backend later means changing this file, not every screen.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { produce } from 'immer'
import type { Customer, DB, Part, RepairOrder, ROStatus, TimelineEvent, Unit } from './types'
import { makeSeed, DB_VERSION, defaultLines, defaultSettings } from './seed'
import { STATUS_LABEL, uid } from './calc'
import { idbGet, idbSet } from './idb'
import { ensureCashCustomer } from './customerSearch'

const IDB_KEY = 'db'
const LEGACY_LS_KEY = 'shopline.db.v1'

const VENDOR_LINE: Record<string, string> = {
  Stihl: 'STIHL', Echo: 'ECHO', Exmark: 'EXMARK', Scag: 'SCAG', Toro: 'TORO', Shindaiwa: 'SHINDAIWA',
}

/** Bring an older saved database up to the current shape without losing anything. */
function migrate(raw: DB): DB {
  const db = raw as DB & Record<string, unknown>
  if (db.version < 2) {
    db.lines = defaultLines.map((l) => ({ ...l }))
    db.wholegoods = []
    db.importLog = []
    db.auditLog = []
    db.settings = { ...defaultSettings, ...db.settings }
    db.parts = db.parts.map((p) => ({
      ...p,
      line: (p as Partial<Part>).line ?? VENDOR_LINE[p.vendor] ?? 'OTHER',
      bin: (p as Partial<Part>).bin ?? '',
      supersededBy: (p as Partial<Part>).supersededBy ?? '',
      priceUpdatedAt: (p as Partial<Part>).priceUpdatedAt ?? null,
    }))
    db.version = 2
  }
  if (db.version < 3) {
    // v3: built-in walk-in Cash Customer (#1000) for the customer look-up.
    ensureCashCustomer(db)
    db.version = 3
  }
  return db
}

async function load(): Promise<DB> {
  try {
    const saved = await idbGet<DB>(IDB_KEY)
    if (saved) return migrate(saved)
  } catch { /* IndexedDB blocked — fall through */ }
  try {
    const legacy = localStorage.getItem(LEGACY_LS_KEY)
    if (legacy) return migrate(JSON.parse(legacy) as DB)
  } catch { /* ignore */ }
  return makeSeed()
}

interface StoreApi {
  db: DB
  /** Apply a change to the DB (Immer draft — mutate freely). */
  mutate: (fn: (draft: DB) => void) => void
  currentUser: string
  setCurrentUser: (id: string) => void
  resetDemo: () => void
  // Master override
  override: boolean
  enableOverride: (pin: string) => boolean
  disableOverride: () => void
  audit: (action: string) => void
  // RO helpers
  createRO: (input: Omit<RepairOrder, 'id' | 'number' | 'openedAt' | 'updatedAt' | 'closedAt' | 'timeline' | 'labor' | 'parts' | 'fees' | 'approvals'>) => RepairOrder
  updateRO: (id: string, fn: (ro: RepairOrder) => void, event?: { kind: TimelineEvent['kind']; text: string }) => void
  setStatus: (id: string, status: ROStatus) => void
  addNote: (id: string, text: string) => void
  // Customer helpers
  createCustomer: (c: Omit<Customer, 'id' | 'number' | 'createdAt'>) => Customer
  createUnit: (u: Omit<Unit, 'id'>) => Unit
}

const Ctx = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB | null>(null)
  const [override, setOverride] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => { load().then(setDb) }, [])

  // Debounced save — big catalogs make every-keystroke saves wasteful.
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!db) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      idbSet(IDB_KEY, db).then(() => setSaveError(false), () => setSaveError(true))
    }, 400)
  }, [db])
  // Flush on tab close so the last edit isn't lost.
  useEffect(() => {
    const h = () => { if (db) idbSet(IDB_KEY, db) }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [db])

  const mutate = useCallback((fn: (d: DB) => void) => {
    setDb((prev) => (prev ? produce(prev, fn) : prev))
  }, [])

  const api = useMemo<StoreApi | null>(() => {
    if (!db) return null
    const currentUser = db.staff.find((s) => s.id === db.currentUserId)?.name ?? 'Unknown'
    const now = () => new Date().toISOString()
    const event = (kind: TimelineEvent['kind'], text: string): TimelineEvent => ({
      id: uid(), at: now(), kind, text, user: currentUser + (override ? ' (override)' : ''),
    })
    const audit = (action: string) => mutate((d) => {
      d.auditLog.unshift({ id: uid(), at: now(), user: currentUser, action })
      if (d.auditLog.length > 1000) d.auditLog.length = 1000
    })

    const updateRO: StoreApi['updateRO'] = (id, fn, ev) =>
      mutate((d) => {
        const ro = d.ros.find((r) => r.id === id)
        if (!ro) return
        fn(ro)
        ro.updatedAt = now()
        if (ev) ro.timeline.push(event(ev.kind, ev.text))
      })

    return {
      db,
      mutate,
      currentUser,
      setCurrentUser: (id) => mutate((d) => { d.currentUserId = id }),
      resetDemo: () => { setDb(makeSeed()); setOverride(false) },
      override,
      enableOverride: (pin) => {
        if (pin !== db.settings.overridePin) return false
        setOverride(true)
        audit('Master override turned ON')
        return true
      },
      disableOverride: () => { setOverride(false); audit('Master override turned off') },
      audit,
      createRO: (input) => {
        const ro: RepairOrder = {
          ...input,
          id: uid(),
          number: db.nextRONumber,
          openedAt: now(),
          updatedAt: now(),
          closedAt: null,
          labor: [], parts: [], fees: [], approvals: [],
          timeline: [event('created', 'Repair order opened')],
        }
        mutate((d) => { d.ros.push(ro); d.nextRONumber++ })
        return ro
      },
      updateRO,
      setStatus: (id, status) =>
        updateRO(id, (ro) => {
          ro.status = status
          ro.closedAt = status === 'closed' ? now() : null
        }, { kind: 'status', text: `Status → ${STATUS_LABEL[status]}` }),
      addNote: (id, text) => updateRO(id, () => {}, { kind: 'note', text }),
      createCustomer: (c) => {
        const cust: Customer = { ...c, id: uid(), number: db.nextCustomerNumber, createdAt: now() }
        mutate((d) => { d.customers.push(cust); d.nextCustomerNumber++ })
        return cust
      },
      createUnit: (u) => {
        const unit: Unit = { ...u, id: uid() }
        mutate((d) => { d.units.push(unit) })
        return unit
      },
    }
  }, [db, mutate, override])

  if (!api) return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#80868f' }}>Loading ShopLine…</div>
  return (
    <Ctx.Provider value={api}>
      {children}
      {saveError && <div className="toast" style={{ background: 'var(--bad)' }}>Couldn't save to this browser's storage. Export a backup in Settings.</div>}
    </Ctx.Provider>
  )
}

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore must be inside StoreProvider')
  return s
}

/** Handy lookups used on almost every screen. */
export function useLookups() {
  const { db } = useStore()
  return useMemo(() => {
    const customer = new Map(db.customers.map((c) => [c.id, c]))
    const unit = new Map(db.units.map((u) => [u.id, u]))
    const staff = new Map(db.staff.map((s) => [s.id, s]))
    const line = new Map(db.lines.map((l) => [l.code, l]))
    return { customer, unit, staff, line }
  }, [db.customers, db.units, db.staff, db.lines])
}

export { DB_VERSION }
