import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getReport } from '../api';
import Calculation, { Equation } from '../components/Calculation';
import BrainCalculation from '../components/BrainCalculation';
import StatCard from '../components/StatCard';
import Table from '../components/Table';
import ReviewTabs, { ReviewPanel } from '../components/ReviewTabs';
import { runLink, money, number, eventNames, evidenceLink, dailyLink } from '../format';

function ReportPage({ run, section = 'performance' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    getReport(run.id).then(report => { if (active) setData(report); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [run.id]);

  const productColumns = [
    { key: 'name', label: 'Product', render: row => <Link className="text-link" to={evidenceLink(run.id, 'items', null, row.productId)}>{row.name}</Link> },
    { key: 'unitsSold', label: 'Units sold', render: row => number(row.unitsSold) },
    { key: 'revenueCents', label: 'Revenue', render: row => money(row.revenueCents) },
    { key: 'grossProfitCents', label: 'Gross profit', render: row => <><strong>{money(row.grossProfitCents)}</strong><Calculation><Equation label="Gross profit" formula="Revenue − COGS" substitution={`${money(row.revenueCents)} − ${money(row.cogsCents)}`} result={money(row.grossProfitCents)} /></Calculation></> }
  ];

  return <>
    <div className="page-heading"><h2>{({ performance: 'Business Performance', operations: 'Inventory & Operations', diagnosis: 'Commercial Diagnosis' })[section]}</h2>{data && <p>{data.days[0]?.date} to {data.days.at(-1)?.date} · {data.days.length} days</p>}</div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {!data && !error && <p className="loading">Building the report from stored history...</p>}
    {data && <>
      {section === 'performance' && <section className="report-section" id="performance">
        <ReviewTabs scope="performance" label="Performance details">
        <ReviewPanel value="overview" label="Overview">
        <div className="stats-grid">
          <StatCard label="Sales revenue" value={money(data.totals.revenueCents)} />
          <StatCard label="Cost of goods sold" value={money(data.totals.cogsCents)} note="Purchase cost of units sold" />
          <StatCard label="Gross profit" value={money(data.totals.grossProfitCents)}  />
          <StatCard label="Expiry write-offs" value={money(data.totals.writeOffCents)} note={`${number(data.totals.writeOffUnits)} units at purchase cost`} />
          <StatCard label="Total customers" value={number(data.totals.customers)} />
          <StatCard label="Completed transactions" value={number(data.totals.transactions)} />
          <StatCard label="Units sold" value={number(data.totals.unitsSold)} note={`${number(data.totals.missedUnits)} requested units missed`} />
          <StatCard label="Closing operating cash" value={money(data.totals.closingCashCents)} />
          <StatCard label="Trading result" value={money(data.totals.tradingResultCents)} note="Gross profit less write-offs" />
          <StatCard label="Closing inventory value" value={money(data.totals.closingInventoryCents)} note="Valued at purchase cost" />
        </div>
        <Calculation title="Calculations · financials and averages">
          <Equation label="Gross profit" formula="Gross profit = revenue − COGS" substitution={`${money(data.totals.revenueCents)} − ${money(data.totals.cogsCents)}`} result={money(data.totals.grossProfitCents)} />
          <Equation label="Trading result" formula="Trading result = gross profit − write-offs" substitution={`${money(data.totals.grossProfitCents)} − ${money(data.totals.writeOffCents)}`} result={money(data.totals.tradingResultCents)} />
          <Equation label="Closing cash" formula="Closing cash = opening cash + revenue − replenishment spending" substitution={`${money(data.totals.openingCashCents)} + ${money(data.totals.revenueCents)} − ${money(data.totals.replenishmentCents)}`} result={money(data.totals.closingCashCents)} />
          <Equation label="Customers / day" formula="Average daily customers = customers ÷ retained days" substitution={`${number(data.totals.customers)} ÷ ${data.days.length}`} result={number(data.totals.averageCustomers, 1)} />
          <Equation label="Basket size" formula="Average basket size = units sold ÷ completed transactions" substitution={data.totals.transactions ? `${number(data.totals.unitsSold)} ÷ ${number(data.totals.transactions)}` : 'No completed transactions; model convention: 0'} result={`${number(data.totals.averageBasketSize, 2)} units`} />
          <Equation label="Transaction value" formula="Average transaction value = revenue ÷ completed transactions" substitution={data.totals.transactions ? `${money(data.totals.revenueCents)} ÷ ${number(data.totals.transactions)}` : 'No completed transactions; model convention: 0'} result={money(data.totals.averageTransactionCents)} />
          <Equation label="Fulfilled demand" formula="Fulfilment = units sold ÷ requested units × 100" substitution={`${number(data.totals.unitsSold)} ÷ ${number(data.totals.requestedUnits)} × 100`} result={`${number(data.totals.fulfilmentPercent, 1)}%`} />
          <Equation label="Closing inventory" formula="Closing inventory value = opening value + received value − COGS − write-offs" substitution={`${money(data.totals.openingInventoryCents)} + ${money(data.products.reduce((sum, p) => sum + p.receivedUnits * p.unitCostCents, 0))} − ${money(data.totals.cogsCents)} − ${money(data.totals.writeOffCents)}`} result={money(data.totals.closingInventoryCents)}><Link className="text-link" to={runLink(run.id, 'operations')}>Inspect product positions</Link></Equation>
          <Link className="text-link" to={evidenceLink(run.id, 'transactions')}>Inspect underlying transactions</Link>
        </Calculation>
        <p>{number(data.totals.fulfilmentPercent, 1)}% of requested units were fulfilled. After write-offs, the trading result was {money(data.totals.tradingResultCents)}; operating overheads are excluded.</p>
        </ReviewPanel>
        <ReviewPanel value="shoppers" label="Shoppers">
        <div className="stats-grid three">
          <StatCard label="Customers per day" value={number(data.totals.averageCustomers, 1)} />
          <StatCard label="Basket size" value={`${number(data.totals.averageBasketSize, 2)} units`} />
          <StatCard label="Transaction value" value={money(data.totals.averageTransactionCents)} />
        </div>
        <div className="panel"><h3>Weekday and weekend shopping</h3>
          
          <Table rows={Object.entries(data.comparisons).map(([name, values]) => ({ name: name === 'weekday' ? 'Weekdays' : 'Weekends', ...values }))} columns={[
            { key: 'name', label: 'Day group' }, { key: 'days', label: 'Days' },
            { key: 'customers', label: 'Customers', render: row => number(row.customers) },
            { key: 'averageCustomers', label: 'Customers / day', render: row => <span>{number(row.customers)} ÷ {row.days} = <strong>{number(row.averageCustomers, 1)}</strong></span> },
            { key: 'transactions', label: 'Transactions', render: row => number(row.transactions) },
            { key: 'revenueCents', label: 'Revenue', render: row => money(row.revenueCents) },
            { key: 'averageRevenueCents', label: 'Revenue / day', render: row => <span>{money(row.revenueCents)} ÷ {row.days} = <strong>{money(row.averageRevenueCents)}</strong></span> }
          ]} />
        </div>
        <div className="panel"><h3>Customer activity across the 60 days</h3><p className="muted">Select a day to inspect its report.</p>
          <div className="chart-legend"><span><i className="weekday-key" /> Weekday</span><span><i className="weekend-key" /> Weekend</span><span>Maximum: {Math.max(...data.days.map(day => day.customers))} customers</span></div>
          <div className="activity-chart" aria-label="Daily customer activity">
            {data.days.map(day => <Link key={day.day} to={dailyLink(run.id, day.day)} className={day.isWeekend ? 'weekend-bar' : 'weekday-bar'}
              style={{ height: `${day.customers / Math.max(...data.days.map(row => row.customers)) * 100}%` }}
              title={`Day ${day.day}, ${day.weekday}: ${day.customers} customers`} aria-label={`Day ${day.day}: ${day.customers} customers`} />)}
          </div><div className="chart-axis"><span>Day 1</span><span>Day 15</span><span>Day 30</span><span>Day 45</span><span>Day 60</span></div>
        </div>
        </ReviewPanel>
        <ReviewPanel value="categories" label="Categories">
        <div className="panel"><h3>Category performance</h3><Table rows={data.categories} columns={[
          { key: 'category', label: 'Category' }, { key: 'unitsSold', label: 'Units sold', render: row => number(row.unitsSold) },
          { key: 'revenueCents', label: 'Revenue', render: row => money(row.revenueCents) },
          { key: 'cogsCents', label: 'COGS', render: row => money(row.cogsCents) },
          { key: 'grossProfitCents', label: 'Gross profit', render: row => <><strong>{money(row.grossProfitCents)}</strong><Calculation><Equation label="Gross profit" formula="Revenue − COGS" substitution={`${money(row.revenueCents)} − ${money(row.cogsCents)}`} result={money(row.grossProfitCents)} /></Calculation></> }
        ]} /></div>
        </ReviewPanel>
        <ReviewPanel value="products" label="Products">
        <div className="two-columns"><div className="panel"><h3>Top-selling products</h3><Table rows={data.topProducts} columns={productColumns} /></div>
          <div className="panel"><h3>Weak-selling products</h3><p className="muted">Lowest unit sales. Weak sales alone do not prove excess stock.</p><Table rows={data.weakProducts} columns={productColumns} /></div></div>
        </ReviewPanel></ReviewTabs>
      </section>}

      {section === 'operations' && <section className="report-section" id="operations">
        <ReviewTabs scope="operations" label="Operations details">
        <ReviewPanel value="overview" label="Overview">
        <div className="stats-grid">{Object.entries(data.eventCounts).map(([type, count]) => <StatCard key={type} label={eventNames[type]} value={number(count)} />)}</div>
        <p className="muted">Low-stock, sold-out and slow-mover counts are product-day observations at the close. Expiry records are batch removals; replenishment records are orders. Zero event types remain visible.</p>
        <p>{number(data.totals.missedUnits)} requested units went unfilled; {number(data.totals.writeOffUnits)} units expired at a cost of {money(data.totals.writeOffCents)}.</p>
        </ReviewPanel>
        <ReviewPanel value="categories" label="Category health">
        <div className="panel"><h3>Inventory health by category</h3><Table rows={data.categories} columns={[
          { key: 'category', label: 'Category' }, { key: 'stockoutDays', label: 'Sold-out product-days' },
          { key: 'lowStockDays', label: 'Low-stock product-days' }, { key: 'expiredUnits', label: 'Expired units' },
          { key: 'writeOffCents', label: 'Write-off value', render: row => money(row.writeOffCents) },
          { key: 'orderedUnits', label: 'Units ordered', render: row => number(row.orderedUnits) },
          { key: 'replenishmentCents', label: 'Spending', render: row => money(row.replenishmentCents) },
          { key: 'closingQuantity', label: 'Closing units' }, { key: 'closingValueCents', label: 'Closing value', render: row => money(row.closingValueCents) }
        ]} />
          <p>{number(data.totals.replenishmentUnits)} units were ordered for {money(data.totals.replenishmentCents)}. {number(data.totals.receivedUnits)} units were received within the horizon. {data.eventCounts.cash_constraint === 0 ? 'No replenishment decision was constrained by insufficient operating cash.' : `${data.eventCounts.cash_constraint} decisions were constrained by insufficient cash; inspect the Store Brain records for affordable partial orders or deferrals.`}</p>
        </div>
        </ReviewPanel>
        <ReviewPanel value="inventory" label="Product inventory">
        <section className="panel"><h3>Inventory and slow movers</h3>
          <p className="muted">{data.products.length} products · {data.products.filter(product => product.slowMoverDays > 0).length} observed slow movers</p>

          <Table rows={data.products} columns={[
            { key: 'name', label: 'Product', render: row => <Link className="text-link" to={evidenceLink(run.id, 'inventory', null, row.productId)}>{row.name}</Link> },
            { key: 'initialQuantity', label: 'Opening' }, { key: 'receivedUnits', label: 'Received' }, { key: 'unitsSold', label: 'Sold' },
            { key: 'expiredUnits', label: 'Expired' }, { key: 'writeOffCents', label: 'Write-off value', render: row => money(row.writeOffCents) },
            { key: 'stockoutDays', label: 'Sold-out days' }, { key: 'lowStockDays', label: 'Low-stock days' },
            { key: 'slowMoverDays', label: 'Slow-mover days' },
            { key: 'orderedUnits', label: 'Ordered' }, { key: 'replenishmentCents', label: 'Order spending', render: row => money(row.replenishmentCents) },
            { key: 'closingQuantity', label: 'Closing units', render: row => <>{number(row.closingQuantity)}<Calculation><Equation label="Closing stock" formula="Opening + received − sold − written off" substitution={`${row.initialQuantity} + ${row.receivedUnits} − ${row.unitsSold} − ${row.expiredUnits}`} result={row.initialQuantity + row.receivedUnits - row.unitsSold - row.expiredUnits} recorded={row.closingQuantity} matches={row.initialQuantity + row.receivedUnits - row.unitsSold - row.expiredUnits === row.closingQuantity} /><Equation label="Closing value" formula="Closing stock × unit purchase cost" substitution={`${row.closingQuantity} × ${money(row.unitCostCents)}`} result={money(row.closingValueCents)} /><Equation label="Write-off" formula="Expired units × unit purchase cost" substitution={`${row.expiredUnits} × ${money(row.unitCostCents)}`} result={money(row.writeOffCents)} /></Calculation></> }, { key: 'closingValueCents', label: 'Closing value', render: row => money(row.closingValueCents) }
          ]} />
        </section>
        </ReviewPanel>
        <ReviewPanel value="decisions" label="Store Brain">
        <div className="inline-links"><Link className="text-link" to={evidenceLink(run.id, 'alerts')}>All Store Brain decisions and warnings</Link><Link className="text-link" to={evidenceLink(run.id, 'orders')}>Replenishment orders</Link></div>
        <h3 className="section-title">Significant decisions</h3>
        <div className="scroll-list" role="region" aria-label="Significant Store Brain cases" tabIndex={0}>
        {data.cases.map(record => <article className="panel case-card" key={record.id}>
          <div className="section-heading"><h3>{record.name}</h3><span className="badge">Day {record.day} / {eventNames[record.type]}</span></div>
          <dl><dt>Condition</dt><dd>{record.condition}</dd><dt>Action</dt><dd>{record.action}</dd><dt>Recorded outcome</dt><dd>{record.outcome}</dd></dl>
          <BrainCalculation record={record} config={run.config} product={run.config.products.find(product => product.productId === record.productId)} />
          <div className="inline-links"><Link className="text-link" to={dailyLink(run.id, record.day, record.productId)}>Inspect Day {record.day}</Link>
            <Link className="text-link" to={evidenceLink(run.id, 'alerts', record.day, record.productId)}>Brain record #{record.id}</Link>
            {record.nextDay && <Link className="text-link" to={dailyLink(run.id, record.day + 1, record.productId)}>Following-day position</Link>}</div>
        </article>)}
        </div>
      </ReviewPanel></ReviewTabs>
      </section>}

      {section === 'diagnosis' && <section className="report-section" id="findings">
        <ReviewTabs scope="diagnosis" label="Commercial findings">
        {data.findings.map((finding, index) => <ReviewPanel key={finding.title} value={`finding-${index + 1}`} label={['Product mix', 'Availability & waste', 'Cash & viability'][index]}>
        <article className="panel finding" key={finding.title}>
          <p className="eyebrow">Finding {index + 1}</p><h3>{finding.title}</h3>
          <dl><dt>Observation</dt><dd>{finding.observation}</dd><dt>Evidence</dt><dd>{finding.evidence}</dd>
            <dt>Diagnosis</dt><dd>{finding.diagnosis}</dd><dt>Business implication</dt><dd>{finding.implication}</dd>
            <dt>Recommendation</dt><dd>{finding.recommendation}</dd><dt>Model limitation</dt><dd>{finding.limitation}</dd></dl>
          <div className="inline-links"><Link className="text-link" to={dailyLink(run.id, finding.day, finding.productId)}>Trace to Day {finding.day}</Link>
            <Link className="text-link" to={evidenceLink(run.id, 'inventory', null, finding.productId)}>Inspect supporting history</Link></div>
        </article></ReviewPanel>)}
        </ReviewTabs>
      </section>}

    </>}
  </>;
}

export default ReportPage;
