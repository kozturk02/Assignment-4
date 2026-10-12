import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { getRun } from '../api';
import { runLink, runName, runDate } from '../format';

const views = [
  { path: 'daily', name: 'Daily Report' },
  { path: 'performance', name: 'Performance' },
  { path: 'operations', name: 'Operations' },
  { path: 'diagnosis', name: 'Diagnosis' },
  { path: 'assurance', name: 'Assurance' },
  { path: 'model', name: 'Model Declaration' }
];

function RunViewer({ runs, submittedId }) {
  const { runId } = useParams();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setRun(null);
    setError('');
    getRun(runId).then(data => { if (active) setRun(data); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [runId]);

  function changeRun(id) {
    const currentView = pathname.endsWith('/evidence') ? 'evidence' : views.find(view => pathname.endsWith(`/${view.path}`))?.path || 'daily';
    const filters = new URLSearchParams(search);
    filters.delete('offset');
    navigate({ pathname: runLink(id, currentView), search: filters.toString() });
  }

  const isSubmitted = runId === submittedId;
  return <div className="results-page">
    <div className="viewer-heading"><h1>Review Run</h1><Link className="back-link" to="/">Back to simulations</Link></div>
    <div className="run-context">
      <label>Select run
        <select aria-label="Select run" value={runId} onChange={event => changeRun(event.target.value)}>
          {runs.length === 0 && <option value={runId}>{runId}</option>}
          {runs.map(item => <option key={item.id} value={item.id}>
            {runName(runs, item.id)} - {item.id === submittedId ? 'Submitted Run' : 'Review Run'} - {runDate(item.createdAt)}
          </option>)}
        </select>
      </label>
      <div className="run-identification">
        <span className={`badge ${isSubmitted ? 'good' : ''}`}>{isSubmitted ? 'Submitted Run' : 'Review Run'}</span>
        <code>{runId}</code>
      </div>
    </div>
    <nav className="navigation" aria-label="Review Run tabs">
      {views.map(view => <NavLink key={view.path} className={({ isActive }) => isActive || (view.path === 'daily' && pathname.endsWith('/evidence')) ? 'active' : ''}
        to={runLink(runId, view.path) + search}>{view.name}</NavLink>)}
    </nav>

    {error && <p className="error-message" role="alert">{error}</p>}
    {!error && run?.id !== runId && <p className="loading">Loading the selected run...</p>}
    {run?.id === runId && <Outlet key={runId} context={{ run, submittedId }} />}
  </div>;
}

export default RunViewer;
