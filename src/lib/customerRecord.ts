// Customer record depth: contacts, ship-to addresses and the notes log.
// contact1 / contact2 are kept as mirrors of the first two contacts so the importer,
// printouts and older screens keep working without changes.
import type { Contact, Customer, CustomerNote, NoteKind, ShipTo } from './types'
import { uid } from './calc'

export const CONTACT_TYPES = ['Owner', 'Office / billing', 'Shop foreman', 'Crew lead', 'Spouse', 'Other']
export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  general: 'Note', call: 'Call', billing: 'Billing', service: 'Service', complaint: 'Complaint',
}

export const blankContact = (name = ''): Contact => ({ id: uid(), name, type: '', phone: '', cell: '', email: '', primary: false, canApprove: false, notes: '' })
export const blankShipTo = (): ShipTo => ({ id: uid(), label: '', address: '', address2: '', city: '', state: '', zip: '', phone: '', isDefault: false })

/** The customer's contacts: the real list once there is one, otherwise built from the old contact1/contact2 fields. */
export function contactsOf(c: Customer): Contact[] {
  if (c.contacts) return c.contacts
  return [c.contact1, c.contact2].filter((x): x is string => !!x?.trim())
    .map((name, i) => ({ ...blankContact(name.trim()), id: `legacy-${i}`, primary: i === 0 }))
}

/** Turn legacy contact fields into a real list (on a draft) before the first edit. */
export function ensureContacts(c: Customer): Contact[] {
  if (!c.contacts) c.contacts = contactsOf(c).map((x) => ({ ...x, id: uid() }))
  return c.contacts
}

/** Keep contact1/contact2 in step with the list (primary first). Call after every contacts edit. */
export function syncLegacyContacts(c: Customer) {
  const list = [...(c.contacts ?? [])].sort((a, b) => Number(b.primary) - Number(a.primary))
  c.contact1 = list[0]?.name.trim() || undefined
  c.contact2 = list[1]?.name.trim() || undefined
}

export function addNote(c: Customer, n: { kind: NoteKind; text: string; user: string; roId?: string }): CustomerNote {
  const note: CustomerNote = { id: uid(), at: new Date().toISOString(), user: n.user, kind: n.kind, text: n.text.trim(), pinned: false, roId: n.roId }
  c.noteLog = [note, ...(c.noteLog ?? [])]
  return note
}

/** Pinned first, then newest first. */
export const sortedNotes = (c: Customer) => [...(c.noteLog ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at.localeCompare(a.at))
