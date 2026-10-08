// True customer merge: one record survives, the other's history moves onto it.
import type { Customer, DB } from './types'
import { customerPhones } from './calc'
import { contactsOf, syncLegacyContacts } from './customerRecord'

/** Fields the person chooses between, in the order they're shown. */
export const MERGE_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'cellPhone', label: 'Cell phone' },
  { key: 'altPhone', label: 'Alt phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' }, // whole block: address, address2, city, state, zip
  { key: 'category', label: 'Category' },
  { key: 'isBusiness', label: 'Account type' },
  { key: 'contact1', label: 'Contact 1' },
  { key: 'contact2', label: 'Contact 2' },
  { key: 'salesman', label: 'Salesman' },
  { key: 'priceLevel', label: 'Price level' },
  { key: 'taxExempt', label: 'Tax' },
  { key: 'arType', label: 'A/R type' },
  { key: 'deliveryCode', label: 'Statement delivery' },
  { key: 'creditFlag', label: 'Credit flag' },
  { key: 'creditLimit', label: 'Credit limit' },
  { key: 'termsDays', label: 'Terms (days)' },
] as const
export type MergeField = (typeof MERGE_FIELDS)[number]['key']
export type Side = 'keep' | 'other'
export type Picks = Partial<Record<MergeField, Side>>

const ADDR = ['address', 'address2', 'city', 'state', 'zip'] as const

/** How a field reads on screen (blank = ''). */
export function showField(c: Customer, f: MergeField): string {
  if (f === 'address') return [c.address, c.address2, [c.city, c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  if (f === 'isBusiness') return c.isBusiness ? 'Commercial' : 'Personal'
  if (f === 'taxExempt') return c.taxExempt ? 'Tax exempt' : 'Taxable'
  if (f === 'creditFlag') return c.creditFlag ? 'On' : ''
  const v = c[f]
  return v == null ? '' : String(v)
}

/** Default choice: keep the survivor's value, unless it's blank and the other one isn't. */
export function defaultPicks(keep: Customer, other: Customer): Picks {
  const p: Picks = {}
  for (const { key } of MERGE_FIELDS) {
    const a = showField(keep, key), b = showField(other, key)
    if (a === b) continue
    p[key] = !a && b ? 'other' : 'keep'
  }
  return p
}

/** Which record should survive by default: the one with more history. */
export function strongerFirst(db: DB, aId: string, bId: string): [string, string] {
  const weight = (id: string) =>
    db.ros.filter((r) => r.customerId === id).length * 3 + db.units.filter((u) => u.customerId === id).length * 2 +
    db.ar.filter((e) => e.customerId === id).length
  const wa = weight(aId), wb = weight(bId)
  if (wa !== wb) return wa > wb ? [aId, bId] : [bId, aId]
  const a = db.customers.find((c) => c.id === aId)!, b = db.customers.find((c) => c.id === bId)!
  return a.number <= b.number ? [aId, bId] : [bId, aId]
}

export interface MergeImpact { units: number; ros: number; wholegoods: number; ar: number }
export function mergeImpact(db: DB, otherId: string): MergeImpact {
  return {
    units: db.units.filter((u) => u.customerId === otherId).length,
    ros: db.ros.filter((r) => r.customerId === otherId).length,
    wholegoods: db.wholegoods.filter((w) => w.soldToCustomerId === otherId).length,
    ar: db.ar.filter((e) => e.customerId === otherId).length,
  }
}

/**
 * Merge `otherId` into `keepId` on an Immer draft. Returns the audit line.
 * Nothing is lost: chosen fields win, leftover phones fill empty slots (or go to notes),
 * both notes are kept, and the old number is remembered so searches still find it.
 */
export function mergeCustomers(d: DB, keepId: string, otherId: string, picks: Picks, user: string): string {
  const keep = d.customers.find((c) => c.id === keepId)
  const other = d.customers.find((c) => c.id === otherId)
  if (!keep || !other || keep.id === other.id) throw new Error('Pick two different customers.')
  if (keep.isCash || other.isCash) throw new Error('The Cash Customer can’t be merged.')
  const at = new Date().toISOString()
  const before = { number: other.number, name: other.name }

  // 1. Fields
  for (const { key } of MERGE_FIELDS) {
    if (picks[key] !== 'other') continue
    if (key === 'address') { for (const k of ADDR) keep[k] = other[k] }
    else (keep as unknown as Record<string, unknown>)[key] = (other as unknown as Record<string, unknown>)[key]
  }
  // 2. Phones the survivor doesn't have yet → empty slots, else notes
  const have = new Set(customerPhones(keep).map((p) => p.value.replace(/\D/g, '')))
  const extra = customerPhones(other).filter((p) => !have.has(p.value.replace(/\D/g, '')))
  const leftovers: string[] = []
  for (const p of extra) {
    if (!keep.phone) keep.phone = p.value
    else if (!keep.cellPhone) keep.cellPhone = p.value
    else if (!keep.altPhone) keep.altPhone = p.value
    else leftovers.push(`${p.label} ${p.value}`)
  }
  // 3. Notes: keep both
  const extraNotes = [other.notes?.trim(), leftovers.length ? `Other phone(s): ${leftovers.join(', ')}` : '']
    .filter(Boolean).join('\n')
  if (extraNotes && !keep.notes.includes(extraNotes)) {
    keep.notes = [keep.notes.trim(), `From merged #${other.number}: ${extraNotes}`].filter(Boolean).join('\n')
  }
  // 3b. Contacts, ship-to addresses and the notes log: keep everything from both (contacts de-duplicated by name)
  if (keep.contacts || other.contacts) {
    const mine = contactsOf(keep).map((x) => ({ ...x }))
    const seen = new Set(mine.map((x) => x.name.trim().toLowerCase()))
    for (const x of contactsOf(other)) if (x.name.trim() && !seen.has(x.name.trim().toLowerCase())) { mine.push({ ...x, primary: false }); seen.add(x.name.trim().toLowerCase()) }
    keep.contacts = mine.map((x, i) => ({ ...x, id: x.id.startsWith('legacy-') ? `${keep.id}-ct${i}` : x.id }))
    syncLegacyContacts(keep)
  }
  if (other.shipTos?.length) keep.shipTos = [...(keep.shipTos ?? []), ...other.shipTos.map((x) => ({ ...x, isDefault: x.isDefault && !keep.shipTos?.length }))]
  if (other.noteLog?.length) keep.noteLog = [...(keep.noteLog ?? []), ...other.noteLog].sort((x, y) => y.at.localeCompare(x.at))
  if (other.createdAt < keep.createdAt) keep.createdAt = other.createdAt
  keep.mergedFrom = [...(keep.mergedFrom ?? []), ...(other.mergedFrom ?? []), { number: other.number, name: other.name, at, user }]

  // 4. Move everything that points at the old record
  const n = mergeImpact(d, other.id)
  for (const u of d.units) if (u.customerId === other.id) u.customerId = keep.id
  for (const r of d.ros) if (r.customerId === other.id) r.customerId = keep.id
  for (const w of d.wholegoods) if (w.soldToCustomerId === other.id) w.soldToCustomerId = keep.id
  for (const e of d.ar) if (e.customerId === other.id) e.customerId = keep.id

  // 5. Remove it, and any "not a duplicate" marks that mention it
  d.customers.splice(d.customers.indexOf(other), 1)
  d.notDuplicates = d.notDuplicates.filter((k) => !k.split('|').includes(other.id))

  const moved = [`${n.units} unit${n.units === 1 ? '' : 's'}`, `${n.ros} RO${n.ros === 1 ? '' : 's'}`,
    n.wholegoods ? `${n.wholegoods} sold wholegood${n.wholegoods === 1 ? '' : 's'}` : '', n.ar ? `${n.ar} A/R entr${n.ar === 1 ? 'y' : 'ies'}` : '']
    .filter(Boolean).join(', ')
  return `Merged customer #${before.number} ${before.name} into #${keep.number} ${keep.name} (moved ${moved})`
}
