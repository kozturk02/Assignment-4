import { Navigate, useSearchParams } from 'react-router-dom';
import { runLink } from '../format';

export default function EvidencePage({ run }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('dailyView', 'records');
  return <Navigate to={`${runLink(run.id, 'daily')}?${next}`} replace />;
}
