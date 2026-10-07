# ShopLine

**Dealer management for small-engine and outdoor power equipment shops: repair orders, wholegoods, and parts inventory.**

ShopLine is a dealer management system rebuilt from scratch as a fast, keyboard-friendly web app. I've worked the counter and the bench at a lawn equipment shop. The dealer software we used could do the job, but it hid the most important question: *which jobs are stuck, and why?* ShopLine is built around answering that question.

> Portfolio project. All customers, phone numbers, and serials in the demo data are fictional.

## Features

**Work in Progress**: every open repair order on one screen
- Instant search by RO #, customer, phone, serial number, or model (`/` to focus, `Enter` to open a single match)
- Group by status, customer, tech, or age, with subtotals
- Quick filters: *Needs attention · In the shop · Waiting on customer · Waiting on parts · Ready for pickup · $0 / no estimate · Warranty*
- Status colors show **who the job is waiting on**: the shop (blue), the customer (amber), or a vendor (purple)
- Separate counters for days open and days idle

**Automatic flags** catch the jobs that fall through the cracks:
| Flag | Meaning |
|---|---|
| Stale | No activity in N days (configurable) |
| $0 / no estimate | Diagnosed but nobody built the estimate |
| Long parts wait | On order longer than N days |
| Past promise date | Customer was promised a date that has passed |
| Work over approved amount | Job total exceeds what the customer approved |

**Repair order write-up**
- Customer lookup by name, phone, or number, or create a new customer inline
- Pick one of the customer's units or add one (type, make, model, serial, engine hours)
- Complaint, drop-off checklist (fuel, blade, battery, accessories), promise date, warranty flag

**Working the RO**
- Click-through status pipeline: Estimate → Checked In → Diagnosing → Awaiting Customer OK → Parts On Order → In Progress → Ready for Pickup → Closed
- **3 C's**: Complaint, Cause, Correction
- Labor lines (tech, hours × rate), parts lines from a searchable catalog (with stock status: in stock, ordered, back-ordered, received) or special-order parts, and fees (shop supplies auto-calculated as a % of labor)
- Live totals: labor + parts + fees + tax. Warranty jobs aren't taxed to the customer.
- **Customer approval log**: amount, who approved it, how (phone, text, in person, email), and when. Moving a job to *In Progress* without approval for the full amount triggers a warning.
- Timeline of every status change, approval, and note
- Closing an RO takes the parts out of inventory

**Print**: a modern take on the classic dealer repair estimate. Shop header, big RO number with claim tag, bill-to / contact / unit cards, an info strip (customer #, date in, promised, counter, salesman, tech, PO #), a highlighted service line, one line-item table grouped by labor, parts and fees, a totals block, your own terms (set in Settings), a Code 128 barcode of the RO number, and a signature line. The shop ticket uses the same layout with blank boxes for the tech. Both fit on one letter page; use *Save as PDF* to email one.

**Shop Dashboard**: open work value, where the money is stuck (waiting on OK / approved but unfinished / done but not picked up), status breakdown, aging buckets, tech workload, and a needs-attention list. Everything is clickable through to the filtered list.

**Wholegoods**: units for sale, split by manufacturer line (Scag, Exmark, Stihl, Echo, Shindaiwa, Toro, plus All Makes / Used)
- Stock #, model, serial, year, condition, DP, SRP, margin, and **days on hand** (aging flagged after a configurable number of days)
- Line summary: money on the floor at DP, value at SRP, average days here, aged units, floor plan payoffs due within 30 days, on order, and units sold in the last 90 days with gross
- **By-model view** shows in stock, on order, sold in 90 days, and oldest unit, to drive reorder decisions
- Mark received, mark sold (pick or create a customer). A sold unit is automatically added to the customer's units with its serial.
- Import unit lists or shipping manifests from CSV/Excel, matched by serial

**Parts inventory**: split by line, with DP, SRP, margin, bin, on hand, quantity committed to open ROs, available, supersessions, and the date of the last price update
- Stats per line: SKUs, units, value at DP and SRP, zero-stock count, last price import
- Filters: in stock, out of stock, short for open ROs, price more than a year old
- Paginated and indexed for catalogs of 50,000+ parts
- **Adjust** a part (receive / physical count) without override; every change is logged

**Price-file import**: overwrite every part's DP and SRP from a manufacturer price list in one click
- CSV or .xlsx; title rows above the headers are detected automatically
- Columns are auto-matched by name ("Dealer Net" → DP, "Suggested Retail" → SRP…) and can be changed by hand
- Part numbers are matched ignoring spaces, dashes and case (`1123 640 1700` = `11236401700`)
- Full preview before anything changes: updated, added, unchanged, skipped (with reasons), duplicates, and the biggest price swings
- Options: overwrite prices, add missing parts, overwrite descriptions, overwrite on-hand from file, and derive SRP from DP × markup when the file has no SRP
- Tested at 30,000 rows; applying takes about a second

**Customer import**: bring the whole customer list over from an old system (CSV/.xlsx)
- Auto-matches every column of an Infinity customer export (CustomerID, Name, AddressLine1/2, City, State, ZipCode, Phone, AltPhone, CellPhone, Email, ArTyp, Salesman, Discount, Category, Contact1/2, TaxDefault, DeliveryCode, CreditCode) plus common generic headers (first/last, company, notes, tax exempt, customer-since)
- `TaxDefault` is read the right way round: FALSE = tax exempt. Any category other than Personal Use marks the account commercial; `CreditCode` TRUE shows a credit-flag warning at write-up
- Keeps the old customer numbers so staff don't have to relearn them; numbers already taken get new ones
- Fixes ALL-CAPS names and addresses (`ALEX YAUK` → `Alex Yauk`, `100 N MAIN ST` → `100 N Main St`); keeps acronyms like GE, US, FCI; flags commercial accounts by name (LLC, Lawn, Landscaping…)
- Treats placeholder phones like `() -` as blank and moves the cell number to primary when there's no main phone
- Equipment exports (one row per unit) also create the customer's units from model and serial columns
- Matching runs by customer #, then phone, then name, so re-running the same file adds no duplicates. Tested with 5,000 customers and 4,000 units.
- Tax-exempt customers are charged no tax on their repair orders

**Master override**: a manager PIN that lifts every lock: edit closed ROs, skip approval/close prompts, edit prices and quantities inline, import, delete. A red banner shows while it's on, and every action is written to the audit log.

**Admin tools** (Settings, collapsed at the bottom; requires override): change the PIN, view import history and the audit log, **zero out on-hand inventory** for one line or all lines (type `ZERO` to confirm, with a backup prompt), **clear sample data** before going live (customers/ROs, wholegoods, parts, each optional), reset demo data.

**Records**: customers and units with full repair history, a parts catalog showing margin and *available = on hand − committed to open ROs*, and settings for labor rate, tax, shop supplies %, flag thresholds, and staff. JSON backup export and restore are included.

## Keyboard shortcuts
| Key | Action |
|---|---|
| `N` | New repair order |
| `/` | Search Work in Progress |
| `D` | Dashboard |
| `↑ ↓ Enter` | Pick from customer or part search results |
| `Esc` | Clear search / close dialogs |

## Run it

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev        # opens http://localhost:5173
```

On Windows you can also double-click **`start-shopline.bat`**.

```bash
npm run build      # production build to dist/
npm run preview    # serve the build locally
```

## How it's built
- **React 19 + TypeScript + Vite**, with no UI framework; the styles are hand-written CSS in `src/index.css`
- **State** is a single typed in-memory database (`src/lib/store.tsx`) updated with Immer (structural sharing, so editing an RO doesn't copy a 50k-part catalog) and saved to **IndexedDB**, which holds hundreds of MB versus localStorage's ~5 MB. Screens only talk to the store, so replacing it with a real backend (Node + SQLite or Postgres) is a single-file change.
- **Business rules** (totals, tax, aging, flags) live in `src/lib/calc.ts` as pure functions
- **Import engine** (`src/lib/importer.ts`): PapaParse for CSV, read-excel-file for .xlsx (lazy-loaded), header detection, column guessing, and a plan/apply split so every import is previewed first
- **Demo data** (`src/lib/seed.ts`) comes from a seeded random generator, so every reset produces the same realistic shop: about 40 customers, 90+ repair orders across every status, 110+ wholegoods across six lines, and a deliberate tail of forgotten estimates and unclaimed units

```
src/
  lib/        types.ts · calc.ts · store.tsx · seed.ts · importer.ts · idb.ts
  components/ ui.tsx · fields.tsx · lines.tsx (line tabs, pager) · override.tsx
  pages/      WorkInProgress · NewRO · RODetail · PrintRO · Dashboard
              Wholegoods · Parts · Import
              Customers · CustomerDetail · Settings
```

## Roadmap
- [ ] Backend + multi-user logins (Node, SQLite, auth)
- [ ] Tech time clock per labor line
- [ ] Text the customer their estimate with an approve link
- [ ] Counter sales / POS and back orders
- [ ] Parts ordering: suggested stock orders from sales history and min/max
- [ ] Warranty claim tracking
- [ ] CSV import of customers, units, and parts from existing dealer systems
