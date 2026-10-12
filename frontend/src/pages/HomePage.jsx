import { useState } from 'react';
import { Link } from 'react-router-dom';
import { setSubmittedRun } from '../api';
import Table from '../components/Table';
import { runLink, runName, runDate } from '../format';

function HomePage({ runs, submittedId, loading, onRunsChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function selectSubmitted(runId) {
    try {
      setBusy(runId);
      setError('');
      await setSubmittedRun(runId);
      await onRunsChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  return <div className="home-page">
    <section className="home-hero">
      <h1>Autonomous Supermarket</h1>
      <p className="home-tagline">Simulate. Analyse. Make better decisions.</p>
      <Link className="main-button pill-button" to="/new-simulation">New Simulation</Link>
    </section>
    <section className="previous-simulations">
      <div className="section-heading"><h2>Previous Simulations</h2><span className="muted">{runs.length} {runs.length === 1 ? 'run' : 'runs'}</span></div>
      {error && <p className="error-message" role="alert">{error}</p>}
      {loading ? <p className="loading">Loading previous simulations...</p> :
        <div className="run-list-scroll">
          <Table rows={runs} empty="No simulations yet. Start a new simulation to create your first 60-day history." columns={[
            { key: 'id', label: 'Run', sortValue: item => runName(runs, item.id), render: item => <>
              <strong>{runName(runs, item.id)}</strong><code className="run-id">{item.id}</code>
              {item.id === submittedId && <span className="badge good">Submitted Run</span>}
            </> },
            { key: 'createdAt', label: 'Created', render: item => <time dateTime={item.createdAt}>{runDate(item.createdAt)}</time> },
            { key: 'actions', label: 'Actions', sortable: false, render: item => <div className="run-actions">
              {item.id !== submittedId && <button className="secondary-button" disabled={Boolean(busy)} onClick={() => selectSubmitted(item.id)}
                aria-label={`Use ${runName(runs, item.id)} as Submitted Run`}>{busy === item.id ? 'Checking...' : 'Use as Submitted Run'}</button>}
              <Link className="view-button" to={runLink(item.id)} aria-label={`View ${runName(runs, item.id)}`}>View</Link>
            </div> }
          ]} />
        </div>}
    </section>
  </div>;
}

export default HomePage;
