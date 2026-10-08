// Core data model for ShopLine.
// Everything a repair order needs, and nothing it doesn't.

export type ROStatus =
  | 'estimate'
  | 'checked_in'
  | 'diagnosing'
  | 'awaiting_ok'
  | 'parts_on_order'
  | 'in_progress'
  | 'ready'
  | 'closed'

export type PartLineStatus = 'in_stock' | 'ordered' | 'back_ordered' | 'received'

export type ApprovalMethod = 'phone' | 'text' | 'in_person' | 'email'

export type UnitType =
  | 'Push Mower'
  | 'Self-Propelled Mower'
  | 'Zero-Turn Mower'
  | 'Riding Mower'
  | 'Chainsaw'
  | 'String Trimmer'
  | 'Backpack Blower'
  | 'Handheld Blower'
  | 'Hedge Trimmer'
  | 'Edger'
  | 'Pressure Washer'
  | 'Generator'
  | 'Tiller'

export interface Customer {
  id: string
  number: number
  name: string
  phone: string
  email: string
  isBusiness: boolean
  notes: string
  createdAt: string
  // Optional — filled by imports or the customer screen
  altPhone?: string
  cellPhone?: string
  address?: string
  address2?: string
  city?: string
  state?: string
  zip?: string
  taxExempt?: boolean
  category?: string // Personal Use, Landscape, Government, Farm… (Infinity "Category")
  contact1?: string // person to ask for on a business account
  contact2?: string
  salesman?: string
  priceLevel?: string // Infinity "Discount", e.g. "Retail Pricing"
  arType?: string // accounts-receivable type, e.g. "Open Item"
  deliveryCode?: string
  creditFlag?: boolean // Infinity "CreditCode"
  isCash?: boolean // the built-in walk-in "Cash Customer" (#1000) — pinned in look-up, never flagged
}

export interface Unit {
  id: string
  customerId: string
  type: UnitType
  make: string
  model: string
  serial: string
  engineHours: number | null
}

/** A manufacturer / product line the dealer carries (Scag, Stihl, Toro…). */
export interface Line {
  code: string // short key, e.g. 'STIHL'
  name: string
  color: string
  carriesWholegoods: boolean
}

export interface Part {
  id: string
  line: string // Line.code
  partNo: string
  description: string
  vendor: string
  cost: number // DP — dealer price
  price: number // SRP — what we sell it for
  onHand: number
  bin: string
  supersededBy: string
  priceUpdatedAt: string | null
}

export type WholegoodStatus = 'on_order' | 'in_stock' | 'demo' | 'sold'

/** A new (or trade-in) unit for sale on the floor. */
export interface Wholegood {
  id: string
  line: string
  stockNo: string
  category: UnitType
  model: string
  description: string
  serial: string
  year: number
  condition: 'new' | 'used'
  status: WholegoodStatus
  dp: number // dealer cost
  srp: number
  orderedAt: string | null
  receivedAt: string | null
  floorPlan: boolean
  floorPlanDue: string | null
  soldAt: string | null
  soldPrice: number | null
  soldToCustomerId: string | null
  customerUnitId: string | null
  notes: string
}

export interface ImportLogEntry {
  id: string
  at: string
  user: string
  target: 'parts' | 'wholegoods' | 'customers'
  fileName: string
  line: string
  updated: number
  added: number
  unchanged: number
  skipped: number
}

export interface AuditEntry {
  id: string
  at: string
  user: string
  action: string
}

export interface Staff {
  id: string
  name: string
  role: 'tech' | 'counter' | 'manager'
  active: boolean
}

export interface LaborLine {
  id: string
  description: string
  techId: string | null
  hours: number
  rate: number
}

export interface PartLine {
  id: string
  partId: string | null
  partNo: string
  description: string
  qty: number
  unitPrice: number
  status: PartLineStatus
}

export interface FeeLine {
  id: string
  description: string
  amount: number
  taxable: boolean
}

export interface Approval {
  id: string
  amount: number
  approvedBy: string
  method: ApprovalMethod
  at: string
  recordedBy: string
}

export interface TimelineEvent {
  id: string
  at: string
  kind: 'created' | 'status' | 'note' | 'approval' | 'edit'
  text: string
  user: string
}

export interface Checklist {
  hasFuel: boolean
  bladeOn: boolean
  batteryIncluded: boolean
  accessories: string
}

export interface RepairOrder {
  id: string
  number: number
  customerId: string
  unitId: string
  status: ROStatus
  warranty: boolean
  techId: string | null
  openedAt: string
  updatedAt: string
  closedAt: string | null
  promiseDate: string | null
  complaint: string
  cause: string
  correction: string
  dropOffNotes: string
  checklist: Checklist
  labor: LaborLine[]
  parts: PartLine[]
  fees: FeeLine[]
  approvals: Approval[]
  timeline: TimelineEvent[]
  // Optional — printed on the estimate/invoice
  tag?: string // claim tag hung on the unit (e.g. E71)
  poNumber?: string
}

export interface Settings {
  shopName: string
  shopAddress: string
  shopPhone: string
  shopFax: string
  invoiceTerms: string // printed in the footer of estimates & invoices
  laborRate: number
  taxRate: number // e.g. 0.0875
  taxLabor: boolean
  shopSuppliesPct: number // % of labor added as shop supplies fee, 0 to disable
  staleDays: number // no activity for this many days = stale
  partsWaitDays: number // waiting on parts longer than this = flagged
  agedUnitDays: number // wholegoods on hand longer than this = flagged
  overridePin: string
}

export interface DB {
  version: number
  settings: Settings
  customers: Customer[]
  units: Unit[]
  lines: Line[]
  parts: Part[]
  wholegoods: Wholegood[]
  staff: Staff[]
  ros: RepairOrder[]
  nextRONumber: number
  nextCustomerNumber: number
  currentUserId: string
  importLog: ImportLogEntry[]
  auditLog: AuditEntry[]
}
