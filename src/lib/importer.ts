// Price-file / unit-list import engine.
// 1. read CSV or Excel → rows of strings
// 2. find the header row and guess which column is which
// 3. build a plan (what will change) so the user can preview it
// 4. apply the plan in one shot
import Papa from 'papaparse'
import type { Customer, DB, Part, Unit, Wholegood, UnitType } from './types'
import { round2, uid } from './calc'

export interface Sheet { name: string; rows: string[][] }
export interface ParsedFile { fileName: string; sheets: Sheet[] }

const cell = (v: unknown): string => {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'xlsx') {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(file)
    return { fileName: file.name, sheets: sheets.map((s) => ({ name: s.sheet, rows: s.data.map((r) => r.map(cell)) })) }
  }
  if (ext === 'xls') throw new Error('Old .xls files aren’t supported. Open it in Excel and “Save As” .xlsx or .csv.')
  const text = await file.text()
  const res = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
  return { fileName: file.name, sheets: [{ name: 'CSV', rows: res.data.map((r) => r.map(cell)) }] }
}

// ---------- Field definitions ----------

export interface FieldDef {
  key: string
  label: string
  required?: boolean
  patterns: RegExp[] // checked in order; earlier = stronger match
  help?: string
}

export const PART_FIELDS: FieldDef[] = [
  { key: 'partNo', label: 'Part number', required: true, patterns: [/^part\s*(#|no\.?|num(ber)?)$/i, /part\s*(#|no|num)/i, /^(item|sku|material)\s*(#|no\.?|num(ber)?)?$/i, /\b(sku|item|material|part)\b/i] },
  { key: 'description', label: 'Description', patterns: [/^desc/i, /desc/i, /\bname\b/i] },
  { key: 'dp', label: 'DP (dealer price)', patterns: [/^dp$/i, /dealer\s*(net|price|cost)/i, /\b(dlr|dealer|net|cost)\b/i] },
  { key: 'srp', label: 'SRP (retail)', patterns: [/^m?srp$/i, /sugg|retail|\blist\b/i, /\bm?srp\b/i, /^price$/i] },
  { key: 'onHand', label: 'On-hand qty', patterns: [/on\s*hand/i, /^(qty|quantity|oh|soh)$/i, /\b(qty|quantity)\b/i], help: 'Only used if you turn on “Overwrite on-hand”.' },
  { key: 'supersededBy', label: 'Superseded by', patterns: [/supersed|replaced?\s*by|substitut|new\s*part/i] },
  { key: 'bin', label: 'Bin / location', patterns: [/^(bin|loc|location)$/i, /\bbin\b/i] },
  { key: 'line', label: 'Line / brand', patterns: [/^(line|brand|mfg|manufacturer|make)$/i, /\b(product\s*line|brand|manufacturer)\b/i], help: 'Optional — leave unmapped to put everything in the line you picked.' },
]

export const WG_FIELDS: FieldDef[] = [
  { key: 'model', label: 'Model #', required: true, patterns: [/^model\s*(#|no\.?|num(ber)?)?$/i, /model/i, /\b(item|sku)\b/i] },
  { key: 'serial', label: 'Serial #', patterns: [/serial/i, /\bs\/?n\b/i, /\bvin\b/i] },
  { key: 'description', label: 'Description', patterns: [/^desc/i, /desc/i] },
  { key: 'dp', label: 'DP (dealer price)', patterns: [/^dp$/i, /dealer\s*(net|price|cost)/i, /\b(dlr|dealer|net|cost|invoice)\b/i] },
  { key: 'srp', label: 'SRP (retail)', patterns: [/^m?srp$/i, /sugg|retail|\blist\b/i, /^price$/i] },
  { key: 'stockNo', label: 'Stock #', patterns: [/stock\s*(#|no|num)/i] },
  { key: 'receivedAt', label: 'Received date', patterns: [/receiv|arriv|in\s*date|date\s*in/i, /\bdate\b/i] },
  { key: 'category', label: 'Category', patterns: [/categ|type|class/i] },
  { key: 'year', label: 'Model year', patterns: [/\byear\b|\byr\b/i] },
  { key: 'line', label: 'Line / brand', patterns: [/^(line|brand|mfg|manufacturer|make)$/i] },
]

export type Mapping = Record<string, number> // field key → column index (-1 = not mapped)

/** Price files often start with title rows. Pick the row in the first 20 that looks most like headers. */
export function findHeaderRow(rows: string[][], fields: FieldDef[]): number {
  let best = 0, bestScore = -1
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i]
    const score = fields.reduce((a, f) => a + (r.some((h) => h && f.patterns.some((p) => p.test(h))) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best
}

export function guessMapping(headers: string[], fields: FieldDef[]): Mapping {
  const m: Mapping = {}
  const used = new Set<number>()
  // Strongest pattern first across all fields, so "Dealer Price" goes to DP before SRP's /price/ grabs it.
  const maxP = Math.max(...fields.map((f) => f.patterns.length))
  for (let pi = 0; pi < maxP; pi++) {
    for (const f of fields) {
      if (m[f.key] !== undefined) continue
      const p = f.patterns[pi]
      if (!p) continue
      const idx = headers.findIndex((h, i) => !used.has(i) && h && p.test(h))
      if (idx >= 0) { m[f.key] = idx; used.add(idx) }
    }
  }
  for (const f of fields) if (m[f.key] === undefined) m[f.key] = -1
  return m
}

export function parseMoney(v: string): number | null {
  if (!v) return null
  const neg = /^\(.*\)$/.test(v.trim())
  const n = Number(v.replace(/[$,\s()]/g, ''))
  if (!Number.isFinite(n)) return null
  return round2(neg ? -n : n)
}

/** Match key: ignore spaces, dashes, dots and case. "1123 640-1700" === "11236401700". */
export const normPartNo = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

// ---------- Parts plan ----------

export interface PartsOptions {
  line: string
  updatePrices: boolean
  addNew: boolean
  overwriteDescriptions: boolean
  overwriteQty: boolean
  srpMarkup: number | null // if SRP column missing: SRP = DP × this
}

export interface PartChange {
  part: Part
  next: Partial<Part>
  dpDelta: number | null
  srpDelta: number | null
}

export interface PartsPlan {
  changes: PartChange[]
  adds: Part[]
  unchanged: number
  skipped: { row: number; reason: string }[]
  duplicates: number
  total: number
}

export function planParts(db: DB, rows: string[][], headerRow: number, m: Mapping, o: PartsOptions): PartsPlan {
  const lineByAny = new Map<string, string>()
  for (const l of db.lines) { lineByAny.set(l.code.toUpperCase(), l.code); lineByAny.set(l.name.toUpperCase(), l.code) }
  const index = new Map<string, Part>()
  for (const p of db.parts) index.set(p.line + '|' + normPartNo(p.partNo), p)

  const get = (r: string[], k: string) => (m[k] >= 0 ? r[m[k]] ?? '' : '')
  const plan: PartsPlan = { changes: [], adds: [], unchanged: 0, skipped: [], duplicates: 0, total: 0 }
  const seen = new Set<string>()
  const now = new Date().toISOString()

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => !c)) continue
    plan.total++
    const partNo = get(r, 'partNo')
    if (!partNo) { plan.skipped.push({ row: i + 1, reason: 'No part number' }); continue }
    const lineRaw = get(r, 'line').toUpperCase()
    const line = (lineRaw && lineByAny.get(lineRaw)) || o.line
    const key = line + '|' + normPartNo(partNo)
    if (seen.has(key)) { plan.duplicates++; continue }
    seen.add(key)

    const dp = parseMoney(get(r, 'dp'))
    let srp = parseMoney(get(r, 'srp'))
    if (srp == null && dp != null && o.srpMarkup) srp = round2(dp * o.srpMarkup)
    if (m.dp >= 0 && get(r, 'dp') && dp == null) { plan.skipped.push({ row: i + 1, reason: `DP “${get(r, 'dp')}” isn’t a number` }); continue }
    if (m.srp >= 0 && get(r, 'srp') && srp == null) { plan.skipped.push({ row: i + 1, reason: `SRP “${get(r, 'srp')}” isn’t a number` }); continue }
    const desc = get(r, 'description')
    const qtyRaw = get(r, 'onHand')
    const qty = qtyRaw === '' ? null : Number(qtyRaw.replace(/,/g, ''))
    const sup = get(r, 'supersededBy')
    const bin = get(r, 'bin')

    const existing = index.get(key)
    if (existing) {
      const next: Partial<Part> = {}
      if (o.updatePrices && dp != null && dp !== existing.cost) next.cost = dp
      if (o.updatePrices && srp != null && srp !== existing.price) next.price = srp
      if (desc && (o.overwriteDescriptions || !existing.description) && desc !== existing.description) next.description = desc
      if (o.overwriteQty && qty != null && Number.isFinite(qty) && qty !== existing.onHand) next.onHand = Math.round(qty)
      if (sup && sup !== existing.supersededBy) next.supersededBy = sup
      if (bin && bin !== existing.bin) next.bin = bin
      if (Object.keys(next).length) {
        if (next.cost != null || next.price != null) next.priceUpdatedAt = now
        plan.changes.push({
          part: existing, next,
          dpDelta: next.cost != null ? next.cost - existing.cost : null,
          srpDelta: next.price != null ? next.price - existing.price : null,
        })
      } else plan.unchanged++
    } else if (o.addNew) {
      const lineName = db.lines.find((l) => l.code === line)?.name ?? line
      plan.adds.push({
        id: uid(), line, partNo: partNo.toUpperCase(), description: desc || '(no description)', vendor: lineName,
        cost: dp ?? 0, price: srp ?? 0, onHand: o.overwriteQty && qty != null && Number.isFinite(qty) ? Math.round(qty) : 0,
        bin, supersededBy: sup, priceUpdatedAt: dp != null || srp != null ? now : null,
      })
    } else plan.unchanged++
  }
  return plan
}

export function applyParts(d: DB, plan: PartsPlan) {
  const byId = new Map(d.parts.map((p, i) => [p.id, i]))
  for (const c of plan.changes) {
    const i = byId.get(c.part.id)
    if (i != null) Object.assign(d.parts[i], c.next)
  }
  for (const a of plan.adds) d.parts.push(a) // no spread: 50k+ args can overflow the stack
}

// ---------- Wholegoods plan ----------

export interface WGOptions { line: string; updatePrices: boolean; addNew: boolean }
export interface WGChange { wg: Wholegood; next: Partial<Wholegood> }
export interface WGPlan { changes: WGChange[]; adds: Wholegood[]; unchanged: number; skipped: { row: number; reason: string }[]; duplicates: number; total: number }

const CATS: UnitType[] = ['Push Mower', 'Self-Propelled Mower', 'Zero-Turn Mower', 'Riding Mower', 'Chainsaw', 'String Trimmer', 'Backpack Blower', 'Handheld Blower', 'Hedge Trimmer', 'Edger', 'Pressure Washer', 'Generator', 'Tiller']
function guessCategory(text: string): UnitType {
  const t = text.toLowerCase()
  const direct = CATS.find((c) => t.includes(c.toLowerCase()))
  if (direct) return direct
  if (/zero|ztr|stand[- ]?on|z master|lazer|turf tiger|patriot|radius|cheetah|titan|timecutter/.test(t)) return 'Zero-Turn Mower'
  if (/saw|chain/.test(t)) return 'Chainsaw'
  if (/backpack/.test(t)) return 'Backpack Blower'
  if (/blow/.test(t)) return 'Handheld Blower'
  if (/hedge/.test(t)) return 'Hedge Trimmer'
  if (/edger/.test(t)) return 'Edger'
  if (/trim|brush/.test(t)) return 'String Trimmer'
  if (/self|personal pace|walk/.test(t)) return 'Self-Propelled Mower'
  if (/rid|tractor/.test(t)) return 'Riding Mower'
  return 'Push Mower'
}

export function planWholegoods(db: DB, rows: string[][], headerRow: number, m: Mapping, o: WGOptions): WGPlan {
  const lineByAny = new Map<string, string>()
  for (const l of db.lines) { lineByAny.set(l.code.toUpperCase(), l.code); lineByAny.set(l.name.toUpperCase(), l.code) }
  const bySerial = new Map(db.wholegoods.filter((w) => w.serial).map((w) => [normPartNo(w.serial), w]))
  const get = (r: string[], k: string) => (m[k] >= 0 ? r[m[k]] ?? '' : '')
  const plan: WGPlan = { changes: [], adds: [], unchanged: 0, skipped: [], duplicates: 0, total: 0 }
  const seen = new Set<string>()
  let stock = Math.max(5000, ...db.wholegoods.map((w) => Number(w.stockNo) || 0)) + 1

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => !c)) continue
    plan.total++
    const model = get(r, 'model')
    if (!model) { plan.skipped.push({ row: i + 1, reason: 'No model #' }); continue }
    const serial = get(r, 'serial').toUpperCase()
    if (serial) { if (seen.has(serial)) { plan.duplicates++; continue } seen.add(serial) }
    const dp = parseMoney(get(r, 'dp')), srp = parseMoney(get(r, 'srp'))
    const line = lineByAny.get(get(r, 'line').toUpperCase()) || o.line
    const existing = serial ? bySerial.get(normPartNo(serial)) : undefined
    if (existing) {
      const next: Partial<Wholegood> = {}
      if (o.updatePrices && dp != null && dp !== existing.dp) next.dp = dp
      if (o.updatePrices && srp != null && srp !== existing.srp) next.srp = srp
      if (Object.keys(next).length) plan.changes.push({ wg: existing, next }); else plan.unchanged++
    } else if (o.addNew) {
      const desc = get(r, 'description')
      const recv = get(r, 'receivedAt')
      const recvDate = recv && !Number.isNaN(Date.parse(recv)) ? new Date(recv).toISOString() : new Date().toISOString()
      const year = Number(get(r, 'year')) || new Date().getFullYear()
      plan.adds.push({
        id: uid(), line, stockNo: get(r, 'stockNo') || String(stock++), category: guessCategory(get(r, 'category') + ' ' + desc + ' ' + model),
        model, description: desc, serial, year, condition: 'new', status: 'in_stock', dp: dp ?? 0, srp: srp ?? 0,
        orderedAt: null, receivedAt: recvDate, floorPlan: false, floorPlanDue: null, soldAt: null, soldPrice: null,
        soldToCustomerId: null, customerUnitId: null, notes: '',
      })
    } else plan.unchanged++
  }
  return plan
}

export function applyWholegoods(d: DB, plan: WGPlan) {
  const byId = new Map(d.wholegoods.map((w, i) => [w.id, i]))
  for (const c of plan.changes) {
    const i = byId.get(c.wg.id)
    if (i != null) Object.assign(d.wholegoods[i], c.next)
  }
  for (const a of plan.adds) d.wholegoods.push(a)
}

export function toCSV(rows: (string | number | null)[][]): string {
  return Papa.unparse(rows.map((r) => r.map((c) => (c == null ? '' : c))))
}

export function download(name: string, text: string, type = 'text/csv') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ---------- Customers plan ----------
// Handles a plain customer list, and also an equipment list (one row per unit) —
// rows with a model or serial create customer-owned units under that customer.

export const CUSTOMER_FIELDS: FieldDef[] = [
  { key: 'number', label: 'Customer #', patterns: [/^(cust(omer)?\s*(#|no\.?|num(ber)?|id)|acct|account\s*(#|no))$/i, /cust(omer)?\s*(#|no|num|id)/i, /^(id|#|no\.?)$/i], help: 'Keeps the same customer numbers as your old system. Also used to match on re-import.' },
  { key: 'name', label: 'Full name', patterns: [/^(customer\s*)?name$/i, /^customer$/i, /full\s*name|bill\s*to|display\s*name/i], help: 'Map this OR first + last name.' },
  { key: 'first', label: 'First name', patterns: [/^first(\s*name)?$/i, /first/i] },
  { key: 'last', label: 'Last name', patterns: [/^last(\s*name)?$/i, /last|surname/i] },
  { key: 'company', label: 'Company', patterns: [/^(company|business)(\s*name)?$/i, /company|business|organization/i], help: 'If filled, the customer is marked commercial and the company becomes the name.' },
  { key: 'phone', label: 'Phone', patterns: [/^(home\s*)?phone(\s*(1|#|no\.?|number))?$/i, /^(home|main|primary|day)\s*phone/i, /phone|tel/i] },
  { key: 'altPhone', label: 'Alt phone', patterns: [/^alt(ernate)?\.?\s*phone$/i, /alt|phone\s*2|work\s*phone/i] },
  { key: 'cell', label: 'Cell phone', patterns: [/^(cell|mobile)(\s*phone)?$/i, /cell|mobile/i] },
  { key: 'email', label: 'Email', patterns: [/^e-?mail(\s*address)?$/i, /e-?mail/i] },
  { key: 'address2', label: 'Address line 2', patterns: [/^(address\s*(line\s*)?2|addr\s*2)$/i, /address\s*(line\s*)?2|suite|apt/i] },
  { key: 'address', label: 'Street address', patterns: [/^(street|address(\s*1|\s*line\s*1)?|addr1?)$/i, /address|street/i] },
  { key: 'city', label: 'City', patterns: [/^city$/i, /city/i] },
  { key: 'state', label: 'State', patterns: [/^(state|st|province)$/i, /state/i] },
  { key: 'zip', label: 'ZIP', patterns: [/^(zip|zip\s*code|postal(\s*code)?)$/i, /zip|postal/i] },
  { key: 'category', label: 'Category', patterns: [/^(category|customer\s*(type|category|class)|class)$/i, /categ|cust\w*\s*type/i], help: 'Personal Use, Landscape, Government, Farm… Anything other than personal/residential marks the account commercial.' },
  { key: 'contact1', label: 'Contact 1', patterns: [/^(contact\s*1?|contact\s*name|attn)$/i, /contact\s*1|attention/i] },
  { key: 'contact2', label: 'Contact 2', patterns: [/^contact\s*2$/i, /contact\s*2/i] },
  { key: 'salesman', label: 'Salesman', patterns: [/^(sales\s*(man|person|rep)|salesman)$/i, /sales/i] },
  { key: 'priceLevel', label: 'Price level / discount', patterns: [/^(discount|price\s*(level|code|class|tier)|pricing)$/i, /discount|pric(e|ing)\s*(level|code|class)/i] },
  { key: 'arType', label: 'A/R type', patterns: [/^a\/?r\s*_?typ(e)?$/i, /\ba\/?r\s*typ|account\s*type/i] },
  { key: 'deliveryCode', label: 'Delivery code', patterns: [/^deliv(ery)?\s*code$/i, /deliver|ship\s*via/i] },
  { key: 'creditFlag', label: 'Credit flag', patterns: [/^credit\s*(code|hold|flag)$/i, /credit/i], help: 'TRUE / Y / 1 = flagged. Shows a warning on the customer and their repair orders.' },
  { key: 'notes', label: 'Notes', patterns: [/^(notes?|comments?|memo)$/i, /note|comment|memo/i] },
  { key: 'taxExempt', label: 'Tax exempt', patterns: [/tax\s*(exempt|status|code)|exempt/i], help: 'Yes/Y/1/True/Exempt = exempt.' },
  { key: 'taxable', label: 'Taxable (TaxDefault)', patterns: [/^(tax\s*default|taxable)$/i, /tax\s*default|taxable/i], help: 'The opposite of tax exempt: TRUE = charge tax, FALSE = exempt. Infinity exports this as TaxDefault.' },
  { key: 'createdAt', label: 'Customer since', patterns: [/since|created|date\s*added|open(ed)?\s*date|start\s*date/i] },
  { key: 'unitModel', label: 'Unit model', patterns: [/^model(\s*(#|no\.?|num(ber)?))?$/i, /model/i], help: 'Optional. For equipment lists: each row with a model or serial becomes a unit on that customer.' },
  { key: 'unitSerial', label: 'Unit serial', patterns: [/serial/i, /\bs\/?n\b/i] },
  { key: 'unitMake', label: 'Unit make', patterns: [/^(make|brand|mfg|manufacturer)$/i, /make|brand|manufacturer/i] },
  { key: 'unitType', label: 'Unit type / description', patterns: [/^(unit|equipment|item)\s*(type|desc(ription)?)?$/i, /equip|unit\s*desc|item\s*desc/i] },
]

const BIZ_WORDS = /\b(llc|inc|co|corp|company|lawn|lawns|landscap\w*|mowing|turf|tree|services?|property|properties|grounds|outdoor|construction|church|city of|county|school|isd|farms?|ranch|rentals?|enterprises?|holdings|management|group|solutions)\b/i

export function properCase(s: string, isName = false) {
  // Only touch ALL-CAPS text; leave mixed case alone. Keep short all-letter tokens like "JD", "LLC", "AJ" caps.
  if (s !== s.toUpperCase()) return s
  return s.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (m, a: string, b: string) => {
    if (/^(llc|inc|jd|aj|ii|iii|iv|usa|ok|okc|ne|nw|se|sw|po|ge|us|bj|cj|tj|rv|atv|hoa|isd|ou|osu)$/.test(m)) return m.toUpperCase()
    // In names, a 2–4 letter word with no vowels is an acronym (FCI, DCP, BMX) — but not Jr/Sr/Mr/Dr/St.
    if (isName && /^[bcdfghjklmnpqrstvwxz]{2,4}$/.test(m) && !/^(jr|sr|mr|mrs|dr|st)$/.test(m)) return m.toUpperCase()
    return a.toUpperCase() + b
  })
}

export interface CustomerOptions {
  updateExisting: boolean
  addNew: boolean
  properCaseNames: boolean
  keepNumbers: boolean
}

export interface CustomersPlan {
  adds: Customer[]
  changes: { id: string; next: Partial<Customer>; before: Customer; fields: string[] }[]
  units: Unit[]
  unchanged: number
  skipped: { row: number; reason: string }[]
  duplicates: number
  total: number
  numberConflicts: number
}

const digits = (s: string) => s.replace(/\D/g, '')
function fmtPhoneLoose(v: string) {
  let d = digits(v)
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 0) return ''
  return v.trim() // keep whatever it was (7-digit, extensions…) rather than lose it
}
const truthy = (v: string) => /^(y|yes|true|t|1|x)$/i.test(v.trim())
const yes = (v: string) => /^(y|yes|true|1|x|exempt|tax\s*exempt|e)$/i.test(v.trim())

export function planCustomers(db: DB, rows: string[][], headerRow: number, m: Mapping, o: CustomerOptions): CustomersPlan {
  const get = (r: string[], k: string) => (m[k] >= 0 ? (r[m[k]] ?? '').trim() : '')
  const byNumber = new Map(db.customers.map((c) => [c.number, c]))
  const byPhone = new Map<string, Customer>()
  for (const c of db.customers) { const d = digits(c.phone); if (d.length >= 10) byPhone.set(d.slice(-10), c) }
  const byName = new Map(db.customers.map((c) => [c.name.toUpperCase(), c]))
  const unitKeys = new Set(db.units.map((u) => u.customerId + '|' + normPartNo(u.serial || u.model)))

  const plan: CustomersPlan = { adds: [], changes: [], units: [], unchanged: 0, skipped: [], duplicates: 0, total: 0, numberConflicts: 0 }
  const seenInFile = new Map<string, Customer>() // key → customer created/matched from this file
  const usedNumbers = new Set(db.customers.map((c) => c.number))
  let nextNo = Math.max(db.nextCustomerNumber, ...db.customers.map((c) => c.number + 1))
  const now = new Date().toISOString()

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => !c)) continue
    plan.total++

    const company = get(r, 'company')
    const person = get(r, 'name') || [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' ')
    let name = (company || person).replace(/\s+/g, ' ').trim()
    if (!name) { plan.skipped.push({ row: i + 1, reason: 'No name' }); continue }
    if (o.properCaseNames) name = properCase(name, true)
    const numRaw = digits(get(r, 'number'))
    const num = numRaw ? Number(numRaw) : null
    const phone = fmtPhoneLoose(get(r, 'phone'))
    let cell = fmtPhoneLoose(get(r, 'cell'))
    let alt = fmtPhoneLoose(get(r, 'altPhone'))
    const primary = phone || cell || alt
    if (!phone) { if (cell) cell = ''; else alt = '' } // promoted to main phone
    if (alt && alt === primary) alt = ''
    if (cell && cell === primary) cell = ''
    const fileKey = num != null ? 'n' + num : 'p' + digits(primary).slice(-10) + '|' + name.toUpperCase()

    // Same customer appears on several rows (equipment lists) — only add units.
    let cust = seenInFile.get(fileKey)
    if (!cust) {
      const existing = (num != null && o.keepNumbers ? byNumber.get(num) : undefined)
        ?? (digits(primary).length >= 10 ? byPhone.get(digits(primary).slice(-10)) : undefined)
        ?? byName.get(name.toUpperCase())
      const sinceRaw = get(r, 'createdAt')
      const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null
      const pc = (k: string, isName = false) => { const v = get(r, k).replace(/\s+/g, ' ').trim(); return (o.properCaseNames ? properCase(v, isName) : v) || undefined }
      const category = get(r, 'category') || undefined
      const taxableRaw = get(r, 'taxable')
      const incoming: Partial<Customer> = {
        name, phone: primary, altPhone: alt || undefined, cellPhone: cell || undefined, email: get(r, 'email').toLowerCase(),
        address: pc('address'), address2: pc('address2'), city: pc('city'),
        state: get(r, 'state').toUpperCase() || undefined, zip: get(r, 'zip') || undefined, notes: get(r, 'notes'),
        taxExempt: m.taxExempt >= 0 ? yes(get(r, 'taxExempt')) : m.taxable >= 0 && taxableRaw ? !truthy(taxableRaw) : undefined,
        category, contact1: pc('contact1', true), contact2: pc('contact2', true), salesman: pc('salesman', true),
        priceLevel: get(r, 'priceLevel') || undefined, arType: get(r, 'arType') || undefined,
        deliveryCode: get(r, 'deliveryCode') || undefined,
        creditFlag: m.creditFlag >= 0 && get(r, 'creditFlag') ? truthy(get(r, 'creditFlag')) : undefined,
        isBusiness: !!company || BIZ_WORDS.test(name) || (!!category && !/personal|residential|home|retail/i.test(category)),
      }
      if (existing) {
        cust = existing
        if (o.updateExisting) {
          const next: Partial<Customer> = {}
          const fields: string[] = []
          for (const [k, v] of Object.entries(incoming) as [keyof Customer, unknown][]) {
            if (v === undefined || v === '' ) continue
            if (k === 'isBusiness' && v === false) continue
            if ((existing as unknown as Record<string, unknown>)[k] !== v) { (next as Record<string, unknown>)[k] = v; fields.push(k) }
          }
          if (fields.length) plan.changes.push({ id: existing.id, next, before: existing, fields })
          else plan.unchanged++
        } else plan.unchanged++
      } else if (o.addNew) {
        let number: number
        if (num != null && o.keepNumbers && !usedNumbers.has(num)) number = num
        else { if (num != null && o.keepNumbers) plan.numberConflicts++; while (usedNumbers.has(nextNo)) nextNo++; number = nextNo++ }
        usedNumbers.add(number)
        cust = {
          ...incoming, id: uid(), number, name, phone: primary, email: incoming.email ?? '', isBusiness: !!incoming.isBusiness,
          notes: incoming.notes ?? '', createdAt: since ?? now,
        }
        for (const k of Object.keys(cust) as (keyof Customer)[]) if (cust[k] === undefined) delete cust[k]
        plan.adds.push(cust)
      } else { plan.unchanged++; continue }
      seenInFile.set(fileKey, cust)
    } else plan.duplicates++

    // Optional unit on this row
    const model = get(r, 'unitModel'), serial = get(r, 'unitSerial').toUpperCase()
    if (cust && (model || serial)) {
      const key = cust.id + '|' + normPartNo(serial || model)
      if (!unitKeys.has(key)) {
        unitKeys.add(key)
        const desc = get(r, 'unitType')
        const make = get(r, 'unitMake') || db.lines.find((l) => (desc + ' ' + model).toUpperCase().includes(l.name.toUpperCase()))?.name || ''
        plan.units.push({ id: uid(), customerId: cust.id, type: guessCategory(desc + ' ' + model + ' ' + make), make: o.properCaseNames ? properCase(make) : make, model, serial, engineHours: null })
      }
    }
  }
  return plan
}

export function applyCustomers(d: DB, plan: CustomersPlan) {
  const byId = new Map(d.customers.map((c, i) => [c.id, i]))
  for (const c of plan.changes) { const i = byId.get(c.id); if (i != null) Object.assign(d.customers[i], c.next) }
  for (const c of plan.adds) d.customers.push(c)
  for (const u of plan.units) d.units.push(u)
  d.nextCustomerNumber = Math.max(d.nextCustomerNumber, ...d.customers.map((c) => c.number + 1))
}
