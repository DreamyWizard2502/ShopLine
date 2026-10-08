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
  /** Records merged into this one. Their old numbers still find this customer. */
  mergedFrom?: { number: number; name: string; at: string; user: string }[]
  // A/R
  creditLimit?: number // 0 / blank = no limit
  termsDays?: number // blank = shop default (Settings.arTermsDays)
}

// ---------- Duplicates & merging ----------

export type DupSignal = 'name' | 'phone' | 'address' | 'email'

/** Editable in Settings → Duplicate customers & merging. */
export interface DuplicateRules {
  enabled: boolean
  signals: Record<DupSignal, boolean> // which fields are compared
  nameRequired: boolean // the name must be one of the matching fields
  minSignals: number // how many compared fields must match (1–4)
  phoneDigits: 7 | 10 // compare the last 7 (ignores area code) or all 10 digits
  ignoreWords: string // comma list stripped from names before comparing ("inc, llc, the")
  mergeNeedsOverride: boolean
}

// ---------- Accounts receivable ----------

/** charge / refund raise the balance; payment / credit lower it. */
export type ArKind = 'charge' | 'payment' | 'credit' | 'refund'
export type PayMethod = 'cash' | 'check' | 'card' | 'other'

/**
 * One line on a customer's account. Amounts are always positive;
 * `kind` says which way it moves the balance (charge = up, payment/credit = down).
 */
export interface ArEntry {
  id: string
  customerId: string
  kind: ArKind
  at: string // posting date (ISO)
  amount: number
  ref: string // RO #, check #, "Opening balance"…
  memo: string
  roId?: string // the repair order this charge bills, or this deposit was taken for
  partial?: boolean // charge: progress billing on an RO that's still open
  deposit?: boolean // payment: taken up front for `roId`; held for that RO until it's billed
  method?: PayMethod // payments and refunds
  /** payment/credit: dollars pinned to specific charges ("apply this check to RO 10422"). The rest goes oldest first. */
  applications?: { chargeId: string; amount: number }[]
  user: string
  voided?: { at: string; user: string; reason: string }
}

/** One printed statement batch (the statement cycle). */
export interface StatementRun {
  id: string
  date: string // statement (cycle close) date, YYYY-MM-DD
  at: string // when it was printed
  user: string
  customerIds: string[]
}

/** Month-end A/R snapshot, frozen when the month is closed. */
export interface ArSnapshot {
  id: string
  period: string // YYYY-MM
  asOf: string // ISO, end of that month
  closedAt: string
  user: string
  totals: { balance: number; current: number; d31: number; d61: number; d91: number; pastDue: number; credit: number; accounts: number }
  accounts: { customerId: string; number: number; name: string; balance: number; current: number; d31: number; d61: number; d91: number }[]
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
  dupRules: DuplicateRules
  arTermsDays: number // default "net" days before a charge is past due
  // Statements
  statementDay: number // cycle closes on this day of the month; 0 = last day of the month
  statementMessage: string // printed on every statement
  statementMinBalance: number // skip statements under this balance (unless there was activity)
  // Write-up
  arWarnAtWriteUp: boolean // show balance / past-due / over-limit when an RO is written up
  arAckOverLimit: boolean // over limit or past due: counter must tick "checked with the office" to create the RO
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
  /** Customer-id pairs ("a|b", sorted) someone marked "not a duplicate". */
  notDuplicates: string[]
  ar: ArEntry[]
  statementRuns: StatementRun[]
  arHistory: ArSnapshot[]
}
