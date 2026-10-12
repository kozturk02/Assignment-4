import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getEvidence, getTransaction } from '../api';
import Table from './Table';
import Calculation, { Equation } from './Calculation';
import { money, number, eventNames } from '../format';

const evidenceTypes = {
  transactions: { name: 'Transactions', fields: ['id', 'day', 'hour', 'customerId', 'units', 'totalCents', 'cogsCents'] },
  items: { name: 'Transaction items', fields: ['id', 'transactionId', 'productId', 'batchId', 'quantity', 'unitPriceCents', 'lineTotalCents', 'lineCostCents'] },
  customers: { name: 'Customers', fields: ['id', 'day', 'hour', 'mission', 'requestedUnits', 'soldUnits', 'missedUnits'] },
  requests: { name: 'Customer requests', fields: ['id', 'day', 'customerId', 'productId', 'requestedQuantity', 'soldQuantity', 'missedQuantity'] },
  inventory: { name: 'Inventory movements', fields: ['id', 'day', 'type', 'productId', 'batchId', 'quantity', 'stockAfter', 'batchAfter', 'valueCents', 'transactionId', 'orderId'] },
  batches: { name: 'Receipt batches', fields: ['id', 'productId', 'receivedDay', 'expiryDay', 'initialQuantity', 'unitCostCents', 'orderId'] },
  orders: { name: 'Replenishment orders', fields: ['id', 'day', 'arrivalDay', 'productId', 'quantity', 'costCents', 'cashBeforeCents', 'cashAfterCents', 'reason'] },
  cash: { name: 'Cash ledger', fields: ['id', 'day', 'type', 'amountCents', 'balanceCents', 'transactionId', 'orderId'] },
  alerts: { name: 'Store Brain records', fields: ['id', 'day', 'type', 'productId', 'condition', 'action'] },
  stock: { name: 'Daily stock positions', fields: ['id', 'day', 'productId', 'openingQuantity', 'receivedQuantity', 'soldQuantity', 'expiredQuantity', 'requestedQuantity', 'missedQuantity', 'orderedQuantity', 'closingQuantity', 'closingValueCents'] }
};

const labels = {
  id: 'Record ID', day: 'Day', hour: 'Hour', customerId: 'Customer ID', transactionId: 'Transaction ID',
  orderId: 'Order ID', batchId: 'Batch ID', productId: 'Product', type: 'Type', units: 'Units',
  totalCents: 'Total', cogsCents: 'COGS', quantity: 'Units / movement', unitPriceCents: 'Unit price',
  unitCostCents: 'Unit cost', lineTotalCents: 'Line revenue', lineCostCents: 'Line COGS',
  requestedUnits: 'Requested', soldUnits: 'Sold', missedUnits: 'Missed', requestedQuantity: 'Requested',
  soldQuantity: 'Sold', missedQuantity: 'Missed', stockAfter: 'Stock after', batchAfter: 'Batch after',
  valueCents: 'Purchase-cost value', receivedDay: 'Received day', expiryDay: 'Expiry day', initialQuantity: 'Received units',
  arrivalDay: 'Arrival day', costCents: 'Order cost', cashBeforeCents: 'Cash before', cashAfterCents: 'Cash after',
  amountCents: 'Cash change', balanceCents: 'Cash balance', mission: 'Mission', condition: 'Condition',
  action: 'Action', reason: 'Reason', openingQuantity: 'Opening', receivedQuantity: 'Received',
  expiredQuantity: 'Expired', orderedQuantity: 'Ordered for tomorrow', closingQuantity: 'Closing', closingValueCents: 'Closing value'
};

function EvidenceBrowser({ run }) {
  const [params, setParams] = useSearchParams();
  const type = Object.hasOwn(evidenceTypes, params.get('type')) ? params.get('type') : 'transactions';
  const requestedDay = Number(params.get('day'));
  const day = Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= 60 ? requestedDay : '';
  const productId = run.config.products.some(product => product.productId === params.get('productId')) ? params.get('productId') : '';
  const requestedOffset = Number(params.get('offset') || 0);
  const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 && requestedOffset <= 10000000 ? requestedOffset : 0;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const requestVersion = useRef(0);
  const sortKey = evidenceTypes[type].fields.includes(params.get('sortBy')) ? params.get('sortBy') : 'id';
  const sortDirection = params.get('sortDirection') === 'descending' ? 'descending' : 'ascending';
  const [transactionId, setTransactionId] = useState(null);
  const [transaction, setTransaction] = useState(null);
  const [transactionError, setTransactionError] = useState('');
  const itemRevenue = transaction?.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const itemCost = transaction?.items.reduce((sum, item) => sum + item.quantity * item.unitCostCents, 0);
  const products = new Map(run.config.products.map(product => [product.productId, product]));

  useEffect(() => {
    let active = true;
    requestVersion.current += 1;
    setData(null);
    setError('');
    setLoadingMore(false);
    setTransactionId(null);
    getEvidence(run.id, type, { day, productId: type === 'cash' ? '' : productId, limit: 50, offset, sortBy: sortKey, sortDirection })
      .then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [run.id, type, day, productId, offset, sortKey, sortDirection]);

  async function loadMore() {
    const version = requestVersion.current;
    setLoadingMore(true);
    setError('');
    try {
      const result = await getEvidence(run.id, type, { day, productId: type === 'cash' ? '' : productId,
        limit: 50, offset: offset + data.rows.length, sortBy: sortKey, sortDirection });
      if (version === requestVersion.current) setData(previous => ({ ...result, rows: [...previous.rows, ...result.rows] }));
    } catch (err) {
      if (version === requestVersion.current) setError(err.message);
    } finally {
      if (version === requestVersion.current) setLoadingMore(false);
    }
  }

  function changeSort(sort) {
    const next = new URLSearchParams(params);
    next.delete('offset');
    next.set('sortBy', sort.key);
    next.set('sortDirection', sort.direction);
    setParams(next);
  }

  function changeFilter(field, value) {
    const next = new URLSearchParams(params);
    next.delete('offset');
    if (field === 'type') { next.delete('sortBy'); next.delete('sortDirection'); }
    if (value !== '' && value !== 0) next.set(field, value); else next.delete(field);
    setParams(next);
  }

  useEffect(() => {
    let active = true;
    setTransaction(null);
    setTransactionError('');
    if (transactionId) {
      getTransaction(run.id, transactionId).then(result => { if (active) setTransaction(result); })
        .catch(err => { if (active) setTransactionError(err.message); });
    }
    return () => { active = false; };
  }, [run.id, transactionId]);

  useEffect(() => {
    function closeOnEscape(event) { if (event.key === 'Escape') setTransactionId(null); }
    if (transactionId) document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [transactionId]);

  function renderValue(row, field) {
    const value = row[field];
    if (value === null || value === undefined) return '-';
    if (field.endsWith('Cents')) return money(value);
    if (field === 'hour') return `${String(value).padStart(2, '0')}:00`;
    if (field === 'productId') return <span>{value}<br /><span className="muted">{products.get(value)?.name}</span></span>;
    if (field === 'type') return eventNames[value] || value;
    if (field === 'transactionId') return <button className="text-button" onClick={() => setTransactionId(value)}>#{value}</button>;
    return value;
  }
  const columns = evidenceTypes[type].fields.map(field => ({ key: field, label: labels[field] || field,
    render: row => renderValue(row, field) }));
  columns.push({ key: 'record', label: 'Audit', render: row => <div className="record-actions">
    {type === 'transactions' && <button className="text-button" onClick={() => setTransactionId(row.id)}>View transaction</button>}
    <details><summary>Full record</summary><pre className="record-json">{JSON.stringify(row, null, 2)}</pre></details>
  </div> });

  return <>
    <div className="filter-row">
      <label>Evidence type<select aria-label="Evidence type" value={type} onChange={event => changeFilter('type', event.target.value)}>
        {Object.entries(evidenceTypes).map(([value, info]) => <option key={value} value={value}>{info.name}</option>)}
      </select></label>
      <label>Day filter<select aria-label="Day filter" value={day} onChange={event => changeFilter('day', event.target.value)}>
        <option value="">All days, including opening records</option>
        {Array.from({ length: 60 }, (_, index) => <option key={index + 1} value={index + 1}>Day {index + 1}</option>)}
      </select></label>
      <label>Product filter<select aria-label="Product filter" value={productId} disabled={type === 'cash'} onChange={event => changeFilter('productId', event.target.value)}>
        <option value="">All products</option>
        {run.config.products.map(product => <option key={product.productId} value={product.productId}>{product.productId} - {product.name}</option>)}
      </select></label>
    </div>
    {type === 'cash' && <p className="muted">Cash is a store-wide ledger. A sale may contain several products.</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {!data && !error && <p className="loading">Reading stored evidence...</p>}
    {data && <>
      <Table caption={`${evidenceTypes[type].name} · ${number(data.total)} matching records`} columns={columns} rows={data.rows}
        sort={{ key: sortKey, direction: sortDirection }} onSort={changeSort} />
      <div className="pagination"><span className="muted">{number(data.rows.length)} of {number(data.total)} records loaded</span>
        <div>{offset > 0 && <button className="secondary-button" onClick={() => changeFilter('offset', 0)}>From first record</button>}
          {offset + data.rows.length < data.total && <button className="secondary-button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading...' : 'Load more records'}</button>}</div>
      </div>
    </>}
    {transactionId && <div className="modal-overlay" onClick={() => setTransactionId(null)}>
      <div className="transaction-modal" role="dialog" aria-modal="true" aria-labelledby="transaction-heading" onClick={event => event.stopPropagation()}>
        <div className="section-heading"><h2 id="transaction-heading">Transaction #{transactionId}</h2><button className="secondary-button" autoFocus onClick={() => setTransactionId(null)}>Close</button></div>
        {transactionError && <p className="error-message" role="alert">{transactionError}</p>}
        {!transaction && !transactionError && <p className="loading">Loading transaction...</p>}
        {transaction && <>
          <p>Day {transaction.day}, {transaction.hour}:00 / Customer #{transaction.customerId} / {transaction.customer.mission}</p>
          <p><strong>{money(transaction.totalCents)}</strong> revenue, {money(transaction.cogsCents)} COGS, {transaction.units} units.</p>
          <Calculation title="Calculations · transaction totals">
            <Equation label="Revenue" formula="Transaction revenue = Σ(sold quantity × unit selling price)"
              substitution={transaction.items.map(item => `${item.quantity} × ${money(item.unitPriceCents)}`).join(' + ')}
              result={money(itemRevenue)}
              recorded={money(transaction.totalCents)} matches={itemRevenue === transaction.totalCents && transaction.items.every(item => item.lineTotalCents === item.quantity * item.unitPriceCents)} />
            <Equation label="COGS" formula="Transaction COGS = Σ(sold quantity × unit purchase cost)"
              substitution={transaction.items.map(item => `${item.quantity} × ${money(item.unitCostCents)}`).join(' + ')}
              result={money(itemCost)}
              recorded={money(transaction.cogsCents)} matches={itemCost === transaction.cogsCents && transaction.items.every(item => item.lineCostCents === item.quantity * item.unitCostCents)} />
            <Equation label="Gross profit" formula="Gross profit = transaction revenue − COGS"
              substitution={`${money(transaction.totalCents)} − ${money(transaction.cogsCents)}`} result={money(transaction.totalCents - transaction.cogsCents)} />
          </Calculation>
          <h3>Requested basket</h3>
          <Table rows={transaction.requests} columns={[
            { key: 'productId', label: 'Product', render: row => renderValue(row, 'productId') },
            { key: 'requestedQuantity', label: 'Requested' }, { key: 'soldQuantity', label: 'Fulfilled' }, { key: 'missedQuantity', label: 'Missed' }
          ]} />
          <h3>Sold items and source batches</h3>
          <Table rows={transaction.items} columns={[
            { key: 'id', label: 'Item ID' }, { key: 'productId', label: 'Product', render: row => renderValue(row, 'productId') },
            { key: 'batchId', label: 'Batch ID' }, { key: 'quantity', label: 'Units' },
            { key: 'lineTotalCents', label: 'Revenue', render: row => money(row.lineTotalCents) },
            { key: 'lineCostCents', label: 'COGS', render: row => money(row.lineCostCents) }
          ]} />
          <h3>Inventory deductions</h3>
          <Table rows={transaction.inventory} columns={[
            { key: 'id', label: 'Movement ID' }, { key: 'productId', label: 'Product' }, { key: 'batchId', label: 'Batch' },
            { key: 'quantity', label: 'Stock change' }, { key: 'stockAfter', label: 'Product stock after' }, { key: 'batchAfter', label: 'Batch stock after' }
          ]} />
          <h3>Cash receipt</h3>
          <Table rows={transaction.cash} columns={[
            { key: 'id', label: 'Cash event ID' }, { key: 'amountCents', label: 'Cash received', render: row => money(row.amountCents) },
            { key: 'balanceCents', label: 'Cash balance after', render: row => money(row.balanceCents) }
          ]} />
        </>}
      </div>
    </div>}
  </>;
}

export default EvidenceBrowser;
