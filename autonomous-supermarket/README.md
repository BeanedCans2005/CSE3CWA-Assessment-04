# Autonomous Supermarket: 60-Day Simulation and Commercial Assurance

**CSE3CWA Assignment 4, Semester 2, 2026**
**Student:** Matthew Elliott, 22453699

A full-stack web application that simulates a small, unstaffed IGA-style supermarket near 
Swanston Street and Melbourne Town Hall for 60 days. A simulated customer world generates
demand, an autonomous rule-based Store Brain runs inventory and replenishment, every
event is stored in SQLite, and the website reports and audits the result. This is a 
fictional educational scenario and is not affiliated with IGA.

**Stack:** React (Vite) . Node.js + Express . SQLite (`better-sqlite3`)

## Quick Start

**Requirements:** Node.js and npm. Developed and tested on Node 23.9.0 (macOS); Node 20 or 22 LTS
should also work. No environment variables are needed.

```bash
npm run install:all     # installs root, server and client dependencies
npm run dev             # starts the API (port 3001) and the website (port 5173)
```

Open **http://localhost:5173**. The site opens on the Submitted Run.

## The database and the Submitted Run

- The SQLite database is **`server/src/db/supermarket.db` and is included in the submitted ZIP.
  It contains the Submitted Run with it's complete history.
  Please do not delete it: the app would recreate an empty database and the Submitted Run would be lost.
- **Submitted Run ID: `RUN-20261012120727-2026`** (seed 2026, 60/60 days).
- The Submitted Run is identified by the `submitted_run_id` row in the `app_settings` table, 
  which is set outside the web app by `npm run mark-submitted -- <RUN-ID>` (run in `server/`).
  The website selects it automatically and labels it "Submitted Run".

### Creating a new run to test the simulation

- **In the website:** open the **Runs** tab and click *Create and run a new 60-day simulation*. It takes about a second.
- **From the command line** (in `server/`): `npm run sim` (seed 2026) or `npm run sim -- 77` (another seed). 
  The script also prints a quick reconciliation check.

New runs are stored as seperate histories and never alter an existing run. Because the model is stochastic, a new run 
will not reproduce the Submitted Run's figures. To keep the Submitted Run safe, copy `supermarket.db` before experimenting.

## Where to find things in the application

| Required item | Where |
|----------|---------|
| Submitted Run and Run ID | **Runs** tab (badge) and the run selector at the top |
| Model Declaration, with opening budget, cash and product data | **Model Declaration** tab |
| 60-Day Commercial Report, Parts 1-3 (findings and recommendations at the bottom) | **60-Day Report** tab |
| Daily Reports, Days 1-60 | **Daily Report** tab (slider, arrows or drop-down). Clicking a bar in the customers-per-day chart also opens that day |

**Tracing a figure:** in the 60-Day Report, click a product name to see its day-by-day stock record, then click a row to open that day's
Daily report, which lists the Store Brain events, orders, cash ledger, per-product stock movement and the stored transactions.

## Architecture and data flow

```
server/src/sim/catalogue.js, openingQty.json   products and opening stock
server/src/sim/demandConfig.js, brainConfig.js customer model and Store Brain rules
                    │
                    ▼
server/src/sim/engine.js   runs 60 days inside ONE database transaction
                    │       (a crash leaves no partial run)
                    ▼
SQLite (supermarket.db)    frozen run configuration + append-only history
                    │
                    ▼
server/src/reports.js      every report and every assurance check is a SQL
                    │       query over the stored history, calculated on request
                    ▼
server/src/index.js        Express JSON API (/api/...)
                    │
                    ▼
client/ (React)            Declaration, Runs, Report, Daily, Assurance
```
- **Configuration:** each run stores its demand model, Store Brain rules and product data (`runs.config_json`, `run_products`) when it starts. These are frozen with the run.
- **History:** customers, transactions and items, stock batches, inventory movements (OPENING, RECEIVED, SOLD, EXPIRED), replenishment orders and lines, the cash ledger, Store Brain events, unmet demand, daily per-product snapshots and daily summaries.
- **Immutability:** database triggers block UPDATE and DELETE on all history tables, block any new rows once a run is COMPLETED, and block any change to a run's configuration. The API has no endpoint that edits history. This is an application-level control (someone with direct database access could remove the triggers), as the brief allows.
- **Reports are derived, not stored:** nothing on the report or assurance pages is typed in, apart from the written findings and the Model Declaration text. All totals are recalculated from the stored records.
- **Money** is stored as integer cents to avoid rounding errors in reconciliation.

## Model summary

**Customers and demand.** Expected visitors per day = 300 × weekday factor × daily random noise × rain factor × event factor. Visitors are spread across 24 hours using separate weekday and weekend curves (commuter and lunch peaks on weekdays, a broad midday bulge on weekends) and drawn as Poisson counts. Rain affects 18% of days, and one town-hall event day raises traffic and boosts drinks and snacks. Each visitor either browses without buying or follows one of six shopping missions (Grab and Go, Lunch Run, Top-up, Dinner, Essentials, Urgent Need) chosen by time of day. The mission sets the basket size and category preferences, and products within a category are chosen by popularity tier. If an item is out of stock, the customer substitutes a same-category item with 35% probability or the sale is lost (recorded in `unmet_demand`).

**Products.** 63 products in 8 categories (grocery, drinks, snacks, dairy and chilled, fresh and bakery, ready-to-eat, household, personal and convenience). Opening inventory is about A$24.6k at cost, under the A$40,000 cap. Unused budget is not operating cash.

**Perishables.** Each received lot is a batch with an expiry day (received day + shelf life). Stock is sold earliest-expiry-first, and a batch is removed and written off at cost at the start of its expiry day.

**Store Brain (rule-based).** Each day: receive yesterday's order and remove expired stock, then trade, then at close review stock and order for tomorrow (fixed one-day lead time; the cost leaves cash immediately; no order after Day 60). It estimates demand from the trailing 7-day average and raises SOLD_OUT, LOW_STOCK (low days of cover), EXPIRY_WARNING (units expected to be unsold before expiry) and SLOW_MOVER (more than 35 days of cover) events. Perishables are ordered up to a short cover target based on shelf life, counting only stock still sellable tomorrow. Other products reorder at 4 days of cover, up to 10 days. Orders are funded in urgency order and can never exceed available cash. Every event records the detected condition, the action taken and the outcome.

## AI collaboration

**Tools:** Claude (Anthropic), used as a chat assistant throughout.

**Tasks it assisted with:** project planning and build order; the SQLite schema and immutability triggers; drafting the product catalogue; designing the customer and demand model; the simulation engine and Store Brain; the report and assurance queries; the React interface; and drafting the wording of the findings and README. 

**What I reviewed, changed or rejected** I reviewed all the changes it made to my initial code, cleaning it up where necessary, rejected a few changes that overhauled the project's initial look:

- **Catalogue.** The AI drafted the 63-product list. I reviewed prices, costs and shelf lives for plausibility and changed: [list what you actually changed, for example specific prices, shelf lives or products].
- **Bug found by checking the output against the declared model.** The first calibration showed about 14% fewer visitors than the configuration implied. Diagnostic scripts and the AI traced it to a misspelt configuration key (`rainTrafficFactorL`), which silently produced zero customers on every rainy day. I corrected the key and added a check that stops the simulation if expected visitors is not a finite number. The calibration was re-run before any other tuning.
- **Rejected AI estimate.** The AI predicted that filling the A$38k target would need 15–20 days of cover. Running the calibration showed 21 days of cover reached only about A$20k. I chose not to inflate stock to use the budget and declared this in the Model Declaration.
- **Checked a claim before including it.** The AI's first diagnosis for the Ready-to-Eat finding was a weekday/weekend demand mismatch. I ran a SQL query by weekday on the stored events, found it fitted only partly (Monday write-offs, Thursday–Friday sold-outs), and the finding was reworded to say the explanation is likely rather than proven.

I remain responsible for the model, the stored history and every claim in the report.

## Known limitations

- Demand parameters are plausible assumptions and are not calibrated to real data, so the results describe how this model behaves, not a real store.
- Fixed costs (premises, rent, fit-out, refrigeration, utilities, insurance, hardware, overhead) and wages are outside the boundary, so gross profit and closing cash must not be read as net profit.
- Supplier availability is unlimited, with no minimum order sizes, delivery fees or payment terms. Deliveries are always on time. Prices and costs are constant and there are no markdowns.
- Lost sales do not affect later customer behaviour (no repeat-visit effect).
- In the Submitted Run the cash constraint never bound, so the cash-priority ordering rule is implemented but not demonstrated by this run's evidence.
- The Store Brain uses a flat 7-day average with no day-of-week adjustment, which Finding 1 identifies as a likely cause of perishable waste.
- One run (one seed) is analysed, with no confidence intervals.
- Immutability is enforced by database triggers and the absence of edit endpoints, not by cryptographic means.