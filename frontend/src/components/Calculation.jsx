export function Equation({ label, formula, substitution, result, recorded, matches, children }) {
  return <div className="calculation-row">
    <div className="calculation-label">{label}</div>
    <div className="calculation-body">
      <div className="formula">{formula}</div>
      <div className="substitution">{substitution}{result !== undefined && <> = <strong>{result}</strong></>}</div>
      {recorded !== undefined && <div className="reconciliation"><span>Recorded: <strong>{recorded}</strong></span>
        <span className={`badge ${matches ? 'good' : 'bad'}`}>{matches ? 'PASS' : 'FAIL'}</span></div>}
      {children}
    </div>
  </div>;
}

export default function Calculation({ children, title = 'Calculation', open = false }) {
  return <details className="calculation" open={open}><summary>{title}</summary><div>{children}</div></details>;
}
