// 这是给前端页面用的 API 封装工具，后续只需 importRecords / fetchRecords / fetchStats / clearRecords 即可
const API_BASE = '/api';

export async function importRecords(records, apiKey) {
  const res = await fetch(`${API_BASE}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey || '' },
    body: JSON.stringify({ records })
  });
  return res.json();
}

export async function fetchRecords({ start, end, page = 1, pageSize = 1000, filters = {} } = {}) {
  const qs = new URLSearchParams();
  if (start) qs.set('start', start);
  if (end) qs.set('end', end);
  qs.set('page', page);
  qs.set('pageSize', pageSize);
  if (filters.customer) qs.set('customer', filters.customer.join(','));
  if (filters.satellite) qs.set('satellite', filters.satellite.join(','));
  if (filters.station) qs.set('station', filters.station.join(','));
  const res = await fetch(`${API_BASE}/records?${qs.toString()}`);
  return res.json();
}

export async function fetchStats(params) {
  const qs = new URLSearchParams(params || {}).toString();
  const res = await fetch(`${API_BASE}/stats?${qs}`);
  return res.json();
}

export async function clearRecords(apiKey) {
  const res = await fetch(`${API_BASE}/clear`, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey || '' }
  });
  return res.json();
}