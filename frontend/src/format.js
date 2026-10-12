export function money(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((cents || 0) / 100);
}

export function number(value, digits = 0) {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value || 0);
}

export function runLink(runId, page = 'daily') {
  return `/runs/${encodeURIComponent(runId)}/${page}`;
}

export function runName(runs, runId) {
  const index = runs.findIndex(run => run.id === runId);
  return index < 0 ? 'Simulation' : `Run ${String(runs.length - index).padStart(2, '0')}`;
}

export function runDate(value) {
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }).format(new Date(value));
}

export function evidenceLink(runId, type, day, productId) {
  const params = new URLSearchParams({ type, dailyView: 'records' });
  if (day) params.set('day', day);
  if (productId) params.set('productId', productId);
  return `${runLink(runId, 'daily')}?${params}`;
}

export function dailyLink(runId, day, productId) {
  const params = new URLSearchParams({ day });
  if (productId) params.set('productId', productId);
  return `${runLink(runId, 'daily')}?${params}`;
}

export const eventNames = {
  low_stock: 'Low stock', sold_out: 'Sold out', expiry_warning: 'Expiry warnings',
  expiry: 'Expiry removals', slow_mover: 'Slow movers', replenishment: 'Replenishment',
  cash_constraint: 'Cash constraints'
};
