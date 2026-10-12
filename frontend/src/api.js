async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  let data = null;

  if (res.status !== 204) {
    const contentType = res.headers.get('content-type') || '';
    data = contentType.includes('application/json')
      ? await res.json()
      : { error: await res.text() };
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data;
}

export function getProducts() {
  return request('/api/products');
}

export function saveProducts(products) {
  return request('/api/products', {
    method: 'PUT',
    body: JSON.stringify({ products })
  });
}

export function getConfig() {
  return request('/api/config');
}

export function getRuns() {
  return request('/api/runs');
}

export function getRun(id) {
  return request(`/api/runs/${encodeURIComponent(id)}`);
}

export function createRun(config) {
  return request('/api/runs', {
    method: 'POST',
    body: JSON.stringify(config)
  });
}

export function getSubmittedRun() {
  return request('/api/submitted-run');
}

export function setSubmittedRun(runId) {
  return request('/api/submitted-run', { method: 'PUT', body: JSON.stringify({ runId }) });
}

export function getReport(id) {
  return request(`/api/runs/${encodeURIComponent(id)}/report`);
}

export function getDailyReport(id, day) {
  return request(`/api/runs/${encodeURIComponent(id)}/days/${day}`);
}

export function getAssurance(id) {
  return request(`/api/runs/${encodeURIComponent(id)}/assurance`);
}

export function getEvidence(id, type, filters) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined));
  return request(`/api/runs/${encodeURIComponent(id)}/evidence/${type}?${query}`);
}

export function getTransaction(id, transactionId) {
  return request(`/api/runs/${encodeURIComponent(id)}/transactions/${transactionId}`);
}
