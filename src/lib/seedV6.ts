// Sample data for v6 features, added after the main demo shop is built.
// Uses its own random stream so the rest of the demo (A/R book, statements) is unchanged.
import type { Approval, Customer, DB, FeeLine, NoteKind, RepairOrder, ROStatus, TimelineEvent, Unit } from './types'
import { STATUS_LABEL, round2, roTotals } from './calc'
import { presetLines, quickComplaint } from './jobs'
import { syncLegacyContacts } from './customerRecord'
import { archiveOrders } from './orders'

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ['Bobby', 'Lena', 'Gus', 'Trish', 'Ray', 'Mona', 'Earl', 'Jill', 'Hank', 'Rosa', 'Dale', 'Vera']
const LAST = ['Akers', 'Bettis', 'Coyle', 'Dunham', 'Eads', 'Frye', 'Gaines', 'Hobbs', 'Isom', 'Jett']
const COLORS = ['Orange', 'Red', 'Yellow', 'Green', 'Black', 'Gray']
const BINS = ['Yard A', 'Yard B', 'Bay 1', 'Bay 2', 'Bay 3', 'Loft', 'Back lot']
const FORGOTTEN_JOBS = [
  'Runs rough, surges at full throttle.', 'Won’t start. Sat all winter.', 'Belt keeps coming off the deck.',
  'Pull cord is stuck.', 'Leaking oil from the bottom.', 'Cuts uneven, scalping on the left.', 'Smokes when it runs.',
  'Self-propel stopped working.', 'Needs a tune-up before spring.', 'Hydro drive weak going uphill.',
]

export function seedV6(db: DB, now: number) {
  const r = rng(6062026)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const iso = (daysAgo: number, hours = 0) => new Date(now - daysAgo * 86_400_000 - hours * 3_600_000).toISOString()
  let n = 0
  const id = (p: string) => `${p}6-${(++n).toString(36)}`
  const phone = () => `(405) 555-${String(int(1000, 9999))}`
  const s = db.settings
  const cash = db.customers.find((c) => c.isCash)!
  const biz = db.customers.filter((c) => c.isBusiness && !c.isCash)
  const people = db.customers.filter((c) => !c.isBusiness && !c.isCash)
  const counter = ['Ana R.', 'Ben T.']
  const techs = db.staff.filter((x) => x.role === 'tech')
  const unitsOf = (c: Customer) => db.units.filter((u) => u.customerId === c.id)

  const push = (ro: Omit<RepairOrder, 'id' | 'number'>) => {
    const full = { ...ro, id: id('ro'), number: db.nextRONumber++ } as RepairOrder
    db.ros.push(full)
    return full
  }
  const ev = (at: string, kind: TimelineEvent['kind'], text: string, user = pick(counter)): TimelineEvent => ({ id: id('e'), at, kind, text, user })

  // ---------- Quick tickets ----------
  const jt = (code: string) => s.jobTypes.find((j) => j.code === code)!
  type Q = { code: string; c: Customer; status: ROStatus; age: number; qty: Record<string, number>; fields: Record<string, string | number | boolean>; item?: string; unit?: Unit; walkIn?: boolean; note?: string }
  const sawOf = (c: Customer) => unitsOf(c).find((u) => u.type === 'Chainsaw')
  const mowerOf = (c: Customer) => unitsOf(c).find((u) => /Mower/.test(u.type))
  const tickets: Q[] = [
    // Walk-ins on the Cash Customer
    { code: 'chain', c: cash, status: 'checked_in', age: 0, qty: { sharpen: 2 }, fields: { bar: '18 in', pitch: '.325', gauge: '.050', links: 68 }, item: 'Two loose chains, Husqvarna 450', walkIn: true },
    { code: 'chain', c: cash, status: 'ready', age: 1, qty: { sharpen: 1, bar: 1 }, fields: { bar: '20 in', pitch: '3/8', gauge: '.050', links: 72, onSaw: true }, item: 'Stihl MS 271 Farm Boss', walkIn: true },
    { code: 'tire', c: cash, status: 'in_progress', age: 0, qty: { plug: 1 }, fields: { position: 'Front left', size: '15x6.00-6', tube: 'Tubeless', brought: 'Wheel only' }, item: 'Riding mower front wheel', walkIn: true },
    { code: 'blade', c: cash, status: 'ready', age: 2, qty: { sharpen: 2 }, fields: { size: '21 in', style: 'Mulching' }, item: 'Two push-mower blades', walkIn: true },
    { code: 'tire', c: cash, status: 'ready', age: 41, qty: { tube: 1, mount: 1 }, fields: { position: 'Front (single)', size: '4.10/3.50-6', tube: 'Tubed', brought: 'Wheel only' }, item: 'Wheelbarrow tire', walkIn: true, note: 'Customer said he’d be back Saturday.' },
    // Landscapers drop off blades and chains by the dozen
    { code: 'blade', c: biz[1], status: 'in_progress', age: 1, qty: { sharpen: 12 }, fields: { size: '60 in deck', style: 'High-lift', onDeck: false }, item: '12 blades in a bucket (four 60 in decks)' },
    { code: 'blade', c: biz[2], status: 'checked_in', age: 0, qty: { sharpen: 3, pull: 1 }, fields: { size: '52 in deck', style: 'Standard', onDeck: true }, unit: mowerOf(biz[2]) },
    { code: 'chain', c: biz[4], status: 'checked_in', age: 0, qty: { sharpen: 6 }, fields: { bar: '20 in', pitch: '3/8', gauge: '.050', links: 72 }, item: '6 loops, tree crew', note: 'Need them back by 7 AM tomorrow.' },
    { code: 'chain', c: biz[4], status: 'ready', age: 3, qty: { sharpen: 4, bar: 2 }, fields: { bar: '24 in', pitch: '3/8', gauge: '.058', links: 84 }, item: '4 loops + 2 bars' },
    { code: 'tire', c: biz[0], status: 'checked_in', age: 0, qty: { plug: 2, sealant: 2 }, fields: { position: 'Rear left', size: '24x12.00-12', tube: 'Tubeless', brought: 'On the unit' }, unit: mowerOf(biz[0]) },
  ]
  // Closed quick tickets over the last two months (personal customers and walk-ins only, so the A/R book doesn't change)
  for (let k = 0; k < 14; k++) {
    const code = pick(['chain', 'chain', 'blade', 'blade', 'tire'])
    const c = r() < 0.5 ? cash : pick(people)
    const fields: Q['fields'] = code === 'chain' ? { bar: pick(['16 in', '18 in', '20 in']), pitch: pick(['3/8 LP', '.325', '3/8']), gauge: '.050' }
      : code === 'blade' ? { size: pick(['21 in', '22 in', '42 in deck', '48 in deck']), style: pick(['Standard', 'Mulching', 'High-lift']) }
      : { position: pick(['Front left', 'Front right', 'Rear left']), size: pick(['15x6.00-6', '13x5.00-6', '20x8.00-8']), tube: pick(['Tubeless', 'Tubed']), brought: 'Wheel only' }
    const qty: Record<string, number> = code === 'chain' ? { sharpen: int(1, 3) } : code === 'blade' ? { sharpen: pick([1, 2, 3]) } : { plug: 1 }
    tickets.push({ code, c, status: 'closed', age: int(2, 60), qty, fields, unit: c.isCash ? undefined : (code === 'chain' ? sawOf(c) : mowerOf(c)), item: c.isCash ? pick(['Loose chain', 'Blades in a bag', 'Wheel off a zero-turn', 'Saw, no case']) : undefined, walkIn: c.isCash })
  }

  for (const q of tickets) {
    const t = jt(q.code)
    const fees: FeeLine[] = presetLines(t, q.qty).map((f) => ({ ...f, id: id('f') }))
    const openedAt = iso(q.age, int(1, 6))
    const sum = round2(fees.reduce((a, f) => a + f.amount, 0))
    const who = q.walkIn ? `${pick(FIRST)} ${pick(LAST)}` : (q.c.contact1 ?? q.c.name.split(' ')[0])
    const approvals: Approval[] = sum ? [{ id: id('a'), amount: round2(sum * (1 + s.taxRate)), approvedBy: who, method: 'in_person', at: openedAt, recordedBy: 'Ana R.' }] : []
    const timeline = [ev(openedAt, 'created', `${t.ticketName} ticket opened`)]
    const tech = pick(techs)
    const path: ROStatus[] = q.status === 'checked_in' ? [] : q.status === 'in_progress' ? ['in_progress'] : q.status === 'ready' ? ['in_progress', 'ready'] : ['in_progress', 'ready', 'closed']
    let at = new Date(openedAt).getTime()
    const end = q.status === 'ready' && q.age > 20 ? now - (q.age - 1) * 86_400_000 : Math.min(now - 600_000, at + int(2, 30) * 3_600_000)
    const stepT = path.length ? (end - at) / path.length : 0
    for (const st of path) { at += stepT; timeline.push(ev(new Date(at).toISOString(), 'status', `Status → ${STATUS_LABEL[st]}`, st === 'in_progress' ? tech.name : pick(counter))) }
    if (q.note) timeline.push(ev(openedAt, 'note', q.note))
    const updatedAt = timeline[timeline.length - 1].at
    push({
      customerId: q.c.id, unitId: q.unit?.id ?? '', status: q.status, warranty: false, techId: q.status === 'checked_in' ? null : tech.id,
      openedAt, updatedAt, closedAt: q.status === 'closed' ? updatedAt : null,
      promiseDate: new Date(new Date(openedAt).getTime() + t.promiseHours * 3_600_000).toISOString(),
      complaint: quickComplaint(t, q.qty, ''), cause: '', correction: q.status === 'ready' || q.status === 'closed' ? 'Done as listed.' : '',
      dropOffNotes: q.note ?? '', checklist: { hasFuel: false, bladeOn: false, batteryIncluded: false, accessories: '' },
      labor: [], parts: [], fees, approvals, timeline,
      kind: q.code, jobFields: q.fields, item: q.unit ? undefined : q.item,
      walkIn: q.walkIn ? { name: who, phone: phone() } : undefined,
      tag: `Q${int(10, 99)}`,
    })
  }

  // ---------- Forgotten orders (the pile nobody wants to click through) ----------
  const forgottenPlan: [ROStatus, number, number][] = [
    ['ready', 32, 58], ['ready', 61, 210], ['ready', 61, 210], ['ready', 35, 90], ['ready', 75, 300], ['ready', 40, 59],
    ['estimate', 35, 260], ['estimate', 40, 190], ['estimate', 90, 400], ['estimate', 31, 70],
    ['awaiting_ok', 33, 140], ['awaiting_ok', 45, 220], ['awaiting_ok', 60, 300],
    ['parts_on_order', 25, 80], ['checked_in', 30, 120], ['diagnosing', 28, 90],
  ]
  const forgotten: RepairOrder[] = []
  for (let k = 0; k < 3; k++) for (const [status, lo, hi] of forgottenPlan) {
    const c = pick([...people, ...people, ...biz])
    const unit = pick(unitsOf(c).length ? unitsOf(c) : db.units)
    const idle = int(lo, hi)
    const openedAt = iso(idle + int(2, 25), int(1, 6))
    const updatedAt = iso(idle, int(0, 5))
    const priced = status !== 'checked_in' && status !== 'diagnosing' && r() < 0.8
    const hours = round2(int(5, 30) / 10)
    const labor = priced ? [{ id: id('l'), description: pick(['Diagnose and repair', 'Carb service', 'Tune-up', 'Replace belt', 'Repair as needed']), techId: null, hours, rate: s.laborRate }] : []
    const part = priced && r() < 0.6 ? pick(db.parts.slice(0, 40)) : undefined
    const parts = part ? [{ id: id('pl'), partId: part.id, partNo: part.partNo, description: part.description, qty: 1, unitPrice: part.price, status: (status === 'parts_on_order' ? 'ordered' : 'in_stock') as 'ordered' | 'in_stock' }] : []
    const timeline = [ev(openedAt, 'created', 'Repair order opened'), ev(updatedAt, 'status', `Status → ${STATUS_LABEL[status]}`)]
    if (status === 'ready' && r() < 0.7) timeline.push(ev(updatedAt, 'note', pick(['Called, left voicemail: ready for pickup.', 'Texted that it’s ready.', 'Number disconnected.'])))
    const okd = status !== 'estimate' && status !== 'checked_in' && status !== 'diagnosing' && labor.length > 0 && r() < 0.6
    const approvals: Approval[] = okd ? [{ id: id('a'), amount: round2((hours * s.laborRate + (part?.price ?? 0)) * 1.1), approvedBy: c.isBusiness ? 'Office' : c.name.split(' ')[0], method: 'phone', at: updatedAt, recordedBy: 'Ana R.' }] : []
    forgotten.push(push({
      customerId: c.id, unitId: unit.id, status, warranty: false, techId: status === 'checked_in' ? null : pick(techs).id,
      openedAt, updatedAt, closedAt: null, promiseDate: null,
      complaint: pick(FORGOTTEN_JOBS), cause: priced ? 'See labor lines.' : '', correction: status === 'ready' ? 'Repaired and test run.' : '',
      dropOffNotes: '', checklist: { hasFuel: r() < 0.5, bladeOn: true, batteryIncluded: false, accessories: '' },
      labor, parts, fees: [], approvals, timeline, tag: `${'FGHJK'[k + 1]}${int(10, 99)}`,
    }))
  }
  // Fix the timeline order on items with a note added after the status line
  for (const ro of forgotten) ro.timeline.sort((a, b) => a.at.localeCompare(b.at))

  // A batch archived three weeks ago, so the Archived tab has something to restore.
  const toArchive = forgotten.filter((ro) => ro.status === 'ready' || ro.status === 'estimate').slice(0, 6).map((ro) => ro.id)
  archiveOrders(db, toArchive, { reason: 'abandoned', note: 'Spring clean-out, called twice', partsUsed: false, user: 'Ben T.' })
  for (const ro of db.ros) if (ro.archived && toArchive.includes(ro.id)) {
    ro.archived.at = iso(21)
    ro.timeline[ro.timeline.length - 1].at = iso(21)
    ro.updatedAt = iso(21)
    if (ro.status === 'estimate') { ro.archived.reason = 'declined'; ro.timeline[ro.timeline.length - 1].text = 'Archived: Estimate declined (Spring clean-out, called twice)' }
  }
  db.auditLog.unshift({ id: id('au'), at: iso(21), user: 'Ben T.', action: `Archived ${toArchive.length} orders (spring clean-out)` })

  // ---------- Customer record depth ----------
  const TYPES = ['Owner', 'Office / billing', 'Shop foreman', 'Crew lead']
  for (const c of biz) {
    const names = [c.contact1].filter((x): x is string => !!x)
    const want = r() < 0.6 ? 3 : 2
    while (names.length < want) { const nm = `${pick(FIRST)} ${pick(LAST)}`; if (!names.includes(nm)) names.push(nm) }
    c.contacts = names.map((name, i) => ({
      id: id('ct'), name, type: TYPES[i] ?? 'Other', phone: i === 0 ? c.phone : '', cell: phone(),
      email: i === 1 ? (c.email || '') : '', primary: i === 0, canApprove: i < 2, notes: i === 2 ? 'Drops off equipment most mornings.' : '',
    }))
    syncLegacyContacts(c)
  }
  for (const c of biz.slice(0, 4)) {
    c.shipTos = [
      { id: id('st'), label: 'Main yard', address: c.address ?? '', address2: '', city: c.city ?? '', state: 'OK', zip: c.zip ?? '', phone: c.phone, isDefault: true },
      { id: id('st'), label: pick(['North shop', 'County barn', 'Job site trailer', 'Equipment lot']), address: `${int(100, 9999)} ${pick(['N Council Rd', 'SW 89th St', 'E Reno Ave', 'Sara Rd'])}`, address2: '', city: pick(['Yukon', 'Mustang', 'El Reno']), state: 'OK', zip: pick(['73099', '73064', '73036']), phone: '', isDefault: false },
    ]
  }
  const NOTES: [NoteKind, string][] = [
    ['call', 'Called about pickup. Will come Friday after 3.'],
    ['billing', 'Prefers invoices emailed to the office. Pays net 30 by check.'],
    ['service', 'Runs non-ethanol fuel only. Remind them at pickup.'],
    ['complaint', 'Unhappy the deck belt squealed after the last repair. Checked tension, no charge.'],
    ['general', 'Has a second property in El Reno. Mowers move between them.'],
    ['call', 'Asked for a quote on a new 60 in Scag. Passed to sales.'],
  ]
  for (const c of [...biz.slice(0, 5), ...people.slice(0, 5)]) {
    const count = int(1, 3)
    c.noteLog = Array.from({ length: count }, (_, i) => {
      const [kind, text] = pick(NOTES)
      const ro = db.ros.find((x) => x.customerId === c.id)
      return { id: id('n'), at: iso(int(1, 200)), user: pick(counter), kind, text, pinned: i === 0 && r() < 0.4, roId: kind === 'complaint' ? ro?.id : undefined }
    })
  }

  // ---------- Unit detail ----------
  for (const u of db.units) {
    if (r() < 0.55) u.color = pick(COLORS)
    if (r() < 0.45) {
      const bought = int(60, 1500)
      u.purchaseDate = iso(bought).slice(0, 10)
      if (/Mower/.test(u.type)) u.warrantyUntil = iso(bought - 730).slice(0, 10)
      if (r() < 0.3) { u.espUntil = iso(bought - 1460).slice(0, 10); u.espProvider = pick(['Scag Protection Plan', 'Exmark Extended', 'Dealer ESP']) }
    }
    if (/Zero-Turn|Riding/.test(u.type) && r() < 0.6) { u.engineModel = pick(['Kawasaki FR691V', 'Kawasaki FX730V', 'Briggs 7240', 'Kohler 7000']); u.engineSerial = `E${int(1000000, 9999999)}` }
    const inShop = db.ros.some((ro) => ro.unitId === u.id && ro.status !== 'closed' && !ro.archived)
    if (inShop && r() < 0.7) u.bin = pick(BINS)
  }

  // Totals sanity: no quick ticket with a $0 total
  for (const ro of db.ros) if (ro.kind && roTotals(ro, s).total === 0) ro.fees = presetLines(jt(ro.kind), { [jt(ro.kind).presets[0].id]: 1 })
}
