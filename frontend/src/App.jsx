import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useOutletContext, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import RunViewer from './components/RunViewer';
import HomePage from './pages/HomePage';
import SetupPage from './pages/SetupPage';
import ReportPage from './pages/ReportPage';
import DailyReportPage from './pages/DailyReportPage';
import AssurancePage from './pages/AssurancePage';
import ModelDeclarationPage from './pages/ModelDeclarationPage';
import EvidencePage from './pages/EvidencePage';
import { getRuns, getSubmittedRun } from './api';
import { runLink } from './format';
import './styles.css';

function App() {
  const [runs, setRuns] = useState([]);
  const [submittedId, setSubmittedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadRuns() {
    try {
      setError('');
      const [history, submitted] = await Promise.all([getRuns(), getSubmittedRun()]);
      setRuns(history);
      setSubmittedId(submitted?.id || '');
    } catch (err) {
      setError(err.message || 'Could not load the simulation runs.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRuns(); }, []);

  return (
    <Layout>
      {error && <p className="error-message" role="alert">{error} <button className="text-button" onClick={loadRuns}>Retry</button></p>}
      <Routes>
        <Route path="/" element={<HomePage runs={runs} submittedId={submittedId} loading={loading} onRunsChanged={loadRuns} />} />
        <Route path="/new-simulation" element={<SetupPage onRunsChanged={loadRuns} />} />
        <Route path="/setup" element={<Navigate to="/new-simulation" replace />} />
        <Route path="/runs/:runId" element={<RunViewer runs={runs} submittedId={submittedId} />}>
          <Route index element={<Navigate to="daily" replace />} />
          <Route path="report" element={<ReportRedirect />} />
          <Route path="performance" element={<RunPage page={ReportPage} section="performance" />} />
          <Route path="operations" element={<RunPage page={ReportPage} section="operations" />} />
          <Route path="diagnosis" element={<RunPage page={ReportPage} section="diagnosis" />} />
          <Route path="daily" element={<RunPage page={DailyReportPage} />} />
          <Route path="assurance" element={<RunPage page={AssurancePage} />} />
          <Route path="evidence" element={<RunPage page={EvidencePage} />} />
          <Route path="model" element={<RunPage page={ModelDeclarationPage} />} />
        </Route>
        {['report', 'daily', 'assurance', 'model', 'evidence'].map(page =>
          <Route key={page} path={`/${page}`} element={<LegacyRunPage page={page} runId={page === 'model' ? submittedId : submittedId || runs[0]?.id} loading={loading} />} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function RunPage({ page: Page, ...props }) {
  const context = useOutletContext();
  return <Page {...context} {...props} />;
}

function LegacyRunPage({ page, runId, loading }) {
  const { search } = useLocation();
  if (loading) return <p className="loading">Loading the selected run...</p>;
  if (!runId && page === 'model') return <p className="notice">Select a completed Submitted Run on Home to inspect its Model Declaration.</p>;
  return <Navigate to={runId ? runLink(runId, page === 'report' ? 'performance' : page) + search : '/'} replace />;
}

function ReportRedirect() {
  const { runId } = useParams();
  const { search } = useLocation();
  return <Navigate to={runLink(runId, 'performance') + search} replace />;
}

export default App;
