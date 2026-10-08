// Accounts receivable math. Pure functions over the ledger — no UI, no store.
//
// How money is matched to charges (nothing about this is stored except the
// person's explicit choices, so it can't drift):
//   1. Applications someone pinned on a payment/credit ("this check pays RO 10422").
//   2. Deposits and anything else tied to an RO pay that RO's charges.
//   3. Everything left pays the oldest charges first (open item).
// A deposit for an RO that is still open is held for that RO and doesn't pay other bills.
//
// Every function can be run "as of" a past date, which is what statements and
// month-end history use. A void only counts from the moment it was made.
import type { ArEntry, ArSnapshot, Customer, DB, Settings } from './types'
import { round2, uid } from './calc'

export const AGING = ['Current', '31–60', '61–90', 'Over 90'] as const
export type AgingBucket = (typeof AGING)[number]

const DAY = 86_400_000
const ageDays = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY))
export const bucketOf = (days: number): AgingBucket => (days <= 30 ? 'Current' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : 'Over 90')

export const isDebit = (e: ArEntry) => e.kind === 'charge' || e.kind === 'refund'
export const signed = (e: ArEntry) => (isDebit(e) ? e.amount : -e.amount)
/** Counts right now. */
export const live = (e: ArEntry) => !e.voided
/** Counted on date `t` (posted by then, not yet voided). */
export const liveAt = (e: ArEntry, t: number) => new Date(e.at).getTime() <= t && (!e.voided || new Date(e.voided.at).getTime() > t)

export const isBalanceForward = (c: Pick<Customer, 'arType'>) => /balance\s*fwd|balance\s*forward|^bf$/i.test(c.arType ?? '')

export interface OpenCharge { entry: ArEntry; remaining: number; days: number; pastDue: boolean }

export interface Account {
  balance: number // positive = they owe us; negative = credit balance
  charged: number
  paid: number
  open: OpenCharge[] // charges/refunds with money still owed, oldest first
  aging: Record<AgingBucket, number>
  pastDue: number // owed on charges older than their terms
  held: number // deposits held for ROs that are still open
  unapplied: number // credit not matched to anything and not held (a credit balance)
  creditLeft: Map<string, number> // per payment/credit: dollars not yet matched to a charge
  paidOn: Map<string, { creditId: string; amount: number }[]> // per charge: what paid it
  lastPayment: ArEntry | null
  overLimit: boolean
  terms: number
}

export interface AccountOpts {
  now?: number // "as of" this moment (default: now)
  openROs?: Set<string> // RO ids not closed yet — their deposits are held
}

export function accountOf(entries: ArEntry[], c: Pick<Customer, 'creditLimit' | 'termsDays'>, s: Settings, opts: AccountOpts = {}): Account {
  const now = opts.now ?? Date.now()
  const rows = entries.filter((e) => liveAt(e, now)).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  const debits = rows.filter(isDebit)
  const credits = rows.filter((e) => !isDebit(e))
  const terms = c.termsDays ?? s.arTermsDays

  const rem = new Map(debits.map((e) => [e.id, e.amount]))
  const left = new Map(credits.map((e) => [e.id, e.amount]))
  const paidOn = new Map<string, { creditId: string; amount: number }[]>()
  const apply = (cr: ArEntry, dId: string, want: number) => {
    const x = round2(Math.min(want, rem.get(dId) ?? 0, left.get(cr.id) ?? 0))
    if (x <= 0) return
    rem.set(dId, round2(rem.get(dId)! - x))
    left.set(cr.id, round2(left.get(cr.id)! - x))
    const a = paidOn.get(dId); const row = { creditId: cr.id, amount: x }
    if (a) a.push(row); else paidOn.set(dId, [row])
  }
  // 1. Pinned applications
  for (const cr of credits) for (const ap of cr.applications ?? []) apply(cr, ap.chargeId, ap.amount)
  // 2. RO-linked money pays that RO's charges
  for (const cr of credits) if (cr.roId) for (const d of debits) if (d.roId === cr.roId) apply(cr, d.id, Infinity)
  // 3. Oldest first — except deposits still held for an open RO
  const isHeld = (cr: ArEntry) => !!(cr.deposit && cr.roId && opts.openROs?.has(cr.roId))
  for (const cr of credits) {
    if (isHeld(cr)) continue
    for (const d of debits) { if ((left.get(cr.id) ?? 0) <= 0) break; apply(cr, d.id, Infinity) }
  }

  const open: OpenCharge[] = []
  for (const d of debits) {
    const r = rem.get(d.id) ?? 0
    if (r > 0.004) { const days = ageDays(d.at, now); open.push({ entry: d, remaining: r, days, pastDue: days > terms }) }
  }
  const aging = { Current: 0, '31–60': 0, '61–90': 0, 'Over 90': 0 } as Record<AgingBucket, number>
  for (const o of open) aging[bucketOf(o.days)] = round2(aging[bucketOf(o.days)] + o.remaining)
  let held = 0, unapplied = 0
  for (const cr of credits) { const l = left.get(cr.id) ?? 0; if (isHeld(cr)) held += l; else unapplied += l }
  const charged = round2(debits.reduce((a, e) => a + e.amount, 0))
  const paid = round2(credits.reduce((a, e) => a + e.amount, 0))
  const balance = round2(charged - paid)
  const pays = credits.filter((e) => e.kind === 'payment')
  return {
    balance, charged, paid, open, aging, terms, paidOn,
    pastDue: round2(open.filter((o) => o.pastDue).reduce((a, o) => a + o.remaining, 0)),
    held: round2(held), unapplied: round2(unapplied), creditLeft: left,
    lastPayment: pays.length ? pays[pays.length - 1] : null,
    overLimit: !!c.creditLimit && balance > c.creditLimit,
  }
}

export const openROIds = (db: DB) => new Set(db.ros.filter((r) => r.status !== 'closed').map((r) => r.id))

/** Ledger lines grouped per customer (live and voided). */
export function arByCustomer(db: DB) {
  const m = new Map<string, ArEntry[]>()
  for (const e of db.ar) { const a = m.get(e.customerId); if (a) a.push(e); else m.set(e.customerId, [e]) }
  return m
}

/** Every customer with ledger activity → their account. */
export function allAccounts(db: DB, now = Date.now()) {
  const by = arByCustomer(db)
  const openROs = openROIds(db)
  const out = new Map<string, Account>()
  for (const c of db.customers) {
    const e = by.get(c.id)
    if (e?.length) out.set(c.id, accountOf(e, c, db.settings, { now, openROs }))
  }
  return out
}

export function accountFor(db: DB, c: Customer, now?: number) {
  return accountOf(db.ar.filter((e) => e.customerId === c.id), c, db.settings, { now, openROs: openROIds(db) })
}

/** Ledger lines oldest → newest with the running balance after each (voided lines don't move it). */
export function withRunningBalance(entries: ArEntry[]) {
  const rows = [...entries].sort((x, y) => x.at.localeCompare(y.at) || (isDebit(x) ? -1 : 1))
  const out: { e: ArEntry; bal: number }[] = []
  let run = 0
  for (const e of rows) { if (live(e)) run = round2(run + signed(e)); out.push({ e, bal: run }) }
  return out
}

// ---------- Repair orders ----------

export interface ROBilling {
  charges: ArEntry[] // live charges for this RO (partial bills + the final)
  billed: number
  deposits: ArEntry[] // live deposits taken for this RO
  deposited: number
}
export function roBilling(db: DB, roId: string): ROBilling {
  const mine = db.ar.filter((e) => e.roId === roId && live(e))
  const charges = mine.filter((e) => e.kind === 'charge')
  const deposits = mine.filter((e) => e.kind === 'payment' && e.deposit)
  return {
    charges, billed: round2(charges.reduce((a, e) => a + e.amount, 0)),
    deposits, deposited: round2(deposits.reduce((a, e) => a + e.amount, 0)),
  }
}

/**
 * What's left to settle on an RO at pickup:
 * total − deposits − whatever was billed to the account that the deposits didn't already pay.
 */
export function roSettlement(db: DB, roId: string, total: number) {
  const b = roBilling(db, roId)
  const ro = db.ros.find((r) => r.id === roId)
  const c = ro && db.customers.find((x) => x.id === ro.customerId)
  let depositPaidBills = 0
  if (c && b.charges.length && b.deposits.length) {
    const a = accountFor(db, c)
    const depIds = new Set(b.deposits.map((d) => d.id))
    for (const ch of b.charges) for (const p of a.paidOn.get(ch.id) ?? []) if (depIds.has(p.creditId)) depositPaidBills += p.amount
  }
  const onAccount = round2(b.billed - depositPaidBills) // billed, and owed through the account
  const due = round2(total - b.deposited - onAccount)
  return { ...b, onAccount, due: Math.max(0, due), leftover: Math.max(0, -due) }
}

// ---------- Statements ----------

const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayYMD = () => ymd(new Date())
/** A date input → ISO. Today means "now", so it sorts after earlier activity today. */
export const atFromDate = (date: string) => (date === todayYMD() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString())
/** End of that local day, as a timestamp. */
export const endOfDay = (date: string) => new Date(`${date}T23:59:59.999`).getTime()

/** Cycle-close date for a month (statementDay 0 = last day). */
function closeIn(year: number, month: number, day: number) {
  const last = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, day <= 0 ? last : Math.min(day, last))
}
/** The most recent cycle close on or before `today`. */
export function lastCycleClose(s: Settings, today = new Date()): string {
  let d = closeIn(today.getFullYear(), today.getMonth(), s.statementDay)
  if (d > today) d = closeIn(today.getFullYear(), today.getMonth() - 1, s.statementDay)
  return ymd(d)
}
/** The cycle close before `date` (the start of that statement's period). */
export function previousCycleClose(s: Settings, date: string): string {
  const d = new Date(`${date}T12:00:00`)
  return ymd(closeIn(d.getFullYear(), d.getMonth() - 1, s.statementDay))
}

export interface Statement {
  c: Customer
  date: string
  from: string // period start (exclusive), the previous cycle close
  balanceForward: boolean
  acct: Account
  previous: number // balance at the previous close
  activity: ArEntry[] // posted in the period, live on the statement date
  due: number
  pastDue: number
}

export function statementFor(db: DB, c: Customer, date: string): Statement {
  const end = endOfDay(date)
  const from = previousCycleClose(db.settings, date)
  const start = endOfDay(from)
  const mine = db.ar.filter((e) => e.customerId === c.id)
  const acct = accountOf(mine, c, db.settings, { now: end, openROs: openROIds(db) })
  const prior = accountOf(mine, c, db.settings, { now: start, openROs: openROIds(db) })
  const activity = mine.filter((e) => liveAt(e, end) && new Date(e.at).getTime() > start)
    .sort((a, b) => a.at.localeCompare(b.at))
  return {
    c, date, from, balanceForward: isBalanceForward(c), acct, previous: prior.balance,
    activity, due: Math.max(0, acct.balance), pastDue: acct.pastDue,
  }
}

/** Who gets a statement for this date: a balance over the minimum, or any activity in the period. */
export function statementCandidates(db: DB, date: string) {
  const by = arByCustomer(db)
  const out: Statement[] = []
  for (const c of db.customers) {
    if (c.isCash || !by.get(c.id)?.length) continue
    const st = statementFor(db, c, date)
    // Deposits held for open work aren't a balance to bill or report.
    const billable = round2(st.acct.balance + st.acct.held)
    const realActivity = st.activity.some((e) => !e.deposit)
    if (Math.abs(billable) >= db.settings.statementMinBalance || realActivity) out.push(st)
  }
  return out.sort((a, b) => a.c.name.localeCompare(b.c.name))
}

// ---------- Month-end history ----------

export const monthEnd = (period: string) => { const [y, m] = period.split('-').map(Number); return ymd(new Date(y, m, 0)) }
export const periodLabel = (period: string) => { const [y, m] = period.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

/** Freeze every account as of the last day of `period` (YYYY-MM). */
export function snapshotFor(db: DB, period: string, user: string, closedAt = new Date().toISOString(), asOfOverride?: number): ArSnapshot {
  const asOf = asOfOverride ?? endOfDay(monthEnd(period))
  const accounts: ArSnapshot['accounts'] = []
  const t = { balance: 0, current: 0, d31: 0, d61: 0, d91: 0, pastDue: 0, credit: 0, accounts: 0 }
  const by = arByCustomer(db)
  const openROs = openROIds(db)
  for (const c of db.customers) {
    const e = by.get(c.id)
    if (!e?.length) continue
    const a = accountOf(e, c, db.settings, { now: asOf, openROs })
    if (Math.abs(a.balance) < 0.005 && !a.open.length) continue
    accounts.push({ customerId: c.id, number: c.number, name: c.name, balance: a.balance,
      current: a.aging.Current, d31: a.aging['31–60'], d61: a.aging['61–90'], d91: a.aging['Over 90'] })
    if (a.balance > 0) { t.balance += a.balance; t.accounts++ } else t.credit += -a.balance
    t.current += a.aging.Current; t.d31 += a.aging['31–60']; t.d61 += a.aging['61–90']; t.d91 += a.aging['Over 90']
    t.pastDue += a.pastDue
  }
  for (const k of Object.keys(t) as (keyof typeof t)[]) if (k !== 'accounts') t[k] = round2(t[k])
  accounts.sort((a, b) => b.balance - a.balance)
  return { id: uid(), period, asOf: new Date(asOf).toISOString(), closedAt, user, totals: t, accounts }
}

/** Live charge that bills an RO in full (not a partial), if any. */
export const chargeForRO = (db: DB, roId: string) => db.ar.find((e) => e.roId === roId && e.kind === 'charge' && !e.partial && live(e))

export const PAY_METHOD_LABEL = { cash: 'Cash', check: 'Check', card: 'Card', other: 'Other' } as const
export const KIND_LABEL = { charge: 'Charge', payment: 'Payment', credit: 'Credit', refund: 'Refund' } as const
