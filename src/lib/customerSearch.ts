// Customer look-up: one search box that checks every field a counter person
// might know (name, any phone, customer #, contact, unit serial, email, address),
// plus duplicate detection and the built-in Cash Customer.
import type { Contact, Customer, DB, DuplicateRules, DupSignal, Unit } from './types'
import { contactsOf } from './customerRecord'
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
  people: Contact[] // full contact records (name, type, phones)
  contactPhones: { who: string; value: string; digits: string }[]
  shipLines: string[] // ship-to addresses
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
    x.total++; if (r.status !== 'closed' && !r.archived) x.open++
    if (!x.last || r.openedAt > x.last) x.last = r.openedAt
    ros.set(r.customerId, x)
  }
  return db.customers.map((c) => {
    const r = ros.get(c.id)
    return {
      c,
      name: c.name.toLowerCase(),
      phones: customerPhones(c).map((p) => ({ ...p, digits: p.value.replace(/\D/g, '') })),
      ...contactParts(c),
      email: (c.email ?? '').toLowerCase(),
      addrLine: addressLine(c),
      units: units.get(c.id) ?? [],
      open: r?.open ?? 0, total: r?.total ?? 0, last: r?.last ?? null,
    }
  })
}

function contactParts(c: Customer) {
  const people = contactsOf(c)
  return {
    contacts: people.map((p) => p.name).filter((x) => x.trim()),
    people,
    contactPhones: people.flatMap((p) => [p.phone, p.cell].filter(Boolean).map((v) => ({ who: p.name, value: v, digits: v.replace(/\D/g, '') }))),
    shipLines: (c.shipTos ?? []).map((s) => [s.label, s.address, s.address2, s.city, s.state, s.zip].filter(Boolean).join(', ')),
  }
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
  if (numeric && digits.length >= 3) {
    const m = e.c.mergedFrom?.find((x) => String(x.number) === digits)
    if (m) return { field: 'number', label: `Matched old #${m.number} (merged into this record)` }
  }
  if (digits.length >= 3 && digits.length >= tok.length - 2) {
    const p = e.phones.find((x) => x.digits.includes(digits))
    if (p) return { field: 'phone', label: `Matched ${p.label === 'Phone' ? 'phone' : p.label.toLowerCase()} ${p.value}` }
    const cp = e.contactPhones.find((x) => x.digits.includes(digits))
    if (cp) return { field: 'phone', label: `Matched ${cp.who}’s phone ${cp.value}` }
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
  const sh = e.shipLines.find((x) => x.toLowerCase().includes(tok))
  if (sh) return { field: 'address', label: `Matched ship-to ${sh}` }
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

export interface Dup { otherId: string; reason: string; signals: DupSignal[] }

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function normName(s: string, ignoreWords: string) {
  const ignore = new Set(ignoreWords.toLowerCase().split(/[,\s]+/).filter(Boolean))
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !ignore.has(w)).join(' ')
}
const normAddr = (c: Customer) =>
  c.address ? (c.address ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + (c.zip ?? '').slice(0, 5) : ''

/** Shared values bigger than this (a franchise's shared office phone, say) are skipped. */
const MAX_BUCKET = 25

/**
 * Possible duplicates under the shop's rules (Settings → Duplicate customers & merging).
 * Default: same name AND at least one of phone / address / email.
 */
export function findDuplicates(entries: CustEntry[], rules: DuplicateRules, dismissed: string[] = []): Map<string, Dup[]> {
  const out = new Map<string, Dup[]>()
  if (!rules.enabled) return out
  const on = (Object.keys(rules.signals) as DupSignal[]).filter((k) => rules.signals[k])
  if (!on.length) return out
  const needName = rules.nameRequired && rules.signals.name
  const min = Math.max(1, Math.min(rules.minSignals, on.length))
  const n = rules.phoneDigits
  const people = entries.filter((e) => !e.c.isCash)

  const keysOf = (e: CustEntry) => {
    const k: Record<DupSignal, string[]> = { name: [], phone: [], address: [], email: [] }
    if (rules.signals.name) { const v = normName(e.c.name, rules.ignoreWords); if (v) k.name.push(v) }
    if (rules.signals.phone) for (const p of e.phones) if (p.digits.length >= n) k.phone.push(p.digits.slice(-n))
    if (rules.signals.address) { const v = normAddr(e.c); if (v) k.address.push(v) }
    if (rules.signals.email && e.email) k.email.push(e.email.trim())
    return k
  }
  const keys = people.map(keysOf)
  const buckets = new Map<string, number[]>()
  keys.forEach((k, i) => {
    for (const sig of on) for (const v of new Set(k[sig])) {
      const b = `${sig}:${v}`; const a = buckets.get(b); if (a) a.push(i); else buckets.set(b, [i])
    }
  })
  const seen = new Set<string>()
  const skip = new Set(dismissed)
  for (const idx of buckets.values()) {
    if (idx.length < 2 || idx.length > MAX_BUCKET) continue
    for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
      const i = idx[x], j = idx[y]
      const pk = i < j ? `${i}|${j}` : `${j}|${i}`
      if (seen.has(pk)) continue
      seen.add(pk)
      const a = people[i], b = people[j]
      if (skip.has(pairKey(a.c.id, b.c.id))) continue
      const hit = on.filter((sig) => keys[i][sig].some((v) => keys[j][sig].includes(v)))
      if (hit.length < min || (needName && !hit.includes('name'))) continue
      const words = hit.map((sig) => {
        if (sig !== 'phone') return sig
        const p = a.phones.find((ph) => ph.digits.length >= n && b.phones.some((q) => q.digits.slice(-n) === ph.digits.slice(-n)))
        return p && p.label !== 'Phone' ? `${p.label.toLowerCase()} number` : 'phone number'
      })
      const reason = 'same ' + (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0])
      const add = (id: string, d: Dup) => { const arr = out.get(id); if (arr) arr.push(d); else out.set(id, [d]) }
      add(a.c.id, { otherId: b.c.id, reason, signals: hit })
      add(b.c.id, { otherId: a.c.id, reason, signals: hit })
    }
  }
  return out
}

export type Attention = 'credit' | 'past_due' | 'over_limit' | 'duplicate' | 'no_phone'
export const ATTENTION_LABEL: Record<Attention, string> = {
  credit: 'Credit flag',
  past_due: 'Past due',
  over_limit: 'Over credit limit',
  duplicate: 'Possible duplicate',
  no_phone: 'No phone on file',
}

export function attentionOf(e: CustEntry, dups: Map<string, Dup[]>, acct?: { pastDue: number; overLimit: boolean }): Attention[] {
  if (e.c.isCash) return []
  const a: Attention[] = []
  if (e.c.creditFlag) a.push('credit')
  if (acct && acct.pastDue > 0) a.push('past_due')
  if (acct?.overLimit) a.push('over_limit')
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
