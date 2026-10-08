// Customer look-up: one search box that checks every field a counter person
// might know (name, any phone, customer #, contact, unit serial, email, address),
// plus duplicate detection and the built-in Cash Customer.
import type { Customer, DB, Unit } from './types'
import { customerPhones } from './calc'

// ---------- Cash Customer ----------

export const CASH_NUMBER = 1000

/** Make sure the walk-in Cash Customer exists. Mutates an Immer draft (or a fresh DB). */
export function ensureCashCustomer(d: DB) {
  if (d.customers.some((c) => c.isCash)) return
  const at1000 = d.customers.find((c) => c.number === CASH_NUMBER)
  // An imported Infinity "Cash Customer" already sitting at #1000 — adopt it.
  if (at1000 && /\bcash\b/i.test(at1000.name)) { at1000.isCash = true; return }
  const number = at1000 ? Math.max(d.nextCustomerNumber, ...d.customers.map((c) => c.number + 1)) : CASH_NUMBER
  d.customers.push({
    id: 'c-cash', number, name: 'Cash Customer', phone: '', email: '', isBusiness: false,
    notes: 'Walk-in sale. No customer record kept.', createdAt: new Date().toISOString(), isCash: true,
  })
  if (number >= d.nextCustomerNumber) d.nextCustomerNumber = number + 1
}

// ---------- Index ----------

export interface CustEntry {
  c: Customer
  name: string // lower-case
  phones: { label: string; value: string; digits: string }[]
  contacts: string[]
  email: string
  addrLine: string // "418 Elder Ln, Mustang, OK 73064"
  units: Unit[]
  open: number
  total: number
  last: string | null // last RO opened
}

export function buildIndex(db: DB): CustEntry[] {
  const units = new Map<string, Unit[]>()
  for (const u of db.units) { const a = units.get(u.customerId); if (a) a.push(u); else units.set(u.customerId, [u]) }
  const ros = new Map<string, { open: number; total: number; last: string | null }>()
  for (const r of db.ros) {
    const x = ros.get(r.customerId) ?? { open: 0, total: 0, last: null }
    x.total++; if (r.status !== 'closed') x.open++
    if (!x.last || r.openedAt > x.last) x.last = r.openedAt
    ros.set(r.customerId, x)
  }
  return db.customers.map((c) => {
    const r = ros.get(c.id)
    return {
      c,
      name: c.name.toLowerCase(),
      phones: customerPhones(c).map((p) => ({ ...p, digits: p.value.replace(/\D/g, '') })),
      contacts: [c.contact1, c.contact2].filter((x): x is string => !!x?.trim()),
      email: (c.email ?? '').toLowerCase(),
      addrLine: addressLine(c),
      units: units.get(c.id) ?? [],
      open: r?.open ?? 0, total: r?.total ?? 0, last: r?.last ?? null,
    }
  })
}

export function addressLine(c: Customer) {
  const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [c.address, c.address2, cityLine].filter(Boolean).join(', ')
}

// ---------- Search ----------

type Field = 'name' | 'number' | 'phone' | 'contact' | 'unit' | 'email' | 'address'

export interface Hit {
  e: CustEntry
  /** Why it matched, when it wasn't the name — e.g. "Matched cell (405) 555-0142". */
  match: string | null
  score: number
}

/** Split the query. A query that's only digits and phone punctuation is kept whole. */
function tokens(q: string): string[] {
  const t = q.trim().toLowerCase()
  if (!t) return []
  if (/^[\d\s()+\-.#]+$/.test(t)) return [t.replace(/[^\d]/g, '')].filter(Boolean)
  return t.split(/\s+/)
}

function matchToken(e: CustEntry, tok: string): { field: Field; label: string } | null {
  const digits = tok.replace(/\D/g, '')
  const numeric = /^#?\d+$/.test(tok)
  if (e.name.includes(tok)) return { field: 'name', label: '' }
  if (numeric && String(e.c.number).startsWith(digits)) return { field: 'number', label: `Matched customer #${e.c.number}` }
  if (digits.length >= 3 && digits.length >= tok.length - 2) {
    const p = e.phones.find((x) => x.digits.includes(digits))
    if (p) return { field: 'phone', label: `Matched ${p.label === 'Phone' ? 'phone' : p.label.toLowerCase()} ${p.value}` }
  }
  const ct = e.contacts.find((x) => x.toLowerCase().includes(tok))
  if (ct) return { field: 'contact', label: `Matched contact ${ct}` }
  const bare = tok.replace(/[^a-z0-9]/g, '')
  const u = e.units.find((x) =>
    (bare.length >= 3 && x.serial.toLowerCase().replace(/[^a-z0-9]/g, '').includes(bare)) ||
    `${x.make} ${x.model} ${x.type}`.toLowerCase().includes(tok))
  if (u) return { field: 'unit', label: `Matched unit ${u.make} ${u.model}${u.serial ? `, S/N ${u.serial}` : ''}` }
  if (e.email.includes(tok)) return { field: 'email', label: `Matched email ${e.c.email}` }
  if (e.addrLine.toLowerCase().includes(tok)) return { field: 'address', label: `Matched address ${e.addrLine}` }
  return null
}

export function searchCustomers(entries: CustEntry[], q: string): Hit[] {
  const toks = tokens(q)
  const out: Hit[] = []
  if (!toks.length) {
    for (const e of entries) out.push({ e, match: null, score: 0 })
  } else {
    const whole = q.trim().toLowerCase()
    for (const e of entries) {
      let label: string | null = null
      let ok = true
      let nameOnly = true
      for (const t of toks) {
        const m = matchToken(e, t)
        if (!m) { ok = false; break }
        if (m.field !== 'name') { nameOnly = false; label ??= m.label }
      }
      if (!ok) continue
      let score = 100
      if (String(e.c.number) === toks[0] && toks.length === 1) score = 1000
      else if (nameOnly) {
        if (e.name.startsWith(whole)) score = 500
        else if (toks.every((t) => e.name.split(/[\s,.&/-]+/).some((w) => w.startsWith(t)))) score = 300
        else score = 200
      }
      out.push({ e, match: nameOnly ? null : label, score })
    }
  }
  // Best match first; then whoever was in most recently; then A–Z.
  return out.sort((a, b) =>
    b.score - a.score ||
    (b.e.last ?? '').localeCompare(a.e.last ?? '') ||
    a.e.c.name.localeCompare(b.e.c.name))
}

// ---------- Duplicates & attention ----------

export interface Dup { otherId: string; reason: string }

const normName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|inc|llc|co|company|corp)\b/g, ' ').replace(/\s+/g, ' ').trim()
const normAddr = (c: Customer) =>
  (c.address ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + (c.zip ?? '').slice(0, 5)

/**
 * Possible duplicates: same name AND at least one of (shared phone, same street address, same email).
 * Same name alone isn't enough — there are a lot of John Smiths.
 */
export function findDuplicates(entries: CustEntry[]): Map<string, Dup[]> {
  const byName = new Map<string, CustEntry[]>()
  for (const e of entries) {
    if (e.c.isCash) continue
    const k = normName(e.c.name)
    if (!k) continue
    const a = byName.get(k); if (a) a.push(e); else byName.set(k, [e])
  }
  const out = new Map<string, Dup[]>()
  const add = (id: string, d: Dup) => { const a = out.get(id); if (a) a.push(d); else out.set(id, [d]) }
  for (const group of byName.values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j]
      const why: string[] = []
      const shared = a.phones.find((p) => p.digits.length >= 7 && b.phones.some((q) => q.digits.slice(-7) === p.digits.slice(-7)))
      if (shared) why.push(`${shared.label === 'Phone' ? 'phone' : shared.label.toLowerCase()} number`)
      if (a.c.address && normAddr(a.c) === normAddr(b.c)) why.push('address')
      if (a.email && a.email === b.email) why.push('email')
      if (!why.length) continue
      const reason = `same name and ${why.join(' and ')}`
      add(a.c.id, { otherId: b.c.id, reason })
      add(b.c.id, { otherId: a.c.id, reason })
    }
  }
  return out
}

export type Attention = 'credit' | 'duplicate' | 'no_phone'
export const ATTENTION_LABEL: Record<Attention, string> = {
  credit: 'Credit flag',
  duplicate: 'Possible duplicate',
  no_phone: 'No phone on file',
}

export function attentionOf(e: CustEntry, dups: Map<string, Dup[]>): Attention[] {
  if (e.c.isCash) return []
  const a: Attention[] = []
  if (e.c.creditFlag) a.push('credit')
  if (dups.has(e.c.id)) a.push('duplicate')
  if (!e.phones.length) a.push('no_phone')
  return a
}

/** Infinity DeliveryCode → plain words. Only "P" is confirmed so far. */
export function statementDelivery(code?: string) {
  if (!code) return null
  if (code.toUpperCase() === 'P') return 'Paper'
  return `Code ${code}`
}
