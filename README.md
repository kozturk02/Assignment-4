# Autonomous Supermarket

A local React, Node.js/Express and SQLite application for a fictional autonomous supermarket near Swanston Street and Melbourne Town Hall. It simulates 60 consecutive days and lets a remote manager review commercial results, daily evidence and integrity checks. The scenario is not affiliated with IGA.

## Install and run

Use **Node.js 24.x and npm 11.x** (checked with Node.js 24.15.0 and npm 11.14.1). No API keys, login or environment file are needed.

From the extracted project folder:

```bash
npm run setup
npm run build
npm start
```

Open **http://127.0.0.1:3001**. Keep the terminal running. Express serves the website and API.

If Windows PowerShell blocks npm.ps1, use `npm.cmd` in place of `npm`.

For development, run `npm run dev:backend` and `npm run dev:frontend` in separate terminals, then open **http://127.0.0.1:5173**. Vite forwards API requests to port 3001. Ubuntu users can use `bash setup_ubuntu.sh`, then `bash run_backend.sh` and `bash run_frontend.sh` with Node.js 24 installed.

Optional backend variables: `PORT` (default 3001), `DB_PATH` (default below; use an absolute path if overridden), and `CLIENT_ORIGIN` (allowed local frontend origins). If changing the development backend port, update the proxy in frontend/vite.config.js.

## Submitted Run and new simulations

The included SQLite database is **backend/data/supermarket.db**. It retains the completed Submitted Run:

```text
RUN-9b7eb376-bdb7-434a-87ee-bf4f93bb698d
```

This run uses seed 234234 and covers 27 August to 25 October 2026. Its daily customer means are 200 on weekdays and 300 on weekends, with up to 15% variation. Opening inventory costs A$4,795.95 within the A$40,000 limit; operating cash starts separately at A$15,000. Unused inventory funding is not cash.

On **Home**, find the row marked **Submitted Run** and select **View**. Its reports are immediately available; no new simulation is needed.

To test another run, select **New Simulation**, choose the settings and opening quantities, then select **Run Simulation**. Quantities are saved automatically before running. Opening inventory over A$40,000 prevents the run from starting. Each completed run retains its own configuration and history.

Use **Select run** in the review to switch runs. On Home, **Use as Submitted Run** selects a completed run after its assurance checks pass. It does not alter history. `npm run demo` verifies the selected run, creating a default run only when no Submitted Run exists.

## Review and required evidence

The **Review Run** workspace has six main tabs. Each contains a small set of secondary tabs; long tables scroll inside their panels. Select a table heading to sort alphabetically or numerically; select it again to reverse the order. Sorting uses underlying numbers, including currency values.

| Main tab | Secondary tabs and evidence |
| --- | --- |
| Daily Report | Overview, Cash & orders, Inventory, Store Brain, Records. One day selector covers Days 1-60; product filters focus inventory and decisions. |
| Performance | Overview: customers, transactions, units, revenue, cost of goods sold, gross profit, write-offs, closing cash and inventory. Shoppers: daily averages, baskets, transaction value, weekday/weekend comparison and the 60-day activity chart. Categories and Products: category sales and profit, top sellers and weak sellers. |
| Operations | Overview: all required event counts, including zero events. Category health and Product inventory: stockouts, low stock, expiry losses, slow movers, orders, spending and closing stock. Store Brain: significant conditions, actions and recorded outcomes. |
| Diagnosis | Three findings: product mix, availability and waste, cash and viability. Each includes observation, evidence, diagnosis, business implication, recommendation and limitation. |
| Assurance | Checks & exceptions, History, Inventory, Revenue and Operating cash. Includes 60/60 days, retained record counts, PASS/FAIL results, exceptions and reconciliations. |
| Model Declaration | Overview, Customers & demand, Expiry, Store Brain, Catalogue. Frozen assumptions, shopping weights, expiry handling, thresholds, cash constraints, financial rules and all opening products. |

Daily selection and secondary tabs survive refreshes and navigation. Whole-run results always cover all 60 days, regardless of the selected daily filter. Run ID and Submitted Run status remain visible.

Optional **Calculation** sections show formulas and recorded inputs. Required audit links lead to the relevant day, product or records within Daily Report > Records. Records can be filtered by type, day and product. **Load more records** appends rows to the same scrollable table; evidence sorting applies to the entire matching history before records are loaded. Older evidence URLs remain supported.

For a sale, open **View transaction** to inspect its requested basket, sold batch lines, inventory deductions and cash receipt. Assurance independently checks:

- Inventory: opening + received - sold - expired = closing stock; no negative stock, overselling or expired sales.
- Revenue: daily totals equal transaction totals; run revenue equals the sum of daily revenue and sold-item values.
- Cash: opening cash + revenue - order spending = closing cash; each order is affordable when placed.

Stockouts, expiry and cash warnings may be legitimate business outcomes. Contradictions in stored history produce FAIL results.

## Architecture and data flow

React calls Express through fetch. A run freezes its product catalogue and model settings, then writes customer requests, transactions, source batches, stock movements, orders, cash events, alerts and daily positions into SQLite in one transaction. Failed runs roll back. Reports are derived from the selected run's retained history; assurance replays stock and cash and compares calculations with recorded values.

Completed history has no edit or delete route. SQLite triggers also reject historical changes and additions to completed runs. The Submitted Run pointer can change independently. JSON seeds the opening catalogue and stores structured configuration inside SQLite; SQLite is the primary persistent store.

```text
backend/
  database.js        Schema, validation and history protection
  simulation.js      Customer generation, sales and Store Brain
  reports.js         Run reports, findings and daily views
  assurance.js       Independent reconciliation checks
  server.js          Express API and local website server
  data/products.json Seed catalogue
  data/supermarket.db Submitted Run and retained history
frontend/
  src/pages/         Setup and review views
  src/components/    Tables, secondary tabs and evidence browser
  src/api.js         Fetch requests
  src/styles.css     Interface styles
```

## Customer model and Store Brain

The opening range has 48 products across eight categories, with clear pack sizes, purchase costs, prices, quantities and shelf lives. Prices and popularity are educational assumptions. Shelf life 0 means durable stock within the run.

Defaults are 170 weekday and 110 weekend customers with up to 15% daily variation. Commute, lunch, top-up and convenience missions influence arrival times, basket size and category preference. Popularity varies by product. Requests are generated before checking stock, so missed demand is retained.

Each morning, yesterday's orders arrive and expired batches are removed. Customers shop in arrival-hour order; sales consume the oldest valid batch first. Each completed purchase links sold items, stock deductions and a cash receipt.

At the close, the Store Brain observes the last seven days of requested demand, including missed units. It detects low stock, sold-out products, approaching expiry and slow movers. Sold-out products and the lowest stock cover have replenishment priority. Target cover is limited by shelf life and the remaining simulation days; slow-mover orders are held.

Orders are capped at whole units affordable from current cash. Cash is deducted when ordered; delivery arrives before customers the next day. Partial or deferred orders retain cash-constraint records. No orders are placed after Day 60. Exact rules and weights are available in Model Declaration.

## Verification

Run `npm run demo` to recalculate assurance for the included Submitted Run.

Development verification covered complete runs, expiry, constrained cash, immutable history, corrupted evidence, persistence, API validation and sorting. The production build, desktop/mobile navigation and clean-copy installation passed on 14 October 2026. The included database was verified unchanged.

## AI collaboration

ChatGPT through Codex assisted with interpreting the brief, drafting the catalogue and model, implementing React and Express, debugging, reconciliation, tests and documentation. The author remains responsible for reviewing and understanding the code, assumptions and conclusions.

Examples of reviewed and corrected output:

- Replaced leftover AI Capsule routes, database fields and startup commands with the supermarket workflow.
- Fixed an origin filter that blocked the production site's own module script; added an HTTP check.
- Tested reconciliation against deliberately corrupted evidence rather than relying on a saved PASS result.
- Corrected Windows persistence-test cleanup to close SQLite before deleting the temporary database.
- Kept required report evidence while removing assignment numbering, reducing prose and adding secondary navigation. Evidence sorting was changed to sort the full matching history before loading records.

## Limitations

This is a local prototype for one remote manager without authentication or live suppliers. It has no real customer history, demand response to prices, substitution, markdowns, variable shelf life or delivery delays. Receipts are assumed fresh.

Rent, fit-out, refrigeration, utilities, insurance, hardware, delivery charges, payment fees and overheads are excluded; GST is not separately calculated. Cash growth and the inventory trading result do not establish real profitability. Target stock falls near the end of the 60-day horizon. Real operating data is needed for calibration.

Persistence depends on retaining the included SQLite database.

## Video and submission

Record your own **4-8 minute MP4 with working audio**, showing your **face and student ID**. Present the working website as a project handover:

1. Introduce the store, customer model and Store Brain. Show New Simulation, opening funding and sample products.
2. Open the Submitted Run and its Run ID. Use Model Declaration for the assumptions.
3. Show Performance and Operations, then explain all three Diagnosis findings and recommendations.
4. Inspect one Daily Report and a Store Brain decision. For this run, Day 45 / P25 (White bread 650 g) provides an expiry example: 12 units and A$20.40 written off. Follow its stored history and open a transaction.
5. Show Assurance: 60/60 days, inventory, revenue and cash checks, plus exceptions. State limitations and how AI assisted.

Submit one **source-code ZIP** containing the project, README, package lock files and backend/data/supermarket.db. Exclude node_modules, build folders, .git, temporary files and secrets. Submit the MP4 separately. Check the uploaded video's duration, audio and playback. Separate daily documents or another written report are not required.
