// Accounts receivable math. Pure functions over the ledger — no UI, no store.
//
// Allocation: open item, oldest first. Every payment and credit is applied to the
// oldest unpaid charge(s). Nothing about allocation is stored yet, so it can't drift;
// manual "apply this check to that invoice" is a later phase.
import type { ArEntry, Customer, DB, Settings } from './types'
import { round2 } from './calc'

export const AGING = ['Current', '31–60', '61–90', 'Over 90'] as const
export type AgingBucket = (typeof AGING)[number]

const DAY = 86_400_000
const ageDays = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / DAY)
export const bucketOf = (days: number): AgingBucket => (days <= 30 ? 'Current' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : 'Over 90')

export interface OpenCharge { entry: ArEntry; remaining: number; days: number; pastDue: boolean }

export interface Account {
  balance: number // positive = they owe us; negative = credit balance
  charged: number
  paid: number
  open: OpenCharge[] // charges with money still owed, oldest first
  aging: Record<AgingBucket, number>
  pastDue: number // owed on charges older than their terms
  unapplied: number // payments/credits beyond everything charged (credit balance)
  lastPayment: ArEntry | null
  overLimit: boolean
  terms: number
}

export const live = (e: ArEntry) => !e.voided
export const signed = (e: ArEntry) => (e.kind === 'charge' ? e.amount : -e.amount)

export function accountOf(entries: ArEntry[], c: Pick<Customer, 'creditLimit' | 'termsDays'>, s: Settings, now = Date.now()): Account {
  const rows = entries.filter(live).sort((a, b) => a.at.localeCompare(b.at))
  const charges = rows.filter((e) => e.kind === 'charge')
  const credits = rows.filter((e) => e.kind !== 'charge')
  const charged = round2(charges.reduce((a, e) => a + e.amount, 0))
  const paid = round2(credits.reduce((a, e) => a + e.amount, 0))
  const terms = c.termsDays ?? s.arTermsDays

  let pool = paid
  const open: OpenCharge[] = []
  for (const e of charges) {
    const applied = Math.min(pool, e.amount)
    pool = round2(pool - applied)
    const remaining = round2(e.amount - applied)
    if (remaining > 0.004) {
      const days = ageDays(e.at, now)
      open.push({ entry: e, remaining, days, pastDue: days > terms })
    }
  }
  const aging = { Current: 0, '31–60': 0, '61–90': 0, 'Over 90': 0 } as Record<AgingBucket, number>
  for (const o of open) aging[bucketOf(o.days)] = round2(aging[bucketOf(o.days)] + o.remaining)
  const balance = round2(charged - paid)
  const pays = credits.filter((e) => e.kind === 'payment')
  return {
    balance, charged, paid, open, aging, terms,
    pastDue: round2(open.filter((o) => o.pastDue).reduce((a, o) => a + o.remaining, 0)),
    unapplied: round2(pool),
    lastPayment: pays.length ? pays[pays.length - 1] : null,
    overLimit: !!c.creditLimit && balance > c.creditLimit,
  }
}

/** Ledger lines grouped per customer (live and voided). */
export function arByCustomer(db: DB) {
  const m = new Map<string, ArEntry[]>()
  for (const e of db.ar) { const a = m.get(e.customerId); if (a) a.push(e); else m.set(e.customerId, [e]) }
  return m
}

/** Every customer with ledger activity → their account. */
export function allAccounts(db: DB, now = Date.now()) {
  const by = arByCustomer(db)
  const out = new Map<string, Account>()
  for (const c of db.customers) {
    const e = by.get(c.id)
    if (e?.length) out.set(c.id, accountOf(e, c, db.settings, now))
  }
  return out
}

/** Ledger lines oldest → newest with the running balance after each (voided lines don't move it). */
export function withRunningBalance(entries: ArEntry[]) {
  const rows = [...entries].sort((x, y) => x.at.localeCompare(y.at) || (x.kind === 'charge' ? -1 : 1))
  const out: { e: ArEntry; bal: number }[] = []
  let run = 0
  for (const e of rows) { if (live(e)) run = round2(run + signed(e)); out.push({ e, bal: run }) }
  return out
}

/** The live charge posted for a repair order, if any. */
export const chargeForRO = (db: DB, roId: string) => db.ar.find((e) => e.roId === roId && e.kind === 'charge' && live(e))

export const PAY_METHOD_LABEL = { cash: 'Cash', check: 'Check', card: 'Card', other: 'Other' } as const
export const KIND_LABEL = { charge: 'Charge', payment: 'Payment', credit: 'Credit' } as const
