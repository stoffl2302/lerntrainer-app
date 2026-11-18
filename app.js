'use strict';
// Lerntrainer – Oberfläche (ohne Frameworks)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
let ME = null;
let keyHandler = null;
const store = {
  get(k, d) { try { const v = localStorage.getItem('lt_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lt_' + k, JSON.stringify(v)); } catch { /* egal */ } },
};

async function api(method, url, body) {
  if (window.LT_OFFLINE) return window.LocalApi.call(method, url, body);
  const r = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data = null;
  try { data = await r.json(); } catch { /* keine JSON-Antwort */ }
  if (r.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/password')) { ME = null; route(); throw new Error(data?.error || 'Bitte anmelden.'); }
  if (!r.ok) throw new Error(data?.error || 'Fehler ' + r.status);
  return data;
}

// Kleines Markdown: Absätze, Listen, **fett**, *kursiv*, `code`, ```Blöcke```
function md(src) {
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  const out = []; let list = null, para = [], code = null;
  const flushP = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>` + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + `</${list.t}>`); list = null; } };
  for (const line of String(src || '').split('\n')) {
    if (code !== null) { if (/^\s*```/.test(line)) { out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { flushP(); flushL(); code = []; continue; }
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if (!line.trim()) { flushP(); flushL(); continue; }
    flushL(); para.push(line);
  }
  if (code) out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
  flushP(); flushL();
  return '<div class="md">' + out.join('') + '</div>';
}

function progressBar(s) {
  const t = s.total || 1;
  const sicher = s.sicher, offen = s.offen, rest = Math.max(0, s.seen - sicher - offen);
  return `<div class="bar" title="${sicher} sicher, ${rest} in Arbeit, ${offen} zuletzt falsch, ${s.total - s.seen} neu">
    <i class="g" style="width:${100 * sicher / t}%"></i><i class="b" style="width:${100 * rest / t}%"></i><i class="r" style="width:${100 * offen / t}%"></i></div>`;
}
const legend = () => `<div class="legend"><span><b style="background:var(--ok)"></b>sicher</span><span><b style="background:var(--pri)"></b>in Arbeit</span><span><b style="background:var(--no)"></b>zuletzt falsch</span><span><b style="background:var(--line)"></b>neu</span></div>`;

function setView(html) { if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; } app.innerHTML = html; window.scrollTo(0, 0); }
function onKeys(fn) { keyHandler = fn; document.addEventListener('keydown', fn); }
function showMsg(el, text, kind = 'err') { el.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : ''; }
function confirmBtn(btn, label, fn) {
  let armed = false, orig = btn.textContent;
  btn.onclick = () => {
    if (!armed) { armed = true; btn.textContent = label; setTimeout(() => { armed = false; btn.textContent = orig; }, 3500); return; }
    fn();
  };
}

// ---------- Kopfzeile ----------
function renderTop() {
  $('#top').classList.toggle('hide', !ME);
  if (!ME) return;
  $('#who').textContent = ME.name || '';
  if (window.LT_OFFLINE) { $('#menu').innerHTML = '<a href="#/">Fächer</a><a href="#/sicherung">Sicherung & Inhalte</a><a href="#/hilfe">Hilfe</a>'; return; }
  $('#menu').innerHTML = `<a href="#/">Fächer</a><a href="#/profil">Mein Konto</a>${ME.role === 'admin' ? '<a href="#/verwaltung">Verwaltung</a>' : ''}<a href="#/hilfe">Hilfe</a><button id="logout">Abmelden</button>`;
  $('#logout').onclick = async () => { await api('POST', '/api/logout', {}).catch(() => {}); ME = null; location.hash = '#/'; route(); };
}
$('#menuBtn').onclick = e => { e.stopPropagation(); $('#menu').classList.toggle('hide'); };
document.addEventListener('click', () => $('#menu').classList.add('hide'));

// ---------- Anmeldung ----------
function viewAuth(status) {
  const setup = status.setup;
  let mode = setup ? 'setup' : 'login';
  const draw = () => {
    setView(`<div class="auth"><h1><img src="icon.svg" width="44" height="44" alt="" style="vertical-align:middle"> Lerntrainer</h1>
      <div class="card">
      ${mode === 'setup' ? '<h2 style="margin-top:0">Erste Einrichtung</h2><p class="sub">Leg dein Admin-Konto an. Damit verwaltest du später Inhalte und die Konten deiner Kollegen.</p>' : ''}
      ${mode === 'login' ? '<h2 style="margin-top:0">Anmelden</h2>' : ''}
      ${mode === 'register' ? '<h2 style="margin-top:0">Konto erstellen</h2><p class="sub">Den Einladungscode bekommst du vom Admin.</p>' : ''}
      <form id="f">
        ${mode === 'register' ? '<label class="f"><span>Einladungscode</span><input type="text" name="code" required autocomplete="off"></label>' : ''}
        <label class="f"><span>Benutzername</span><input type="text" name="username" required autocomplete="username" autocapitalize="none"></label>
        ${mode !== 'login' ? '<label class="f"><span>Anzeigename (z. B. Vorname)</span><input type="text" name="name" autocomplete="name"></label>' : ''}
        <label class="f"><span>Passwort${mode !== 'login' ? ' (mind. 6 Zeichen)' : ''}</span><input type="password" name="password" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
        <div id="m"></div>
        <div class="btns full"><button class="pri" type="submit">${mode === 'login' ? 'Anmelden' : 'Konto anlegen'}</button></div>
      </form>
      ${!setup && status.registration ? (mode === 'login' ? '<p class="sub" style="margin-top:14px;text-align:center">Neu hier? <a href="#" id="sw">Mit Einladungscode registrieren</a></p>' : '<p class="sub" style="margin-top:14px;text-align:center"><a href="#" id="sw">Zurück zur Anmeldung</a></p>') : ''}
      ${!setup && !status.registration && mode === 'login' ? '<p class="sub" style="margin-top:14px;text-align:center">Noch kein Konto? Frag den Admin.</p>' : ''}
      </div></div>`);
    const sw = $('#sw'); if (sw) sw.onclick = e => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); };
    $('#f').onsubmit = async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try { await api('POST', '/api/' + mode, body); await boot(); }
      catch (err) { showMsg($('#m'), err.message); }
    };
    $('input[name=' + (mode === 'register' ? 'code' : 'username') + ']').focus();
  };
  draw();
}

// ---------- Fächer (Hauptmenü) ----------
async function viewHome() {
  const d = await api('GET', '/api/faecher');
  const f = d.faecher;
  const lastSet = store.get('last', null);
  let cont = '';
  if (lastSet) for (const s of f) for (const st of s.sets) if (st.id === lastSet) cont = `<a class="card tile" href="#/${st.type === 'mc' ? 'mc' : 'karten'}/${st.id}" style="border-color:var(--pri)"><div class="info">Weiter lernen</div><div class="name">${esc(s.name)} · ${esc(st.title)}</div>${progressBar(st)}</a>`;
  setView(`<h1>Hallo${ME.name ? ' ' + esc(ME.name) : ''}</h1>
    <p class="sub">${d.heute ? `Heute schon ${d.heute} Fragen geübt.` : 'Heute noch nichts geübt.'}${d.streak > 1 ? ` · ${d.streak} Tage in Folge gelernt` : ''}</p>
    ${installBox()}${cont}
    <h2>Fach wählen</h2>
    ${f.length ? `<div class="grid">${f.map(s => {
      const tot = s.sets.reduce((a, x) => a + x.total, 0), sicher = s.sets.reduce((a, x) => a + x.sicher, 0);
      const seen = s.sets.reduce((a, x) => a + x.seen, 0), offen = s.sets.reduce((a, x) => a + x.offen, 0);
      const due = s.sets.filter(x => x.type === 'cards').reduce((a, x) => a + x.faellig, 0);
      return `<a class="card tile" href="#/fach/${s.id}"><div class="name">${esc(s.name)}</div>
        <div class="info">${s.sets.map(x => x.type === 'mc' ? `${x.total} MC-Fragen` : `${x.total} Karteikarten`).join(' · ')}</div>
        <div style="margin:10px 0 4px">${progressBar({ total: tot, seen, sicher, offen })}</div>
        <div class="info">${pct(sicher, tot)} % sicher${due ? ` · <span class="pill warn">${due} Karten fällig</span>` : ''}</div></a>`;
    }).join('')}</div>${legend()}` : `<div class="card empty">Noch keine Lerninhalte vorhanden.${window.LT_OFFLINE ? '<br><a href="#/sicherung">Inhalte hinzufügen</a>' : ME.role === 'admin' ? '<br><a href="#/verwaltung">Inhalte importieren</a>' : '<br>Der Admin muss erst Inhalte hochladen.'}</div>`}`);
  wireInstall();
}

// ---------- Fach-Seite ----------
async function viewFach(id) {
  const d = await api('GET', '/api/faecher');
  const s = d.faecher.find(x => x.id === id);
  if (!s) return viewNotFound();
  setView(`<a class="back" href="#/">‹ Alle Fächer</a><h1>${esc(s.name)}</h1><p class="sub">Was willst du lernen?</p>
    ${s.sets.map(st => `<div class="card">
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <div><span class="pill">${st.type === 'mc' ? 'Multiple Choice' : 'Karteikarten'}</span><h2 style="margin:.4rem 0 0">${esc(st.title)}</h2></div>
      </div>
      <p class="sub" style="margin-top:6px">${st.total} ${st.type === 'mc' ? 'Fragen' : 'Karten'} · ${st.seen} schon geübt · ${pct(st.sicher, st.total)} % sicher${st.type === 'mc' && (st.right + st.wrong) ? ` · ${pct(st.right, st.right + st.wrong)} % richtig beantwortet` : ''}</p>
      ${progressBar(st)}
      <div class="btns"><a class="btn pri" href="#/${st.type === 'mc' ? 'mc' : 'karten'}/${st.id}">${st.type === 'mc' ? 'MC-Trainer starten' : (st.faellig ? `${st.faellig} fällige Karten lernen` : 'Karteikarten öffnen')}</a></div>
    </div>`).join('')}${legend()}`);
}

// ---------- MC-Trainer ----------
async function viewMC(setId) {
  const data = await api('GET', '/api/sets/' + setId);
  if (data.type !== 'mc') return viewNotFound();
  store.set('last', setId);
  const items = data.items;
  const topics = [...new Set(items.map(i => i.topic))];
  const opt = store.get('mcopt', { num: 20, mix: true, hard: true, mode: 'learn' });
  const selTopics = store.get('mctopics_' + setId, null);

  function start() {
    const s = data.summary;
    const offen = items.filter(i => i.p && i.p.lastOk === 0).length;
    const neu = items.filter(i => !i.p).length;
    setView(`<a class="back" href="#/fach/${data.fach_id}">‹ ${esc(data.fach)}</a><h1>${esc(data.title)}</h1>
      <div class="card"><div class="stats">
        <div class="stat"><div class="v">${s.seen}/${s.total}</div><div class="l">geübt</div></div>
        <div class="stat"><div class="v">${pct(s.sicher, s.total)} %</div><div class="l">sicher (2× in Folge richtig)</div></div>
        <div class="stat"><div class="v">${s.right + s.wrong ? pct(s.right, s.right + s.wrong) + ' %' : '–'}</div><div class="l">Trefferquote</div></div>
      </div><div style="margin-top:12px">${progressBar(s)}</div>${legend()}</div>
      <div class="card"><h2 style="margin-top:0">Themen</h2><div class="topics">
        ${topics.map((t, i) => {
          const ti = items.filter(x => x.topic === t), ok = ti.filter(x => x.p && x.p.streak >= 2).length;
          return `<label class="row"><input type="checkbox" class="tp" value="${i}" ${!selTopics || selTopics.includes(t) ? 'checked' : ''}> ${esc(t || 'Allgemein')}<small>${ti.length} Fragen · ${pct(ok, ti.length)} % sicher</small></label>`;
        }).join('')}
      </div>
      ${topics.length > 1 ? '<div class="btns"><button class="sm" id="all">Alle</button><button class="sm" id="none">Keine</button></div>' : ''}
      <h2>Einstellungen</h2>
      <label class="row">Anzahl Fragen <select id="num" style="margin-left:auto;width:auto">${[10, 20, 30, 50, 0].map(n => `<option value="${n}" ${opt.num === n ? 'selected' : ''}>${n || 'Alle'}</option>`).join('')}</select></label>
      <label class="row"><input type="checkbox" id="mix" ${opt.mix ? 'checked' : ''}> Fragen mischen</label>
      <label class="row"><input type="checkbox" id="hard" ${opt.hard ? 'checked' : ''}> Schwierige und neue Fragen bevorzugen</label>
      <div class="seg" style="margin-top:8px">
        <label><input type="radio" name="mode" value="learn" ${opt.mode !== 'exam' ? 'checked' : ''}>Lernmodus<br><small>sofort Feedback</small></label>
        <label><input type="radio" name="mode" value="exam" ${opt.mode === 'exam' ? 'checked' : ''}>Prüfungsmodus<br><small>Auswertung am Ende</small></label>
      </div>
      <div id="m"></div>
      <div class="btns full"><button class="pri" id="go">Start</button></div>
      <div class="btns">
        <button id="wrongBtn" ${offen ? '' : 'disabled'}>Falsche wiederholen (${offen})</button>
        <button id="newBtn" ${neu ? '' : 'disabled'}>Nur neue (${neu})</button>
      </div></div>
      ${data.attempts.length ? `<div class="card"><h2 style="margin-top:0">Letzte Durchgänge</h2><div class="tbl"><table><tr><th>Datum</th><th>Modus</th><th>Ergebnis</th></tr>
        ${data.attempts.map(a => `<tr><td>${new Date(a.at).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${a.mode === 'exam' ? 'Prüfung' : 'Lernen'}</td><td>${a.correct}/${a.total} (${pct(a.correct, a.total)} %)</td></tr>`).join('')}
      </table></div></div>` : ''}
      <div class="btns"><button class="danger sm" id="reset">Meinen Fortschritt hier löschen</button></div>`);
    const all = $('#all'); if (all) { all.onclick = () => $$('.tp').forEach(c => c.checked = true); $('#none').onclick = () => $$('.tp').forEach(c => c.checked = false); }
    const readOpt = () => {
      const o = { num: +$('#num').value, mix: $('#mix').checked, hard: $('#hard').checked, mode: $('input[name=mode]:checked').value };
      store.set('mcopt', o); return o;
    };
    $('#go').onclick = () => {
      const o = readOpt();
      const tps = $$('.tp:checked').map(c => topics[+c.value]);
      if (!tps.length) return showMsg($('#m'), 'Bitte mindestens ein Thema wählen.');
      store.set('mctopics_' + setId, tps.length === topics.length ? null : tps);
      const pool = items.filter(i => tps.includes(i.topic));
      begin(pick(pool, o.num || pool.length, o.mix, o.hard), o.mode);
    };
    $('#wrongBtn').onclick = () => { const o = readOpt(); begin(shuffle(items.filter(i => i.p && i.p.lastOk === 0)), o.mode); };
    $('#newBtn').onclick = () => { const o = readOpt(); begin(pick(items.filter(i => !i.p), o.num || 9999, o.mix, false), o.mode); };
    confirmBtn($('#reset'), 'Wirklich löschen? Nochmal tippen', async () => { await api('POST', `/api/sets/${setId}/reset`, {}); viewMC(setId); });
  }

  function weight(i) {
    if (!i.p) return 3;
    const n = i.p.right + i.p.wrong;
    return 1 + 4 * i.p.wrong / n + (i.p.lastOk === 0 ? 3 : 0) + (i.p.streak >= 2 ? -0.6 : 0);
  }
  function pick(pool, n, mix, hard) {
    if (!hard) return (mix ? shuffle(pool.slice()) : pool.slice()).slice(0, n);
    const p = pool.slice(), out = [];
    while (out.length < n && p.length) {
      let tot = p.reduce((s, q) => s + weight(q), 0), r = Math.random() * tot, i = 0;
      for (; i < p.length - 1; i++) { r -= weight(p[i]); if (r <= 0) break; }
      out.push(p.splice(i, 1)[0]);
    }
    return mix ? out : out.sort((a, b) => items.indexOf(a) - items.indexOf(b));
  }

  function begin(run, mode) {
    if (!run.length) return;
    let pos = 0, picked = -1, done = false, cur = null;
    const wrong = [];
    const qv = () => {
      const it = run[pos];
      cur = { it, o: shuffle(it.answers.map(a => ({ ...a }))) };
      picked = -1; done = false;
      setView(`<div class="card">
        <div class="meta"><span>${esc(it.topic)}</span><span>${pos + 1} / ${run.length}</span></div>
        <div class="bar"><i class="b" style="width:${100 * pos / run.length}%"></i></div>
        <div class="q">${esc(it.front)}</div>
        <div id="ans">${cur.o.map((a, i) => `<button class="ans" data-i="${i}"><b>${'ABCDEFGH'[i]}</b><span>${esc(a.text)}</span></button>`).join('')}</div>
        <div class="fb" id="fb"></div><div id="ex"></div>
        <div class="btns"><button class="pri" id="next" ${mode === 'exam' ? 'disabled' : 'disabled'}>${pos + 1 === run.length ? 'Auswertung' : 'Weiter'}</button><button id="quit">Abbrechen</button></div>
        <div class="kbd">Tastatur: 1–4 oder A–D wählen · Enter weiter · Esc abbrechen</div></div>`);
      $$('.ans').forEach(b => b.onclick = () => choose(+b.dataset.i));
      $('#next').onclick = next;
      $('#quit').onclick = () => finish(true);
      onKeys(e => {
        const k = e.key.toLowerCase();
        let i = '12345678'.indexOf(k); if (i < 0) i = 'abcdefgh'.indexOf(k);
        if (i >= 0 && i < cur.o.length && k.length === 1) choose(i);
        else if (e.key === 'Enter' && picked >= 0) { e.preventDefault(); next(); }
        else if (e.key === 'Escape') finish(true);
      });
    };
    const choose = i => {
      if (done) return;
      picked = i;
      const bs = $$('.ans');
      if (mode === 'exam') {
        bs.forEach((b, j) => b.classList.toggle('sel', j === i));
      } else {
        done = true;
        const ok = cur.o[i].richtig;
        bs.forEach((b, j) => { if (cur.o[j].richtig) b.classList.add('ok'); else if (j === i) b.classList.add('no'); b.disabled = true; b.style.opacity = 1; });
        $('#fb').textContent = ok ? 'Richtig.' : 'Falsch. Die richtige Antwort ist grün markiert.';
        $('#fb').className = 'fb ' + (ok ? 'ok' : 'no');
        if (cur.it.explanation) $('#ex').innerHTML = `<div class="expl">${md(cur.it.explanation)}</div>`;
        record(ok);
      }
      $('#next').disabled = false;
    };
    const record = ok => {
      if (!ok) wrong.push({ it: cur.it, chosen: cur.o[picked].text });
      api('POST', '/api/answer', { itemId: cur.it.id, ok }).then(r => { cur.it.p = r.p; }).catch(() => {});
    };
    const next = () => {
      if (picked < 0) return;
      if (mode === 'exam' && !done) { done = true; record(cur.o[picked].richtig); }
      pos++;
      if (pos >= run.length) finish(false); else qv();
    };
    const finish = aborted => {
      const n = aborted ? pos : run.length;
      if (n) api('POST', '/api/attempts', { setId, mode, total: n, correct: n - wrong.length }).catch(() => {});
      if (!n) return start();
      const p = pct(n - wrong.length, n);
      setView(`<div class="card"><h2 style="margin-top:0">Auswertung${aborted ? ' (abgebrochen)' : ''}</h2>
        <div class="big">${p} %</div><p class="sub">${n - wrong.length} von ${n} richtig${p >= 90 ? ' · Sehr gut!' : p >= 70 ? ' · Gut, weiter so.' : ' · Die falschen am besten gleich nochmal üben.'}</p>
        <div class="btns"><button class="pri" id="again" ${wrong.length ? '' : 'disabled'}>Falsche wiederholen (${wrong.length})</button><button id="home">Zur Übersicht</button></div>
        ${wrong.length ? '<h3>Falsch beantwortet</h3>' + wrong.map(w => {
          const r = w.it.answers.filter(a => a.richtig).map(a => a.text).join(' / ');
          return `<div class="wr"><div><strong>${esc(w.it.front)}</strong></div><div class="w">✗ ${esc(w.chosen)}</div><div class="r">✓ ${esc(r)}</div>${w.it.explanation ? `<div class="expl">${md(w.it.explanation)}</div>` : ''}</div>`;
        }).join('') : ''}</div>`);
      $('#again').onclick = () => begin(shuffle(wrong.map(w => w.it)), mode);
      $('#home').onclick = () => viewMC(setId);
    };
    qv();
  }
  start();
}

// ---------- Karteikarten ----------
async function viewKarten(setId) {
  const data = await api('GET', '/api/sets/' + setId);
  if (data.type !== 'cards') return viewNotFound();
  store.set('last', setId);
  const items = data.items;
  const topics = [...new Set(items.map(i => i.topic))];
  const isDue = i => !i.p || i.p.due <= Date.now();

  function start() {
    const s = data.summary;
    const due = items.filter(isDue);
    const nextDue = items.filter(i => i.p && i.p.due > Date.now()).map(i => i.p.due).sort((a, b) => a - b)[0];
    setView(`<a class="back" href="#/fach/${data.fach_id}">‹ ${esc(data.fach)}</a><h1>${esc(data.title)}</h1>
      <div class="card"><div class="stats">
        <div class="stat"><div class="v">${due.length}</div><div class="l">heute fällig</div></div>
        <div class="stat"><div class="v">${s.seen}/${s.total}</div><div class="l">schon gelernt</div></div>
        <div class="stat"><div class="v">${pct(s.sicher, s.total)} %</div><div class="l">sicher</div></div>
      </div><div style="margin-top:12px">${progressBar(s)}</div>${legend()}
      <p class="sub" style="margin-top:10px">So funktioniert's: Karte ansehen, Antwort im Kopf überlegen, umdrehen, ehrlich bewerten. Gewusste Karten kommen erst nach 1, 3, 7, 14 und 30 Tagen wieder.</p>
      <div class="btns full"><button class="pri" id="due" ${due.length ? '' : 'disabled'}>${due.length ? `${due.length} fällige Karten lernen` : 'Heute alles erledigt'}</button></div>
      ${!due.length && nextDue ? `<p class="sub" style="text-align:center;margin-top:8px">Nächste Karte fällig: ${new Date(nextDue).toLocaleString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>` : ''}
      </div>
      <div class="card"><h2 style="margin-top:0">Frei üben</h2><p class="sub">Alle Karten eines Themas durchgehen, egal ob fällig.</p>
        <div class="topics">${topics.map((t, i) => `<label class="row"><input type="checkbox" class="tp" value="${i}" checked> ${esc(t || 'Allgemein')}<small>${items.filter(x => x.topic === t).length} Karten</small></label>`).join('')}</div>
        <label class="row"><input type="checkbox" id="mix" checked> Mischen</label>
        <div class="btns"><button id="free">Durchgehen</button></div></div>
      <div class="btns"><button class="danger sm" id="reset">Meinen Fortschritt hier löschen</button></div>`);
    $('#due').onclick = () => begin(shuffle(due.slice()).sort((a, b) => (a.p ? a.p.box : -1) - (b.p ? b.p.box : -1)));
    $('#free').onclick = () => {
      const tps = $$('.tp:checked').map(c => topics[+c.value]);
      const pool = items.filter(i => tps.includes(i.topic));
      if (pool.length) begin($('#mix').checked ? shuffle(pool) : pool);
    };
    confirmBtn($('#reset'), 'Wirklich löschen? Nochmal tippen', async () => { await api('POST', `/api/sets/${setId}/reset`, {}); viewKarten(setId); });
  }

  function begin(queue) {
    let pos = 0, shown = false;
    const total = queue.length, res = { ja: 0, unsicher: 0, nein: 0 };
    const again = [];
    const draw = () => {
      const it = queue[pos];
      shown = false;
      setView(`<div class="meta"><span>${esc(it.topic)}</span><span>${Math.min(pos + 1, queue.length)} / ${queue.length}</span></div>
        <div class="bar"><i class="b" style="width:${100 * pos / queue.length}%"></i></div>
        <div class="card flash" id="fc"><span class="side">Frage</span><div class="front">${esc(it.front)}</div>
          <div class="answer hide" id="bk">${md(it.back)}</div><div class="tap" id="tap">Tippen zum Umdrehen</div></div>
        <div class="rate hide" id="rate">
          <button class="n" data-r="nein">Nicht gewusst<small>kommt gleich wieder</small></button>
          <button class="u" data-r="unsicher">Unsicher<small>morgen</small></button>
          <button class="j" data-r="ja">Gewusst<small>${it.p ? ['heute', '1 Tag', '3 Tage', '7 Tage', '14 Tage', '30 Tage'][Math.min((it.p.box || 0) + 1, 5)] : '1 Tag'}</small></button>
        </div>
        <div class="btns"><button class="sm" id="quit">Beenden</button></div>
        <div class="kbd">Tastatur: Leertaste umdrehen · 1 nicht gewusst · 2 unsicher · 3 gewusst</div>`);
      $('#fc').onclick = flip;
      $$('#rate button').forEach(b => b.onclick = () => rate(b.dataset.r));
      $('#quit').onclick = () => finish();
      onKeys(e => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!shown) flip(); }
        else if (shown && '123'.includes(e.key)) rate(['nein', 'unsicher', 'ja'][+e.key - 1]);
        else if (e.key === 'Escape') finish();
      });
    };
    const flip = () => {
      if (shown) return;
      shown = true;
      $('#bk').classList.remove('hide'); $('#tap').classList.add('hide'); $('#rate').classList.remove('hide');
      $('.side').textContent = 'Antwort';
    };
    const rate = r => {
      const it = queue[pos];
      res[r]++;
      api('POST', '/api/answer', { itemId: it.id, rating: r }).then(x => { it.p = x.p; }).catch(() => {});
      // Nicht gewusste Karten kommen in dieser Runde nochmal (max. 3x)
      if (r === 'nein') { it._n = (it._n || 0) + 1; if (it._n < 3) { queue.push(it); again.push(it); } }
      pos++;
      if (pos >= queue.length) finish(); else draw();
    };
    const finish = () => {
      const n = res.ja + res.unsicher + res.nein;
      if (n) api('POST', '/api/attempts', { setId, mode: 'karten', total: n, correct: res.ja }).catch(() => {});
      queue.forEach(i => delete i._n);
      setView(`<div class="card"><h2 style="margin-top:0">Runde fertig</h2>
        <div class="big">${n}</div><p class="sub">Karten bewertet (${total} verschiedene)</p>
        <div class="stats"><div class="stat"><div class="v" style="color:var(--ok)">${res.ja}</div><div class="l">gewusst</div></div>
        <div class="stat"><div class="v" style="color:var(--warn)">${res.unsicher}</div><div class="l">unsicher</div></div>
        <div class="stat"><div class="v" style="color:var(--no)">${res.nein}</div><div class="l">nicht gewusst</div></div></div>
        <div class="btns"><button class="pri" id="home">Zur Übersicht</button><a class="btn" href="#/fach/${data.fach_id}">Zum Fach</a></div></div>`);
      $('#home').onclick = () => viewKarten(setId);
    };
    draw();
  }
  start();
}

// ---------- Mein Konto ----------
function viewProfil() {
  setView(`<h1>Mein Konto</h1>
    ${ME.mustChange ? '<div class="msg info">Du hast ein Start-Passwort vom Admin bekommen. Bitte vergib jetzt dein eigenes.</div>' : ''}
    <div class="card"><h2 style="margin-top:0">Anzeigename</h2><form id="pf">
      <label class="f"><span>Benutzername: ${esc(ME.username)}</span><input type="text" name="name" value="${esc(ME.name)}" required></label>
      <div id="pm"></div><div class="btns"><button class="pri">Speichern</button></div></form></div>
    <div class="card"><h2 style="margin-top:0">Passwort ändern</h2><form id="pw">
      <label class="f"><span>Bisheriges Passwort</span><input type="password" name="old" required autocomplete="current-password"></label>
      <label class="f"><span>Neues Passwort (mind. 6 Zeichen)</span><input type="password" name="new" required autocomplete="new-password"></label>
      <label class="f"><span>Neues Passwort wiederholen</span><input type="password" name="new2" required autocomplete="new-password"></label>
      <div id="wm"></div><div class="btns"><button class="pri">Passwort ändern</button></div></form></div>`);
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', '/api/profile', Object.fromEntries(new FormData(e.target))); ME.name = e.target.name.value; renderTop(); showMsg($('#pm'), 'Gespeichert.', 'ok'); }
    catch (err) { showMsg($('#pm'), err.message); }
  };
  $('#pw').onsubmit = async e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    if (b.new !== b.new2) return showMsg($('#wm'), 'Die neuen Passwörter stimmen nicht überein.');
    try { await api('POST', '/api/password', b); ME.mustChange = false; e.target.reset(); showMsg($('#wm'), 'Passwort geändert.', 'ok'); }
    catch (err) { showMsg($('#wm'), err.message); }
  };
}

// ---------- Verwaltung ----------
async function viewAdmin() {
  if (ME.role !== 'admin') return viewNotFound();
  const [u, s] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/sets')]);
  const faecher = [...new Set(s.sets.map(x => x.fach))];
  const ago = t => { if (!t) return 'nie'; const d = Math.floor((Date.now() - t) / 86400000); return d <= 0 ? 'heute' : d === 1 ? 'gestern' : `vor ${d} Tagen`; };
  setView(`<h1>Verwaltung</h1>
    <div class="card"><h2 style="margin-top:0">Inhalte importieren</h2>
      <p class="sub">Markdown- (.md) oder JSON-Datei hochladen. Gibt es das Lernset (gleiches Fach, gleicher Titel) schon, wird es aktualisiert. Der Lernfortschritt bei unveränderten Fragen bleibt erhalten.</p>
      <label class="f"><span>Fach (nur nötig, wenn es nicht in der Datei steht)</span><input type="text" id="impFach" list="fl" placeholder="z. B. Qualitätssicherung"><datalist id="fl">${faecher.map(f => `<option value="${esc(f)}">`).join('')}</datalist></label>
      <div class="drop" id="drop">Datei hierher ziehen oder <u>auswählen</u><input type="file" id="file" accept=".md,.json,.txt,text/markdown,application/json" multiple hidden></div>
      <div id="im"></div>
      <details><summary>Dateiformat anzeigen</summary>${formatHelp()}</details>
    </div>
    <div class="card"><h2 style="margin-top:0">Lernsets</h2>${s.sets.length ? s.sets.map(x => `<div class="li"><div class="t"><strong>${esc(x.fach)}</strong> · ${esc(x.title)}<br><small class="sub">${x.type === 'mc' ? 'Multiple Choice' : 'Karteikarten'} · ${x.n} Einträge · ${esc(x.source || '')}</small></div>
      <div class="a"><a class="btn sm" href="/api/admin/sets/${x.id}/export" download>Export</a><button class="sm danger" data-del="${x.id}">Löschen</button></div></div>`).join('') : '<p class="sub">Noch keine Inhalte.</p>'}</div>
    <div class="card"><h2 style="margin-top:0">Konten</h2>
      ${u.users.map(x => `<div class="li"><div class="t"><strong>${esc(x.name)}</strong> <small class="sub">(${esc(x.username)}${x.role === 'admin' ? ', Admin' : ''})</small><br>
        <small class="sub">${x.gelernt} Fragen geübt${x.richtig + x.falsch ? ' · ' + pct(x.richtig, x.richtig + x.falsch) + ' % richtig' : ''} · zuletzt da: ${ago(x.last_seen)}</small></div>
        <div class="a">${x.id === ME.id ? '<small class="sub">das bist du</small>' : `<button class="sm" data-pw="${x.id}">Neues Passwort</button><button class="sm" data-role="${x.id}" data-to="${x.role === 'admin' ? 'user' : 'admin'}">${x.role === 'admin' ? 'Admin entfernen' : 'Zum Admin machen'}</button><button class="sm danger" data-deluser="${x.id}">Löschen</button>`}</div></div>`).join('')}
      <h3>Konto für Kollegen anlegen</h3>
      <form id="nu"><label class="f"><span>Benutzername</span><input type="text" name="username" required autocapitalize="none"></label>
        <label class="f"><span>Anzeigename</span><input type="text" name="name"></label>
        <label class="f"><span>Start-Passwort (mind. 6 Zeichen, wird beim ersten Login geändert)</span><input type="text" name="password" required value="${randPw()}"></label>
        <div id="um"></div><div class="btns"><button class="pri">Konto anlegen</button></div></form>
    </div>
    <div class="card"><h2 style="margin-top:0">Selbst registrieren</h2>
      <p class="sub">Mit einem Einladungscode können sich Kollegen selbst ein Konto anlegen. Leer lassen schaltet das aus.</p>
      <form id="ic"><label class="f"><span>Einladungscode</span><input type="text" name="inviteCode" value="${esc(u.inviteCode)}" placeholder="aus"></label>
      <div id="cm"></div><div class="btns"><button class="pri">Speichern</button></div></form>
    </div>
    <div class="card"><h2 style="margin-top:0">So erreichen dich deine Kollegen</h2>
      <p class="sub">Im gleichen Netzwerk (WLAN/LAN) diese Adresse im Browser öffnen:</p>
      ${(/^(localhost|127\.)/.test(location.hostname) ? u.addresses : [location.origin]).map(a => `<p><strong>${esc(a)}</strong></p>`).join('') || `<p class="sub">Die IP-Adresse deines PCs plus <strong>:${esc(location.port || '80')}</strong>, z. B. http://192.168.0.20:${esc(location.port || '80')}. Die IP findest du unter Windows mit <code>ipconfig</code> (Zeile „IPv4-Adresse“).</p>`}
      ${/^(localhost|127\.)/.test(location.hostname) && u.addresses.length > 1 ? '<p class="sub">Mehrere Adressen: meist ist es die mit 192.168.… am Anfang.</p>' : ''}
      <p class="sub">Am Handy im Browser-Menü „Zum Startbildschirm hinzufügen“ wählen, dann startet der Lerntrainer wie eine App.</p>
    </div>`);

  const drop = $('#drop'), file = $('#file');
  drop.onclick = () => file.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); };
  file.onchange = () => upload([...file.files]);
  async function upload(files) {
    const out = [];
    for (const f of files) {
      try {
        const text = await f.text();
        const r = await api('POST', '/api/admin/import', { fileName: f.name, text, fach: $('#impFach').value.trim() });
        out.push(`<div class="msg ok">${esc(f.name)}: ${esc(r.fach)} · ${esc(r.titel)} – ${r.total} ${r.typ === 'mc' ? 'Fragen' : 'Karten'} ${r.isNew ? 'neu angelegt' : `aktualisiert (${r.added} neu, ${r.removed} entfernt)`}</div>`);
      } catch (err) { out.push(`<div class="msg err">${esc(f.name)}: ${esc(err.message)}</div>`); }
    }
    $('#im').innerHTML = out.join('') + '<div class="btns"><button class="sm" id="reload">Liste aktualisieren</button></div>';
    $('#reload').onclick = viewAdmin;
  }
  $$('[data-del]').forEach(b => confirmBtn(b, 'Sicher?', async () => { await api('DELETE', '/api/admin/sets/' + b.dataset.del, {}); viewAdmin(); }));
  $$('[data-deluser]').forEach(b => confirmBtn(b, 'Sicher?', async () => { await api('DELETE', '/api/admin/users/' + b.dataset.deluser, {}); viewAdmin(); }));
  $$('[data-role]').forEach(b => b.onclick = async () => { await api('POST', '/api/admin/users/' + b.dataset.role, { role: b.dataset.to }); viewAdmin(); });
  $$('[data-pw]').forEach(b => b.onclick = async () => {
    const pw = randPw();
    await api('POST', '/api/admin/users/' + b.dataset.pw, { password: pw });
    b.outerHTML = `<span class="pill">Neues Passwort: ${esc(pw)}</span>`;
  });
  $('#nu').onsubmit = async e => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try { await api('POST', '/api/admin/users', b); await viewAdmin(); showMsg($('#um'), `Konto „${b.username}“ angelegt. Start-Passwort: ${b.password}`, 'ok'); }
    catch (err) { showMsg($('#um'), err.message); }
  };
  $('#ic').onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', '/api/admin/settings', Object.fromEntries(new FormData(e.target))); showMsg($('#cm'), 'Gespeichert.', 'ok'); }
    catch (err) { showMsg($('#cm'), err.message); }
  };
}
function randPw() { const c = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; const a = crypto.getRandomValues(new Uint32Array(8)); for (const x of a) s += c[x % c.length]; return s; }

function formatHelp() {
  return `<h3>Multiple Choice als Markdown</h3><pre class="fmt">---
fach: Qualitätssicherung
titel: MC-Trainer
typ: mc
---
## Thema 1 · Grundlagen

### Wofür steht PDCA?
- [x] Plan, Do, Check, Act
- [ ] Prüfen, Dokumentieren, Controllen, Abnehmen
- [ ] Plan, Design, Check, Approve
> Erklärung (optional): Deming-Kreis.</pre>
<h3>Karteikarten als Markdown</h3><pre class="fmt">---
fach: Qualitätssicherung
titel: Karteikarten
typ: karteikarten
---
## Thema 1

### Was ist ein Ishikawa-Diagramm?
Ursache-Wirkungs-Diagramm (Fischgräte).
- Mensch, Maschine, Material, Methode …

Kurzform, eine Karte pro Zeile:
Was ist FMEA? :: Fehlermöglichkeits- und Einflussanalyse</pre>
<h3>JSON</h3><pre class="fmt">{ "fach": "…", "titel": "…", "typ": "mc",
  "fragen": [{ "thema": "…", "frage": "…", "richtig": "…",
               "falsch": ["…","…","…"], "erklaerung": "…" }] }

{ "fach": "…", "titel": "…", "typ": "karteikarten",
  "karten": [{ "thema": "…", "vorne": "…", "hinten": "…" }] }</pre>`;
}

function viewHilfe() {
  setView(`<h1>Hilfe</h1>
    <div class="card"><h2 style="margin-top:0">MC-Trainer</h2>
    <p><strong>Lernmodus:</strong> nach jeder Frage siehst du sofort, ob es richtig war. <strong>Prüfungsmodus:</strong> erst am Ende kommt die Auswertung.</p>
    <p>„Schwierige und neue Fragen bevorzugen“ zieht öfter Fragen, die du noch nie hattest oder oft falsch hattest. Eine Frage gilt als <strong>sicher</strong>, wenn du sie zweimal hintereinander richtig hattest.</p></div>
    <div class="card"><h2 style="margin-top:0">Karteikarten</h2>
    <p>Die Karten arbeiten nach dem Karteikasten-Prinzip: Was du weißt, kommt immer später wieder (1, 3, 7, 14, 30 Tage). Was du nicht weißt, kommt in derselben Runde nochmal. So lernst du jeden Tag nur die fälligen Karten. Eine Karte gilt ab dem dritten „Gewusst“ in Folge als sicher.</p></div>
    <div class="card"><h2 style="margin-top:0">Fortschritt</h2><p>${window.LT_OFFLINE ? 'Dein Fortschritt wird nur auf diesem Gerät gespeichert. Die App funktioniert auch ohne Internet, z. B. im Flugmodus. Unter „Sicherung & Inhalte“ kannst du ihn speichern und zwischen Handy und Tablet abgleichen.' : 'Dein Fortschritt wird pro Konto am Server gespeichert. Du kannst also am PC anfangen und am Handy weitermachen.'}</p></div>
    ${ME.role === 'admin' || window.LT_OFFLINE ? `<div class="card"><h2 style="margin-top:0">Dateiformate für den Import</h2>${formatHelp()}</div>` : ''}`);
}

function viewNotFound() { setView('<div class="card empty">Seite nicht gefunden. <a href="#/">Zu den Fächern</a></div>'); }

// ---------- Offline: Sicherung und eigene Inhalte ----------
function viewSicherung() {
  const L = window.LocalApi, st = L.stats(), cs = L.customSets();
  const last = store.get('lastBackup', 0);
  setView(`<h1>Sicherung & Inhalte</h1>
    <div class="card"><h2 style="margin-top:0">Fortschritt abgleichen und sichern</h2>
      <p class="sub">Dein Fortschritt (${st.progress} geübte Fragen und Karten) liegt auf diesem Gerät. ${last ? 'Zuletzt gespeichert: ' + new Date(last).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' }) + '.' : 'Noch nie gespeichert.'}</p>
      <div class="btns"><button class="pri" id="bk">Fortschritt speichern</button><button id="rs">Fortschritt einlesen</button><input type="file" id="rsf" accept=".json,application/json" hidden></div>
      <div id="bm"></div>
      <details><summary>Handy und Tablet abgleichen (iCloud Drive)</summary>
        <ol class="sub" style="padding-left:1.3em">
          <li>Auf dem Gerät, wo du gelernt hast: <strong>Fortschritt speichern</strong> → „In Dateien sichern“ → <strong>iCloud Drive</strong> (am besten immer in denselben Ordner, alte Datei ersetzen).</li>
          <li>Auf dem anderen Gerät: <strong>Fortschritt einlesen</strong> → die Datei aus iCloud Drive wählen.</li>
        </ol>
        <p class="sub">Beim Einlesen wird nichts überschrieben: Der Stand beider Geräte wird zusammengeführt, pro Frage gilt der neuere. Gleichzeitig ist es auch deine Sicherung.</p>
      </details></div>
    <div class="card"><h2 style="margin-top:0">Eigene Inhalte hinzufügen</h2>
      <p class="sub">Markdown- oder JSON-Datei mit Fragen oder Karteikarten öffnen. Gleiches Fach und gleicher Titel ersetzt das vorhandene Lernset, der Fortschritt bei gleichen Fragen bleibt.</p>
      <label class="f"><span>Fach (nur nötig, wenn es nicht in der Datei steht)</span><input type="text" id="impFach"></label>
      <div class="btns"><button id="imp">Datei auswählen</button><input type="file" id="impf" accept=".md,.json,.txt,text/markdown,application/json" multiple hidden></div>
      <div id="im"></div>
      ${cs.length ? '<h3>Von dir hinzugefügt</h3>' + cs.map((c, i) => `<div class="li"><div class="t"><strong>${esc(c.fach)}</strong> · ${esc(c.title)}<br><small class="sub">${c.type === 'mc' ? 'Multiple Choice' : 'Karteikarten'} · ${c.n} Einträge${c.overrides ? ' · ersetzt die mitgelieferte Version' : ''}</small></div><div class="a"><button class="sm danger" data-rm="${i}">Entfernen</button></div></div>`).join('') : ''}
      <details><summary>Dateiformat anzeigen</summary>${formatHelp()}</details></div>
    <div class="card"><h2 style="margin-top:0">Dein Name</h2><form id="nf"><label class="f"><span>Für die Begrüßung</span><input type="text" name="name" value="${esc(ME.name || '')}"></label><div id="nm"></div><div class="btns"><button class="pri">Speichern</button></div></form></div>`);
  $('#bk').onclick = async () => {
    const data = JSON.stringify(L.backup(), null, 1);
    const name = 'lerntrainer-fortschritt.json';
    const file = new File([data], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Lerntrainer-Sicherung' });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
      store.set('lastBackup', Date.now()); showMsg($('#bm'), 'Gespeichert: ' + name, 'ok');
    } catch (e) { if (e.name !== 'AbortError') showMsg($('#bm'), e.message); }
  };
  $('#rs').onclick = () => $('#rsf').click();
  $('#rsf').onchange = async () => {
    try {
      const n = L.restore(JSON.parse(await $('#rsf').files[0].text()));
      ME.name = (await api('GET', '/api/status')).user.name; renderTop();
      $('#rsf').value = '';
      showMsg($('#bm'), n ? `Eingelesen und zusammengeführt: ${n} Fragen und Karten übernommen.` : 'Eingelesen: Dieses Gerät war schon auf dem neuesten Stand.', 'ok');
    } catch (e) { showMsg($('#bm'), e instanceof SyntaxError ? 'Die Datei ist nicht lesbar.' : e.message); }
  };
  $('#imp').onclick = () => $('#impf').click();
  $('#impf').onchange = async () => {
    const out = [];
    for (const f of $('#impf').files) {
      try { const r = L.importFile(await f.text(), f.name, $('#impFach').value.trim()); out.push(`<div class="msg ok">${esc(f.name)}: ${esc(r.fach)} · ${esc(r.titel)} – ${r.total} ${r.typ === 'mc' ? 'Fragen' : 'Karten'}</div>`); }
      catch (e) { out.push(`<div class="msg err">${esc(f.name)}: ${esc(e.message)}</div>`); }
    }
    viewSicherung(); $('#im').innerHTML = out.join('');
  };
  $$('[data-rm]').forEach(b => confirmBtn(b, 'Sicher?', () => { L.removeCustom(+b.dataset.rm); viewSicherung(); }));
  $('#nf').onsubmit = async e => {
    e.preventDefault();
    await api('POST', '/api/profile', { name: e.target.name.value });
    ME.name = e.target.name.value.trim(); renderTop(); showMsg($('#nm'), 'Gespeichert.', 'ok');
  };
}
if (window.LT_OFFLINE && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- Als App installieren ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (location.hash === '' || location.hash === '#/') route(); });
window.addEventListener('appinstalled', () => { installEvt = null; store.set('installed', true); });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installBox() {
  if (isStandalone() || store.get('hideInstall', false)) return '';
  let body = '';
  if (installEvt) body = '<p class="sub" style="margin:0 0 8px">Leg den Lerntrainer als App auf deinen Startbildschirm.</p><div class="btns" style="margin-top:0"><button class="pri" id="inst">App installieren</button><button class="ghost sm" id="noinst">Nicht mehr anzeigen</button></div>';
  else if (isIOS()) body = '<p class="sub" style="margin:0">Als App aufs iPhone: in Safari unten auf <strong>Teilen</strong> (Quadrat mit Pfeil nach oben) tippen, dann <strong>„Zum Home-Bildschirm“</strong>.</p><div class="btns"><button class="ghost sm" id="noinst">Nicht mehr anzeigen</button></div>';
  else if (/android/i.test(navigator.userAgent)) body = `<p class="sub" style="margin:0">Als App aufs Handy: im Browser-Menü <strong>⋮</strong> auf <strong>„App installieren“</strong> oder „Zum Startbildschirm hinzufügen“ tippen.${location.protocol !== 'https:' && !/^(localhost|127\.)/.test(location.hostname) ? ' (Ohne HTTPS-Adresse ist es nur eine Verknüpfung.)' : ''}</p><div class="btns"><button class="ghost sm" id="noinst">Nicht mehr anzeigen</button></div>`;
  else return '';
  return `<div class="card" id="installBox" style="border-color:var(--pri)"><strong>📱 Lerntrainer als App</strong>${body}</div>`;
}
function wireInstall() {
  const i = $('#inst'); if (i) i.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBox')?.remove(); };
  const n = $('#noinst'); if (n) n.onclick = () => { store.set('hideInstall', true); $('#installBox')?.remove(); };
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.)/.test(location.hostname))) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- Navigation ----------
async function route() {
  renderTop();
  if (!ME) { const st = await api('GET', '/api/status'); return viewAuth(st); }
  const h = location.hash.replace(/^#/, '') || '/';
  let m;
  try {
    if (ME.mustChange && h !== '/profil') { location.hash = '#/profil'; return; }
    if (h === '/') await viewHome();
    else if ((m = h.match(/^\/fach\/(\d+)$/))) await viewFach(+m[1]);
    else if ((m = h.match(/^\/mc\/(\d+)$/))) await viewMC(+m[1]);
    else if ((m = h.match(/^\/karten\/(\d+)$/))) await viewKarten(+m[1]);
    else if (h === '/profil') viewProfil();
    else if (h === '/verwaltung') await viewAdmin();
    else if (h === '/hilfe') viewHilfe();
    else if (h === '/sicherung' && window.LT_OFFLINE) viewSicherung();
    else viewNotFound();
  } catch (e) { if (ME) setView(`<div class="msg err">${esc(e.message)}</div><a href="#/">Zu den Fächern</a>`); }
}
async function boot() {
  try { const st = await api('GET', '/api/status'); ME = st.user; if (!ME) { renderTop(); return viewAuth(st); } route(); }
  catch (e) { setView(`<div class="msg err">Keine Verbindung zum Lerntrainer. Bitte Internet bzw. WLAN prüfen und neu laden.</div><div class="btns"><button class="pri" onclick="location.reload()">Neu laden</button></div>`); }
}
window.addEventListener('hashchange', route);
boot();
