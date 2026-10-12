import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAssurance } from '../api';
import Calculation, { Equation } from '../components/Calculation';
import StatCard from '../components/StatCard';
import Table from '../components/Table';
import ReviewTabs, { ReviewPanel } from '../components/ReviewTabs';
import { runLink, money, number, evidenceLink, dailyLink } from '../format';

function AssurancePage({ run, submittedId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    getAssurance(run.id).then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [run.id]);
  const countNames = { days: 'Daily reports', products: 'Frozen products', batches: 'Receipt batches',
    customers: 'Customer visits', customerRequests: 'Requested product lines', transactions: 'Completed transactions',
    transactionItems: 'Sold batch lines', inventoryEvents: 'Inventory movements', cashEvents: 'Cash events',
    orders: 'Replenishment orders', storeBrainRecords: 'Store Brain records', dailyStockPositions: 'Daily product positions' };

  return <>
    <div className="page-heading"><h2>Commercial Assurance</h2></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {!data && !error && <p className="loading">Recalculating assurance from stored records...</p>}
    {data && <>
      <div className={`assurance-banner ${data.status === 'PASS' ? 'good' : 'bad'}`}>
        <strong>{data.status}</strong><div><h2>{data.status === 'PASS' ? 'The recorded history reconciles' : 'Integrity exceptions need investigation'}</h2>
          <p>{data.counts.days}/60 days retained. Checks are recalculated from stored history; stockouts and write-offs are business outcomes.</p></div></div>
      <ReviewTabs scope="assurance" label="Assurance details">
      <ReviewPanel value="checks" label="Checks & exceptions">
      <section className="panel"><h3>Integrity checks and exceptions</h3>
        <div className="check-list scroll-list" role="region" aria-label="Integrity checks and exceptions" tabIndex={0}>{data.checks.map(check => <div className="check-row" key={check.key}>
          <span className={`badge ${check.status === 'PASS' ? 'good' : 'bad'}`}>{check.status}</span>
          <div><h3>{check.name}</h3>{check.failureCount > 0 && <p>{number(check.failureCount)} contradictions detected.</p>}
            {check.exceptions.length > 0 && <ul>{check.exceptions.map((message, index) => <li key={index}>{message}</li>)}</ul>}
            {check.failureCount > check.exceptions.length && <p>Showing the first {check.exceptions.length} exceptions. The total failure count includes all detected contradictions.</p>}
          </div></div>)}</div>
        <div className="stats-grid">
          <StatCard label="Negative-stock movements" value={data.metrics.negativeStock} />
          <StatCard label="Overselling movements" value={data.metrics.overselling} />
          <StatCard label="Expired-product sales" value={data.metrics.expiredSales} />
          <StatCard label="Unaffordable orders" value={data.metrics.unaffordableOrders} note={`${data.metrics.negativeCash} negative cash balances`} />
        </div>
      </section>
      </ReviewPanel>
      <ReviewPanel value="history" label="History">
      <section className="panel"><h3>History completeness</h3>
        <p>Submitted Run ID: <code>{submittedId || 'Not selected'}</code></p>
        {data.runId !== submittedId && <p className="notice">Viewing a review run. Select the Submitted Run to inspect the submission evidence.</p>}
        <h3>Retained records</h3>
        <Table rows={Object.entries(data.counts).map(([key, count]) => ({ key, name: countNames[key], count }))} columns={[
          { key: 'name', label: 'Retained record type' }, { key: 'count', label: 'Records', render: row => number(row.count) }
        ]} />
        <Link className="text-link" to={runLink(run.id, "evidence")}>Inspect the retained records</Link>
      </section>
      </ReviewPanel>
      <ReviewPanel value="inventory" label="Inventory">
      <section className="panel"><h3>Inventory reconciliation</h3>
        <p>Opening stock + replenishment received - units sold - expired units = closing stock.</p>

        <Table rows={data.inventory} columns={[
          { key: 'name', label: 'Product', render: row => <Link className="text-link" to={evidenceLink(run.id, 'inventory', null, row.productId)}>{row.productId} / {row.name}</Link> },
          { key: 'opening', label: 'Opening' }, { key: 'received', label: 'Received' }, { key: 'sold', label: 'Sold' },
          { key: 'expired', label: 'Expired' }, { key: 'expectedClosing', label: 'Calculated closing' },
          { key: 'recordedClosing', label: 'Day 60 closing' }, { key: 'ledgerClosing', label: 'Ledger closing' },
          { key: 'difference', label: 'Difference', sortValue: row => row.recordedClosing === null ? null : row.recordedClosing - row.expectedClosing, render: row => row.recordedClosing === null ? 'Missing position' : row.recordedClosing - row.expectedClosing },
          { key: 'reconciliation', label: 'Calculation / result', sortValue: row => row.recordedClosing === row.expectedClosing && row.ledgerClosing === row.expectedClosing ? 'PASS' : 'FAIL', render: row => <><span className="substitution">{row.opening} + {row.received} − {row.sold} − {row.expired} = {row.expectedClosing}</span><br /><span className={`badge ${row.recordedClosing === row.expectedClosing && row.ledgerClosing === row.expectedClosing ? 'good' : 'bad'}`}>{row.recordedClosing === row.expectedClosing && row.ledgerClosing === row.expectedClosing ? 'PASS' : 'FAIL'}</span></> }
        ]} />
      </section>
      </ReviewPanel>
      <ReviewPanel value="revenue" label="Revenue">
      <section className="panel"><h3>Revenue reconciliation</h3>
        <div className="stats-grid three">
          <StatCard label="Sum of daily revenue" value={money(data.revenueTotals.dailyRevenueCents)} />
          <StatCard label="Sum of transaction totals" value={money(data.revenueTotals.transactionRevenueCents)} />
          <StatCard label="Sum of sold item values" value={money(data.revenueTotals.lineRevenueCents)} />
        </div>
        <Calculation title="Revenue reconciliation"><Equation label="Run revenue" formula="Σ daily revenue = Σ transaction totals = Σ sold-item values" substitution={`${money(data.revenueTotals.dailyRevenueCents)} = ${money(data.revenueTotals.transactionRevenueCents)} = ${money(data.revenueTotals.lineRevenueCents)}`} recorded={money(data.revenueTotals.dailyRevenueCents)} matches={data.revenueTotals.dailyRevenueCents === data.revenueTotals.transactionRevenueCents && data.revenueTotals.dailyRevenueCents === data.revenueTotals.lineRevenueCents} /></Calculation>
        <h3>Daily revenue checks</h3>
          <Table rows={data.revenue} columns={[
            { key: 'day', label: 'Day', render: row => <Link className="text-link" to={dailyLink(run.id, row.day)}>Day {row.day}</Link> },
            { key: 'recordedRevenueCents', label: 'Daily report', render: row => money(row.recordedRevenueCents) },
            { key: 'transactionRevenueCents', label: 'Stored transactions', render: row => money(row.transactionRevenueCents) },
            { key: 'differenceCents', label: 'Difference', render: row => money(row.differenceCents) }, { key: 'result', label: 'Result', sortValue: row => row.differenceCents === 0 ? 'PASS' : 'FAIL', render: row => <span className={`badge ${row.differenceCents === 0 ? 'good' : 'bad'}`}>{row.differenceCents === 0 ? 'PASS' : 'FAIL'}</span> }
          ]} />
      </section>
      </ReviewPanel>
      <ReviewPanel value="cash" label="Operating cash">
      <section className="panel"><h3>Cash reconciliation</h3>
        <Equation label="Closing cash" formula="Closing cash = opening cash + revenue − replenishment spending"
          substitution={`${money(data.cash.openingCashCents)} + ${money(data.cash.salesRevenueCents)} − ${money(data.cash.replenishmentCents)}`} result={money(data.cash.expectedClosingCents)}
          recorded={data.cash.recordedClosingCents === null ? 'Missing' : money(data.cash.recordedClosingCents)} matches={data.cash.recordedClosingCents === data.cash.expectedClosingCents && data.cash.ledgerClosingCents === data.cash.expectedClosingCents} />
        <div className="stats-grid three">
          <StatCard label="Recorded Day 60 closing cash" value={data.cash.recordedClosingCents === null ? 'Missing' : money(data.cash.recordedClosingCents)} />
          <StatCard label="Replayed cash ledger" value={money(data.cash.ledgerClosingCents)} />
          <StatCard label="Difference" value={data.cash.differenceCents === null ? 'Missing' : money(data.cash.differenceCents)} />
        </div>
        <p>Orders are checked against cash available when placed. Opening inventory funding is separate.</p>
        <div className="inline-links"><Link className="text-link" to={evidenceLink(run.id, 'cash')}>Cash ledger</Link><Link className="text-link" to={evidenceLink(run.id, 'orders')}>Orders and available cash</Link></div>
      </section>
      </ReviewPanel></ReviewTabs>
    </>}
  </>;
}

export default AssurancePage;
