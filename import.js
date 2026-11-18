'use strict';
// Liest Lerninhalte aus JSON oder Markdown und gibt ein einheitliches Objekt zurück:
// { fach, titel, typ: 'mc'|'karteikarten', items: [{ thema, frage, antworten?:[{text,richtig}], antwort?, erklaerung? }] }

function fail(msg) { const e = new Error(msg); e.userError = true; throw e; }

function normTyp(t) {
  t = String(t || '').toLowerCase().trim();
  if (['mc', 'multiple-choice', 'multiplechoice', 'quiz'].includes(t)) return 'mc';
  if (['karteikarten', 'karteikarte', 'cards', 'flashcards', 'karten'].includes(t)) return 'karteikarten';
  return null;
}

function clean(s) { return String(s == null ? '' : s).replace(/\r/g, '').trim(); }

function fromJson(text, defaults = {}) {
  let d;
  try { d = JSON.parse(text); } catch (e) { fail('Die JSON-Datei ist nicht lesbar: ' + e.message); }
  const fach = clean(d.fach), titel = clean(d.titel);
  let typ = normTyp(d.typ) || (Array.isArray(d.fragen) ? 'mc' : Array.isArray(d.karten) ? 'karteikarten' : null);
  if (!typ) fail('Im JSON fehlt "typ" ("mc" oder "karteikarten").');
  const items = [];
  if (typ === 'mc') {
    for (const [i, q] of (d.fragen || []).entries()) {
      const richtig = Array.isArray(q.richtig) ? q.richtig : [q.richtig];
      const antworten = richtig.filter(x => clean(x)).map(t => ({ text: clean(t), richtig: true }))
        .concat((q.falsch || []).filter(x => clean(x)).map(t => ({ text: clean(t), richtig: false })));
      if (!clean(q.frage)) fail(`Frage ${i + 1}: Text fehlt.`);
      if (!antworten.some(a => a.richtig)) fail(`Frage ${i + 1}: keine richtige Antwort.`);
      if (antworten.length < 2) fail(`Frage ${i + 1}: mindestens 2 Antworten nötig.`);
      items.push({ thema: clean(q.thema), frage: clean(q.frage), antworten, erklaerung: clean(q.erklaerung) });
    }
  } else {
    for (const [i, k] of (d.karten || []).entries()) {
      const frage = clean(k.vorne ?? k.frage), antwort = clean(k.hinten ?? k.antwort);
      if (!frage || !antwort) fail(`Karte ${i + 1}: Vorder- oder Rückseite fehlt.`);
      items.push({ thema: clean(k.thema), frage, antwort });
    }
  }
  return finish({ fach, titel, typ, items }, defaults);
}

function parseFrontmatter(text) {
  const meta = {};
  const m = text.match(/^﻿?---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta, body: text };
  for (const line of m[1].split('\n')) {
    const k = line.match(/^\s*([\wäöüÄÖÜ]+)\s*:\s*(.*)$/);
    if (k) meta[k[1].toLowerCase()] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

function fromMarkdown(text, fileName, defaults = {}) {
  text = text.replace(/\r\n?/g, '\n');
  const { meta, body } = parseFrontmatter(text);
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  let thema = '', cur = null, inCode = false;
  const blocks = [];
  let h1 = '';
  for (const line of lines) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    if (!inCode) {
      let m;
      if ((m = line.match(/^#\s+(.+)/)) && !cur && !h1) { h1 = m[1].trim(); continue; }
      if ((m = line.match(/^##\s+(.+)/))) { thema = m[1].trim(); cur = null; continue; }
      if ((m = line.match(/^###\s+(.+)/))) { cur = { thema, frage: m[1].trim(), lines: [] }; blocks.push(cur); continue; }
      if (!cur && (m = line.match(/^(.+?)\s*::\s*(.+)$/))) { blocks.push({ thema, frage: m[1].trim(), lines: [m[2]] }); continue; }
    }
    if (cur) cur.lines.push(line);
  }
  // Typ erkennen: Meta, sonst Ankreuz-Listen => MC
  let typ = normTyp(meta.typ);
  if (!typ) typ = blocks.some(b => b.lines.some(l => /^\s*[-*]\s+\[[ xX]\]/.test(l))) ? 'mc' : 'karteikarten';
  const items = [];
  for (const [i, b] of blocks.entries()) {
    if (typ === 'mc') {
      const antworten = [], erkl = [];
      for (const l of b.lines) {
        const a = l.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (a) antworten.push({ text: a[2].trim(), richtig: a[1] !== ' ' });
        else if (/^\s*>/.test(l)) erkl.push(l.replace(/^\s*>\s?/, ''));
      }
      if (!antworten.some(a => a.richtig)) fail(`Frage ${i + 1} („${b.frage.slice(0, 50)}“): keine Antwort mit [x] markiert.`);
      if (antworten.length < 2) fail(`Frage ${i + 1} („${b.frage.slice(0, 50)}“): mindestens 2 Antworten nötig.`);
      items.push({ thema: b.thema, frage: b.frage, antworten, erklaerung: clean(erkl.join('\n')) });
    } else {
      const antwort = clean(b.lines.join('\n'));
      if (!antwort) fail(`Karte ${i + 1} („${b.frage.slice(0, 50)}“): Rückseite fehlt.`);
      items.push({ thema: b.thema, frage: b.frage, antwort });
    }
  }
  const base = String(fileName || '').replace(/\.[^.]+$/, '');
  return finish({ fach: clean(meta.fach), titel: clean(meta.titel) || h1 || base, typ, items }, defaults);
}

function finish(d, defaults = {}) {
  if (!d.fach) d.fach = clean(defaults.fach);
  if (!d.fach) fail('Das Fach fehlt (im Kopf der Datei „fach: …“ angeben oder beim Hochladen auswählen).');
  if (!d.titel) d.titel = d.typ === 'mc' ? 'MC-Trainer' : 'Karteikarten';
  if (!d.items.length) fail('In der Datei wurden keine Fragen oder Karten gefunden.');
  if (d.items.length > 5000) fail('Zu viele Einträge (max. 5000).');
  return d;
}

function parse(text, fileName, defaults = {}) {
  const isJson = /\.json$/i.test(fileName || '') || /^\s*[{[]/.test(text);
  return isJson ? fromJson(text, defaults) : fromMarkdown(text, fileName, defaults);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parse };
else window.LTImport = { parse };
