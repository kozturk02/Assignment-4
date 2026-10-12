function StatCard({ label, value, note }) {
  return <div className="stat-card"><span>{label}</span><strong>{value}</strong>{note && <p>{note}</p>}</div>;
}

export default StatCard;
