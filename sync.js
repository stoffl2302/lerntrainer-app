'use strict';
// Automatischer Abgleich zwischen Geräten über Firebase (Anmeldung mit E-Mail/Passwort, Firestore).
// Ein Dokument pro Benutzer: sync/{uid} mit dem gesamten Lernstand als JSON. Abgleich = holen, zusammenführen, zurückschreiben.
// Ohne sync-config.json bleibt die Funktion unsichtbar.
window.LTSync = (() => {
  const KEY = 'lt_sync';
  let cfg = null, busy = null, timer = null;
  const listeners = new Set();
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = st => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* egal */ } };
  let st = load();
  let status = { state: 'idle', msg: '' };
  const emit = () => listeners.forEach(f => { try { f(status); } catch { /* egal */ } });
  const setStatus = (state, msg = '') => { status = { state, msg }; emit(); };

  const MSG = {
    INVALID_LOGIN_CREDENTIALS: 'E-Mail oder Passwort falsch.', EMAIL_NOT_FOUND: 'E-Mail oder Passwort falsch.',
    INVALID_PASSWORD: 'E-Mail oder Passwort falsch.', INVALID_EMAIL: 'Die E-Mail-Adresse ist ungültig.',
    USER_DISABLED: 'Dieses Konto ist gesperrt.', TOO_MANY_ATTEMPTS_TRY_LATER: 'Zu viele Versuche. Bitte später nochmal.',
    TOKEN_EXPIRED: 'Bitte neu anmelden.', USER_NOT_FOUND: 'Bitte neu anmelden.', INVALID_REFRESH_TOKEN: 'Bitte neu anmelden.',
  };
  async function req(url, opts) {
    const r = await fetch(url, opts);
    let d = null; try { d = await r.json(); } catch { /* leer */ }
    if (!r.ok) {
      const code = String(d?.error?.message || d?.error?.status || r.status).split(' ')[0].split(':')[0];
      const e = new Error(MSG[code] || 'Abgleich fehlgeschlagen (' + code + ').'); e.code = code; e.status = r.status; throw e;
    }
    return d;
  }

  async function init() {
    try { const r = await fetch('sync-config.json', { cache: 'no-cache' }); if (r.ok) cfg = await r.json(); } catch { /* offline: aus Cache oder ohne */ }
    if (!cfg || !cfg.apiKey || !cfg.projectId) cfg = null;
  }
  const ready = init();

  const enabled = () => !!cfg;
  const signedIn = () => !!(st.uid && st.refreshToken);

  async function login(email, password) {
    await ready;
    const d = await req(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    st = { email: d.email, uid: d.localId, idToken: d.idToken, refreshToken: d.refreshToken, exp: Date.now() + (+d.expiresIn - 60) * 1000, last: 0 };
    save(st);
    await syncNow();
  }
  function logout() { st = {}; save(st); setStatus('idle'); }

  async function token() {
    if (st.idToken && st.exp > Date.now()) return st.idToken;
    const d = await req(`https://securetoken.googleapis.com/v1/token?key=${cfg.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(st.refreshToken) });
    st.idToken = d.id_token; st.refreshToken = d.refresh_token; st.exp = Date.now() + (+d.expires_in - 60) * 1000; save(st);
    return st.idToken;
  }
  const docUrl = () => `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/sync/${st.uid}`;

  async function run() {
    await ready; await window.LocalApi.ready;
    if (!cfg || !signedIn()) return { skipped: true };
    if (!navigator.onLine) { setStatus('offline', 'Kein Internet. Wird abgeglichen, sobald du wieder online bist.'); return { skipped: true }; }
    setStatus('busy');
    try {
      const auth = { Authorization: 'Bearer ' + await token() };
      let remote = null;
      try { const d = await req(docUrl(), { headers: auth }); remote = JSON.parse(d.fields.data.stringValue); }
      catch (e) { if (e.status !== 404) throw e; }
      const neu = remote ? window.LocalApi.mergeIn(remote) : 0;
      const body = { fields: { data: { stringValue: JSON.stringify(window.LocalApi.backup()) }, updated: { timestampValue: new Date().toISOString() } } };
      await req(docUrl(), { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      st.last = Date.now(); save(st);
      setStatus('ok');
      if (neu) window.dispatchEvent(new CustomEvent('lt-synced', { detail: { neu } }));
      return { neu };
    } catch (e) {
      if (['TOKEN_EXPIRED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED'].includes(e.code)) logout();
      setStatus('error', e instanceof TypeError ? 'Server nicht erreichbar. Neuer Versuch später.' : e.message);
      return { error: e };
    }
  }
  // nie zwei Abgleiche gleichzeitig; kommt währenddessen eine Änderung, läuft danach noch einer
  let again = false;
  async function syncNow() {
    if (busy) { again = true; return busy; }
    busy = run().finally(() => { busy = null; if (again) { again = false; syncNow(); } });
    return busy;
  }
  function soon(ms = 4000) { clearTimeout(timer); timer = setTimeout(syncNow, ms); }

  window.addEventListener('lt-changed', () => { if (signedIn()) soon(); });
  window.addEventListener('online', () => soon(500));
  document.addEventListener('visibilitychange', () => {
    if (!signedIn()) return;
    if (document.visibilityState === 'visible') soon(300); else if (timer) { clearTimeout(timer); syncNow(); }
  });
  setInterval(() => { if (signedIn() && document.visibilityState === 'visible') syncNow(); }, 120000);
  ready.then(() => { if (signedIn()) syncNow(); });

  return { ready, enabled, signedIn, login, logout, syncNow, info: () => ({ email: st.email, last: st.last || 0 }),
    status: () => status, onStatus: f => { listeners.add(f); return () => listeners.delete(f); } };
})();
