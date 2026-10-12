import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDailyReport } from '../api';
import Table from '../components/Table';
import ReviewTabs, { ReviewPanel } from '../components/ReviewTabs';
import StatCard from '../components/StatCard';
import Calculation, { Equation } from '../components/Calculation';
import BrainCalculation from '../components/BrainCalculation';
import { money, number, dailyLink } from '../format';

function ModelDeclarationPage({ run }) {
  const config = run.config;
  const [daily, setDaily] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setDaily(null); setError('');
    getDailyReport(run.id, 1).then(data => { if (active) setDaily(data); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [run.id]);
  const fresh = config.products.find(p => p.shelfLifeDays > 0 && p.initialQuantity > 0);
  const example = daily?.alerts.find(a => a.type === 'replenishment') || daily?.alerts.find(a => a.type === 'low_stock' || a.type === 'sold_out');
  return <>
    <div className="page-heading"><h2>Model Declaration</h2><p>Fictional Melbourne CBD store · Model {config.modelVersion}</p></div>
    <ReviewTabs scope="model" label="Model declaration details">
    <ReviewPanel value="overview" label="Overview">
    <div className="stats-grid three">
      <StatCard label="Simulation period" value={`${config.days} days`} note={`Starting ${config.startDate} · Seed ${config.seed}`} />
      <StatCard label="Opening inventory" value={money(run.openingInventoryCents)} note={`Budget ${money(config.openingInventoryBudgetCents)}`} />
      <StatCard label="Opening operating cash" value={money(config.openingCashCents)} note="Opening stock funded separately" />
    </div>
    <Calculation title="Calculations · opening inventory">
      <Equation label="Inventory budget" formula="Opening value = Σ(initial quantity × unit purchase cost) ≤ inventory budget" substitution={`${config.products.length} catalogue products: ${money(run.openingInventoryCents)} ≤ ${money(config.openingInventoryBudgetCents)}`} />
      <Equation label="Unused funding" formula="Unused budget = inventory budget − opening inventory" substitution={`${money(config.openingInventoryBudgetCents)} − ${money(run.openingInventoryCents)}`} result={money(config.openingInventoryBudgetCents - run.openingInventoryCents)} />
      <p className="muted">Unused inventory funding does not become operating cash.</p>
    </Calculation>
    <section className="panel"><h2>Financial rules and limitations</h2>
      <div className="formula">Revenue = Σ(sold units × selling price)<br />COGS = Σ(sold units × purchase cost)<br />Gross profit = revenue − COGS<br />Trading result = gross profit − write-offs<br />Closing cash = opening cash + revenue − order spending</div>
      <p>Sales are paid immediately. Prices and purchase costs stay fixed. Opening inventory funding is separate from operating cash. Repeated alerts count as separate product-day observations.</p>
      <p className="muted">No real customer history or price elasticity; no substitution, markdown, variable shelf life or delivery delays. Rent, fit-out, utilities, insurance, hardware, staffing, delivery charges, payment fees and overheads are excluded. GST is not calculated separately. Day 60 reduces target stock to zero. These assumptions require calibration with real operating data; cash growth does not establish real store profitability.</p>
    </section>
    </ReviewPanel>
    <ReviewPanel value="demand" label="Customers & demand">
    <section className="panel"><h3>Customer activity and demand</h3>
      <p>{config.weekdayCustomers} weekday and {config.weekendCustomers} weekend visits, with up to {number(config.demandVariation * 100)}% seeded daily variation. Shopping missions shape arrival times, baskets and category preferences.</p>
      <Calculation title="Customer generation"><Equation label="Daily visits" formula="Customers = round(day-group mean × (1 − variation + 2 × variation × u)); u ∈ [0, 1)" substitution={`Weekday mean ${config.weekdayCustomers}; weekend mean ${config.weekendCustomers}; variation ${number(config.demandVariation * 100, 1)}%`} />
      <Table rows={[{ name: 'Weekdays', mean: config.weekdayCustomers }, { name: 'Weekends', mean: config.weekendCustomers }]} columns={[
        { key: 'name', label: 'Day group' }, { key: 'mean', label: 'Daily mean' },
        { key: 'range', label: 'Customer bounds', sortValue: row => row.mean, render: row => `${Math.round(row.mean * (1 - config.demandVariation))}–${Math.round(row.mean * (1 + config.demandVariation))}` }
      ]} />
      {daily && <Equation label="Retained Day 1" formula="Customer factor = recorded customers ÷ day-group mean (after rounding)" substitution={`${daily.summary.customers} ÷ ${daily.summary.isWeekend ? config.weekendCustomers : config.weekdayCustomers}`} result={number(daily.summary.customers / (daily.summary.isWeekend ? config.weekendCustomers : config.weekdayCustomers), 4)} />}
      <p className="muted">Seeded variation. The random draw is not retained; the customer count is retained.</p></Calculation>
      <Table caption="Shopping missions" rows={config.missions} columns={[
        { key: 'name', label: 'Mission' },
        { key: 'weekdayWeight', label: 'Weekday weight', render: row => `${row.weekdayWeight}%` },
        { key: 'weekendWeight', label: 'Weekend weight', render: row => `${row.weekendWeight}%` },
        { key: 'basket', label: 'Distinct product lines', sortValue: row => row.minLines, render: row => `${row.minLines}–${row.maxLines}` },
        { key: 'doubleChance', label: 'Two-unit probability', render: row => `${number(row.doubleChance * 100)}%` },
        { key: 'weights', label: 'Selection calculations', render: row => <Calculation>
          <Equation label="Category selection" formula="P(category) = category weight ÷ Σ weights of eligible categories" substitution={`Declared weight total = ${Object.values(row.categories).join(' + ')}`} result={Object.values(row.categories).reduce((a, b) => a + b, 0)} />
          <Table rows={Object.entries(row.categories).map(([name, weight]) => ({ name, weight }))} columns={[{ key: 'name', label: 'Category' }, { key: 'weight', label: 'Weight' }]} />
          <Equation label="Arrival hour" formula="P(hour) = hour weight ÷ Σ hour weights" substitution={Object.values(row.hours).join(' + ')} result={Object.values(row.hours).reduce((a, b) => a + b, 0)} />
          <Table rows={Object.entries(row.hours).map(([hour, weight]) => ({ hour: `${hour}:00`, weight }))} columns={[{ key: 'hour', label: 'Arrival hour' }, { key: 'weight', label: 'Weight' }]} />
          <Equation label="Basket lines" formula="Lines = min(catalogue size, minLines + ⌊u × (maxLines − minLines + 1)⌋)" substitution={`min(${config.products.length}, ${row.minLines} + ⌊u × (${row.maxLines} − ${row.minLines} + 1)⌋)`} />
          <Equation label="Requested quantity" formula="Quantity = 2 if u < double-unit probability; otherwise 1" substitution={`u < ${row.doubleChance} → 2 units; otherwise 1 unit`} />
        </Calculation> }
      ]} />
      <p>Mission and arrival hour use their declared weights. Customers shop in hour order. Distinct products are selected by category, then popularity within that category.</p>
      <Calculation title="Basket and product selection"><Equation label="Product selection" formula="P(product | category) = popularity ÷ Σ popularity of unchosen products in category" substitution="Weights and product popularity are retained below; eligible weights change as each basket is filled." />
      <p className="muted">Missing category weights are redistributed across eligible categories. If none remain, selection uses popularity across unchosen products.</p>
      <Equation label="Fulfilled requests" formula="Sold units = min(requested units, valid stock); missed units = requested − sold" substitution="Requests are generated before checking stock. No substitution; visits with no fulfilled units have no transaction." /></Calculation>
    </section>
    </ReviewPanel>
    <ReviewPanel value="expiry" label="Expiry">
    <section className="panel"><h3>Perishable stock and expiry</h3>
      <Calculation title="Expiry calculations">
      <Equation label="Expiry day" formula="Expiry day = receipt day + shelf-life days" substitution={fresh ? `Opening ${fresh.name}: 1 + ${fresh.shelfLifeDays}` : 'No perishable opening units in this run'} result={fresh ? `Day ${1 + fresh.shelfLifeDays}` : undefined} />
      <Equation label="Valid sale days" formula="Receipt day ≤ sale day < expiry day" substitution={fresh ? `${fresh.name}: Days 1–${fresh.shelfLifeDays}` : 'Shelf life 0 = durable within this run'} />
      </Calculation><p>Opening stock and receipts are fresh. Each morning: receive yesterday’s orders, then remove expired batches before sales. Sell the oldest valid batch first; retain batch links. Shelf life 0 denotes durable stock.</p>
      <Equation label="Write-off" formula="Write-off value = expired quantity × unit purchase cost" substitution={fresh ? `${fresh.name}: expired quantity × ${money(fresh.unitCostCents)}` : 'Use each product’s frozen purchase cost'} />
    </section>
    </ReviewPanel>
    <ReviewPanel value="rules" label="Store Brain">
    <section className="panel"><h3>Store Brain rules</h3>
      <Table rows={[
        { name: 'Observed demand', formula: `Σ requested units (including missed units) ÷ min(day, ${config.observationDays})` },
        { name: 'Low stock', formula: `0 < closing stock ≤ max(2, ⌈average demand × ${config.reorderDays}⌉)` },
        { name: 'Sold out', formula: 'Closing valid stock = 0' },
        { name: 'Expiry warning', formula: `Batch has remaining units and expiry day ≤ current day + ${config.expiryWarningDays}` },
        { name: 'Expiry removal', formula: 'Expiry day ≤ current day → remove remaining batch units before sales' },
        { name: 'Slow mover', formula: `Day ≥ ${config.observationDays} and stock > max(10, average fulfilled sales × ${config.slowMoverCoverDays}) → hold replenishment` },
        { name: 'Target cover', formula: `min(${config.targetDays}, ${config.days} − day, max(1, shelf life − 1)); durable cap = ${config.targetDays}` },
        { name: 'Target units', formula: '⌈average requested demand × target cover⌉' },
        { name: 'Wanted order', formula: 'max(0, target units − closing stock), only if stock ≤ low-stock threshold and not a slow mover' },
        { name: 'Cash limit', formula: 'Ordered = min(wanted, ⌊available cash ÷ unit purchase cost⌋)' },
        { name: 'Order spending', formula: 'Ordered units × unit purchase cost; cash deducted when placed' },
        { name: 'Arrival day', formula: 'Order day + 1; no order after Day 60' }
      ]} columns={[{ key: 'name', label: 'Rule' }, { key: 'formula', label: 'Calculation / condition' }]} />
      <p>Sold-out products have priority, then the lowest stock cover (stock ÷ max(average demand, 0.01)); product ID breaks ties. Partial or deferred orders create cash-constraint records. Expiry warnings keep oldest stock first; no discount is applied.</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      {example && <details className="model-example"><summary>Stored Day 1 decision · {example.name}</summary><p>{example.condition} {example.action}</p>
        <BrainCalculation record={example} config={config} product={config.products.find(p => p.productId === example.productId)} />
        <Link className="text-link" to={dailyLink(run.id, 1, example.productId)}>Inspect Day 1 decision evidence</Link></details>}
    </section>

    </ReviewPanel>
    <ReviewPanel value="catalogue" label="Catalogue">
    <section className="panel"><h3>Opening catalogue</h3><p className="muted">{config.products.length} products · Frozen for this run</p>
      <Table rows={config.products} columns={[
        { key: 'productId', label: 'ID' }, { key: 'name', label: 'Product / pack' }, { key: 'category', label: 'Category' },
        { key: 'unitCostCents', label: 'Purchase cost', render: row => money(row.unitCostCents) },
        { key: 'unitPriceCents', label: 'Selling price', render: row => money(row.unitPriceCents) },
        { key: 'initialQuantity', label: 'Opening units' },
        { key: 'openingValue', label: 'Opening value', sortValue: row => row.initialQuantity * row.unitCostCents, render: row => `${row.initialQuantity} × ${money(row.unitCostCents)} = ${money(row.initialQuantity * row.unitCostCents)}` },
        { key: 'shelfLifeDays', label: 'Perishable / shelf life', render: row => row.shelfLifeDays ? `Yes / ${row.shelfLifeDays} days` : 'No' },
        { key: 'popularity', label: 'Popularity weight' }
      ]} />
    </section>
    </ReviewPanel></ReviewTabs>
  </>;
}

export default ModelDeclarationPage;
