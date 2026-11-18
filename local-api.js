'use strict';
// Offline-Betrieb: ersetzt den Server. Inhalte kommen aus inhalte.json (mitgeliefert) und eigenen
// Importen, der Lernfortschritt liegt im Speicher des Handys (localStorage).
window.LT_OFFLINE = true;
window.LocalApi = (() => {
  const DAY = 86400000;
  const INTERVALS = [0, 1, 3, 7, 14, 30];
  const K = { prog: 'lt_progress', att: 'lt_attempts', custom: 'lt_custom', name: 'lt_name' };
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const save = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch { throw new Error('Der Speicher am Handy ist voll. Bitte unter „Sicherung“ eine Sicherung machen.'); }
  };
  let sets = null, items = new Map(), bundled = [];

  // Stabiler Schlüssel aus dem Fragetext (gleiche Frage = gleicher Fortschritt, auch nach Updates)
  function keyOf(s) {
    s = String(s).replace(/\s+/g, ' ').trim().toLowerCase();
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  function fromParsed(d) {
    const seen = new Map();
    return { fach: d.fach, title: d.titel, type: d.typ === 'mc' ? 'mc' : 'cards',
      items: d.items.map(it => {
        let key = keyOf(it.frage); const n = seen.get(key) || 0; seen.set(key, n + 1); if (n) key += '-' + n;
        return { key, topic: it.thema || '', front: it.frage, back: it.antwort || '', answers: it.antworten || null, explanation: it.erklaerung || '' };
      }) };
  }
  function build() {
    sets = []; items = new Map();
    let sid = 0, iid = 0;
    const custom = load(K.custom, []);
    const all = bundled.map(s => ({ ...s, custom: false }));
    for (const c of custom) {
      const i = all.findIndex(s => s.fach === c.fach && s.title === c.title && s.type === c.type);
      if (i >= 0) all[i] = { ...c, custom: true }; else all.push({ ...c, custom: true });
    }
    for (const s of all) {
      const set = { ...s, id: ++sid, skey: s.fach + '|' + s.title + '|' + s.type };
      set.items = s.items.map(it => { const x = { ...it, id: ++iid, setId: set.id, pkey: set.skey + '|' + it.key }; items.set(x.id, x); return x; });
      sets.push(set);
    }
  }
  async function init() {
    try { const r = await fetch('inhalte.json', { cache: 'no-cache' }); bundled = (await r.json()).sets.map(fromParsed); }
    catch { bundled = []; }
    build();
  }
  const ready = init();

  function summary(set, prog, t) {
    let seen = 0, right = 0, wrong = 0, sicher = 0, offen = 0, faellig = 0;
    for (const it of set.items) {
      const p = prog[it.pkey];
      if (!p) { faellig++; continue; }
      seen++; right += p.right; wrong += p.wrong;
      if (set.type === 'mc' ? p.streak >= 2 : p.box >= 3) sicher++;
      if (p.lastOk === 0) offen++;
      if (p.due <= t) faellig++;
    }
    return { total: set.items.length, seen, right, wrong, sicher, offen, faellig };
  }
  const subjects = () => {
    const m = new Map();
    for (const s of sets) { if (!m.has(s.fach)) m.set(s.fach, { id: m.size + 1, name: s.fach, sets: [] }); m.get(s.fach).sets.push(s); }
    return [...m.values()];
  };
  function streak(prog) {
    const days = new Set(Object.values(prog).map(p => new Date(p.seen).toLocaleDateString('sv-SE')));
    const d = new Date(); let n = 0;
    if (!days.has(d.toLocaleDateString('sv-SE'))) d.setDate(d.getDate() - 1);
    while (days.has(d.toLocaleDateString('sv-SE'))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const err = (m) => { throw new Error(m); };

  async function call(method, url, body = {}) {
    await ready;
    const path = url.split('?')[0];
    const prog = load(K.prog, {});
    const t = Date.now();
    let m;
    if (path === '/api/status') return { setup: false, registration: false, user: { id: 1, username: 'ich', name: load(K.name, ''), role: 'offline', mustChange: false } };
    if (path === '/api/faecher' && method === 'GET') {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return { faecher: subjects().map(s => ({ id: s.id, name: s.name, sets: s.sets.map(st => ({ id: st.id, title: st.title, type: st.type, ...summary(st, prog, t) })) })),
        streak: streak(prog), heute: Object.values(prog).filter(p => p.seen >= today.getTime()).length };
    }
    if ((m = path.match(/^\/api\/sets\/(\d+)$/)) && method === 'GET') {
      const s = sets.find(x => x.id === +m[1]) || err('Lernset nicht gefunden.');
      const subj = subjects().find(x => x.name === s.fach);
      return { id: s.id, title: s.title, type: s.type, fach: s.fach, fach_id: subj.id, now: t,
        items: s.items.map(it => ({ id: it.id, topic: it.topic, front: it.front, back: it.back, explanation: it.explanation, answers: it.answers, p: prog[it.pkey] || null })),
        summary: summary(s, prog, t),
        attempts: load(K.att, []).filter(a => a.skey === s.skey).slice(-10).reverse() };
    }
    if (path === '/api/answer') {
      const it = items.get(+body.itemId) || err('Frage nicht gefunden.');
      const p = prog[it.pkey] || { right: 0, wrong: 0, streak: 0, box: 0, due: 0 };
      const rating = body.rating || (body.ok ? 'ja' : 'nein');
      let { right, wrong, streak: st, box } = p, due;
      if (rating === 'ja') { right++; st++; box = Math.min(box + 1, INTERVALS.length - 1); due = t + INTERVALS[box] * DAY - 3600000; }
      else if (rating === 'unsicher') { right++; st = 0; box = Math.max(1, box); due = t + DAY - 3600000; }
      else { wrong++; st = 0; box = 0; due = t; }
      prog[it.pkey] = { right, wrong, streak: st, lastOk: rating === 'nein' ? 0 : 1, box, due, seen: t };
      save(K.prog, prog);
      return { ok: true, p: prog[it.pkey] };
    }
    if (path === '/api/attempts') {
      const s = sets.find(x => x.id === +body.setId) || err('Lernset nicht gefunden.');
      const a = load(K.att, []); a.push({ skey: s.skey, mode: body.mode, total: +body.total || 0, correct: +body.correct || 0, at: t });
      save(K.att, a.slice(-500));
      return { ok: true };
    }
    if ((m = path.match(/^\/api\/sets\/(\d+)\/reset$/))) {
      const s = sets.find(x => x.id === +m[1]) || err('Lernset nicht gefunden.');
      for (const it of s.items) delete prog[it.pkey];
      save(K.prog, prog);
      save(K.att, load(K.att, []).filter(a => a.skey !== s.skey));
      return { ok: true };
    }
    if (path === '/api/profile') { save(K.name, String(body.name || '').trim().slice(0, 60)); return { ok: true }; }
    err('Im Offline-Modus nicht verfügbar.');
  }

  // --- Sicherung und eigene Inhalte ---
  function backup() {
    return { app: 'lerntrainer', version: 1, created: new Date().toISOString(), name: load(K.name, ''),
      progress: load(K.prog, {}), attempts: load(K.att, []), custom: load(K.custom, []) };
  }
  function restore(d) {
    if (!d || d.app !== 'lerntrainer' || typeof d.progress !== 'object') err('Das ist keine Sicherungsdatei vom Lerntrainer.');
    save(K.prog, d.progress); save(K.att, Array.isArray(d.attempts) ? d.attempts : []);
    save(K.custom, Array.isArray(d.custom) ? d.custom : []);
    if (d.name) save(K.name, d.name);
    build();
    return Object.keys(d.progress).length;
  }
  function importFile(text, fileName, fach) {
    const d = window.LTImport.parse(text, fileName, { fach });
    if (fach) d.fach = fach;
    const s = fromParsed(d);
    const custom = load(K.custom, []).filter(c => !(c.fach === s.fach && c.title === s.title && c.type === s.type));
    custom.push(s); save(K.custom, custom); build();
    return { fach: s.fach, titel: s.title, typ: d.typ, total: s.items.length };
  }
  function customSets() { return load(K.custom, []).map(c => ({ fach: c.fach, title: c.title, type: c.type, n: c.items.length, overrides: bundled.some(b => b.fach === c.fach && b.title === c.title && b.type === c.type) })); }
  function removeCustom(i) { const c = load(K.custom, []); c.splice(i, 1); save(K.custom, c); build(); }
  const stats = () => ({ progress: Object.keys(load(K.prog, {})).length, sets: sets.length });

  return { call, ready, backup, restore, importFile, customSets, removeCustom, stats, fromParsed };
})();
