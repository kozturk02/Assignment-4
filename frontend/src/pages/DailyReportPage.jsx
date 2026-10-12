import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getDailyReport } from '../api';
import DaySelector from '../components/DaySelector';
import Calculation, { Equation } from '../components/Calculation';
import BrainCalculation from '../components/BrainCalculation';
import StatCard from '../components/StatCard';
import Table from '../components/Table';
import ReviewTabs, { ReviewPanel } from '../components/ReviewTabs';
import EvidenceBrowser from '../components/EvidenceBrowser';
import { money, number, eventNames, evidenceLink } from '../format';

function DailyReportPage({ run }) {
  const [params, setParams] = useSearchParams();
  const recordsView = params.get('dailyView') === 'records';
  const requestedDay = Number(params.get('day') || 1);
  const day = Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= 60 ? requestedDay : 1;
  const productId = run.config.products.some(product => product.productId === params.get('productId')) ? params.get('productId') : '';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    getDailyReport(run.id, day).then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [run.id, day]);

  function changeDay(value) {
    const next = new URLSearchParams(params);
    next.set('day', value);
    setParams(next);
  }
  function changeProduct(value) {
    const next = new URLSearchParams(params);
    if (value) next.set('productId', value); else next.delete('productId');
    setParams(next);
  }

  return <>
    <div className="page-heading daily-heading"><h2>Daily Report</h2>{data && !recordsView && <p>{data.summary.weekday}, {data.summary.date}</p>}</div>
    {!recordsView && <div className="daily-controls"><DaySelector day={day} onChange={changeDay} />
      <label>Focus product<select aria-label="Focus product" value={productId} onChange={event => changeProduct(event.target.value)}>
        <option value="">All products</option>{run.config.products.map(product => <option key={product.productId} value={product.productId}>{product.name}</option>)}
      </select></label></div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {!data && !error && <p className="loading">Loading Day {day}...</p>}
    {data && <>
      <ReviewTabs scope="daily" label="Daily report details" defaultValue={productId ? 'inventory' : 'overview'}>
      <ReviewPanel value="overview" label="Overview">
      <div className="stats-grid">
        <StatCard label="Customers" value={number(data.summary.customers)} />
        <StatCard label="Transactions" value={number(data.summary.transactions)} />
        <StatCard label="Units sold" value={number(data.summary.unitsSold)} note={`${number(data.summary.missedUnits)} requested units missed`} />
        <StatCard label="Sales revenue" value={money(data.summary.revenueCents)} />
        <StatCard label="Gross profit" value={money(data.summary.revenueCents - data.summary.cogsCents)} />
        <StatCard label="Closing cash" value={money(data.summary.closingCashCents)} />
      </div>
      <Link className="text-link" to={evidenceLink(run.id, 'transactions', day, productId)}>View transactions</Link>
      <Calculation title="Calculations · daily financials">
        <Equation label="Gross profit" formula="Gross profit = revenue − COGS" substitution={`${money(data.summary.revenueCents)} − ${money(data.summary.cogsCents)}`} result={money(data.summary.revenueCents - data.summary.cogsCents)} />
        <Equation label="Write-offs" formula="Write-off value = Σ(expired units × unit purchase cost)" substitution={data.products.filter(p => p.expiredQuantity).map(p => `${p.expiredQuantity} × ${money(p.unitCostCents)}`).join(' + ') || '0 expired units'} result={money(data.summary.writeOffCents)} />
        <Equation label="Closing inventory" formula="Closing inventory value = opening value + received value − COGS − write-offs" substitution={`${money(data.products.reduce((sum, p) => sum + p.openingQuantity * p.unitCostCents, 0))} + ${money(data.products.reduce((sum, p) => sum + p.receivedQuantity * p.unitCostCents, 0))} − ${money(data.summary.cogsCents)} − ${money(data.summary.writeOffCents)}`} result={money(data.summary.closingInventoryCents)} />
      </Calculation>
      </ReviewPanel>
      <ReviewPanel value="cash" label="Cash & orders">
      <section className="panel"><h3>Operating cash</h3>
        <Calculation title="Cash reconciliation"><Equation label="Closing cash" formula="Closing cash = opening cash + revenue − replenishment spending"
          substitution={`${money(data.summary.openingCashCents)} + ${money(data.summary.revenueCents)} − ${money(data.summary.replenishmentCents)}`}
          result={money(data.summary.openingCashCents + data.summary.revenueCents - data.summary.replenishmentCents)} recorded={money(data.summary.closingCashCents)}
          matches={data.summary.openingCashCents + data.summary.revenueCents - data.summary.replenishmentCents === data.summary.closingCashCents} /></Calculation>
        <p>{number(data.summary.receivedUnits)} units arrived before customers. {number(data.summary.replenishmentUnits)} units were ordered after sales{day < 60 ? ` for Day ${day + 1}` : '; no orders are placed after Day 60'}.</p>
        <div className="inline-links"><Link className="text-link" to={evidenceLink(run.id, 'cash', day)}>Cash ledger</Link><Link className="text-link" to={evidenceLink(run.id, 'orders', day, productId)}>Order records</Link></div>
      </section>
        <section className="panel"><h3>Replenishment orders</h3>
        <Table rows={data.orders.filter(row => !productId || row.productId === productId)} columns={[
          { key: 'id', label: 'Order ID' }, { key: 'name', label: 'Product' }, { key: 'quantity', label: 'Units' },
          { key: 'arrivalDay', label: 'Arrival day' }, { key: 'costCents', label: 'Order cost', render: row => money(row.costCents) },
          { key: 'cashBeforeCents', label: 'Cash before', render: row => money(row.cashBeforeCents) },
          { key: 'cashAfterCents', label: 'Cash after', render: row => money(row.cashAfterCents) }, { key: 'reason', label: 'Reason' },
          { key: 'calculation', label: 'Calculation', render: row => <Calculation><Equation label="Cash constraint" formula="Ordered = min(max(0, target − stock), ⌊cash ÷ unit cost⌋)" substitution={`min(max(0, ${row.targetQuantity} − ${row.stockBefore}), ⌊${money(row.cashBeforeCents)} ÷ ${money(run.config.products.find(p => p.productId === row.productId).unitCostCents)}⌋)`} result={row.quantity} /><Equation label="Cash after order" formula="Cash after = cash before − quantity × unit purchase cost" substitution={`${money(row.cashBeforeCents)} − ${row.quantity} × ${money(run.config.products.find(p => p.productId === row.productId).unitCostCents)}`} result={money(row.cashAfterCents)} /></Calculation> }
        ]} empty={day === 60 ? 'Zero orders. The simulation ends at the close of Day 60.' : 'Zero orders for this selection.'} />
        </section>
      </ReviewPanel>
      <ReviewPanel value="inventory" label="Inventory">
      <div className="stats-grid three">
        <StatCard label="Closing inventory" value={money(data.summary.closingInventoryCents)} note="At purchase cost" />
        <StatCard label="Expiry write-off" value={money(data.summary.writeOffCents)} note={`${data.summary.writeOffUnits} expired units`} />
        <StatCard label="Cost of goods sold" value={money(data.summary.cogsCents)} />
      </div>
      <section className="panel"><h3>Product inventory</h3>
        <p className="formula">Closing stock = Opening + Received − Sold − Written off</p>
        <Table rows={data.products.filter(row => !productId || row.productId === productId)} columns={[
          { key: 'productId', label: 'ID' }, { key: 'name', label: 'Product' }, { key: 'openingQuantity', label: 'Opening' },
          { key: 'receivedQuantity', label: 'Received' }, { key: 'soldQuantity', label: 'Sold' }, { key: 'expiredQuantity', label: 'Expired' },
          { key: 'closingQuantity', label: 'Closing' }, { key: 'orderedQuantity', label: 'Ordered' }, { key: 'missedQuantity', label: 'Missed demand' },
          { key: 'closingValueCents', label: 'Closing value', render: row => money(row.closingValueCents) },
          { key: 'trace', label: 'Calculation / evidence', render: row => <><Calculation><Equation label="Closing stock" formula="Opening + received − sold − written off" substitution={`${row.openingQuantity} + ${row.receivedQuantity} − ${row.soldQuantity} − ${row.expiredQuantity}`} result={row.openingQuantity + row.receivedQuantity - row.soldQuantity - row.expiredQuantity} recorded={row.closingQuantity} matches={row.openingQuantity + row.receivedQuantity - row.soldQuantity - row.expiredQuantity === row.closingQuantity} /><Equation label="Closing value" formula="Closing stock × purchase cost" substitution={`${row.closingQuantity} × ${money(row.unitCostCents)}`} result={money(row.closingValueCents)} /></Calculation><Link className="text-link" to={evidenceLink(run.id, 'inventory', day, row.productId)}>Movements</Link></> }
        ]} />
      </section>
      </ReviewPanel>
      <ReviewPanel value="brain" label="Store Brain">
      <section className="panel"><h3>Conditions and responses</h3>
        <Table rows={data.alerts.filter(row => !productId || row.productId === productId)} columns={[
          { key: 'id', label: 'Record ID' }, { key: 'name', label: 'Product' },
          { key: 'type', label: 'Condition', sortValue: row => eventNames[row.type], render: row => eventNames[row.type] },
          { key: 'condition', label: 'Detected condition' }, { key: 'action', label: 'Response' },
          { key: 'details', label: 'Decision evidence', render: row => <BrainCalculation record={row} config={run.config} product={run.config.products.find(product => product.productId === row.productId)} /> }
        ]} empty="Zero Store Brain records for this selection." />
      </section>
      </ReviewPanel>
      <ReviewPanel value="records" label="Records"><section className="panel"><EvidenceBrowser run={run} /></section></ReviewPanel>
      </ReviewTabs>
    </>}
  </>;
}

export default DailyReportPage;
