const collator = new Intl.Collator('en-AU', { numeric: true, sensitivity: 'base' });

export function sortRows(rows, column, direction = 'ascending') {
  if (!column) return rows;
  const value = column.sortValue || (row => row[column.key]);
  return [...rows].sort((a, b) => {
    const left = value(a), right = value(b);
    // Missing values stay last in either direction.
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right : collator.compare(String(left), String(right));
    return direction === 'descending' ? -comparison : comparison;
  });
}
