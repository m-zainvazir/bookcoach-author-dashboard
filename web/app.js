/*
 * app.js — the pipeline dashboard. Plain JavaScript, no build, no CDN.
 *
 * Every value from the server is rendered as TEXT (textContent), never as
 * HTML: details carry strings read from live web pages, and one of those could
 * be anything. The page holds a session token that can sign off steps and flip
 * switches, so it must never execute what it displays.
 */
(() => {
  'use strict';

  const TOKEN = document.querySelector('meta[name="pipeline-token"]').getAttribute('content');
  const GLYPH = { DONE: '✓', READY: '▶', BLOCKED: '·', CONFIRM: '?', FAIL: '✗', OPTIONAL: '○' };
  const HGLYPH = { OK: '✓', WARN: '!', FAIL: '✗', SKIP: '–' };
  const ROW_LABEL = { DONE: 'done', TODO: 'to do', FAIL: 'wrong', WARN: 'note', MANUAL: 'confirm' };
  const SWITCHES = [
    { key: 'guidance', name: 'Guidance', what: 'the /next-step skill in Claude Code' },
    { key: 'alertsLocal', name: 'Local alerts', what: 'health check on a timer, desktop notification on change' },
    { key: 'alertsUptime', name: 'Uptime alerts', what: 'an external monitor on /health — works with the PC off' },
    { key: 'landingPages', name: 'Landing pages', what: 'the /landing-page skill + a "Generate with Claude Code" button in the Zipify and collection steps' },
  ];

  const S = { data: null, health: null, open: null, canvasCode: null, timer: null, deleted: { open: [], finished: [] } };

  /* ------------------------------------------------------------ helpers --- */

  const $ = (id) => document.getElementById(id);

  /** Build an element. Children that are strings become text nodes. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-pipeline-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { problems: json.problems || null, job: json.job || null, status: res.status });
    return json;
  }

  let toastTimer = null;
  function toast(msg, ms = 4000) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast('Copy failed — select the text instead');
    }
  }

  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };
  const stateClass = (s) => `st-${s.state}${s.state === 'DONE' && s.warn ? ' warn' : ''}`;
  const glyphOf = (s) => (s.state === 'DONE' && s.warn ? '!' : GLYPH[s.state]);
  const authorOf = (code) => S.data.authors.find((a) => a.code === code);

  /* -------------------------------------------------------------- loading --- */

  /**
   * `fresh`: null — each author's last reading, as saved (the dashboard opens on
   * it); or { codes: 'all' | [codes], health } — read those from the live systems again.
   */
  async function load(fresh = null) {
    const btn = $('refresh');
    btn.disabled = true;
    showLoading(fresh ? readingText(fresh) : 'Loading…');
    // Taking long without a refresh means an author has no saved reading yet — it is being read now.
    const slow = fresh ? null : setTimeout(() => showLoading('Reading the live systems — an author with no saved reading is read now…'), 1500);
    try {
      const q = new URLSearchParams();
      if (fresh && (fresh.codes === 'all' || fresh.codes.length)) q.set('refresh', fresh.codes === 'all' ? 'all' : fresh.codes.join(','));
      if (fresh && fresh.health) q.set('health', '1');
      // State first, then health — after a refresh, from the same fresh reads.
      S.data = await api(`/api/state${String(q) ? `?${q}` : ''}`);
      // Deleted authors with clean-up left (the grey rows): a local file, nothing live is read.
      try { S.deleted = await api('/api/deleted'); } catch { S.deleted = { open: [], finished: [] }; }
      renderAll();
      window.PipelineWizard.updateRoster();
      hideLoading();
      S.health = await api('/api/health');
      renderHealth();
      // Who has access (plan 07): the last reading for the grid column — nothing live is read,
      // unless this was a refresh that included the health checks (they read the same GHL contacts).
      if (fresh && fresh.health) window.PipelineAccess.read(false); else window.PipelineAccess.loadSaved();
      renderCanvas();
      if (!fresh && !S.followed) { S.followed = true; if (location.hash) followHash(); }
      $('stamp').textContent = readStamp();
      $('stamp').title = 'When the live systems were last read. Each author keeps its last reading until you refresh it.';
      scheduleAuto();
      return true;
    } catch (err) {
      toast(`Could not load: ${err.message}`, 8000);
      return false;
    } finally {
      clearTimeout(slow);
      btn.disabled = false;
      hideLoading();
    }
  }
  const showLoading = (text) => { $('loading').textContent = text; $('loading').classList.add('show'); };
  const hideLoading = () => $('loading').classList.remove('show');

  function scheduleAuto() {
    clearInterval(S.timer);
    const m = Number(S.data && S.data.settings && S.data.settings.autoRefreshMinutes) || 0;
    if (m >= 15) S.timer = setInterval(() => load({ codes: 'all', health: true }), m * 60 * 1000);
  }

  /* ----------------------------------------------- readings and refresh --- */

  /** "10:32" today; "5 Oct 10:32" on another day. */
  function shortWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${t}`;
  }
  /** " · about 25 s", " · about 2 min" — from how long each reading took last time. */
  const about = (ms) => (!ms ? '' : ms < 60000 ? ` · about ${Math.max(1, Math.round(ms / 1000))} s` : ` · about ${Math.round(ms / 60000)} min`);
  const tookOf = (a) => (a && a.reading && a.reading.tookMs) || 0;
  const nameOf = (code) => { const a = authorOf(code); return a ? a.name : code; };
  const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

  /** "read 10:32", or "read 9:05 – 10:32" when the authors were read at different times. */
  function readStamp() {
    const times = S.data.authors.map((a) => a.reading && a.reading.at).filter(Boolean).sort();
    if (!times.length) return `read ${shortWhen(S.data.generatedAt)}`;
    const [first, last] = [times[0], times[times.length - 1]];
    return new Date(last) - new Date(first) < 60000 ? `read ${shortWhen(last)}` : `read ${shortWhen(first)} – ${shortWhen(last)}`;
  }
  /** Under an author's name: when it was read, and whether the checks changed since. */
  const readLine = (a) => (a.reading ? `read ${shortWhen(a.reading.at)}${a.reading.oldChecks ? ' · checks updated since' : ''}` : '');

  function readingText(fresh) {
    if (fresh.codes === 'all') {
      const ms = S.data ? S.data.authors.reduce((t, a) => t + tookOf(a), 0) : 0;
      return `Reading every author from the live systems${about(ms)}…`;
    }
    if (!fresh.codes.length) return 'Reading the health checks…';
    const ms = fresh.codes.reduce((t, c) => t + tookOf(authorOf(c)), 0);
    return `Reading ${andList(fresh.codes.map(nameOf))} from the live systems${about(ms)}…`;
  }

  /** The author open in the Onboard tab — when that is what is on screen. */
  function onboardTarget() {
    const tab = document.querySelector('.tab.active');
    return tab && tab.dataset.tab === 'wizard' ? window.PipelineWizard.current() : null;
  }

  /** In the Onboard tab, Refresh reads only the author open there; anywhere else, it asks. */
  function updateRefreshButton() {
    const cur = onboardTarget();
    const btn = $('refresh');
    if (window.PipelineAccess && window.PipelineAccess.isOpen()) {
      btn.textContent = 'Refresh access';
      btn.title = 'Read who has access again: GHL contacts, subscriptions, recent Shopify orders';
      return;
    }
    btn.textContent = !cur ? 'Refresh…' : cur.exists ? 'Refresh this author' : 'Refresh this draft';
    btn.title = !cur ? 'Choose what to read again from the live systems: everything, or the authors you tick'
      : `Read ${cur.name || cur.code} again from the live systems — only this ${cur.exists ? 'author' : 'draft'}`;
  }

  async function refreshClicked() {
    if (window.PipelineAccess.isOpen()) return window.PipelineAccess.read(true);
    const cur = onboardTarget();
    if (!cur) return openRefreshDialog();
    if (cur.exists) {
      if (await load({ codes: [cur.code], health: false })) await window.PipelineWizard.reload();
      return;
    }
    // A draft is not in the Pipeline yet: only its own page (is it published?) is read.
    showLoading('Checking the draft…');
    try { await window.PipelineWizard.reload(); } finally { hideLoading(); }
  }

  /** "Refresh…": everything, or the authors ticked — and the health checks if ticked. */
  function openRefreshDialog() {
    if (!S.data) return load(null);
    const authors = S.data.authors;
    const healthMs = tookOf(S.health);
    const onHealth = ((document.querySelector('.tab.active') || {}).dataset || {}).tab === 'health';
    const picks = authors.map((a) => ({ a, box: h('input', { type: 'checkbox', value: a.code }) }));
    const healthBox = h('input', { type: 'checkbox', checked: onHealth });
    const go = h('button', { class: 'primary' });
    const update = () => {
      const chosen = picks.filter((p) => p.box.checked);
      const n = chosen.length;
      const what = [n ? `${n} author${n === 1 ? '' : 's'}` : '', healthBox.checked ? 'the health checks' : ''].filter(Boolean);
      go.disabled = !what.length;
      go.textContent = what.length ? `Refresh ${what.join(' and ')}${about(chosen.reduce((t, p) => t + tookOf(p.a), 0) + (healthBox.checked ? healthMs : 0))}` : 'Tick what to refresh';
    };
    const setAll = (on) => { for (const p of picks) p.box.checked = on; update(); };
    for (const p of picks) p.box.addEventListener('change', update);
    healthBox.addEventListener('change', update);
    const run = (fresh) => { dlg.close(); load(fresh); };
    go.addEventListener('click', () => run({ codes: picks.filter((p) => p.box.checked).map((p) => p.a.code), health: healthBox.checked }));

    const total = authors.reduce((t, a) => t + tookOf(a), 0) + healthMs;
    const dlg = h('dialog', { class: 'refresh-dialog', 'aria-labelledby': 'rf-title' }, h('div', { class: 'rf-body' },
      h('h2', { id: 'rf-title', text: 'Refresh — read the live systems again' }),
      h('p', { class: 'muted', text: 'The dashboard opens on each author’s last reading. Read again everything, or only the authors you tick.' }),
      h('button', { class: 'primary rf-all', onclick: () => run({ codes: 'all', health: true }) }, `Everything — all ${authors.length} authors and the health checks${about(total)}`),
      h('div', { class: 'rf-or' }, h('span', { text: 'or choose' })),
      h('div', { class: 'rf-quick' },
        h('button', { class: 'ghost', onclick: () => setAll(true) }, 'Tick all authors'),
        h('button', { class: 'ghost', onclick: () => setAll(false) }, 'Untick all')),
      h('ul', { class: 'rf-list' }, picks.map(({ a, box }) => {
        const st = a.where ? a.where.state : 'DONE';
        return h('li', null, h('label', null, box,
          h('span', { class: `pill st-${st}`, text: GLYPH[st] }),
          h('span', { class: 'rf-name' },
            h('span', { text: `${a.code} ${a.name}` }),
            h('span', { class: `muted${a.reading && a.reading.oldChecks ? ' old' : ''}`, text: `${readLine(a)}${tookOf(a) ? ` · took ${Math.max(1, Math.round(tookOf(a) / 1000))} s` : ''}` }))));
      })),
      h('label', { class: 'rf-health' }, healthBox,
        h('span', { class: 'rf-name' },
          h('span', { text: 'Health checks (the Health tab)' }),
          h('span', { class: 'muted', text: S.health && S.health.reading ? `read ${shortWhen(S.health.reading.at)}` : '' }))),
      h('div', { class: 'rf-foot' }, h('button', { class: 'ghost', onclick: () => dlg.close() }, 'Cancel'), go)));
    // A click on the dimmed area outside closes it, as Esc does (the content fills the dialog, so it is never the target).
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    update();
    document.body.append(dlg);
    dlg.showModal();
  }

  function renderAll() {
    renderSwitches();
    renderLegend();
    renderGrid();
    renderCanvasAuthors();
    if (S.open) openStep(S.open.code, S.open.step);
  }

  /* ------------------------------------------------------------ switches --- */

  function renderSwitches() {
    const box = clear($('switches'));
    const { settings, reality } = S.data;
    for (const sw of SWITCHES) {
      const on = settings[sw.key] === 'on';
      const real = reality[sw.key] || {};
      const mismatch = real.actual && real.actual !== 'manual' && real.actual !== settings[sw.key];
      const toggle = h('button', {
        class: `toggle${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': `${sw.name}: ${on ? 'on' : 'off'}`,
        onclick: () => flip({ [sw.key]: on ? 'off' : 'on' }),
      });
      const extra = sw.key === 'alertsLocal'
        ? h('select', { 'aria-label': 'how often', onchange: (e) => flip({ alertsIntervalMinutes: e.target.value }) },
          [15, 30, 60, 120, 240, 720, 1440].map((m) => h('option', { value: m, selected: Number(settings.alertsIntervalMinutes) === m }, m < 60 ? `every ${m} min` : m === 1440 ? 'daily' : `every ${m / 60} h`)))
        : sw.key === 'landingPages'
          ? h('span', { class: 'switch-extra' },
            h('select', { 'aria-label': 'model', title: 'The model the landing-page chat uses', onchange: (e) => flip({ landingModel: e.target.value }) },
              ['sonnet', 'opus', 'haiku', 'fable'].map((m) => h('option', { value: m, selected: settings.landingModel === m }, m))),
            h('select', { 'aria-label': 'effort', title: 'Its effort', onchange: (e) => flip({ landingEffort: e.target.value }) },
              ['low', 'medium', 'high', 'xhigh', 'max'].map((m) => h('option', { value: m, selected: settings.landingEffort === m }, `${m} effort`))))
          : null;
      box.append(h('div', { class: 'switch' },
        toggle,
        h('div', { class: 'text' },
          h('span', { class: 'name', text: `${sw.name} — ${on ? 'on' : 'off'}` }),
          h('span', { class: 'detail', text: sw.what }),
          h('span', { class: `detail${mismatch ? ' mismatch' : ''}`, text: mismatch ? `⚠ actually ${real.actual}: ${real.detail} — flip it again to re-apply` : real.detail || '' })),
        extra));
    }
  }

  async function flip(changes) {
    try {
      const r = await api('/api/settings', { changes });
      S.data.settings = r.settings;
      S.data.reality = r.reality;
      renderSwitches();
      // An open Onboard step shows what the switches allow (the "Generate with Claude Code" button):
      // read it again, or it keeps showing the state from before the flip.
      if (window.PipelineWizard && window.PipelineWizard.current()) window.PipelineWizard.reload();
      const msgs = Object.entries(r.applied || {}).map(([k, v]) => `${k}: ${v.detail}`);
      toast(msgs.join(' · ') || 'Saved', 7000);
      scheduleAuto();
    } catch (err) {
      toast(err.message, 8000);
    }
  }

  /* ---------------------------------------------------------------- grid --- */

  function renderLegend() {
    const L = S.data.labels;
    const box = clear($('legend'));
    const item = (cls, g, label) => h('span', null, h('span', { class: `pill ${cls}`, text: g }), label);
    box.append(
      item('st-DONE', '✓', L.DONE), item('st-DONE warn', '!', 'done, with a note'), item('st-READY', '▶', L.READY),
      item('st-CONFIRM', '?', L.CONFIRM), item('st-BLOCKED', '·', L.BLOCKED), item('st-OPTIONAL', '○', L.OPTIONAL || 'optional'), item('st-FAIL', '✗', L.FAIL),
    );
    $('doc').textContent = `Steps are the checklist in ${S.data.doc}. Each author shows its last reading of the live systems (the time is under its name); Refresh reads again what you choose.`;
  }

  function renderGrid() {
    // The dashboard was updated since some authors were read: say so, with the way out.
    const old = S.data.authors.filter((a) => a.reading && a.reading.oldChecks).map((a) => a.code);
    const note = clear($('readnote'));
    note.classList.toggle('show', old.length > 0);
    if (old.length) {
      const who = old.length === S.data.authors.length ? 'every author was' : `${andList(old.map(nameOf))} ${old.length === 1 ? 'was' : 'were'}`;
      note.append(`The dashboard’s checks were updated after ${who} last read, so what is shown may be out of date. `,
        h('button', { onclick: () => load({ codes: old, health: false }) }, old.length === 1 ? 'Refresh it' : `Refresh those ${old.length}`));
    }
    const table = clear($('grid'));
    const steps = S.data.steps;
    table.append(h('thead', null, h('tr', null,
      h('th', { class: 'author', text: 'Author' }),
      steps.map((s) => h('th', { title: s.long }, h('span', { class: 'num', text: String(s.id) }), h('span', { class: 'lbl', text: s.title }))),
      h('th', { class: 'acc-col', title: 'Who has this coach now — from the last Access reading' }, h('span', { class: 'lbl', text: 'Access' })),
      h('th', { class: 'row-menu', 'aria-label': 'Actions' }))));
    const body = h('tbody');
    for (const a of S.data.authors) {
      const where = a.where;
      body.append(h('tr', null,
        h('td', { class: 'author' },
          h('div', { class: 'name' }, `${a.code} ${a.name} `, h('button', { class: 'link', title: 'Open this author in the onboarding wizard', onclick: () => window.PipelineWizard.openAuthor(a.code) }, 'Onboard →')),
          h('div', { class: `where ${where ? where.state : ''}`, text: where ? `step ${where.id} ${where.title} — ${S.data.labels[where.state]}` : 'every step done' }),
          a.reading ? h('div', { class: `read${a.reading.oldChecks ? ' old' : ''}`, title: `Read from the live systems ${when(a.reading.at)}. Refresh to read again.`, text: readLine(a) }) : null),
        a.steps.map((s) => h('td', null, h('button', {
          class: `cell ${stateClass(s)}${where && where.id === s.id ? ' here' : ''}`,
          title: `${s.id} ${s.long}: ${S.data.labels[s.state]}${s.warn ? ' (with a note)' : ''}`,
          'aria-label': `${a.name} step ${s.id} ${s.title}: ${S.data.labels[s.state]}`,
          onclick: () => openStep(a.code, s.id),
        }, glyphOf(s)))),
        h('td', { class: 'acc-col' }, window.PipelineAccess.gridCell(a.code)),
        h('td', { class: 'row-menu' }, h('button', { class: 'kebab ghost', title: 'Edit the number or details, or delete', 'aria-haspopup': 'menu', 'aria-label': `Actions for ${a.name}`, onclick: (e) => window.PipelineManage.openMenu(e.currentTarget, a) }, '⋯'))));
    }
    // A deleted author stays here, grey, until what is left in GHL, Shopify and Zipify is gone or signed off.
    for (const d of S.deleted.open) {
      body.append(h('tr', { class: 'ghostrow', tabindex: '0', title: 'Click to see what is left to remove', onclick: () => window.PipelineManage.openCleanup(d.code), onkeydown: (e) => { if (e.key === 'Enter') window.PipelineManage.openCleanup(d.code); } },
        h('td', { class: 'author' }, h('div', { class: 'name', text: `${d.code} ${d.name}` }), h('div', { class: 'where', text: `deleted ${shortWhen(d.deletedAt)} · clean-up open` })),
        h('td', { colspan: String(steps.length + 2), class: 'ghostcell' },
          h('span', { class: 'pill st-CONFIRM', text: `${d.left} of ${d.total} left` }), ' ',
          h('span', { class: 'muted', text: 'still in GHL, Shopify or Zipify. Click to see what, and how to remove it' }))));
    }
    table.append(body);
    const fin = clear($('cleanup-done'));
    if (S.deleted.finished.length) fin.append(`Clean-up finished: ${S.deleted.finished.map((f) => `${f.name} (${f.code})`).join(' · ')}`);
  }

  /* -------------------------------------------------------------- drawer --- */

  function openStep(code, stepId) {
    const a = authorOf(code);
    if (!a) return;
    const s = a.steps.find((x) => x.id === stepId);
    const def = S.data.steps.find((x) => x.id === stepId);
    S.open = { code, step: stepId };
    const body = clear($('drawer-body'));
    body.append(
      h('div', { class: 'muted', text: `${a.code} ${a.name} — ${a.book}` }),
      h('h2', { text: `${s.id} · ${def.long}` }),
      h('div', { class: 'meta' },
        h('span', { class: `pill ${stateClass(s)}`, text: `${glyphOf(s)} ${S.data.labels[s.state]}${s.warn ? ' (with a note)' : ''}` }),
        h('span', { class: 'muted', text: `${def.platform} · ${def.kind}` })),
    );
    if (def.needs.length) {
      body.append(h('div', { class: 'meta' }, h('span', { class: 'muted', text: 'needs' }),
        def.needs.map((n) => {
          const ns = a.steps.find((x) => x.id === n);
          return h('button', { class: 'chip', onclick: () => openStep(code, n), title: S.data.labels[ns.state] },
            h('span', { class: `dot ${stateClass(ns)}` }), `${n} ${ns.title}`);
        })));
    }

    // This panel only reads. Doing the step — the forms, the buttons — is in the Onboard tab.
    const goDo = () => { closeDrawer(); window.PipelineWizard.openAuthor(code, stepId); };
    body.append(h('div', { class: 'drawer-go' }, s.key === 'coachPage'
      ? h('button', { class: 'primary', onclick: goDo }, 'Open the page form →')
      : h('button', { onclick: goDo }, `Do step ${stepId} in the Onboard tab →`)));

    body.append(helpBox(s.help, { openHow: s.state === 'READY' }));
    body.append(h('h3', { text: 'Technical details — what the live systems say' }));
    body.append(h('ul', { class: 'rows' }, s.rows.map((r) => h('li', null,
      h('div', null, h('span', { class: `pill st-${r.status === 'MANUAL' && r.signed ? 'DONE' : r.status}`, text: r.status === 'MANUAL' ? (r.signed ? 'signed off' : 'confirm') : ROW_LABEL[r.status] || r.status }), ' ',
        h('span', { class: 'check', text: r.check })),
      r.detail ? h('div', { class: 'detail', text: r.detail }) : null,
      r.fix && r.status !== 'DONE' && !(r.status === 'MANUAL' && r.signed) ? fixOf(r.fix) : null))));

    const act = s.action || {};
    body.append(h('h3', { text: 'For reference — the checklist\u2019s own wording' }));
    if (act.instructions) body.append(h('p', { class: 'note', text: act.instructions }));
    if (act.command) body.append(cmdBox(act.command));
    body.append(h('p', { class: 'muted', text: `Checklist: ${S.data.doc}, step ${stepId}` }));

    // Sign-off: only for checks no API can read.
    const manual = s.rows.filter((r) => r.status === 'MANUAL');
    if (manual.length) {
      body.append(h('h3', { text: 'Your confirmation' }));
      if (s.signoff) {
        body.append(h('div', { class: 'signed' },
          h('div', { text: `Signed off ${when(s.signoff.at)}${s.signoff.note ? ` — ${s.signoff.note}` : ''}` }),
          h('div', { class: 'muted', text: `Covers: ${(s.signoff.checks || []).join('; ')}` }),
          h('button', { class: 'ghost', onclick: () => sign(code, stepId, null) }, 'Undo sign-off')));
      }
      if (s.unsigned.length) {
        const note = h('textarea', { placeholder: 'What you checked, so the next person knows (optional)', 'aria-label': 'note' });
        body.append(h('div', { class: 'signoff' },
          h('div', { text: def.signoff || 'Confirm by hand:' }),
          h('ul', null, s.unsigned.map((c) => h('li', { text: c }))),
          note,
          h('button', { class: 'primary', onclick: () => sign(code, stepId, note.value) }, 'Sign off')),
        h('p', { class: 'muted', text: 'A sign-off only covers what no API can read. It never turns a wrong or unfinished check green.' }));
      }
    }

    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
  }

  /**
   * Help in plain words (lib-help.mjs): the headline, what is wrong and how to
   * fix it, then how the step works. Steps are text, or { text, copy } for a
   * value to copy.
   */
  const LEVEL = { must: ['Fix this', 'st-FAIL'], confirm: ['Check, then sign off', 'st-CONFIRM'], optional: ['Optional', 'st-WARN'] };
  const stepLine = (x) => (typeof x === 'string' ? h('li', { text: x }) : h('li', null, h('div', { text: x.text }), x.copy ? cmdBox(x.copy) : null));
  function helpBox(help, { openHow = false } = {}) {
    if (!help) return null;
    const box = h('div', { class: 'help' }, h('div', { class: 'help-head', text: help.headline || help.title }));
    for (const p of help.problems || []) {
      const [label, cls] = LEVEL[p.level] || LEVEL.must;
      box.append(h('div', { class: `help-problem ${p.level}` },
        h('div', null, h('span', { class: `pill ${cls}`, text: label }), ' ', h('strong', { text: p.say })),
        p.steps.length ? h('ol', null, p.steps.map(stepLine)) : null));
    }
    if (help.tip) box.append(h('p', { class: 'help-tip', text: `⏱ ${help.tip}` }));
    if (help.what) {
      const how = h('details', { class: 'help-how' },
        h('summary', { text: `How this step works — ${help.title}` }),
        h('p', { text: help.what }),
        help.why ? h('p', { class: 'muted', text: `Why: ${help.why}` }) : null,
        h('ol', null, (help.how || []).map(stepLine)),
        help.done ? h('p', { class: 'muted', text: `Done when: ${help.done}` }) : null);
      if (openHow || !(help.problems || []).length) how.setAttribute('open', '');
      box.append(how);
    }
    if ((help.ignore || []).length) box.append(h('p', { class: 'muted', text: `You can ignore: ${help.ignore.join(' ')}` }));
    return box;
  }

  /** A fix that is a command gets a Copy button; advice is just text. */
  const isCommand = (t) => /^(npm|npx|node|curl) /.test(t);
  const fixOf = (t) => (isCommand(t) ? cmdBox(t) : h('div', { class: 'fixnote', text: `→ ${t}` }));

  function cmdBox(text) {
    return h('div', { class: 'cmd' }, h('code', { text }), h('button', { onclick: () => copy(text) }, 'Copy'));
  }

  async function sign(code, step, note) {
    try {
      const r = await api(note === null ? '/api/unsignoff' : '/api/signoff', { code, step, note: note || '' });
      const i = S.data.authors.findIndex((a) => a.code === code);
      S.data.authors[i] = r.author;
      renderGrid();
      renderCanvas();
      openStep(code, step);
      toast(note === null ? 'Sign-off undone' : 'Signed off');
    } catch (err) {
      toast(err.message, 8000);
    }
  }

  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    S.open = null;
    renderCanvas();
  }

  /* -------------------------------------------------------------- health --- */

  function renderHealth() {
    const box = clear($('health'));
    const H = S.health;
    if (!H) return;
    $('health-badge').className = `badge ${H.overall}`;
    const say = { OK: 'Nothing has quietly broken.', WARN: 'Worth a look — nothing broken.', FAIL: 'Something is broken.' };
    box.append(h('div', { class: `banner st-${H.overall}`, text: `${HGLYPH[H.overall]} ${say[H.overall]}  Read ${when(H.generatedAt)}` }));
    box.append(h('div', { class: 'checks' }, H.rows.map((r) => h('div', { class: 'card' },
      h('div', { class: 'head' }, h('span', { class: `pill st-${r.status}`, text: `${HGLYPH[r.status]} ${r.status}` }), h('strong', { text: `${r.id} ${r.title}` })),
      h('div', { class: 'means', text: r.means }),
      h('div', { text: r.detail }),
      r.help ? h('div', { class: 'help-problem must' }, h('strong', { text: r.help.say }), h('ol', null, r.help.steps.map(stepLine))) : null,
      r.items.length ? h('ul', null, r.items.slice(0, 25).map((it) => h('li', { class: 'mono', text: it })), r.items.length > 25 ? h('li', { text: `…and ${r.items.length - 25} more` }) : null) : null,
      r.fix && r.status !== 'OK' ? fixOf(r.fix) : null))));

    const worst = (ids) => {
      const st = ids.map((id) => (H.rows.find((r) => r.id === id) || {}).status || 'SKIP');
      return ['FAIL', 'WARN', 'OK', 'SKIP'].find((x) => st.includes(x)) || 'SKIP';
    };
    box.append(h('div', { class: 'after' },
      h('h3', { text: 'After launch — checklist steps 17-25 (nothing per author, ever)' }),
      h('table', null, h('tbody', null, H.afterLaunch.map((s) => {
        const w = worst(s.checks);
        return h('tr', null,
          h('td', null, h('span', { class: `pill st-${w}`, text: `${HGLYPH[w]} ${s.id}` })),
          h('td', { text: s.title }),
          h('td', { class: 'muted', text: `watched by ${s.checks.join(' + ')}` }));
      })))));
  }

  /* -------------------------------------------------------------- canvas --- */

  function renderCanvasAuthors() {
    const sel = clear($('canvas-author'));
    for (const a of S.data.authors) sel.append(h('option', { value: a.code, selected: a.code === S.canvasCode }, `${a.code} ${a.name}`));
    if (!S.canvasCode && S.data.authors[0]) S.canvasCode = S.data.authors[0].code;
  }

  function renderCanvas() {
    if (!S.data || !window.PipelineCanvas) return;
    const a = authorOf(S.canvasCode) || S.data.authors[0];
    if (!a) return;
    window.PipelineCanvas.render($('canvas'), {
      author: a,
      steps: S.data.steps,
      labels: S.data.labels,
      health: S.health,
      selected: S.open && S.open.code === a.code ? S.open.step : null,
      onSelect: (id) => openStep(a.code, id),
      onSelectHealth: () => showTab('health'),
    });
  }

  /* ---------------------------------------------------------------- tabs --- */

  /* ------------------------------------------------------- the address bar --- */

  // Every view has its own address, so it can be bookmarked and Back/Forward work:
  //   /pipeline  /canvas  /health  /onboard
  //   /onboard/1002-freddy-davis      that author, at the step they are on
  //   /onboard/1002-freddy-davis/6    that author, at step 5
  // (A name or slug works too — /onboard/freddy — the server finds the author.)
  const TAB_PATH = { grid: 'pipeline', canvas: 'canvas', health: 'health', wizard: 'onboard', access: 'access' };
  const PATH_TAB = Object.fromEntries(Object.entries(TAB_PATH).map(([tab, path]) => [path, tab]));

  function navigate(path, { replace = false } = {}) {
    if (location.pathname === path && !location.hash) return;
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
  }

  /** Open the view the address bar names. True when it named one. */
  function routeFromPath() {
    const parts = location.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
    const tab = PATH_TAB[(parts[0] || '').toLowerCase()];
    if (!tab) return false;
    if (tab !== 'wizard') { showTab(tab); return true; }
    if (!parts[1]) { window.PipelineWizard.openNew({ fromAddress: true }); return true; }
    const code = /^(\d{4})(?:-|$)/.exec(parts[1]);
    const step = /^\d+$/.test(parts[2] || '') ? Number(parts[2]) : undefined;
    window.PipelineWizard.openAuthor(code ? code[1] : parts[1], step, { fromAddress: true });
    return true;
  }

  /** Deep links: #health, #canvas, #grid&step=1043:7 — bookmarkable, and how a screenshot reaches a view. */
  function followHash() {
    const parts = new URLSearchParams(location.hash.slice(1).replace(/^(grid|canvas|health|wizard|access)(&|$)/, 'tab=$1$2'));
    const tab = parts.get('tab');
    if (tab === 'wizard') {
      const code = parts.get('code');
      const step = parts.get('step');
      if (code) window.PipelineWizard.openAuthor(code, step === null ? undefined : Number(step));
      else window.PipelineWizard.openNew();
      return;
    }
    if (tab) showTab(tab);
    // Links may name the author instead of giving the code: #canvas&author=freddy, #grid&step=freddy:11
    const byName = (q) => {
      const w = String(q || '').toLowerCase();
      return authorOf(q) || S.data.authors.find((x) => x.name.toLowerCase().replace(/\s+/g, '-') === w || x.name.toLowerCase().split(/\s+/).includes(w));
    };
    const author = byName(parts.get('author'));
    if (author) { S.canvasCode = author.code; renderCanvasAuthors(); renderCanvas(); window.PipelineCanvas.fit($('canvas')); }
    const step = /^([^:]+):(\d+)$/.exec(parts.get('step') || '');
    const stepAuthor = step && byName(step[1]);
    if (stepAuthor) openStep(stepAuthor.code, Number(step[2]));
  }

  function showTab(name) {
    if (!['grid', 'canvas', 'health', 'wizard', 'access'].includes(name)) return;
    for (const t of document.querySelectorAll('.tab')) {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('active', p.id === `tab-${name}`);
    updateRefreshButton();
    if (name === 'canvas') window.PipelineCanvas && window.PipelineCanvas.fit($('canvas'));
    if (name === 'access') window.PipelineAccess.opened();
  }

  async function snapshot() {
    try {
      const snap = await api('/api/snapshot');
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `pipeline-snapshot-${snap.generatedAt.slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      toast('Snapshot downloaded — status only, no credentials');
    } catch (err) {
      toast(err.message, 8000);
    }
  }

  /* ---------------------------------------------------------------- boot --- */

  window.PipelineWizard.mount({
    api, h, clear, toast, copy, cmdBox, showTab, helpBox, navigate, shortWhen,
    labels: () => (S.data ? S.data.labels : null),
    // Each author's place in the pipeline, for the Onboard tab's author list.
    authorsState: () => (S.data ? S.data.authors : []),
    // After the wizard changes something, the grid loads again (the author it changed is read afresh).
    onChanged: () => load(null),
    // The Onboard tab opened, closed or switched author: the Refresh button follows.
    contextChanged: () => updateRefreshButton(),
  });
  // Edit a number / delete an author / the clean-up after (plan 05): its panels use this page's drawer.
  const manageDeps = {
    api, h, clear, toast, copy,
    load: (fresh) => load(fresh), closeDrawer, renderGrid,
    openAuthor: (code, step) => window.PipelineWizard.openAuthor(code, step),
    stepIdOf: (code, key) => { const a = authorOf(code); const s = a && a.steps.find((x) => x.key === key); return s ? s.id : undefined; },
    deleted: () => S.deleted,
    setDeleted: (r) => { S.deleted = { open: r.open || [], finished: r.finished || [] }; },
    actionsMeta: null,
  };
  window.PipelineManage.mount(manageDeps);
  window.PipelinePrototype.mount({ api, h, clear, toast });
  // Who has access (plan 07): the Access tab, and the grid's Access column + its side panel (the drawer).
  window.PipelineAccess.mount({
    api, h, clear, toast, shortWhen,
    showTab: (name) => { closeDrawer(); showTab(name); navigate(`/${TAB_PATH[name]}`); },
    showDrawer: (...kids) => { S.open = null; clear($('drawer-body')).append(...kids); $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); },
    onGridChange: () => { if (S.data) renderGrid(); },
    onSettings: (r) => { if (S.data) { S.data.settings = r.settings; S.data.reality = r.reality; } },
  });
  api('/api/actions').then((m) => { manageDeps.actionsMeta = m; }).catch(() => {});
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => {
      if (t.dataset.tab === 'wizard') return window.PipelineWizard.openNew();
      showTab(t.dataset.tab);
      navigate(`/${TAB_PATH[t.dataset.tab]}`);
    });
  }
  $('home').addEventListener('click', (e) => { e.preventDefault(); closeDrawer(); showTab('grid'); navigate('/'); window.scrollTo({ top: 0 }); });
  $('add-author').addEventListener('click', () => window.PipelineWizard.openNew());
  $('refresh').addEventListener('click', refreshClicked);
  $('snapshot').addEventListener('click', snapshot);
  $('drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  $('canvas-author').addEventListener('change', (e) => { S.canvasCode = e.target.value; renderCanvas(); window.PipelineCanvas.fit($('canvas')); });
  $('canvas-fit').addEventListener('click', () => window.PipelineCanvas.fit($('canvas'), { all: true }));
  // Back / Forward: show what the address now says.
  window.addEventListener('popstate', () => { closeDrawer(); if (!routeFromPath()) showTab('grid'); });
  if (!location.hash) routeFromPath();
  updateRefreshButton();
  load(null);
})();
