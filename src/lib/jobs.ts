// Quick tickets: chain, blade and tire jobs (and any job type the shop adds in Settings).
// A quick ticket is still a RepairOrder; `kind` says which job type it is.
import type { FeeLine, JobType, RepairOrder, ROStatus, Settings, Unit } from './types'
import { STATUS_ORDER, round2, uid } from './calc'

const sel = (key: string, label: string, options: string[]) => ({ key, label, type: 'select' as const, options, placeholder: '' })
const txt = (key: string, label: string, placeholder = '') => ({ key, label, type: 'text' as const, options: [], placeholder })
const num = (key: string, label: string, placeholder = '') => ({ key, label, type: 'number' as const, options: [], placeholder })
const yes = (key: string, label: string) => ({ key, label, type: 'yesno' as const, options: [], placeholder: '' })
const pre = (id: string, label: string, price: number, taxable = true) => ({ id, label, price, taxable })

/** Starting job types. Prices are placeholders; the shop sets real ones in Settings. */
export const DEFAULT_JOB_TYPES: JobType[] = [
  {
    code: 'chain', name: 'Chain', ticketName: 'Chain service', icon: 'chain', active: true, unitRequired: false, skipDiagnose: true,
    promiseHours: 24, qtyLabel: 'chains',
    fields: [
      sel('bar', 'Bar length', ['12 in', '14 in', '16 in', '18 in', '20 in', '24 in', '28 in', '32 in', '36 in']),
      sel('pitch', 'Pitch', ['1/4', '.325', '3/8 LP', '3/8', '.404']),
      sel('gauge', 'Gauge', ['.043', '.050', '.058', '.063']),
      num('links', 'Drive links', 'e.g. 72'),
      yes('onSaw', 'Brought in on the saw'),
    ],
    presets: [pre('sharpen', 'Sharpen chain', 12.95), pre('bar', 'Dress / true bar', 9.95), pre('replace', 'Install new chain (labor)', 8)],
  },
  {
    code: 'blade', name: 'Blade', ticketName: 'Blade service', icon: 'blade', active: true, unitRequired: false, skipDiagnose: true,
    promiseHours: 24, qtyLabel: 'blades',
    fields: [
      txt('size', 'Blade length / deck', 'e.g. 21 in, or 60 in deck'),
      sel('style', 'Blade type', ['Standard', 'Mulching', 'High-lift', 'Gator / 3-in-1']),
      yes('onDeck', 'Blades still on the mower'),
    ],
    presets: [pre('sharpen', 'Sharpen & balance blade', 7.95), pre('pull', 'Pull & reinstall blades (per deck)', 15), pre('replace', 'Install new blade (labor)', 5)],
  },
  {
    code: 'tire', name: 'Tire / flat', ticketName: 'Tire repair', icon: 'tire', active: true, unitRequired: false, skipDiagnose: true,
    promiseHours: 4, qtyLabel: 'tires',
    fields: [
      sel('position', 'Position', ['Front left', 'Front right', 'Rear left', 'Rear right', 'Front (single)', 'Other']),
      txt('size', 'Tire size', 'e.g. 20x10.00-8'),
      sel('tube', 'Tube', ['Tubeless', 'Tubed']),
      sel('brought', 'Brought in as', ['Wheel only', 'On the unit']),
    ],
    presets: [pre('plug', 'Plug / patch', 12), pre('tube', 'Install tube (labor)', 15), pre('mount', 'Dismount & mount tire', 10), pre('sealant', 'Add tire sealant', 8), pre('stem', 'Replace valve stem', 6)],
  },
]

export const JOB_STATUSES: ROStatus[] = ['checked_in', 'in_progress', 'ready', 'closed']

export function jobTypeOf(s: Settings, ro: Pick<RepairOrder, 'kind'>): JobType | undefined {
  return ro.kind ? s.jobTypes.find((j) => j.code === ro.kind) : undefined
}

/** Statuses to show on the RO pipeline. Quick tickets skip diagnose / awaiting OK / parts. */
export function statusesFor(s: Settings, ro: RepairOrder): ROStatus[] {
  const jt = jobTypeOf(s, ro)
  if (!jt?.skipDiagnose) return STATUS_ORDER
  return JOB_STATUSES.includes(ro.status) ? JOB_STATUSES : [ro.status, ...JOB_STATUSES].filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b))
}

/** "Bar length 20 in · Pitch .325 · 72 drive links" */
export function jobFieldsLine(jt: JobType | undefined, f: RepairOrder['jobFields']) {
  if (!jt || !f) return ''
  return jt.fields.map((x) => {
    const v = f[x.key]
    if (v === undefined || v === '' || v === false) return ''
    if (x.type === 'yesno') return x.label
    return `${x.label} ${v}`
  }).filter(Boolean).join(' · ')
}

/** Service lines for the chosen presets and quantities. */
export function presetLines(jt: JobType, qty: Record<string, number>): FeeLine[] {
  return jt.presets.filter((p) => (qty[p.id] ?? 0) > 0).map((p) => {
    const q = qty[p.id]
    return { id: uid(), description: p.label, qty: q, each: p.price, amount: round2(q * p.price), taxable: p.taxable }
  })
}

/** Plain-English complaint line for the ticket: "Sharpen chain ×3, Dress / true bar ×1". */
export function quickComplaint(jt: JobType, qty: Record<string, number>, note: string) {
  const what = jt.presets.filter((p) => (qty[p.id] ?? 0) > 0).map((p) => `${p.label} ×${qty[p.id]}`).join(', ')
  return [what || jt.ticketName, note.trim()].filter(Boolean).join('. ')
}

/** What to show in a "Unit" column: the unit, or the free-text item on a quick ticket. */
export function unitText(ro: RepairOrder, u: Unit | undefined) {
  if (u) return { main: `${u.make} ${u.model}`.trim(), sub: `${u.type}${u.serial ? ' · ' + u.serial : ''}` }
  return { main: ro.item || '—', sub: '' }
}

/** A new code for a job type the shop adds ("pressure-wash" → "pressure-wash-2" if taken). */
export function newJobCode(name: string, taken: string[]) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'job'
  let code = base, n = 2
  while (taken.includes(code) || code === 'repair' || code === 'estimate') code = `${base}-${n++}`
  return code
}
