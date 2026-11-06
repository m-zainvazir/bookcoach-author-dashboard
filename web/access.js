/*
 * access.js — who has access (plan 07): the Access tab, and the Pipeline grid's Access column
 * with its side panel. Reads only — nothing here can change GHL, Shopify or Cloudflare.
 *
 * The page opens on the LAST reading (/api/access?saved=1, which never reads anything live);
 * GHL and Shopify are read only when you open the tab with nothing saved, or press "Read again".
 * Every value is rendered as text (textContent), never as HTML.
 */
(() => {
  'use strict';

  let A = null; // { api, h, clear, toast, shortWhen, showDrawer, onGridChange, onSettings }
  const X = { data: null, loading: null, sort: null, filter: { code: '', types: null, soon: false, q: '' } };
  const $ = (id) => document.getElementById(id);
  const TYPES = ['Paid', 'Trial', 'Gift', 'Staff', 'Test', 'Unknown'];
  const PILL = { Paid: 'acc-paid', Trial: 'acc-trial', Gift: 'acc-gift', Staff: 'acc-staff', Test: 'acc-test', Unknown: 'acc-unknown' };
  const COLUMNS = [
    { key: 'person', label: 'Person' },
    { key: 'code', label: 'Coach #' },
    { key: 'author', label: 'Author name' },
    { key: 'access', label: 'Access' },
    { key: 'daysLeft', label: 'Days left' },
    { key: 'since', label: 'Since' },
  ];
  const DEFAULT_SORT = { column: 'daysLeft', dir: 'asc' };
  const SORT_KEY = 'bookcoach.access.sort';

  // Remembered on this computer only; a blocked storage just means the default sort.
  const loadSort = () => {
    try { const s = JSON.parse(localStorage.getItem(SORT_KEY) || 'null'); if (s && COLUMNS.some((c) => c.key === s.column) && (s.dir === 'asc' || s.dir === 'desc')) return s; } catch { /* default */ }
    return { ...DEFAULT_SORT };
  };
  const saveSort = () => { try { localStorage.setItem(SORT_KEY, JSON.stringify(X.sort)); } catch { /* not kept */ } };

  function mount(deps) {
    A = deps;
    X.sort = loadSort();
  }

  /* --------------------------------------------------------------- loading --- */

  /** The last reading, read nothing live. For the grid column on page load. */
  async function loadSaved() {
    try {
      const r = await A.api('/api/access?saved=1');
      X.soonDays = r.soonDays || 5;
      if (!r.none) X.data = r;
    } catch { /* the column just shows "—" */ }
    A.onGridChange();
    if (isOpen()) render();
  }

  /** Read GHL and Shopify (refresh) — or the saved reading, if there is one. */
  async function read(refresh) {
    if (X.loading) return X.loading;
    X.loading = (async () => {
      render();
      try {
        const r = await A.api(`/api/access${refresh ? '?refresh=1' : ''}`);
        X.data = r;
        X.soonDays = r.soonDays || X.soonDays || 5;
        A.onGridChange();
        if (refresh) A.toast(`Access read: ${r.rows.length} access${r.rows.length === 1 ? '' : 'es'}, ${r.people} ${r.people === 1 ? 'person' : 'people'}`);
      } catch (err) {
        A.toast(`Could not read access: ${err.message}`, 8000);
      }
    })().finally(() => { X.loading = null; render(); });
    return X.loading;
  }

  const isOpen = () => { const p = $('tab-access'); return p && p.classList.contains('active'); };

  /** The tab opened: show it, and read live only when nothing was ever read. */
  function opened() {
    render();
    if (!X.data && !X.loading) read(false);
  }

  /* --------------------------------------------------------------- sorting --- */

  const lower = (x) => String(x || '').toLowerCase();
  function sorted(rows) {
    const { column, dir } = X.sort;
    const sign = dir === 'desc' ? -1 : 1;
    const text = (r) => ({ person: lower(r.email), code: r.code || 'zzzz', author: lower(r.author), access: r.access, since: r.since || '' })[column];
    const tie = (a, b) => (a.code || 'zzzz').localeCompare(b.code || 'zzzz') || lower(a.email).localeCompare(lower(b.email));
    return [...rows].sort((a, b) => {
      if (column === 'daysLeft') {
        const an = a.daysLeft === null || a.daysLeft === undefined;
        const bn = b.daysLeft === null || b.daysLeft === undefined;
        if (an !== bn) return an ? 1 : -1;
        if (!an && a.daysLeft !== b.daysLeft) return sign * (a.daysLeft - b.daysLeft);
        return tie(a, b);
      }
      return sign * String(text(a)).localeCompare(String(text(b))) || tie(a, b);
    });
  }

  /** Click: ▲, again: ▼, a third time: back to the default (Days left, soonest first). */
  function sortBy(column) {
    const s = X.sort;
    if (s.column !== column) X.sort = { column, dir: 'asc' };
    else if (s.dir === 'asc') X.sort = { column, dir: 'desc' };
    else X.sort = { ...DEFAULT_SORT };
    saveSort();
    render();
  }

  /* ------------------------------------------------------------ formatting --- */

  const dayMonth = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });
  };
  const since = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /** "6 days · 11 Nov", "ends today", "ended 3 Nov", "subscription", "—". */
  function daysText(r) {
    if (r.access === 'Paid') return { text: 'subscription', cls: 'muted' };
    if (r.daysLeft === null || r.daysLeft === undefined) return { text: r.access === 'Trial' || r.access === 'Gift' ? 'no date' : '—', cls: 'muted' };
    const end = r.endsAt ? ` · ${dayMonth(r.endsAt)}` : '';
    if (r.daysLeft < 0) return { text: `ended${end}`, cls: 'acc-ended' };
    if (r.daysLeft === 0) return { text: `ends today${end}`, cls: 'acc-soon' };
    const soon = r.daysLeft <= (X.soonDays || 5);
    return { text: `${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}${end}`, cls: soon ? 'acc-soon' : '' };
  }

  const pill = (access) => A.h('span', { class: `acc-pill ${PILL[access] || ''}`, text: access === 'Test' ? 'Test — remove' : access });

  /* ------------------------------------------------------------ the column --- */

  /** The Pipeline grid's Access cell for one author. */
  function gridCell(code) {
    const { h } = A;
    if (!X.data) return h('span', { class: 'muted', title: 'Not read yet — open the Access tab', text: '—' });
    const s = (X.data.summary || []).find((x) => x.code === code);
    if (!s || !s.total) return h('span', { class: 'muted', text: 'nobody yet' });
    const parts = TYPES.filter((t) => s[t]).map((t) => `${s[t]} ${t.toLowerCase()}`);
    return h('button', { class: 'link acc-cell', title: `Who has ${s.author}'s coach — read ${A.shortWhen(X.data.reading ? X.data.reading.at : '')}`, onclick: () => openPanel(code) }, `${parts.join(' · ')} ›`);
  }

  /** The side panel: one author's people. */
  function openPanel(code) {
    const { h } = A;
    if (!X.data) return;
    const s = (X.data.summary || []).find((x) => x.code === code) || { author: code, total: 0 };
    const rows = sorted(X.data.rows.filter((r) => r.code === code));
    A.showDrawer(
      h('h2', { text: `${code} ${s.author}` }),
      h('p', { class: 'muted', text: `${s.total} with access · read ${A.shortWhen(X.data.reading ? X.data.reading.at : '')}` }),
      rows.length ? h('div', { class: 'acc-panel' }, rows.map((r) => {
        const d = daysText(r);
        return h('div', { class: 'acc-prow' },
          h('div', { class: 'acc-pemail' }, r.ghlUrl ? h('a', { href: r.ghlUrl, target: '_blank', rel: 'noopener noreferrer', text: r.email || r.contactId }) : (r.email || r.contactId)),
          h('div', { class: 'acc-pmeta' }, pill(r.access), h('span', { class: d.cls, text: d.text })),
          r.note ? h('div', { class: 'muted small-note', text: r.note }) : null);
      })) : h('p', { class: 'muted', text: 'Nobody has this coach right now.' }),
      h('div', { class: 'wz-actions' },
        h('button', { class: 'primary', onclick: () => { X.filter.code = code; A.showTab('access'); } }, 'Open in the Access tab')));
  }

  /* --------------------------------------------------------------- the tab --- */

  function filtered(rows) {
    const f = X.filter;
    const q = lower(f.q).trim();
    return rows.filter((r) => (!f.code || r.code === f.code)
      && (!f.types || f.types.includes(r.access))
      && (!f.soon || ((r.access === 'Trial' || r.access === 'Gift') && r.daysLeft !== null && r.daysLeft <= X.soonDays))
      && (!q || lower(r.email).includes(q)));
  }

  async function saveSoonDays(raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 30) { A.toast('Ending soon: a whole number of days, 1 to 30'); render(); return; }
    try {
      const r = await A.api('/api/settings', { changes: { accessSoonDays: n } });
      X.soonDays = n;
      A.onSettings(r);
      A.toast(`Ending soon is now ${n} day${n === 1 ? '' : 's'}`);
    } catch (err) {
      A.toast(err.message, 8000);
    }
    render();
  }

  function render() {
    const box = $('access');
    if (!box || !A) return;
    const { h, clear } = A;
    clear(box);
    const D = X.data;
    const head = h('div', { class: 'acc-head' },
      h('div', null,
        h('h2', { text: 'Who has access' }),
        h('p', { class: 'muted', text: 'Everyone who can use a coach right now: from the coach tags in GHL, the paying subscriptions, and recent Shopify orders. Reads only.' })),
      h('div', { class: 'acc-tools' },
        D && D.reading ? h('span', { class: 'muted', text: `read ${A.shortWhen(D.reading.at)}` }) : null,
        h('button', { class: 'primary', disabled: !!X.loading, onclick: () => read(true) }, X.loading ? 'Reading…' : D ? 'Read again' : 'Read access now')));
    box.append(head);
    if (!D) {
      box.append(h('p', { class: 'muted', text: X.loading ? 'Reading GHL and Shopify… (a few seconds)' : 'Not read yet.' }));
      return;
    }
    if (D.ordersProblem) box.append(h('div', { class: 'note warn-note', text: `⚠ ${D.ordersProblem}.` }));

    // ---- per-author tiles: click one to show only that author ----
    const tiles = h('div', { class: 'acc-tiles' }, (D.summary || []).map((s) => h('button', {
      class: `acc-tile${X.filter.code === s.code ? ' on' : ''}`,
      title: X.filter.code === s.code ? 'Show every author again' : `Show only ${s.author}`,
      onclick: () => { X.filter.code = X.filter.code === s.code ? '' : s.code; render(); },
    },
    h('span', { class: 'acc-tname', text: `${s.code} ${s.author}` }),
    h('span', { class: 'acc-tcount' }, s.total
      ? [h('b', { text: String(s.Paid) }), ' paid · ', h('b', { text: String(s.Trial) }), ' trial', s.Gift ? ` · ${s.Gift} gift` : '', s.Staff ? ` · ${s.Staff} staff` : '', s.Test ? ` · ${s.Test} test` : '', s.Unknown ? ` · ${s.Unknown} unknown` : '']
      : h('span', { class: 'muted', text: 'nobody yet' })))));
    box.append(tiles);

    // ---- ending soon ----
    const soon = sorted(D.rows.filter((r) => (r.access === 'Trial' || r.access === 'Gift') && r.daysLeft !== null && r.daysLeft <= X.soonDays));
    const days = h('input', { id: 'acc-soon-days', type: 'number', min: '1', max: '30', value: String(X.soonDays), 'aria-label': 'Ending soon: days', onchange: (e) => saveSoonDays(e.target.value) });
    box.append(h('div', { class: 'card acc-soonbox' },
      h('div', { class: 'acc-soonhead' }, h('strong', { text: `Ending soon — ${soon.length}` }),
        h('label', { class: 'muted' }, 'Ending soon = ', days, ' days')),
      soon.length ? h('div', { class: 'acc-strip' }, soon.map((r) => {
        const d = daysText(r);
        const pct = Math.max(0, Math.min(100, Math.round((Math.max(r.daysLeft, 0) / (r.trialDays || 10)) * 100)));
        // The page's CSP refuses style="" attributes; a width set through the DOM is allowed.
        const fill = h('span', { class: `acc-fill${r.daysLeft <= 1 ? ' low' : ''}` });
        fill.style.width = `${pct}%`;
        return h('div', { class: 'acc-srow' },
          h('span', { class: 'acc-semail', text: r.email }),
          h('span', { text: `${r.code} ${r.author}` }),
          h('span', { class: 'acc-track', title: `${Math.max(r.daysLeft, 0)} of ${r.trialDays || 10} days left` }, fill),
          h('span', { class: d.cls, text: d.text }));
      })) : h('p', { class: 'muted', text: `No trial ends in the next ${X.soonDays} day${X.soonDays === 1 ? '' : 's'}.` })));

    // ---- filters ----
    const types = X.filter.types || TYPES;
    const chip = (label, on, fn, title) => h('button', { class: `acc-chip${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', title, onclick: fn }, label);
    box.append(h('div', { class: 'acc-filters' },
      h('select', { 'aria-label': 'Author', onchange: (e) => { X.filter.code = e.target.value; render(); } },
        h('option', { value: '' }, 'All authors'),
        (D.summary || []).map((s) => h('option', { value: s.code, selected: X.filter.code === s.code }, `${s.code} ${s.author}`))),
      TYPES.map((t) => chip(t, types.includes(t), () => {
        const next = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
        X.filter.types = next.length === TYPES.length ? null : next;
        render();
      }, types.includes(t) ? `Hide ${t}` : `Show ${t}`)),
      chip(`Ending in ${X.soonDays} days`, X.filter.soon, () => { X.filter.soon = !X.filter.soon; render(); }, 'Only trials ending soon'),
      h('input', { id: 'acc-search', type: 'search', placeholder: 'Search email…', value: X.filter.q, 'aria-label': 'Search email',
        oninput: (e) => { X.filter.q = e.target.value; renderTable(); } })));

    const tableBox = h('div', { id: 'acc-table', class: 'grid-wrap' });
    box.append(tableBox);
    renderTable();
    if (!D.giftChecked && !D.ordersProblem) box.append(h('p', { class: 'muted small-note', text: 'Gifts were not checked: no Shopify orders were read.' }));
  }

  /** Only the table — so typing in the search box keeps its focus. */
  function renderTable() {
    const box = $('acc-table');
    if (!box || !X.data) return;
    const { h, clear } = A;
    clear(box);
    const rows = sorted(filtered(X.data.rows));
    const { column, dir } = X.sort;
    const table = h('table', { class: 'acc-table' },
      h('thead', null, h('tr', null,
        COLUMNS.map((c) => {
          const on = c.key === column;
          return h('th', { 'aria-sort': on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' },
            h('button', { class: `acc-sort${on ? ' on' : ''}`, title: on ? (dir === 'asc' ? 'Click: sort the other way' : 'Click: back to Days left, soonest first') : `Sort by ${c.label}`, onclick: () => sortBy(c.key) },
              c.label, h('span', { class: 'acc-arrow', text: on ? (dir === 'asc' ? ' ▲' : ' ▼') : '' })));
        }),
        h('th', { text: '' }))),
      h('tbody', null, rows.map((r) => {
        const d = daysText(r);
        return h('tr', { class: r.access === 'Test' || r.access === 'Unknown' ? 'acc-flag' : '' },
          h('td', { class: 'mono' }, r.email || r.contactId, r.note ? h('div', { class: 'muted small-note', text: r.note }) : null),
          h('td', { class: 'num', text: r.code || 'all' }),
          h('td', { text: r.author }),
          h('td', null, pill(r.access)),
          h('td', { class: d.cls, text: d.text }),
          h('td', { text: since(r.since) }),
          h('td', null, r.ghlUrl ? h('a', { href: r.ghlUrl, target: '_blank', rel: 'noopener noreferrer', title: 'Open the contact in GHL' }, 'GHL ↗') : null));
      })));
    box.append(rows.length ? table : h('p', { class: 'muted', text: 'Nobody matches these filters.' }));
    box.append(h('p', { class: 'muted small-note', text: `${rows.length} of ${X.data.rows.length} shown · click a column to sort it, again for the other way, a third time for the default (Days left, soonest first).` }));
  }

  window.PipelineAccess = { mount, loadSaved, read, opened, render, gridCell, openPanel, isOpen };
})();
