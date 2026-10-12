import { useState } from 'react';
import { sortRows } from './tableSort.mjs';

function Table({ columns, rows, caption, empty = 'No records for this selection.', sort: controlledSort, onSort }) {
  const [localSort, setLocalSort] = useState(null);
  const sort = onSort ? controlledSort : localSort;
  const column = columns.find(item => item.key === sort?.key);
  const sorted = onSort ? rows : sortRows(rows, column, sort?.direction);
  const sortable = column => column.sortable !== false &&
    (column.sortValue || rows.some(row => ['string', 'number', 'boolean'].includes(typeof row[column.key])));

  function changeSort(column) {
    const next = { key: column.key, direction: sort?.key === column.key && sort.direction === 'ascending' ? 'descending' : 'ascending' };
    if (onSort) onSort(next); else setLocalSort(next);
  }

  return <div className="table-scroll" role="region" aria-label={caption || 'Scrollable table'} tabIndex={0}>
    <table>
      {caption && <caption>{caption}</caption>}
      <thead><tr>{columns.map(column => <th key={column.key} scope="col"
        aria-sort={sort?.key === column.key ? sort.direction : undefined}>
        {sortable(column) ? <button type="button" className="column-sort" onClick={() => changeSort(column)}
          title={`Sort ${column.label} ${sort?.key === column.key && sort.direction === 'ascending' ? 'descending' : 'ascending'}`}>
          {column.label}{sort?.key === column.key && <span className="sort-direction">{sort.direction === 'ascending' ? 'Asc' : 'Desc'}</span>}
        </button> : column.label}
      </th>)}</tr></thead>
      <tbody>
        {sorted.map((row, index) => <tr key={row.id || row.productId || row.category || row.day || index}>
          {columns.map(column => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={columns.length} className="empty-cell">{empty}</td></tr>}
      </tbody>
    </table>
  </div>;
}

export default Table;
