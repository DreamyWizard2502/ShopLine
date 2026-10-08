# ShopLine: handoff notes

Read this first. It is the state of the project as of 2026-10-08 (updated after the merge + A/R skeleton build).

## What it is

ShopLine is a browser-based dealer management system for outdoor power equipment shops. It is Rod's own branding and code, **not** C-Systems' or Infinity's. Rod works hourly at Links Lawn Equipment (an Infinity dealer in Mustang, OK) and is building this as a portfolio and learning project, with the longer aim of fixing Infinity's pain points. He wants the same depth of recorded information as Infinity, but a modern, easier-to-use layout. **Do not make a carbon copy of Infinity's screens.**

Working agreement: define scope and design first, get Rod's OK, then build. The customer **look-up** (Phase 1, part 1) is built; the rest of customer maintenance is not.

## Run it

- Needs Node 22.
- `npm install`, then `npm run dev` (Vite). On Rod's PC, `start-shopline.bat` does the same.
- `npm run build` runs `tsc -b` then `vite build`. `npm run lint` runs oxlint.
- Master override PIN is `0000`.
- Live demo: https://dreamywizard2502.github.io/ShopLine/ (shows a dismissible demo banner on github.io only).
- Repo: https://github.com/DreamyWizard2502/ShopLine, branch `main`. A push to main deploys through `.github/workflows/deploy.yml`.

## Stack

React 19, TypeScript, Vite 8, react-router `HashRouter` (works on Pages), hand-written CSS (no UI library), Immer. All data lives in one typed in-memory DB, persisted to IndexedDB (database `shopline`, store `kv`, key `db`). `vite.config.ts` has `base: './'` for GitHub Pages. There is no backend. Data stays in the browser it was entered in.

## Folder layout

```
src/
  App.tsx            routes, sidebar shell, IS_DEMO + DemoBanner
  index.css          all styles; the .inv* block is the printed invoice/estimate/ticket
  lib/
    types.ts         every data type (Customer, RepairOrder, Wholegood, Part, Settings...)
    store.tsx        DB context + Immer updates + IndexedDB persistence
    idb.ts           tiny IndexedDB wrapper
    seed.ts          demo data + default Settings (shopFax, invoiceTerms, etc.)
    calc.ts          totals/tax math, CUSTOMER_CATEGORIES, customerPhones(c)
    importer.ts      CSV/price-file/customer import (guessMapping, planCustomers/applyCustomers, properCase)
    customerSearch.ts  look-up index/search, duplicate rules, attention flags, Cash Customer
    merge.ts         true customer merge (fields, phones, notes, moves history)
    ar.ts            A/R allocation (open item, oldest first), aging, running balance
  components/
    ui.tsx fields.tsx lines.tsx   shared UI, DraftText inputs, RO line editor
    override.tsx     master-override PIN prompt
    barcode.tsx      Code 128B barcode as inline SVG (checked against python-barcode)
    custpick.tsx     search-as-you-type customer chooser (merge, A/R)
  pages/
    Dashboard, WorkInProgress, NewRO, RODetail   repair-order flow
    PrintRO.tsx      customer-copy invoice/estimate and shop ticket (one page, print CSS)
    Customers, CustomerDetail                    customer look-up and record
    MergeCustomers                               merge two customers
    AR.tsx                                       A/R overview, account ledger, posting
    Wholegoods, Parts                            equipment and inventory (by manufacturer line)
    Import, Settings
.github/workflows/deploy.yml   Pages deploy (build, upload dist, deploy-pages)
```

## Key decisions and why

- **Own branding, own code.** Nothing copied from Infinity. Field meanings were learned from Rod's screenshots and exports only.
- **Browser-only, single typed DB.** It is the fastest way to demo to a few people and costs nothing to host. A backend can come later.
- **Master override with a PIN** gates risky actions such as zero-out, price changes and deletes.
- **Print layout:** a flex column with the footer pushed down by `margin-top:auto`. The print `min-height` is 9.3in so it stays on one page. The accent bar is a `border-top` because a `::before` overflowed in print. Both the invoice and the ticket were verified as 1 page.
- **Importer behavior (from Rod's real Infinity customer export):**
  - TaxDefault FALSE means tax exempt.
  - "Discount" is really Pricing Structure, so it maps to `priceLevel`.
  - ArTyp "Open Item" is the statement setting.
  - DeliveryCode "P" is statement delivery by paper.
  - Contact1/Contact2 are dropdowns fed by Infinity's Contacts tab.
  - Any category other than personal/residential/home/retail marks the customer as a business.
  - Phones are promoted when the main phone is blank.
  - `properCase(s, isName)` turns ALL-CAPS into proper case but keeps acronyms (GE, US, FCI).
- **CreditCode is unresolved.** It is probably "Open Account (house charge approved)", not a credit warning. The field is currently imported as `creditFlag` and shown as a warning. Rod was asked to check customer 1069's Settings tab to confirm. Fix it once he answers.
- **Customer look-up redesign (agreed):** Rod likes the mockup, so use it as the Phase 1 target. It lives in the Design artifact "ShopLine Customer Lookup" (https://claude.ai/artifact/LwywkZJzS4QXvUSQbdHJy5), a clickable page. Key ideas:
  - One omnibox searches name, any phone, customer #, email, address, contact names and unit serials.
  - Each result shows a "Matched ..." line when the hit wasn't the name.
  - Category, open-order, tax-exempt and needs-attention filters are chips.
  - Cash Customer #1000 is pinned above the results.
  - A right-hand preview pane shows reach-them info, contacts, equipment with warranty, recent orders, notes and account settings. The primary button is New repair order.
  - Possible duplicates get a banner with a Merge action.
  - Arrow keys move through results.
- **A/R decision (updated 2026-10-08):** Rod asked to define the A/R scope and build its skeleton. The scope is below; the v1 skeleton is built. Statements and the rest of "Later" are still not started — ask before building them.
- **Merge decision (2026-10-08):** Rod wants a *true* merge (not just a link) with *editable* duplicate rules. Built.

## A/R scope

**Model.** A per-customer ledger (`db.ar: ArEntry[]`). Every line is a `charge`, `payment` or `credit` with a positive amount; voids keep the line (crossed out, with who/when/why) and stop it counting. Customers get optional `creditLimit` and `termsDays` (blank = `Settings.arTermsDays`, default 30).

**Allocation.** Open item, oldest charge first, computed on the fly in `lib/ar.ts` (`accountOf`). Nothing about allocation is stored, so it can't drift. Infinity's "Balance Forward" accounts are treated the same way for now.

**Aging.** By invoice (charge) date: Current 0–30, 31–60, 61–90, Over 90. "Past due" separately means older than the customer's terms.

**v1 skeleton — built:**
- Accounts Receivable page (`/ar`): totals by bucket, past-due total, credit balances; accounts list with filters (past due, over limit, credit balance) and sorts.
- Account page (`/ar/:customerId`): balance and aging tiles, ledger with running balance and "still open" per charge, Record payment (cash/check/card/other, shows which charges it pays), Post charge / credit (opening balances go here), Void (master override, reason required, audited).
- Repair orders: a closed RO gets **Charge to account**. Once charged, it shows "On account $X". It turns red if the RO total changed after charging (void and re-charge for now).
- Customer record: Charge account panel (balance, past due, credit limit, terms). Look-up preview shows balance/past due. "Needs attention" includes Past due and Over credit limit.
- Sidebar badge = number of past-due accounts. Merges carry A/R entries to the surviving customer.

**Later (not started — ask Rod first):** printed statements (and statement cycle/day), credit-limit and past-due warnings at RO write-up, applying a payment to a chosen invoice, partial-charge or deposit on open ROs, refunds, an A/R history (month-end snapshots), importing Infinity A/R balances in bulk, and Balance Forward accounts. Out of scope: finance charges, GL, card processing.

## Duplicate rules & merging

- Settings → **Duplicate customers & merging** (`DuplicateRules` in `types.ts`, `findDuplicates` in `customerSearch.ts`). Choose which fields are compared (name, any phone, street address + ZIP, email), how many must match, whether the name must be one of them, last 7 vs all 10 phone digits, and words ignored in names. Defaults = name + one more. Shared values used by more than 25 customers are skipped.
- Look-up banner: **Review and merge** (defaults to keeping the record with more history) or **Not a duplicate** (stored in `db.notDuplicates`; "Clear marks" in Settings).
- Merge screen (`/customers/merge?keep=&remove=`, also "Merge…" on any customer record): pick or swap the two records, choose field by field (only differing fields shown), see what moves. `lib/merge.ts` moves units, ROs, sold wholegoods and A/R entries, fills empty phone slots with the other's numbers (leftovers go to notes), keeps both notes and the earlier customer-since date, records `mergedFrom`, removes the old record, and writes the audit log. Searching the old number still finds the survivor. Needs master override by default (toggle in Settings, only changeable with override on).

## Current status

**Works** (committed, pushed, deployed):
- Repair orders: create, edit, statuses, lines (labor/parts/fees), Tag # and PO #.
- Wholegoods, and parts inventory by manufacturer line.
- Price-file import and customer import. Verified on Rod's real 40-row Infinity export (e.g. 1505 with 3 phones and 2 contacts).
- Customer fields now cover all Infinity export columns across the list, detail, new-customer, new-RO and import screens.
- Printed invoice, estimate and shop ticket in the modern one-page layout, with barcode.
- Master override, zero-out.
- GitHub Pages auto-deploy.
- **Customer look-up** (`pages/Customers.tsx` + `lib/customerSearch.ts`), built to the approved mockup:
  - Omnibox matches every word across name, any phone, customer # (prefix), contacts, unit make/model/serial, email and address. Non-name hits show a "Matched …" line. Ranked: exact # → name starts-with → name word → other fields, then most recent visit.
  - Chips: top 6 categories (+ "More…" select), Has open order, Tax exempt, Needs attention (credit flag, possible duplicate, no phone).
  - Preview pane: reach them (tel:/mailto: links), contacts, equipment, last 4 ROs, notes, account grid. Buttons: New repair order, New estimate (`/ro/new?status=estimate`), Open record.
  - Duplicate banner follows the Settings rules, with Review and merge / Not a duplicate (see "Duplicate rules & merging").
  - Keys: ↑/↓ move, Enter opens the record, Shift+Enter new RO, Esc clears. Search, filters and selection live in the URL, so Back restores them.
  - Built-in Cash Customer #1000 (`isCash`), pinned above results, excluded from counts/duplicates. DB v3 migration adds it (v4 adds `dupRules`, `arTermsDays`, `notDuplicates`, `ar`) (or adopts an imported "Cash" customer already at #1000); Settings → clear customers re-adds it.
  - Demo seed now has categories, addresses, contacts, a tax-exempt church and one deliberate duplicate pair (Dwight Pruitt #2413/#2444).

**Not working or unverified:**
- The Pages site was only confirmed to answer with its title. The full render wasn't checked, because the cloud sandbox can't reach github.io. Rod should open it and look. The look-up was checked in headless Chromium at 1440 px and 390 px.
- The CreditCode meaning above.
- Rod's PC folder (`C:\Users\Rodri\Projects\ShopLine`) is **behind GitHub**. Either write the files over or have him pull the repo with GitHub Desktop. He hasn't chosen.
- Infinity's export only has customer header and settings fields. Notes, Contacts tab, ShipTo, Documents, unit lists and A/R detail would start empty unless Rod finds other reports. Extracting all customers and ROs from Infinity is still an unsolved problem.

## Next steps, in priority order

1. **Get Rod's answers** to the open scope questions:
   - Customer 1069's Settings tab, to settle CreditCode.
   - Photos of the dropdown lists: Category, Priority, Location, Contact Type, Address Type, and the tax table.
   - The Customer Units tab and Edit-mode screenshots.
   - Which A/R "Later" items he wants next (statements are the obvious one).
2. **Finish Phase 1 customer maintenance** (look-up and Cash Customer are done):
   - Customer record with Settings, Contacts, ShipTo and a Notes log (contacts are still just `contact1/contact2` strings; notes are one text field).
   - A data-cleanup tool for duplicates, missing phones, bad ZIPs and ALL-CAPS names.
   - Needs new types in `types.ts` for contacts, ship-to addresses and notes, a v4 migration in `store.tsx`, and a rewrite of `CustomerDetail.tsx`. When contacts/notes become arrays, update `buildIndex` in `customerSearch.ts` so search still covers them.
   - Possibly reuse `searchCustomers` in the New RO customer picker so both searches behave the same.
3. **Fix the CreditCode handling** (item 1 above).
4. **Sync the PC folder** with GitHub.
5. **Phase 2:** Open Orders and Invoice History tabs, unit fields (warranty, ESP, purchase date, color, bin, engine #, VIN, tag), an email log with `mailto`, Documents, credit-limit warnings.
6. **A/R beyond the skeleton**: see "A/R scope → Later". Ask Rod which first.
7. **Out of scope:** GL, expense accounts, finance charges, card processing, back orders, multi-location transfers, actually sending email.

## Environment gotchas (cloud sessions)

- Playwright must use `executablePath: '/opt/pw-browsers/chromium'`.
- `gh` auth is invalid in the sandbox. `git push` works through the session proxy after the repo is attached with `add_repo`. The remote must be `https://github.com/DreamyWizard2502/ShopLine.git` (the old lowercase URL redirects).
- Copying files out to `/mnt/user-data/outputs` was blocked by the permission classifier earlier. Don't work around it. Ask Rod instead.
- The PC link is files-only (`mcp__remote-devices__*`, no shell), and it is offline unless the Claude desktop app is open on his PC.
- Rod has ADHD and prefers thorough, in-depth explanations. For routine work he wants short answers. He wants the scope defined before anything is built.
