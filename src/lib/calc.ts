import type { RepairOrder, ROStatus, Settings, PartLineStatus, ApprovalMethod } from './types'

// ---------- Status workflow ----------

export const STATUS_ORDER: ROStatus[] = [
  'estimate',
  'checked_in',
  'diagnosing',
  'awaiting_ok',
  'parts_on_order',
  'in_progress',
  'ready',
  'closed',
]

export const STATUS_LABEL: Record<ROStatus, string> = {
  estimate: 'Estimate',
  checked_in: 'Checked In',
  diagnosing: 'Diagnosing',
  awaiting_ok: 'Awaiting Customer OK',
  parts_on_order: 'Parts On Order',
  in_progress: 'In Progress',
  ready: 'Ready for Pickup',
  closed: 'Closed',
}

// Who the job is waiting on — drives the colour family in the UI.
export const STATUS_WAITING_ON: Record<ROStatus, 'shop' | 'customer' | 'vendor' | 'done'> = {
  estimate: 'customer',
  checked_in: 'shop',
  diagnosing: 'shop',
  awaiting_ok: 'customer',
  parts_on_order: 'vendor',
  in_progress: 'shop',
  ready: 'customer',
  closed: 'done',
}

export const PART_STATUS_LABEL: Record<PartLineStatus, string> = {
  in_stock: 'In Stock',
  ordered: 'Ordered',
  back_ordered: 'Back-Ordered',
  received: 'Received',
}

export const APPROVAL_METHOD_LABEL: Record<ApprovalMethod, string> = {
  phone: 'Phone call',
  text: 'Text message',
  in_person: 'In person',
  email: 'Email',
}

// ---------- Money ----------

export const round2 = (n: number) => Math.round(n * 100) / 100

export interface Totals {
  labor: number
  laborHours: number
  parts: number
  fees: number
  taxable: number
  tax: number
  total: number
}

/** `exempt` = the customer is tax exempt (farm, government, reseller…). */
export function roTotals(ro: RepairOrder, s: Settings, exempt = false): Totals {
  const laborHours = ro.labor.reduce((a, l) => a + l.hours, 0)
  const labor = round2(ro.labor.reduce((a, l) => a + l.hours * l.rate, 0))
  const parts = round2(ro.parts.reduce((a, p) => a + p.qty * p.unitPrice, 0))
  const fees = round2(ro.fees.reduce((a, f) => a + f.amount, 0))
  const taxableFees = ro.fees.filter((f) => f.taxable).reduce((a, f) => a + f.amount, 0)
  // Warranty work is billed to the manufacturer — no sales tax to the customer.
  const taxable = ro.warranty || exempt ? 0 : round2(parts + taxableFees + (s.taxLabor ? labor : 0))
  const tax = round2(taxable * s.taxRate)
  const total = round2(labor + parts + fees + tax)
  return { labor, laborHours, parts, fees, taxable, tax, total }
}

export const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

// ---------- Time / aging ----------

const DAY = 86_400_000

export const daysBetween = (a: string | number | Date, b: string | number | Date = Date.now()) =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / DAY)

export const daysOpen = (ro: RepairOrder) =>
  daysBetween(ro.openedAt, ro.closedAt ?? Date.now())

export const daysIdle = (ro: RepairOrder) => daysBetween(ro.updatedAt)

export type AgeBucket = '0–7' | '8–30' | '31–90' | '90+'
export const AGE_BUCKETS: AgeBucket[] = ['0–7', '8–30', '31–90', '90+']
export function ageBucket(days: number): AgeBucket {
  if (days <= 7) return '0–7'
  if (days <= 30) return '8–30'
  if (days <= 90) return '31–90'
  return '90+'
}

export type Flag = 'stale' | 'zero' | 'parts_wait' | 'overdue' | 'unapproved_work'

export const FLAG_LABEL: Record<Flag, string> = {
  stale: 'Stale',
  zero: '$0 / no estimate',
  parts_wait: 'Long parts wait',
  overdue: 'Past promise date',
  unapproved_work: 'Work over approved amount',
}

/** Problems worth a human looking at. */
export function roFlags(ro: RepairOrder, s: Settings): Flag[] {
  if (ro.status === 'closed') return []
  const flags: Flag[] = []
  const t = roTotals(ro, s)
  if (daysIdle(ro) >= s.staleDays) flags.push('stale')
  if (t.total === 0 && ro.status !== 'checked_in' && ro.status !== 'diagnosing') flags.push('zero')
  if (ro.status === 'parts_on_order' && daysIdle(ro) >= s.partsWaitDays) flags.push('parts_wait')
  if (ro.promiseDate && daysBetween(ro.promiseDate) > 0 && ro.status !== 'ready') flags.push('overdue')
  const approved = ro.approvals.reduce((m, a) => Math.max(m, a.amount), 0)
  const workStarted = ['in_progress', 'ready'].includes(ro.status)
  if (workStarted && !ro.warranty && t.total > approved + 0.01) flags.push('unapproved_work')
  return flags
}

export const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

// ---------- Customers ----------

/** Categories seen in Infinity exports; the field is free text, these are just suggestions. */
export const CUSTOMER_CATEGORIES = ['Personal Use', 'Commercial', 'Landscape', 'Farm', 'Government', 'Church', 'Non Profit', 'Financing Company']

/** Every phone number on a customer, labelled, de-duplicated. */
export function customerPhones(c: { phone: string; altPhone?: string; cellPhone?: string }) {
  const out: { label: string; value: string }[] = []
  const seen = new Set<string>()
  for (const [label, v] of [['Phone', c.phone], ['Cell', c.cellPhone], ['Alt', c.altPhone]] as const) {
    const d = (v ?? '').replace(/\D/g, '')
    if (!d || seen.has(d)) continue
    seen.add(d); out.push({ label, value: v! })
  }
  return out
}
