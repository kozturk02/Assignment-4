# Autonomous Supermarket

A fictional autonomous supermarket near Swanston Street and Melbourne Town Hall. The application simulates 60 days and lets a remote manager inspect commercial results, daily records and assurance. Built with React/Vite, Node.js/Express and SQLite (better-sqlite3).

## Install and run

Requires Node.js 24.x and npm 11.x. From the project folder:

```bash
npm run setup
npm run build
npm start
```

Open **http://127.0.0.1:3001** and keep the terminal running. No API keys, login or environment file are required. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

For development, run `npm run dev:backend` and `npm run dev:frontend` in separate terminals, then open **http://127.0.0.1:5173**. Ubuntu setup is also available through `bash setup_ubuntu.sh`.

Optional backend variables: `PORT` (3001), `DB_PATH` (an absolute database path) and `CLIENT_ORIGIN` (allowed frontend origins). If changing the development backend port, update frontend/vite.config.js.

## Stored run and inspection

The database is **backend/data/supermarket.db** and contains one completed Submitted Run:

```text
RUN-280264aa-fb4f-4d74-ad0e-bf35c7227e42
```

On **Home**, select **View** beside Submitted Run. No new simulation is needed to inspect it.

- **Performance:** financial totals, shoppers, categories and products.
- **Operations:** inventory health, replenishment and Store Brain decisions.
- **Diagnosis:** three findings with evidence, diagnoses and recommendations.
- **Assurance:** retained records, exceptions and inventory, revenue and cash reconciliation.
- **Daily Report:** select any Day 1-60; use Records to inspect transactions, inventory, orders and alerts.
- **Model Declaration:** frozen assumptions, demand weights, stock rules and opening catalogue.

Secondary tabs organise each view. Tables scroll and column headings sort. Calculation sections show formulas and inputs; audit links open the relevant day or product. In Records, **View transaction** shows the requested basket, source batches, stock deductions and cash receipt.

To create another run, choose **New Simulation**, adjust settings and opening quantities, then **Run Simulation**. A new run keeps existing history. **Use as Submitted Run** selects a completed run after assurance passes. Run `npm run demo` to check the selected run's assurance.

## Architecture and model

React calls Express through fetch. database.js manages SQLite and validation; simulation.js generates customers and runs the Store Brain; reports.js derives reports; assurance.js independently checks recorded history. Express serves the built frontend and API.

Each run freezes its catalogue and configuration. SQLite retains customers, requests, transactions, batches, stock movements, orders, cash, alerts and daily positions. A run writes in one transaction and rolls back on failure. Completed history cannot be edited through the app; database triggers also protect it. JSON is seed/configuration data, not the primary database.

The model uses 48 products with varied prices, popularity and shelf lives. Customer volume varies by day; shopping missions influence arrival time, basket size and category demand. Requests are generated before stock checks, so missed demand is recorded.

Each morning receives yesterday's orders and removes expired stock. Sales use the oldest valid batch. At closing, the Store Brain observes recent demand, identifies low stock, sold-out products, expiry and slow movers, then places affordable next-day orders. Opening stock is limited to A$40,000; operating cash starts separately at A$15,000. Unused inventory funding is not cash. No orders are placed after Day 60.

## AI collaboration and verification

ChatGPT through Codex assisted with model/catalogue drafting, implementation, debugging, analysis and documentation. Reviewed corrections included a same-origin request filter that blocked the built website and reconciliation checks tested against deliberately corrupted revenue, cash and expired-sale records. The author remains responsible for understanding and validating the work.

Development checks covered simulation constraints, persistence, integrity and sorting. The production build, desktop/mobile review and clean-copy installation passed. The included Submitted Run retains 60 days and passes recalculated assurance.

## Limitations and submission

This local prototype has no authentication, real customer history, live suppliers, price elasticity, substitution, markdowns or delivery delays. Shelf lives and prices are fixed; receipts are assumed fresh. Rent, fit-out, utilities, hardware, delivery/payment fees and overheads are excluded; GST is not separately calculated. Cash growth does not establish real profitability. Real data is needed for calibration.

Submit a source ZIP with the README, lock files and SQLite database; exclude node_modules, build folders, .git, temporary files and secrets. Submit the 4-8 minute MP4 separately with working audio, your face and student ID. Demonstrate the website, findings, one daily audit trace, assurance and AI contribution.
