function DaySelector({ day, onChange }) {
  return <div className="day-selector">
    <button className="secondary-button" disabled={day <= 1} onClick={() => onChange(day - 1)}>Previous</button>
    <label>Simulated day
      <select aria-label="Simulated day" value={day} onChange={event => onChange(Number(event.target.value))}>
        {Array.from({ length: 60 }, (_, index) => <option key={index + 1} value={index + 1}>Day {index + 1}</option>)}
      </select>
    </label>
    <button className="secondary-button" disabled={day >= 60} onClick={() => onChange(day + 1)}>Next</button>
  </div>;
}

export default DaySelector;
