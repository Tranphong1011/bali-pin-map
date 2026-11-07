const PW_KEY = 'baliPinMap.password';

export function getPassword() {
  try { return localStorage.getItem(PW_KEY) || ''; } catch { return ''; }
}

export function setPassword(pw) {
  try {
    if (pw) localStorage.setItem(PW_KEY, pw);
    else localStorage.removeItem(PW_KEY);
  } catch { /* storage unavailable */ }
}

export class AuthError extends Error {
  constructor() { super('Password required'); }
}

async function request(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  const pw = getPassword();
  if (pw) headers['X-App-Password'] = pw;
  const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 403) throw new AuthError();
  if (!r.ok) {
    let detail = `${r.status} ${r.statusText}`;
    try { detail = (await r.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return r.status === 204 ? null : r.json();
}

export const api = {
  authInfo: () => request('GET', '/api/auth/'),
  login: (password) => fetch('/api/auth/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  }).then((r) => r.ok),

  groups: () => request('GET', '/api/groups/'),
  createGroup: (g) => request('POST', '/api/groups/', g),
  updateGroup: (id, g) => request('PATCH', `/api/groups/${id}/`, g),
  deleteGroup: (id) => request('DELETE', `/api/groups/${id}/`),

  pins: () => request('GET', '/api/pins/'),
  createPin: (p) => request('POST', '/api/pins/', p),
  updatePin: (id, p) => request('PATCH', `/api/pins/${id}/`, p),
  deletePin: (id) => request('DELETE', `/api/pins/${id}/`),

  reference: () => request('GET', '/api/reference/'),
  referenceDetail: (id) => request('GET', `/api/reference/${id}/`),

  importLegacy: (data) => request('POST', '/api/import/', data),
};
