// Order history, the "forgotten" queue, and archiving.
// Archive is not delete and not close: closed = billed; archived = put away without billing.
import type { ArchiveReason, DB, RepairOrder, Settings } from './types'
import { daysIdle, uid } from './calc'

/** Open = still on the board: not closed and not archived. */
export const isOpenRO = (ro: RepairOrder) => ro.status !== 'closed' && !ro.archived

export const ARCHIVE_REASON_LABEL: Record<ArchiveReason, string> = {
  abandoned: 'Abandoned (never picked up)',
  declined: 'Estimate declined',
  no_response: 'No response from customer',
  duplicate: 'Duplicate ticket',
  done_elsewhere: 'Done elsewhere / took it back',
  other: 'Other',
}

export type ForgottenKind = 'pickup' | 'estimate' | 'awaiting_ok' | 'parts' | 'stale'
export const FORGOTTEN_LABEL: Record<ForgottenKind, string> = {
  pickup: 'Ready, never picked up',
  estimate: 'Estimate never approved',
  awaiting_ok: 'Waiting on the customer’s OK',
  parts: 'Waiting on parts too long',
  stale: 'No activity',
}
export const FORGOTTEN_ORDER: ForgottenKind[] = ['pickup', 'estimate', 'awaiting_ok', 'parts', 'stale']

export interface Forgotten { kind: ForgottenKind; idle: number; suggest: ArchiveReason; why: string }

/** Why an open order counts as forgotten, or null. One reason per order, the first that fits. */
export function forgottenOf(ro: RepairOrder, s: Settings): Forgotten | null {
  if (!isOpenRO(ro)) return null
  const idle = daysIdle(ro)
  if (ro.status === 'ready' && idle >= s.pickupForgottenDays) {
    const abandoned = idle >= s.abandonedDays
    return { kind: 'pickup', idle, suggest: abandoned ? 'abandoned' : 'no_response', why: `Ready ${idle} days${abandoned ? ' · likely abandoned' : ''}` }
  }
  if (ro.status === 'estimate' && idle >= s.estimateForgottenDays) return { kind: 'estimate', idle, suggest: 'declined', why: `Estimate untouched ${idle} days` }
  if (ro.status === 'awaiting_ok' && idle >= s.estimateForgottenDays) return { kind: 'awaiting_ok', idle, suggest: 'no_response', why: `No answer in ${idle} days` }
  if (ro.status === 'parts_on_order' && idle >= Math.max(s.partsWaitDays, s.staleDays)) return { kind: 'parts', idle, suggest: 'other', why: `Parts wait ${idle} days` }
  if (idle >= s.staleDays && ro.status !== 'ready') return { kind: 'stale', idle, suggest: 'other', why: `Nothing logged in ${idle} days` }
  return null
}

/** Money on the customer's account tied to this RO (deposits or bills). Those must be settled before archiving. */
export function archiveBlocker(db: DB, ro: RepairOrder): string | null {
  if (ro.status === 'closed') return 'Closed (already billed)'
  if (ro.archived) return 'Already archived'
  const tied = db.ar.filter((e) => e.roId === ro.id && !e.voided)
  if (tied.some((e) => e.deposit)) return 'Has a deposit on account'
  if (tied.some((e) => e.kind === 'charge')) return 'Has a bill on account'
  return null
}

/**
 * Archive orders on an Immer draft. Returns the batch id (for Undo) and how many were archived.
 * `partsUsed`: the stocked parts on these orders were installed or scrapped, so take them out of inventory.
 */
export function archiveOrders(d: DB, ids: string[], opts: { reason: ArchiveReason; note: string; partsUsed: boolean; user: string; batch?: string }) {
  const batch = opts.batch ?? uid()
  const at = new Date().toISOString()
  const done: number[] = []
  for (const id of ids) {
    const ro = d.ros.find((r) => r.id === id)
    if (!ro || archiveBlocker(d, ro)) continue
    ro.archived = { at, by: opts.user, reason: opts.reason, note: opts.note.trim(), partsUsed: opts.partsUsed, batch }
    if (opts.partsUsed) moveStock(d, ro, -1)
    ro.timeline.push({ id: uid(), at, kind: 'status', user: opts.user,
      text: `Archived: ${ARCHIVE_REASON_LABEL[opts.reason]}${opts.note.trim() ? ` (${opts.note.trim()})` : ''}${opts.partsUsed ? ' · parts taken out of inventory' : ''}` })
    done.push(ro.number)
  }
  return { batch, numbers: done }
}

/** Put archived orders back on the board. Parts taken out at archive go back into stock (they come out again at close). */
/** `undo`: reversing an archive just made, so the order keeps its old activity date (and stays "forgotten" if it was). */
export function restoreOrders(d: DB, ids: string[], user: string, why = 'Restored from archive', undo = false) {
  const at = new Date().toISOString()
  const done: number[] = []
  for (const id of ids) {
    const ro = d.ros.find((r) => r.id === id)
    if (!ro?.archived) continue
    if (ro.archived.partsUsed) moveStock(d, ro, +1)
    delete ro.archived
    if (!undo) ro.updatedAt = at
    ro.timeline.push({ id: uid(), at, kind: 'status', user, text: why })
    done.push(ro.number)
  }
  return done
}

function moveStock(d: DB, ro: RepairOrder, sign: 1 | -1) {
  for (const line of ro.parts) {
    const p = line.partId ? d.parts.find((x) => x.id === line.partId) : undefined
    if (p) p.onHand = Math.max(0, p.onHand + sign * line.qty)
  }
}

/** "RO 10412, 10415, 10420 and 44 more" */
export function numberList(nums: number[], max = 12) {
  const sorted = [...nums].sort((a, b) => a - b)
  return sorted.length <= max ? sorted.join(', ') : `${sorted.slice(0, max).join(', ')} and ${sorted.length - max} more`
}
