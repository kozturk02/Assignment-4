import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getProducts, getConfig, saveProducts, createRun } from '../api';
import Table from '../components/Table';
import { money, runLink } from '../format';

function SetupPage({ onRunsChanged }) {
  const [products, setProducts] = useState([]);
  const [config, setConfig] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    Promise.all([getProducts(), getConfig()]).then(([catalogue, defaults]) => {
      if (!active) return;
      setProducts(catalogue);
      setConfig(Object.fromEntries(['seed', 'startDate', 'weekdayCustomers', 'weekendCustomers',
        'reorderDays', 'targetDays'].map(field => [field, defaults[field]])));
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  const openingCost = products.reduce((sum, product) => sum + product.initialQuantity * product.unitCostCents, 0);
  const overBudget = openingCost > 4000000;

  function changeQuantity(productId, value) {
    setProducts(current => current.map(product => product.productId === productId
      ? { ...product, initialQuantity: Number(value) } : product));
    setDirty(true);
  }

  async function startRun(event) {
    event.preventDefault();
    if (busy || overBudget) return;
    try {
      setBusy(true);
      setError('');
      if (dirty) {
        setProducts(await saveProducts(products));
        setDirty(false);
      }
      const completed = await createRun(config);
      await onRunsChanged();
      navigate(runLink(completed.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="new-simulation-page">
    <Link className="back-link" to="/">Back</Link>
    <div className="page-heading"><h1>New Simulation</h1><p>Configure your simulation settings and opening inventory.</p></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {!config && !error && <p className="loading">Loading the model...</p>}
    {config && <form onSubmit={startRun}>
      <section className="simulation-panel">
        <h2>Simulation Settings</h2>
        <div className="settings-columns">
          <div className="settings-group">
            <label>Start date<input type="date" required min="2000-01-01" max="2100-12-31" value={config.startDate} disabled={busy}
              onChange={event => setConfig({ ...config, startDate: event.target.value })} /></label>
            <label>Random seed<input type="number" required min="0" max="4294967295" step="1" value={config.seed} disabled={busy}
              onChange={event => setConfig({ ...config, seed: Number(event.target.value) })} /></label>
            <label>Weekday customers (daily mean)<input type="number" required min="20" max="600" step="1" value={config.weekdayCustomers} disabled={busy}
              onChange={event => setConfig({ ...config, weekdayCustomers: Number(event.target.value) })} /></label>
          </div>
          <div className="settings-group">
            <label>Weekend customers (daily mean)<input type="number" required min="20" max="600" step="1" value={config.weekendCustomers} disabled={busy}
              onChange={event => setConfig({ ...config, weekendCustomers: Number(event.target.value) })} /></label>
            <label>Low-stock cover (days)<input type="number" required min="0.5" max="3" step="0.1" value={config.reorderDays} disabled={busy}
              onChange={event => setConfig({ ...config, reorderDays: Number(event.target.value) })} /></label>
            <label>Replenishment target (days)<input type="number" required min={config.reorderDays} max="14" step="0.1" value={config.targetDays} disabled={busy}
              onChange={event => setConfig({ ...config, targetDays: Number(event.target.value) })} /></label>
          </div>
        </div>
        <div className="opening-inventory">
          <div className="section-heading"><div><h2>Opening Inventory</h2><p>Set the initial unit amounts for each product in your store.</p></div>
            <span className="muted">Inventory budget: A$40,000</span></div>
          {overBudget && <p className="error-message" role="alert">Opening inventory exceeds A$40,000. Reduce the quantities before running.</p>}
          <div className="inventory-table"><Table rows={products} columns={[
            { key: 'name', label: 'Product / pack' }, { key: 'category', label: 'Category' },
            { key: 'unitCostCents', label: 'Unit cost (A$)', render: product => money(product.unitCostCents) },
            { key: 'unitPriceCents', label: 'Unit price (A$)', render: product => money(product.unitPriceCents) },
            { key: 'shelfLifeDays', label: 'Shelf life', render: product => product.shelfLifeDays ? `${product.shelfLifeDays} days` : 'Durable' },
            { key: 'initialQuantity', label: 'Initial units', render: product => <input className="quantity-input" type="number" required min="0" max="10000" step="1"
              aria-label={`Initial units for ${product.name}`} value={product.initialQuantity} disabled={busy} onChange={event => changeQuantity(product.productId, event.target.value)} /> }
          ]} /></div>
          <div className="inventory-totals">
            <p><span>Opening inventory cost</span><strong>{money(openingCost)}</strong></p>
            <p><span>Unused inventory budget</span><strong>{money(4000000 - openingCost)}</strong></p>
            <p><span>Opening operating cash</span><strong>{money(1500000)}</strong></p>
          </div>
          <p className="inventory-note">Unused inventory budget does not become operating cash. Opening quantities are saved when you run this simulation.</p>
        </div>
      </section>
      <div className="simulation-actions"><button className="main-button pill-button" disabled={busy || overBudget}>{busy ? 'Running Simulation...' : 'Run Simulation'}</button></div>
    </form>}
  </div>;
}

export default SetupPage;
