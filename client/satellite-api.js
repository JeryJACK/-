// 全局函数版本，直接引入即可，无需 export
async function importRecords(records, apiKey) {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey || '' },
    body: JSON.stringify({ records })
  });
  return res.json();
}

async function fetchRecords({ start, end, page = 1, pageSize = 1000, filters = {} } = {}) {
  const qs = new URLSearchParams();
  if (start) qs.set('start', start);
  if (end) qs.set('end', end);
  qs.set('page', page);
  qs.set('pageSize', pageSize);
  if (filters.customer) qs.set('customer', filters.customer.join(','));
  if (filters.satellite) qs.set('satellite', filters.satellite.join(','));
  if (filters.station) qs.set('station', filters.station.join(','));
  const res = await fetch(`/api/records?${qs.toString()}`);
  return res.json();
}

async function fetchStats(params) {
  const qs = new URLSearchParams(params || {}).toString();
  const res = await fetch(`/api/stats?${qs}`);
  return res.json();
}

async function clearRecords(apiKey) {
  const res = await fetch('/api/clear', {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey || '' }
  });
  return res.json();
}
