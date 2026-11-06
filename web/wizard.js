/*
 * wizard.js — "Add author": the onboarding checklist, one step at a time.
 *
 * Asks for each input at the step that needs it, with Previous / Next. Before
 * step 3 the answers are a DRAFT (drafts.local.json); step 3 runs onboard.mjs,
 * which creates the author in coaches.json and GHL. After that, answers are
 * saved straight to coaches.json with `author set`.
 *
 * Step 2 is a form of its own: the coach page's answers in, the whole page out
 * (lib-pages.mjs) — it comes first, so it works on a draft too. The page file can hold the Voiceflow key, so this script
 * never sees it — "Copy" and "Open" ask the server to do that on this PC.
 *
 * Every real change is previewed first (a dry run) and then confirmed. All text
 * is rendered with textContent — never as HTML.
 */
(() => {
  'use strict';

  let A = null; // { api, h, clear, toast, copy, onChanged, labels }
  // pageDraft: the step-2 page answers as typed, kept across a re-render until a build succeeds.
  const W = { code: null, view: null, step: 0, job: null, poll: null, errors: {}, generated: null, actionsMeta: null, pageDraft: null, pageResult: null };
  const GLYPH = { DONE: '✓', READY: '▶', BLOCKED: '·', CONFIRM: '?', FAIL: '✗', OPTIONAL: '○' };
  const ROW = { DONE: 'done', TODO: 'to do', FAIL: 'wrong', WARN: 'note', MANUAL: 'confirm' };

  /* ------------------------------------------------- typed, not yet used --- */
  // What you type into a box survives every redraw — a Preview, a Refresh, moving between steps or
  // authors — and is marked until it is saved or used for real. Per author, in this browser tab only
  // (sessionStorage): a path or a link, never a credential (the key cannot be typed into the wizard).
  const TYPED_KEY = 'bookcoach-typed-v1';
  W.typed = (() => { try { return JSON.parse(sessionStorage.getItem(TYPED_KEY) || '{}') || {}; } catch (e) { return {}; } })();
  const typedFor = (code) => (W.typed[code] = W.typed[code] || {});
  const keepTyped = () => { try { sessionStorage.setItem(TYPED_KEY, JSON.stringify(W.typed)); } catch (e) { /* private window */ } };
  const sameValue = (a, b) => String(a === undefined || a === null ? '' : a) === String(b === undefined || b === null ? '' : b);
  function forgetTyped(code, keys) {
    const t = typedFor(code);
    for (const k of keys) delete t[k];
    keepTyped();
  }
  /** A box's saved value, as the box shows it. */
  const savedValue = (f) => (f.type === 'checkbox' ? !!f.value : f.value === undefined || f.value === null ? '' : f.value);
  /** Which of a step's boxes hold something typed that is not saved or used yet. */
  const pendingIn = (code, step) => step.fields.filter((f) => f.key in typedFor(code) && !sameValue(typedFor(code)[f.key], savedValue(f)));
  /** In plain words: what makes this box's value count. */
  function pendingText(f, s) {
    if (f.where === 'param') {
      const labels = s.actions.filter((a) => !/^(set|page|generate:|landing:|verify-email)/.test(a) && (f.card === 'gift' ? a === 'guest' : a !== 'guest')).map((a) => `"${((W.actionsMeta || {})[a] || { label: a }).label} — for real"`);
      return `Not used yet — it is used only when you press ${labels.join(' or ') || 'the button below'}. A Preview does not use it for real.`;
    }
    if (f.where === 'shared') return 'Not saved yet — press "Save the test inbox".';
    if (f.where === 'record' && W.view.exists) return 'Not saved yet — press "Save to coaches.json". Until then nothing uses it.';
    return 'Not saved yet — press "Save the draft" (or Next).';
  }
  const $ = (id) => document.getElementById(id);

  function mount(deps) {
    A = deps;
  }

  /* ------------------------------------------------------------- entry --- */

  async function openNew(opts = {}) {
    A.showTab('wizard');
    A.navigate('/onboard', { replace: !!opts.fromAddress });
    W.code = null;
    W.view = null;
    W.job = null;
    A.contextChanged();
    const box = A.clear($('wizard'));
    box.append(A.h('p', { class: 'muted', text: 'Loading…' }));
    try {
      renderLanding(await A.api('/api/wizard/start'));
    } catch (err) {
      A.toast(err.message, 8000);
    }
  }

  async function openAuthor(code, step, opts = {}) {
    A.showTab('wizard');
    W.code = String(code);
    W.job = null;
    W.generated = null;
    W.errors = {};
    W.pageDraft = null;
    W.pageResult = null;
    try {
      if (!W.actionsMeta) W.actionsMeta = await A.api('/api/actions');
      W.view = await A.api(`/api/wizard?code=${encodeURIComponent(W.code)}`);
      // A link may name the author ("freddy"); from here on, use the real code.
      W.code = W.view.code;
      W.step = Number.isInteger(step) && W.view.steps[step] ? step : (W.view.where ? W.view.where.id : 0);
      A.navigate(addressOf(W.step), { replace: !!opts.fromAddress });
      render();
    } catch (err) {
      A.toast(err.message, 8000);
    }
  }

  async function reload() {
    W.view = await A.api(`/api/wizard?code=${encodeURIComponent(W.code)}`);
    render();
  }

  /* ----------------------------------------------------------- landing --- */

  /* "What are you making?" — Final BookCoachAI (as always) or a Prototype Coach (plan 06).
     The last choice is remembered in this browser (localStorage): no file is written for it. */
  const MODE_KEY = 'bookcoach-add-mode';
  const getMode = () => { try { return localStorage.getItem(MODE_KEY) === 'prototype' ? 'prototype' : 'final'; } catch (e) { return 'final'; } };
  const setMode = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* private window: it just will not be remembered */ } };
  function modeField(start) {
    const { h } = A;
    const mode = getMode();
    const sel = h('select', { id: 'add-mode', 'aria-label': 'What are you making?', onchange: (e) => { setMode(e.target.value); renderLanding(start); } },
      h('option', { value: 'final', selected: mode === 'final' }, 'Final BookCoachAI'),
      h('option', { value: 'prototype', selected: mode === 'prototype' }, 'Prototype Coach'));
    return h('label', { class: 'field' }, h('span', { class: 'lbl', text: 'What are you making?' }), sel,
      h('span', { class: 'help', text: 'Remembers your last choice.' }));
  }

  async function renderPrototypeLanding(start) {
    const { h } = A;
    const box = A.clear($('wizard'));
    const [form, list] = await window.PipelinePrototype.cards(modeField(start), () => renderLanding(start));
    A.clear(box).append(h('div', { class: 'wz-landing' }, form, list));
  }

  function renderLanding(start) {
    const { h } = A;
    if (getMode() === 'prototype') { renderPrototypeLanding(start).catch((err) => A.toast(err.message, 8000)); return; }
    const box = A.clear($('wizard'));
    const code = h('input', { value: start.suggestedCode, inputmode: 'numeric', maxlength: 4, 'aria-label': 'coach code', class: 'code-input' });
    box.append(h('div', { class: 'wz-landing' },
      h('div', { class: 'card' },
        h('h2', { text: 'Add a new author' }),
        modeField(start),
        h('p', { class: 'muted', text: 'The wizard walks the onboarding checklist one step at a time. The coach page comes first (step 2); nothing is created in GHL until step 3, and every real change is previewed and confirmed first.' }),
        h('label', { class: 'field' }, h('span', { class: 'lbl', text: 'Coach code' }), code,
          h('span', { class: 'help', text: `The next free number is ${start.suggestedCode}. Four digits — a caller can key it on a phone.` })),
        h('button', { class: 'primary', onclick: () => {
          if (!/^\d{4}$/.test(code.value)) return A.toast('The coach code is four digits');
          // A number a deleted author had is allowed, but only after reading why it is risky (plan 05).
          const warn = (start.reuseWarnings || {})[code.value];
          if (warn && !window.confirm(warn)) return;
          openAuthor(code.value, 0);
        } }, 'Start →')),
      start.drafts.length ? h('div', { class: 'card' },
        h('h3', { text: 'Drafts — not created yet' }),
        h('ul', { class: 'wz-list' }, start.drafts.map((d) => h('li', null,
          h('span', { text: `${d.code} ${d.name || '(no name yet)'}` }),
          h('span', { class: 'muted', text: d.updatedAt ? ` — saved ${new Date(d.updatedAt).toLocaleString()}` : '' }),
          h('button', { onclick: () => openAuthor(d.code, 0) }, 'Continue'),
          h('button', { class: 'ghost', onclick: () => discard(d.code) }, 'Discard'))))) : null,
      h('div', { class: 'card' },
        h('h3', { text: 'Continue an existing author' }),
        h('ul', { class: 'wz-list' }, start.authors.map((a) => h('li', null,
          h('span', { text: `${a.code} ${a.name}` }),
          h('button', { onclick: () => openAuthor(a.code) }, 'Open'))))),
    ));
  }

  async function discard(code) {
    if (!window.confirm(`Discard the draft for ${code}? Nothing was created yet, so nothing else changes.`)) return;
    await A.api('/api/wizard/discard', { code });
    A.toast('Draft discarded');
    openNew();
  }

  /* ------------------------------------------------------------ wizard --- */

  /** A step's state for the side list: live when the author exists, else from the draft. */
  function stateOf(s) {
    const v = W.view;
    if (s.live) return s.live.state === 'DONE' && s.live.warn ? 'WARN' : s.live.state;
    if (v.exists) return 'BLOCKED';
    // By step key (steps.mjs), never by number.
    if (s.key === 'inputs') return ['displayName', 'bookTitle', 'coachLabel', 'slug'].every((k) => v.values[k]) ? 'DONE' : 'READY';
    if (s.key === 'voiceflow') return v.values.versionID ? 'DONE' : 'READY';
    // The coach page, before the author exists: done once it is published at its address.
    if (s.key === 'coachPage') return v.page && v.page.live === 200 ? 'DONE' : v.values.versionID && v.values.slug ? 'READY' : 'BLOCKED';
    if (s.key === 'ghl') return v.missingForCreate.length ? 'BLOCKED' : 'READY';
    return s.optional ? 'OPTIONAL' : 'BLOCKED';
  }

  function render() {
    const { h } = A;
    const v = W.view;
    const s = v.steps[W.step];
    const box = A.clear($('wizard'));
    A.contextChanged();

    const side = h('nav', { class: 'wz-steps', 'aria-label': 'Steps' },
      h('div', { class: 'wz-who' },
        h('strong', { text: `${v.code} ${v.name || 'New author'}` }),
        h('span', { class: 'muted', text: v.exists ? 'in coaches.json' : 'draft — created at step 3' }),
        // How old what this page shows is: "Refresh this author" (top right) reads it again.
        v.reading ? h('span', { class: `muted wz-read${v.reading.oldChecks ? ' old' : ''}`, title: 'When this author was last read from the live systems. "Refresh this author" (top right) reads it again.', text: `read ${A.shortWhen(v.reading.at)}${v.reading.oldChecks ? ' · checks updated since' : ''}` }) : null),
      v.steps.map((x) => {
        const st = stateOf(x);
        return h('button', { class: `wz-step${x.id === W.step ? ' on' : ''}`, onclick: () => go(x.id) },
          h('span', { class: `pill st-${st === 'WARN' ? 'DONE warn' : st}`, text: st === 'WARN' ? '!' : GLYPH[st] }),
          h('span', { text: `${x.id} ${x.title}` }),
          pendingIn(v.code, x).length ? h('span', { class: 'typed-mark', title: 'You typed something here that is not saved or used yet', text: '✎' }) : null);
      }),
      h('button', { class: 'ghost wz-back', onclick: openNew }, '← All authors'));

    const panel = h('section', { class: 'wz-panel' });
    const st = stateOf(s);
    panel.append(
      h('div', { class: 'muted', text: `Step ${s.id} of ${v.steps.length - 1} · ${s.platform} · ${s.kind}` }),
      h('h2', { text: s.long }),
      h('div', { class: 'meta' }, h('span', { class: `pill st-${st === 'WARN' ? 'DONE warn' : st}`, text: `${st === 'WARN' ? '!' : GLYPH[st]} ${labelOf(st)}` })),
    );
    if (s.needsAuthor) panel.append(h('p', { class: 'note warn-note', text: 'This step needs the author to exist. Finish step 3 first — you can still read what it will ask for.' }));
    // Plain words first: what is wrong and how to fix it, then how the step works.
    if (s.help) panel.append(A.helpBox(s.help, { openHow: !s.live || s.live.state === 'READY' }));

    if (s.info.length) {
      panel.append(h('h3', { text: 'What you need for this step' }));
      for (const it of s.info) {
        panel.append(h('div', { class: 'wz-info' }, h('div', { class: 'lbl', text: it.label }),
          it.copy ? A.cmdBox(it.value) : h('div', { text: it.value })));
      }
    }

    // ---- the inputs ----
    const inputs = {};
    const typed = typedFor(v.code);
    const banner = h('div', { class: 'note warn-note typed-banner', hidden: true });
    const showBanner = () => {
      const open = pendingIn(v.code, s);
      banner.hidden = !open.length;
      banner.textContent = open.length ? `✎ Typed here but not saved or used yet: ${open.map((f) => f.label.replace(/\s*\(.*\)$/, '')).join(' · ')}. It stays in the box until you save it or use it.` : '';
    };
    const giftFields = []; // fields marked card:'gift' go into their own card below the buttons
    if (s.fields.some((f) => !f.card)) panel.append(h('h3', { text: 'Your answers' }));
    if (s.fields.length) {
      panel.append(banner);
      for (const f of s.fields) {
        const saved = savedValue(f);
        if (f.key in typed && sameValue(typed[f.key], saved)) delete typed[f.key];
        const shown = f.key in typed ? typed[f.key] : saved;
        let el;
        if (f.type === 'checkbox') el = h('input', { type: 'checkbox', checked: !!shown });
        else if (f.type === 'lines') el = h('textarea', { rows: 3, placeholder: 'Title|https://…' }, shown || '');
        else if (f.type === 'author') {
          el = h('select', null, h('option', { value: '' }, '— pick an author —'),
            v.authors.map((a) => h('option', { value: a.code, selected: String(shown) === a.code }, `${a.code} ${a.name}${a.hasLanding ? '' : ' (no sales page recorded)'}`)));
        } else {
          el = h('input', { value: shown || '', placeholder: f.placeholder || '', 'aria-label': f.label });
          if (f.key === 'code') el.setAttribute('inputmode', 'numeric');
        }
        const locked = f.readOnly || s.needsAuthor;
        if (locked) el.setAttribute('disabled', '');
        inputs[f.key] = el;
        const err = W.errors[f.key];
        const pending = h('span', { class: 'pending-note', hidden: true });
        const mark = () => {
          const open = f.key in typed && !sameValue(typed[f.key], saved);
          pending.hidden = !open;
          pending.textContent = open ? `✎ ${pendingText(f, s)}` : '';
        };
        if (!locked && f.key !== 'code') {
          const keep = () => {
            const now = el.type === 'checkbox' ? el.checked : el.value;
            if (sameValue(now, saved)) delete typed[f.key]; else typed[f.key] = now;
            keepTyped();
            mark();
            showBanner();
          };
          el.addEventListener('input', keep);
          el.addEventListener('change', keep);
        }
        mark();
        (f.card === 'gift' ? { append: (x) => giftFields.push(x) } : panel).append(h('label', { class: `field${err ? ' bad' : ''}` },
          h('span', { class: 'lbl', text: `${f.label}${f.required ? ' *' : ''}${f.key === 'code' ? ' (chosen when you started)' : f.readOnly ? ' (fixed once created)' : ''}` }), el,
          pending,
          h('span', { class: 'help', text: err || f.help || '' })));
      }
      showBanner();
    }
    // Step 0 of a new author: the slug and the coach label fill themselves in.
    if (s.key === 'inputs' && !v.exists) autoFill(inputs);
    // A reminder for what no API can do (e.g. publishing the Course360 Offer), right under the answers.
    if (s.reminder) panel.append(h('div', { class: 'note reminder-note' }, h('strong', { text: '⚠ Before you go on: ' }), s.reminder));

    // ---- step 0 (Inputs): where you stand — ticks itself from what is saved; tick or untick by hand.
    // By step NAME, so a reorder cannot move it. (It sat on step 1 for a day — a slip, 2026-10-06.)
    if (s.title === 'Inputs' && Array.isArray(v.checklist)) panel.append(checklistBox(v.checklist));

    // ---- the coach page form (a draft too — the page comes first) ----
    if (s.key === 'coachPage' && v.page) panel.append(pageForm());

    // ---- what this step can do ----
    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
    const buttons = h('div', { class: 'wz-actions' });
    for (const a of s.actions.filter((x) => x !== 'guest')) buttons.append(...actionButtons(a, s, values));
    if (buttons.childNodes.length) {
      panel.append(h('h3', { text: 'Do it' }));
      if (s.actions.includes('course360')) panel.append(h('p', { class: 'note reminder-note' }, h('strong', { text: '⚠ ' }), 'Before pressing the button make sure you have cloned a course.'));
      panel.append(buttons);
    }
    if (s.actions.includes('guest')) {
      const gift = h('div', { class: 'wz-gift' },
        h('h3', { text: 'Give a real person free access — not a test' }),
        h('p', { class: 'muted', text: 'A gift for someone who should not pay. The test above uses your own inbox and cleans up after itself. This one is for a real person: their contact is kept.' }),
        ...giftFields,
        h('div', { class: 'wz-actions' }, ...actionButtons('guest', s, values)));
      panel.append(gift);
    }
    if (s.key === 'ghl' && !v.exists && v.missingForCreate.length) panel.append(h('p', { class: 'muted', text: `Still needed before the author can be created: ${v.missingForCreate.join(', ')} (steps 0 and 1).` }));

    if (W.generated && W.generated.step === s.id) {
      const g = W.generated;
      panel.append(h('div', { class: 'wz-gen' },
        h('div', { class: 'lbl', text: `Saved on this computer in ${g.folder}` }),
        h('ul', null, g.files.map((f) => h('li', { class: 'mono', text: `${f.name}  (${f.bytes} bytes)` }))),
        A.cmdBox(g.text)));
    }
    if (W.job && W.job.code === v.code) panel.append(jobBox(W.job));

    // ---- what the live systems say ----
    if (s.live && s.live.rows.length) {
      panel.append(h('h3', { text: 'Technical details — what the live systems say' }));
      panel.append(h('ul', { class: 'rows' }, s.live.rows.map((r) => h('li', null,
        h('div', null, h('span', { class: `pill st-${r.status === 'MANUAL' && r.signed ? 'DONE' : r.status}`, text: r.status === 'MANUAL' ? (r.signed ? 'signed off' : 'confirm') : ROW[r.status] || r.status }), ' ',
          h('span', { class: 'check', text: r.check })),
        r.detail ? h('div', { class: 'detail', text: r.detail }) : null))));
      if (s.live.unsigned.length) {
        const note = h('textarea', { rows: 2, placeholder: 'What you checked (optional)' });
        panel.append(h('div', { class: 'signoff' },
          h('div', { text: 'Only you can confirm:' }),
          h('ul', null, s.live.unsigned.map((c) => h('li', { text: c }))),
          note, h('button', { class: 'primary', onclick: () => signoff(s.id, note.value) }, 'Sign off')));
      } else if (s.live.signoff && s.live.rows.some((r) => r.status === 'MANUAL')) {
        // As the Pipeline tab does: an old sign-off whose manual check is gone (e.g. Course360's, read by API
        // since 2026-10-13) is not shown — it covers nothing any more.
        panel.append(h('div', { class: 'signed' },
          h('div', { text: `Signed off ${new Date(s.live.signoff.at).toLocaleString()}${s.live.signoff.note ? ` — ${s.live.signoff.note}` : ''}` }),
          // Changed your mind, or signed the wrong step: take it back.
          h('button', { class: 'ghost', onclick: () => unsignoff(s.id) }, 'Undo sign-off')));
      }
    }

    // ---- previous / next ----
    panel.append(h('div', { class: 'wz-nav' },
      h('button', { disabled: W.step === 0, onclick: () => go(W.step - 1) }, '← Previous'),
      h('span', { class: 'muted', text: `${W.step + 1} / ${v.steps.length}` }),
      h('button', { class: 'primary', disabled: W.step === v.steps.length - 1, onclick: () => next(s, values) }, 'Next →')));

    box.append(h('div', { class: 'wz' }, rosterNav(), side, panel));
  }

  /* Same rules as lib-wizard.mjs suggestSlug / suggestLabel. */
  const slugFrom = (name) => name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const labelFrom = (name, book) => (name.trim() && book.trim() ? `${name.trim()} – ${book.trim()}` : '');

  /**
   * The page slug follows the author's name, and the coach label follows
   * "<Author> – <Book title>", for as long as you have not typed your own.
   * Both stay editable; emptying one makes it follow again.
   */
  function autoFill(inputs) {
    const { displayName: name, bookTitle: book, slug, coachLabel: label } = inputs;
    if (!name || !book || !slug || !label) return;
    const rules = [[slug, () => slugFrom(name.value)], [label, () => labelFrom(name.value, book.value)]];
    for (const [el, make] of rules) {
      // A saved draft still holding the suggestion keeps following it.
      el.dataset.auto = !el.value || el.value === make() ? '1' : '0';
      el.addEventListener('input', () => { el.dataset.auto = el.value ? '0' : '1'; });
    }
    const update = () => { for (const [el, make] of rules) if (el.dataset.auto === '1') el.value = make(); };
    name.addEventListener('input', update);
    book.addEventListener('input', update);
    update();
  }

  /* ------------------------------------------------------- the author list --- */

  /**
   * Every author and draft, beside the steps: one click switches author and keeps
   * the step, so step 7 can be compared across authors. Each shows where it is,
   * from the Pipeline's own reading (A.authorsState) — when that refreshes, only
   * this list is redrawn (updateRoster), never the form being typed in.
   */
  function rosterNav() {
    const { h } = A;
    const v = W.view;
    const live = Object.fromEntries((A.authorsState() || []).map((a) => [a.code, a]));
    const labels = A.labels() || {};
    return h('nav', { class: 'wz-roster', 'aria-label': 'Authors' },
      h('div', { class: 'wz-roster-head', text: 'Authors' }),
      (v.roster || []).map((a) => {
        const l = live[a.code];
        const st = a.draft ? 'BLOCKED' : l ? (l.where ? (l.where.state === 'DONE' ? 'DONE' : l.where.state) : 'DONE') : null;
        const tip = a.draft ? 'a draft — not created yet' : l ? (l.where ? `step ${l.where.id} ${l.where.title} — ${labels[l.where.state] || l.where.state}` : 'every step done') : '';
        return h('button', { class: `wz-author${a.code === v.code ? ' on' : ''}`, title: tip, 'aria-current': a.code === v.code ? 'true' : null, onclick: () => switchAuthor(a.code) },
          h('span', { class: `pill st-${st || 'BLOCKED'}`, text: a.draft ? '✎' : st ? GLYPH[st] : '·' }),
          h('span', { class: 'wz-author-name' }, h('span', { text: a.name }), h('span', { class: 'muted', text: a.draft ? `${a.code} · draft` : a.code })));
      }),
      h('button', { class: 'ghost wz-back', onclick: openNew }, '+ Add author'));
  }

  /** Same step, another author. */
  function switchAuthor(code) {
    if (code === W.code) return;
    openAuthor(code, W.step);
  }

  /** The Pipeline re-read: refresh the author list's marks, leave everything else alone. */
  function updateRoster() {
    const old = document.querySelector('#wizard .wz-roster');
    if (old && W.view) old.replaceWith(rosterNav());
  }

  const labelOf = (st) => (st === 'WARN' ? 'done, with a note' : (A.labels() || {})[st] || st.toLowerCase());

  /** This author's address at a step: /onboard/1002-freddy-davis/6 (a draft with no slug yet: /onboard/1099/0). */
  const addressOf = (step) => `/onboard/${W.view.code}${W.view.values && W.view.values.slug ? `-${W.view.values.slug}` : ''}/${step}`;

  function go(step) {
    W.step = Math.max(0, Math.min(step, W.view.steps.length - 1));
    A.navigate(addressOf(W.step), { replace: true });
    W.errors = {};
    render();
    window.scrollTo({ top: 0 });
  }

  /** Next saves this step's answers first — a step's draft answers are not lost by moving on. */
  async function next(s, values) {
    // Before the author exists, Inputs and the Voiceflow IDs are kept in the draft.
    if (!W.view.exists && (s.key === 'inputs' || s.key === 'voiceflow')) {
      const ok = await saveDraft(s, values());
      if (!ok) return;
    }
    go(W.step + 1);
  }

  /* ------------------------------------- step 0 (Inputs): where you stand --- */

  const CHECK_NOTE = {
    auto: (it) => `✓ ticked automatically — ${it.why}`,
    you: () => 'ticked by you',
    unticked: (it) => `unticked by you — the dashboard still sees: ${it.why}`,
  };

  /** lib-checklist.mjs: each item ticks itself when its thing is saved; a person can tick or untick any. */
  function checklistBox(items) {
    const { h } = A;
    return h('div', { class: 'wz-checklist' },
      h('h3', { text: 'Where you stand' }),
      h('p', { class: 'muted', text: 'Ticks itself when the dashboard can see something is saved. You can tick or untick anything yourself.' }),
      h('ul', null, items.map((it) => {
        const box = h('input', { type: 'checkbox', checked: it.checked, 'aria-label': it.label });
        box.addEventListener('change', () => setCheck(it, box));
        return h('li', null,
          h('label', { class: 'check' }, box, ' ', h('span', { class: 'lbl', text: it.label })),
          it.source ? h('div', { class: `muted check-note ${it.source}`, text: CHECK_NOTE[it.source](it) }) : null);
      })));
  }

  async function setCheck(it, box) {
    const want = box.checked;
    // A soft warning before overruling the dashboard — then the person's choice wins.
    if (!want && it.source === 'auto' && !window.confirm(`"${it.label}" was ticked automatically, because ${it.why}.\n\nUntick it anyway?`)) {
      box.checked = true;
      return;
    }
    try {
      const r = await A.api('/api/wizard/checklist', { code: W.view.code, key: it.key, value: want });
      W.view.checklist = r.checklist;
      render();
    } catch (err) {
      box.checked = !want;
      A.toast(err.message, 6000);
    }
  }

  /* ------------------------------------------- step 2: the coach page form --- */

  /** The page's answers in, the whole page out — saved on this computer. */
  function pageForm() {
    const { h } = A;
    const v = W.view;
    const pg = v.page;
    const typed = W.pageDraft && W.pageDraft.code === v.code ? W.pageDraft.values : null;
    const box = h('div', { class: 'wz-page' },
      h('h3', { text: 'Build the coach page' }),
      h('p', { class: 'muted', text: 'Every coach page is the same code — only these answers change. Check them and press "Save and build the page". The whole page is made for you and saved on this computer; you never edit code by hand.' }));

    box.append(h('div', { class: 'wz-fixed' },
      h('div', { class: 'lbl', text: 'Filled in for you' }),
      pg.fixed.map((x) => h('div', { class: 'wz-fixed-row' }, h('span', { class: 'muted', text: x.label }),
        h('span', { class: 'wz-fixed-val' }, h('span', { class: 'mono', text: String(x.value) }),
          Number.isInteger(x.step) ? h('button', { class: 'ghost small', title: 'Change it there and press Save — then come back here and build the page again', onclick: () => go(x.step) }, `Change at step ${x.step} →`) : null)))));

    const inputs = {};
    let toggles = null; // the four on/off switches share one group, where the first one falls
    for (const f of pg.fields) {
      const value = typed && f.key in typed ? typed[f.key] : f.value;
      if (f.type === 'toggle') {
        if (!toggles) {
          toggles = h('div', { class: 'wz-toggles' });
          box.append(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Buttons on the page' }), toggles,
            h('span', { class: 'help', text: 'Turn each one on or off, then press "Save and build the page".' })));
        }
        const sw = h('button', { type: 'button', class: `toggle${value ? ' on' : ''}`, role: 'switch', 'aria-checked': value ? 'true' : 'false', 'aria-label': f.label });
        sw.addEventListener('click', () => {
          const on = sw.getAttribute('aria-checked') !== 'true';
          sw.setAttribute('aria-checked', on ? 'true' : 'false');
          sw.classList.toggle('on', on);
        });
        inputs[f.key] = sw;
        const err = W.errors[f.key];
        toggles.append(h('div', { class: `switch${err ? ' bad' : ''}` }, sw,
          h('div', { class: 'text' }, h('span', { class: 'name', text: f.label }), h('span', { class: 'detail', text: err || f.help || '' }))));
        continue;
      }
      let el;
      if (f.type === 'checkbox') el = h('input', { type: 'checkbox', checked: !!value });
      else if (f.type === 'lines') el = h('textarea', { rows: 3, placeholder: f.placeholder || '' }, value || '');
      else if (f.type === 'select') el = h('select', { 'aria-label': f.label }, f.options.map(([val, label]) => h('option', { value: val, selected: value === val }, label)));
      else el = h('input', { value: value || '', placeholder: f.placeholder || '', 'aria-label': f.label });
      inputs[f.key] = el;
      const err = W.errors[f.key];
      const where = f.where === 'record' ? (v.exists ? ' · saved in coaches.json' : ' · kept with the draft; step 3 saves it in coaches.json') : '';
      box.append(f.type === 'checkbox'
        ? h('div', { class: `field${err ? ' bad' : ''}` }, h('label', { class: 'check' }, el, ' ', h('span', { class: 'lbl', text: f.label })), h('span', { class: 'help', text: err || f.help || '' }))
        : h('label', { class: `field${err ? ' bad' : ''}` }, h('span', { class: 'lbl', text: f.label }), el, err || f.help ? h('span', { class: 'help', text: err || `${f.help}${where}` }) : null));
    }
    if (!pg.keyAvailable) box.append(h('p', { class: 'note warn-note', text: 'There is no Voiceflow key in coaches.json, so untick "Put the Voiceflow key in the page" — the page will then work through the coach router only, with no backup.' }));
    if (!pg.templateReady) box.append(h('p', { class: 'note warn-note', text: 'The master page (templates/coach-page.template.html) is missing, so nothing can be built.' }));

    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k,
      el.getAttribute('role') === 'switch' ? el.getAttribute('aria-checked') === 'true' : el.type === 'checkbox' ? el.checked : el.value]));
    const busy = W.job && W.job.status === 'running';
    const build = h('button', { class: 'primary', disabled: busy || !pg.templateReady, onclick: () => buildPage(values(), build) }, 'Save and build the page');
    box.append(h('div', { class: 'wz-actions' }, build));

    // ---- the file, and what to do with it ----
    const f = pg.file;
    const r = W.pageResult && W.pageResult.code === v.code ? W.pageResult : null;
    const where = `${f.folder}\\${f.name}`;
    box.append(h('div', { class: 'wz-gen' },
      h('div', { class: 'lbl', text: f.exists ? 'The page file' : 'Not built yet — it will be saved as' }),
      h('div', { class: 'mono', text: where }),
      f.exists && f.builtAt ? h('div', { class: 'muted', text: `Last built ${new Date(f.builtAt).toLocaleString()}` }) : null,
      r ? h('ul', null,
        h('li', { text: `Built: ${r.built.name}, ${Math.round(r.built.bytes / 1024)} KB.` }),
        r.saved.length ? h('li', { text: `Saved to ${r.savedTo || 'coaches.json'}: ${r.saved.join(', ')}.` }) : null,
        r.built.backup ? h('li', { text: `The previous version was kept as ${r.built.backup}.` }) : null,
        h('li', { text: r.built.includesKey ? 'It holds the Voiceflow key (for the backup), so it stays on this computer — never commit it.' : 'It holds no Voiceflow key: the page works through the coach router only.' })) : null,
      h('div', { class: 'wz-actions' },
        h('button', { class: 'primary', disabled: !f.exists, onclick: () => openPage('copy') }, 'Copy the whole page'),
        h('button', { disabled: !f.exists, onclick: () => openPage('notepad') }, 'Open in Notepad'),
        h('button', { disabled: !f.exists, onclick: () => openPage('folder') }, 'Show in folder')),
      h('p', { class: 'muted', text: `Then, in GHL: Sites → Websites → the ${pg.publishAt || 'coach'} page → its Custom Code element → click inside → Ctrl+A, Ctrl+V → Save → Publish. Press Refresh afterwards: this step turns green when the live page matches.` })));
    return box;
  }

  async function buildPage(vals, btn) {
    W.pageDraft = { code: W.view.code, values: vals };
    btn.disabled = true;
    btn.textContent = 'Saving and building…';
    try {
      const r = await A.api('/api/wizard/page', { code: W.view.code, values: vals });
      W.errors = {};
      W.pageResult = { ...r, code: W.view.code };
      if (r.job) W.job = r.job;
      W.pageDraft = null;
      A.toast(`Built ${r.built.name}${r.saved.length ? ` and saved ${r.saved.join(', ')} to ${r.savedTo || 'coaches.json'}` : ''}. Now press "Copy the whole page".`, 7000);
      await reload();
      A.onChanged();
    } catch (err) {
      W.errors = err.problems || {};
      if (err.job) W.job = err.job;
      render();
      A.toast(err.message, 8000);
    }
  }

  async function openPage(how) {
    try {
      const r = await A.api('/api/wizard/page/open', { code: W.view.code, how });
      A.toast(r.said, 6000);
    } catch (err) {
      A.toast(err.message, 8000);
    }
  }

  /* ------------------------------------------ Generate Landing Pages --- */

  /**
   * The Zipify step (sales text) and the collection step (collection text). The words are
   * written by Claude Code — by the button when the "Landing pages" switch is on, or by
   * pasting the prompt into any chat — and the dashboard builds the page from them.
   */
  function landingBox(kind) {
    const { h } = A;
    const v = W.view;
    const L = v.landing || {};
    const st = (L.status && L.status[kind]) || {};
    const what = kind === 'sales' ? 'the sales page text (3 boxes)' : 'the collection text (2 boxes)';
    const made = st.exists ? `Made ${A.shortWhen(st.builtAt)} — ${st.file}` : 'Not made yet for this author.';
    return h('div', { class: 'wz-gen wz-landing' },
      h('div', { class: 'lbl', text: `Generate Landing Pages — ${what}` }),
      h('div', { class: 'muted', text: made }),
      h('div', { class: 'wz-actions' },
        L.on ? h('button', { class: 'primary', disabled: !v.exists, onclick: () => landing(kind, 'claude') }, 'Generate with Claude Code') : null,
        h('button', { onclick: () => A.copy(L.prompts ? L.prompts[kind] : '') }, 'Copy the prompt'),
        h('button', { disabled: !st.exists, onclick: () => landing(kind, 'open') }, 'Open the page'),
        st.answers ? h('button', { class: 'ghost', title: 'Builds the page again from its answers file — after you or Claude changed the words', onclick: () => landing(kind, 'build') }, 'Rebuild from its answers') : null,
        h('button', { class: 'ghost', disabled: !st.exists, onclick: () => landing(kind, 'folder') }, 'Show in folder')),
      h('p', { class: 'muted small-note', text: L.on
        ? `"Generate" opens a new Claude Code window (${L.model}, ${L.effort} effort). It reads the book from the Voiceflow coach, writes the words and builds the page${kind === 'collection' ? ' — it will ask you to paste the two pieces of text' : ''}. Answer it there if it asks. Then "Open the page" and use its Copy buttons.`
        : 'Paste the prompt into any Claude Code chat. For a one-click button, switch "Landing pages" on (Pipeline tab, the switches at the top).' }));
  }

  async function landing(kind, how) {
    try {
      const r = await A.api('/api/wizard/landing', { code: W.view.code, kind, how });
      A.toast(r.said, 8000);
      if (how === 'build') await reload();
    } catch (err) {
      A.toast(err.message, 8000);
    }
  }

  /* ----------------------------------------------------------- actions --- */

  function actionButtons(action, s, values) {
    const { h } = A;
    const v = W.view;
    const busy = W.job && W.job.status === 'running';
    if (action === 'page') return []; // the coach page has its own form and buttons (pageForm)
    if (action.startsWith('landing:')) return [landingBox(action.split(':')[1])];
    if (action === 'set') {
      return [h('button', { class: 'primary', disabled: busy || s.needsAuthor || !s.fields.some((f) => f.where === 'record' && !f.readOnly) && v.exists,
        onclick: () => (v.exists ? saveRecord(s, values()) : saveDraft(s, values())) }, v.exists ? 'Save to coaches.json' : 'Save the draft')];
    }
    if (action.startsWith('generate:')) {
      const kind = action.split(':')[1];
      // Nothing here is created in GHL or Zipify. (Course360 is: by its own action, course360.)
      // Zipify's list is new work; the grant-workflow and funnel notes are the same as on screen, as a file.
      if (kind === 'zipify') return [h('button', { disabled: !v.exists, onclick: () => generateFiles(kind, values()) }, 'Make the find-and-replace list')];
      return [h('button', { class: 'ghost', disabled: !v.exists, title: 'Saves the notes above as a text file on this computer. It does not create anything in GHL.', onclick: () => generateFiles(kind, values()) }, 'Save these notes as a file (optional)'),
        h('span', { class: 'muted small-note', text: 'Creates nothing in GHL — everything you need is above, with Copy buttons.' })];
    }
    const meta = (W.actionsMeta || {})[action] || { label: action, changes: '', dry: true };
    if (action === 'verify-email') {
      return [h('button', { disabled: busy, onclick: () => runAction('verify-email', { verifyEmail: values().verifyEmail }, false) }, meta.label)];
    }
    // The create commands only CREATE — once the author has the product, they would refuse. Say so, and
    // offer what still makes sense on an existing product: adding its image.
    const existing = action === 'shopify' ? v.values.shopifyProductId : action === 'shopify-collection' ? v.values.collectionProductId : null;
    if (existing) {
      const collection = action === 'shopify-collection';
      const img = () => (collection
        ? { product: 'collection', imageFile: values().collectionImageFile, imageUrl: values().collectionImageUrl }
        : { imageFile: values().imageFile, imageUrl: values().imageUrl });
      const im = (W.actionsMeta || {})['shopify-image'] || { label: 'Add the image to the product', changes: '' };
      return [
        h('span', { class: 'muted small-note', text: (collection ? 'The collection product' : 'The bundle') + ' already exists (product ' + existing + '), so there is nothing to create. If a check above is red, fix it in Shopify as its box says, then press "Refresh this author". To give it a picture, fill in one of the two image boxes above:' }),
        h('button', { disabled: busy, onclick: () => runAction('shopify-image', img(), false) }, 'Preview (dry run)'),
        h('button', { class: 'danger', disabled: busy, onclick: () => {
          if (!window.confirm(`${im.label} for ${v.code} ${v.name}?\n\nThis ${im.changes}.\n\nDid the preview look right?`)) return;
          runAction('shopify-image', img(), true);
        } }, `${im.label} — for real`),
      ];
    }
    const blocked = busy || (action === 'onboard' ? v.exists || v.missingForCreate.length > 0 : !v.exists);
    const params = () => {
      const x = values();
      if (action === 'shopify') return { price: x.price, sku: x.sku, grams: x.grams, imageFile: x.imageFile, imageUrl: x.imageUrl };
      if (action === 'shopify-collection') return { price: x.collectionPrice, imageFile: x.collectionImageFile, imageUrl: x.collectionImageUrl };
      if (action === 'verify') return { keep: !!x.keep };
      if (action === 'guest') return { guestEmail: x.guestEmail };
      if (action === 'course360') return { course: x.courseLink };
      return {};
    };
    return [
      h('button', { disabled: blocked, onclick: async () => { if (action === 'onboard') await saveDraft(s, values(), true); runAction(action, params(), false); } }, 'Preview (dry run)'),
      h('button', { class: 'danger', disabled: blocked, onclick: async () => {
        if (!window.confirm(`${meta.label} for ${v.code} ${v.name}?\n\nThis ${meta.changes}.\n\nDid the preview look right?`)) return;
        if (action === 'onboard') await saveDraft(s, values(), true);
        runAction(action, params(), true);
      } }, `${meta.label} — for real`),
    ];
  }

  async function saveDraft(s, vals, quiet = false) {
    const values = Object.fromEntries(Object.entries(vals).filter(([k]) => s.fields.some((f) => f.key === k)));
    const body = { code: W.view.code, values };
    try {
      W.view = await A.api('/api/wizard/draft', body);
      forgetTyped(W.view.code, Object.keys(values));
      W.errors = {};
      if (!quiet) A.toast('Draft saved');
      render();
      return true;
    } catch (err) {
      W.errors = err.problems || {};
      render();
      A.toast(err.message, 6000);
      return false;
    }
  }

  function saveRecord(s, vals) {
    const values = Object.fromEntries(s.fields.filter((f) => f.where === 'record' && !f.readOnly).map((f) => [f.key, vals[f.key]]).filter(([, x]) => x !== '' && x !== undefined));
    if (values.books !== undefined) values.books = String(values.books).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!Object.keys(values).length) return A.toast('Nothing to save yet');
    return runAction('set', { values }, false);
  }

  async function generateFiles(kind, vals) {
    try {
      const r = await A.api('/api/wizard/generate', { code: W.view.code, kind, from: vals.fromCode || null });
      W.generated = { ...r, step: W.step };
      await reload();
      A.toast('Files written on this computer');
    } catch (err) {
      A.toast(err.message, 8000);
    }
  }

  async function runAction(action, params, write) {
    try {
      const r = await A.api('/api/action', { action, code: W.view.code, params, write, confirm: write ? `${action} ${W.view.code}` : '' });
      W.job = r.job;
      const step = W.view.steps[W.step];
      const meta = (W.actionsMeta || {})[action] || {};
      const used = action === 'set' ? step.fields.filter((f) => f.where === 'record')
        : write || meta.dry === false ? step.fields.filter((f) => f.where === 'param' || f.where === 'shared') : [];
      W.forgetOnDone = used.length ? { id: r.job.id, code: W.view.code, keys: used.map((f) => f.key) } : null;
      render();
      watch(r.job.id);
    } catch (err) {
      A.toast(err.message, 8000);
    }
  }

  function watch(id) {
    clearInterval(W.poll);
    W.poll = setInterval(async () => {
      try {
        const { job } = await A.api(`/api/job?id=${encodeURIComponent(id)}`);
        W.job = job;
        if (job.status !== 'running') {
          clearInterval(W.poll);
          if (job.status === 'done' && W.forgetOnDone && W.forgetOnDone.id === job.id) forgetTyped(W.forgetOnDone.code, W.forgetOnDone.keys);
          W.forgetOnDone = null;
          A.toast(job.status === 'done' ? `${job.action}: done` : `${job.action}: failed — read the output`, 6000);
          // A newly created author: the draft is gone, coaches.json has the entry.
          await reload();
          A.onChanged();
        } else {
          render();
        }
      } catch (err) {
        clearInterval(W.poll);
        A.toast(err.message, 8000);
      }
    }, 1500);
  }

  function jobBox(job) {
    const { h } = A;
    const meta = (W.actionsMeta || {})[job.action] || { label: job.action };
    const head = job.status === 'running' ? `Running ${meta.label}${job.write ? '' : ' (dry run)'}…` : `${meta.label}${job.write ? '' : ' (dry run)'} — ${job.status === 'done' ? 'finished' : `failed (exit ${job.exitCode})`}`;
    // A long output is cut off by its box, and the reason it stopped is at the END — so a failed job
    // says why at the top, and the box opens scrolled to the bottom (2026-10-13, Rick's course).
    const pre = h('pre', { text: job.output || '' });
    if (job.status !== 'running') setTimeout(() => { pre.scrollTop = pre.scrollHeight; }, 0);
    const why = job.status === 'failed' ? (stopReason(job.output) || failRows(job.output) || lastNote(job.output)) : '';
    return h('div', { class: `wz-job ${job.status}` }, h('div', { class: 'lbl', text: head }),
      why ? h('div', { class: 'job-why' }, h('strong', { text: 'Why it stopped: ' }), why) : null, pre);
  }

  /** A plain refusal at the very end (no STOPPED prefix): the last paragraph of the output, if it is not a table. */
  function lastNote(output) {
    const lines = String(output || '').split(String.fromCharCode(10)).map((l) => l.trim());
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    const block = [];
    for (let i = lines.length - 1; i >= 0 && lines[i]; i--) block.unshift(lines[i]);
    const text = block.join(' ');
    return block.length && !/^(PASS|FAIL|WARN)/.test(block[0]) && !text.startsWith('$ ') ? text.slice(0, 600) : '';
  }

  /** The table rows marked FAIL (or WARN): shown on top, so you never scroll for them. */
  function failRows(output) {
    const rows = String(output || '').split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l.startsWith('FAIL ')).map((l) => l.split(/ {2,}/).join(' · '));
    return rows.length ? `${rows.length} check(s) failed — ${rows.join('  |  ')}`.slice(0, 800) : '';
  }

  /** The lines a command prints when it stops: "STOPPED: …", "REFUSING — …" and what follows them. */
  function stopReason(output) {
    const lines = String(output || '').split(/\r?\n/);
    const at = lines.findIndex((l) => /^\s*(STOPPED|REFUSING|Error:)/.test(l));
    if (at < 0) return '';
    const out = [lines[at].trim()];
    for (const l of lines.slice(at + 1)) {
      if (!l.trim() || /^\s*\$ node /.test(l)) break;
      out.push(l.trim());
    }
    return out.join(' ').slice(0, 600);
  }

  async function signoff(step, note) {
    try {
      await A.api('/api/signoff', { code: W.view.code, step, note });
      A.toast('Signed off');
      await reload();
      A.onChanged();
    } catch (err) {
      A.toast(err.message, 8000);
    }
  }

  async function unsignoff(step) {
    try {
      await A.api('/api/unsignoff', { code: W.view.code, step });
      A.toast('Sign-off undone');
      await reload();
      A.onChanged();
    } catch (err) {
      A.toast(err.message, 8000);
    }
  }

  /** The author or draft on screen, for the Refresh button: { code, name, exists } — or null. */
  const current = () => (W.code && W.view ? { code: W.view.code, name: W.view.name, exists: !!W.view.exists } : null);

  window.PipelineWizard = { mount, openNew, openAuthor, updateRoster, current, reload: () => reload().catch((err) => A.toast(err.message, 8000)) };
})();
