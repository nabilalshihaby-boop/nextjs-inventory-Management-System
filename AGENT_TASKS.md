# Blue Piller — Agent Task Register

This file is the working source of truth for future agents. Keep it current as
work is approved, implemented, tested, committed, and deployed.

## Product principles

- Blue Piller is the operational source of truth. Shopify is an integration,
  not the authority for local inventory, sales, or financial history.
- SKU is the canonical product identity for integrations. Barcode is optional
  but globally unique when present. A product variant group has a stable
  Shopify-oriented handle.
- Keep Product Categories, Product Variant Groups, Products, Base Units, and
  Product Units distinct. Inventory is always stored in the product's base
  unit; purchase and sales units convert to it.
- Preserve historical and financial truth. Products with history are
  deactivated, not erased. A product with no stock or history may be deleted.
- Held POS orders must use their stored price, tax, unit, factor, and revision
  snapshots. A changed resumed cart must be held again before payment.
- Prefer server-side authorization and validation. UI visibility is never the
  only protection.

## Roles and sensitive operations

- OWNER is the software/platform owner only. OWNER-only areas include Owner
  Panel, installation reset, license/subscription controls, deployment and
  database connection controls, backup configuration, and restoration.
- ADMIN manages the customer's business system, but must never receive the
  OWNER-only controls above.
- USER access is driven by permission keys and warehouse scope. Every route,
  server action, and loader must enforce both where appropriate.
- Record important business and privileged actions in the immutable audit log.

## Current implementation baseline

- SKU/barcode identity registry, Product Variants, Base Units, Product Unit
  Conversions, safe product lifecycle, Audit Log, P&L, Cash Flow, Aging, and
  role/warehouse scope are implemented.
- Applied database migrations currently run through
  `20261213000000_register_actor_names`.
- Never use the production `nextinventory` database for QA. Use a fresh
  throwaway `nextinventory_qa_*` database and remove it after testing.
- Do not stage `.env`, `.github/`, `.vscode/`, `public/images/`,
  `public/uploads/`, `server.log`, scratch scripts, screenshots, or QA data.
- Do not use `git add -A` or `git add .`. Review the staged file list before a
  commit.

## Completed — POS customer workflow and Register Shift Report

Verified on throwaway databases. The signed-in check on the real system is
still outstanding (see the next milestone).

- [x] POS Add Customer: `customers.create` is enforced on the server
  (`customers.manage` may also create), and creation is audited without phone
  or email.
- [x] Searchable POS customer selector: server-side search by name, phone, or
  email in Arabic and English. Customers have no code/reference field, so there
  is no search by code.
- [x] Quick name-only customer creation: only the name is required; phone and
  email are optional.
- [x] Modal keyboard focus handling: initial focus, Tab trap, and focus return.
- [x] Register Shift Report: printable, with session details, duration, opened
  by, closed by, and cash movements. The UI states that card and bank
  collections are not included in expected cash.
- [x] Immutable actor-name snapshots for register sessions and cash movements.

## Next immediate milestone

1. Signed-in real-user acceptance check on the real system:
   - POS customer search and addition;
   - Register Shift Report, including printing.
2. Then Navigation Cleanup and the Report Hub at `/reports` (items 2 and 3
   below).

## Approved delivery order

1. Signed-in acceptance check of POS customer search/addition and the Shift
   Report with printing. Push only after the owner approves.
2. Navigation cleanup:
   - remove/hide unbuilt Email Templates and SMS Templates;
   - keep working reports visible;
   - add a clearly disabled `Forecasting & Insights` / `التوقعات والتحليلات`
     entry below Reports until it is implemented.
3. Build the Report Hub at `/reports` before Forecasting & Insights:
   - `/reports` must never return 404;
   - group only implemented reports into Financial, Inventory, Sales & POS,
     and Customer & Supplier sections;
   - hide unavailable reports rather than linking to placeholders;
   - respect report permissions and warehouse scope both in the UI and routes;
   - include a disabled, clearly labelled Forecasting & Insights area until
     those reports are delivered.
4. Dynamic product-import templates:
   - standalone-product template;
   - template generated from the selected Product Variant Group with its
     required option columns;
   - preview, precise row errors, server validation, and all-or-nothing
     confirmation.
5. Shopify CSV import:
   - Handle maps to the Variant Group and SKU maps to the sellable product;
   - no legacy name-based grouping;
   - preview, duplicate/conflict policy, and no direct production writes in
     testing.
6. Shopify/n8n integration design and implementation:
   - local system remains source of truth;
   - persist external IDs only after an intentional link;
   - define webhook authentication, idempotency, sync states, retries,
     conflict handling, and audit events.
7. Decision intelligence and reports:
   - report hub first, then Forecasting & Insights;
   - sales trends, best/slow movers, stock aging and clearance candidates,
     ABC analysis, sell-through, turnover/reorder signals, cash-flow forecast,
     sales forecast, and executive dashboard;
   - each forecast must show inputs, horizon, confidence/limitations, and must
     never silently alter inventory or finances.
8. Expand business audit coverage for the remaining important workflows.
9. Hardware and vertical readiness as needed: tablet POS QA, barcode scanner,
   receipt printer/cash drawer, scale/variable-weight barcodes, offline
   strategy, and pharmacy batch/expiry controls if that vertical is enabled.
10. Commercial operations:
   - Docker/local and hosted deployment paths;
   - licensing, renewal/expiry controls;
   - OWNER-only Reset Installation;
   - OWNER-only Backup & Restore Center with scheduled encrypted Google Drive
     backups, retention, restore safeguards, recovery backup, and audit log.
11. Produce the final architecture and maintenance pack listed below.

## Decision intelligence — approved product direction

Forecasting and decision-ready reports are a primary competitive advantage of
Blue Piller. They must be implemented as a trusted decision system, not as
decorative charts.

### Required delivery sequence

1. Data quality controls: reliable SKU identity, units and conversions,
   warehouse scope, dates, returns, costs, and stock movements.
2. Descriptive reports: what happened — net sales and purchases, profit and
   cash flow, best/slow movers, stock aging, returns, and performance by
   branch, warehouse, category, brand, and staff member where permitted.
3. Diagnostic reports: why it happened — stock-outs, pricing, discounts,
   returns, cost changes, seasonality, and branch-level differences.
4. Explainable forecasts: what may happen — sales, cash flow, stock-out dates,
   reorder quantities, clearance candidates, and seasonal demand.
5. Executive decision dashboard: concise alerts and recommended actions.

### Forecast safeguards

- Every forecast must expose its source period, inputs, horizon, model/version
  where relevant, confidence or limitations, and last refresh time.
- Forecasts are recommendations only. They must never create a purchase,
  change a price, alter stock, or post a financial entry without explicit user
  approval.
- Provide a human-readable explanation, for example: expected daily demand,
  stock on hand, projected stock-out date, and the suggested reorder quantity.
- Do not present a forecast if data quality or history is insufficient; show
  the reason and the data needed instead.
- Use appropriate data-analysis tooling and validation on representative,
  anonymized or QA data before releasing a forecasting model.

## Reset Installation and backup safety

- Reset Installation is OWNER-only for access and execution. Require fresh
  re-authentication plus explicit typed confirmation, show the impact, make a
  recovery backup first, and write a durable audit event.
- Backup/restore controls are OWNER-only. ADMIN may not configure database
  connections, reset installation, restore data, or change licensing.
- Restores require maintenance mode, fresh re-authentication, checksum and
  compatibility checks, a recovery backup, explicit confirmation, and audit
  entries. Never send database backups by email; use protected storage such as
  Google Drive with controlled access.

## Release discipline

- Before applying a real migration: inspect status, confirm target database,
  take/verify a backup when data is material, stop processes that lock Prisma,
  run `prisma migrate deploy`, run `prisma generate`, restart the app, and
  verify signed-in flows without manufacturing sessions.
- Never use `db push`, `reset`, destructive SQL, seed resets, or password
  resets on real data unless the owner explicitly authorizes the exact action.
- Run focused tests during implementation. Before commit, run a proportionate
  full regression, type-check, lint, production build, migration/schema checks,
  and real-browser checks for affected signed-in workflows.
- Investigate test failures; do not merely weaken assertions to pass.

## Final architecture and maintenance pack

Create and maintain these documents when the core product work is stable:

1. ERD / database schema.
2. Tables and relationships.
3. API contracts.
4. Permission keys and branch/warehouse scope rules.
5. State machines for every workflow.
6. Immutable audit-event specification.
7. Financial posting rules.
8. HL7 / ASTM mapping strategy if the healthcare integration scope is enabled.
9. Data migration and seed-data plan.
