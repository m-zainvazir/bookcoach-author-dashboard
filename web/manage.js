/*
 * manage.js — edit an author's number, delete an author, and the clean-up after.
 *
 * The ⋯ button on each Pipeline row opens a menu; its panels use the same side drawer as
 * the step panel. A change shows a "what will change" list, then a Preview (dry run), then
 * asks you to confirm — the same rule as every other write here. After a delete the author
 * stays in the grid as a grey row until its leftovers in GHL, Shopify and Zipify are gone
 * or signed off (plan 05). All text is rendered with textContent — never as HTML.
 */
(() => {
  'use strict';

  let A = null; // { api, h, clear, toast, load, closeDrawer, openAuthor, authors, stepIdOf }
  const M = { job: null, poll: null, previewed: null, impactTimer: null, cleanup: null };
  const $ = (id) => document.getElementById(id);
  const KIND_MARK = { auto: ['✓', 'st-DONE'], hand: ['!', 'st-CONFIRM'], keep: ['–', 'st-BLOCKED'] };
  const KIND_TAG = { auto: 'the dashboard does it', hand: 'needs you', keep: 'untouched' };
  const ITEM_PILL = {
    gone: ['gone ✓ detected', 'st-DONE'],
    signed: ['signed off', 'st-CONFIRM'],
  };

  function mount(deps) { A = deps; }

  /* ----------------------------------------------------------------- the ⋯ menu --- */

  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }

  function openMenu(btn, a) {
    closeMenu();
    const { h } = A;
    const item = (label, fn, cls) => h('button', { class: `menu-item${cls ? ` ${cls}` : ''}`, role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, label);
    menu = h('div', { class: 'menu-pop', role: 'menu' },
      item('Open in Onboard', () => A.openAuthor(a.code)),
      item('Edit number…', () => editNumber(a)),
      item('Edit details…', () => editDetails(a)),
      h('hr'),
      item('Delete author…', () => deleteAuthor(a), 'bad'));
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4)}px`;
    menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
    menu.querySelector('button').focus();
  }
  document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('.kebab')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  /* -------------------------------------------------------------- shared pieces --- */

  function show(...kids) {
    const { clear } = A;
    clear($('drawer-body')).append(...kids);
    $('drawer').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
  }

  /** The "what will change" list: ✓ the dashboard does it, ! you do it, – nothing. */
  function impactList(rows) {
    const { h } = A;
    return h('div', { class: 'impact' }, rows.map((r) => {
      const [g, cls] = KIND_MARK[r.kind] || KIND_MARK.keep;
      return h('div', { class: 'impact-row' },
        h('span', { class: `pill ${cls}`, text: g, title: KIND_TAG[r.kind] }),
        h('div', null, h('div', { class: 'impact-sys', text: r.sys }), h('div', { class: 'muted', text: r.what })),
        h('span', { class: 'muted impact-tag', text: KIND_TAG[r.kind] || '' }));
    }));
  }

  function jobBox(job) {
    const { h } = A;
    const label = A.actionsMeta && A.actionsMeta[job.action] ? A.actionsMeta[job.action].label : job.action;
    const head = job.status === 'running' ? `Running ${label}${job.write ? '' : ' (dry run)'}…`
      : `${label}${job.write ? '' : ' (dry run)'} — ${job.status === 'done' ? 'finished' : `stopped (exit ${job.exitCode})`}`;
    const pre = h('pre', { text: job.output || '' });
    if (job.status !== 'running') setTimeout(() => { pre.scrollTop = pre.scrollHeight; }, 0);
    return h('div', { class: `wz-job ${job.status}` }, h('div', { class: 'lbl', text: head }), pre);
  }

  /** Start an allowlisted action and follow it. Resolves with the finished job. */
  async function runAction({ action, code, params, write, into }) {
    const r = await A.api('/api/action', { action, code, params, write, confirm: write ? `${action} ${code}` : '' });
    return new Promise((ok, bad) => {
      clearInterval(M.poll);
      const draw = (job) => { if (into) { A.clear(into).append(jobBox(job)); } };
      draw(r.job);
      M.poll = setInterval(async () => {
        try {
          const { job } = await A.api(`/api/job?id=${encodeURIComponent(r.job.id)}`);
          draw(job);
          if (job.status !== 'running') { clearInterval(M.poll); ok(job); }
        } catch (err) { clearInterval(M.poll); bad(err); }
      }, 1500);
    });
  }

  /** "Update subscribers now": dry run, then the real sync after a confirm. Shown after a number change or a delete. */
  function subscribersBlock(code) {
    const { h } = A;
    const out = h('div');
    const btn = h('button', { onclick: async () => {
      btn.disabled = true;
      try {
        const dry = await runAction({ action: 'sync-subscribers', code, params: {}, write: false, into: out });
        if (dry.status !== 'done') return;
        if (!window.confirm('Update subscribers now?\n\nThe Worker rewrites who may use which coach now instead of at its next 15-minute run. It refuses by itself a run that would revoke most subscribers at once.\n\nDid the preview look right?')) return;
        await runAction({ action: 'sync-subscribers', code, params: {}, write: true, into: out });
        A.toast('Subscribers updated');
      } catch (err) { A.toast(err.message, 8000); } finally { btn.disabled = false; }
    } }, 'Update subscribers now');
    return h('div', { class: 'note' }, h('div', { text: 'Next: people who hold this coach keep or lose access at the Worker\'s next 15-minute run. This does it now.' }), h('div', { class: 'row-gap' }, btn), out);
  }

  /* ------------------------------------------------------------------ edit number --- */

  async function editNumber(a) {
    const { h } = A;
    M.previewed = null;
    const input = h('input', { id: 'mg-new', maxlength: '4', inputmode: 'numeric', value: a.code, 'aria-label': 'New number', class: 'mg-number' });
    const msg = h('div', { class: 'mg-msg', role: 'status' });
    const list = h('div', { class: 'mg-list' });
    const reuse = h('label', { class: 'mg-reuse' }, h('input', { type: 'checkbox', id: 'mg-accept' }), h('span'));
    reuse.hidden = true;
    const out = h('div');
    const preview = h('button', { disabled: true }, 'Preview (dry run)');
    const apply = h('button', { class: 'primary', disabled: true }, 'Apply to all systems');
    let ok = false;
    let warning = null;
    let seq = 0;

    const refresh = () => {
      const typed = input.value.trim();
      ok = false; warning = null; M.previewed = null;
      apply.disabled = true; preview.disabled = true; reuse.hidden = true;
      clearTimeout(M.impactTimer);
      if (typed === a.code || !/^\d{4}$/.test(typed)) {
        msg.className = 'mg-msg'; msg.textContent = typed === a.code ? '' : 'Four digits, like 1012.';
        A.clear(list); return;
      }
      msg.className = 'mg-msg'; msg.textContent = 'Checking…';
      const mine = ++seq;
      M.impactTimer = setTimeout(async () => {
        try {
          const r = await A.api(`/api/manage/impact?kind=renumber&code=${a.code}&newCode=${typed}`);
          if (mine !== seq) return;
          if (!r.ok) { msg.className = 'mg-msg bad'; msg.textContent = r.problem; A.clear(list); return; }
          ok = true; warning = r.warning;
          msg.className = `mg-msg ${warning ? 'warn' : 'ok'}`; msg.textContent = warning ? `${typed} is free, but read the warning below.` : `${typed} is free.`;
          A.clear(list).append(h('h3', { text: 'What will change' }), impactList(r.rows));
          if (warning) { reuse.lastChild.textContent = ` ${warning} Tick to continue.`; reuse.hidden = false; reuse.firstChild.checked = false; }
          preview.disabled = !!warning;
        } catch (err) { if (mine === seq) { msg.className = 'mg-msg bad'; msg.textContent = err.message; } }
      }, 250);
    };
    input.addEventListener('input', refresh);
    reuse.firstChild.addEventListener('change', () => { preview.disabled = !(ok && reuse.firstChild.checked); });

    const params = () => ({ newCode: input.value.trim(), acceptReuse: !!(warning && reuse.firstChild.checked) });
    preview.addEventListener('click', async () => {
      preview.disabled = true;
      try {
        const job = await runAction({ action: 'renumber', code: a.code, params: params(), write: false, into: out });
        if (job.status === 'done') { M.previewed = input.value.trim(); apply.disabled = false; }
      } catch (err) { A.toast(err.message, 8000); } finally { preview.disabled = !(ok && (!warning || reuse.firstChild.checked)); }
    });
    apply.addEventListener('click', async () => {
      const to = input.value.trim();
      if (M.previewed !== to) return A.toast('Preview this number first');
      if (!window.confirm(`Change ${a.name}'s number from ${a.code} to ${to}?\n\nThis changes coaches.json, the Worker's KV entry and secret, and this dashboard's files. ${a.code} stays as a former number, so live links keep working.\n\nDid the preview look right?`)) return;
      apply.disabled = true; preview.disabled = true; input.disabled = true;
      try {
        const job = await runAction({ action: 'renumber', code: a.code, params: params(), write: true, into: out });
        await A.load(null);
        if (job.status === 'done') {
          A.toast(`${a.name} is now ${to}`);
          out.append(subscribersBlock(to), h('div', { class: 'note' }, h('div', { text: 'Still for you: the coach page. Rebuild it with the new number, then paste it into GHL once. The old page keeps working until you do.' }),
            h('div', { class: 'row-gap' }, h('button', { onclick: () => { A.closeDrawer(); A.openAuthor(to, A.stepIdOf(to, 'coachPage')); } }, 'Open the coach page form →'))));
        } else { A.toast('Stopped: read the output. Nothing is half-hidden, the screen shows what is true', 8000); }
      } catch (err) { A.toast(err.message, 8000); }
    });

    show(
      h('div', { class: 'muted', text: `${a.code} ${a.name}` }),
      h('h2', { text: `Edit ${a.name}'s number` }),
      h('div', { class: 'mg-arrow' }, h('span', { class: 'mg-old', text: a.code }), h('span', { text: '→' }), input),
      msg, reuse, list, h('div', { class: 'row-gap' }, preview, apply), out);
    input.focus(); input.select();
  }

  /* --------------------------------------------------------------- edit details --- */

  function editDetails(a) {
    const { h } = A;
    show(
      h('div', { class: 'muted', text: `${a.code} ${a.name}` }),
      h('h2', { text: `Edit ${a.name}'s details` }),
      h('p', { class: 'muted', text: 'These forms already save straight to coaches.json, backed up and checked. Pick what you want to change.' }),
      h('div', { class: 'mg-choices' },
        h('button', { onclick: () => { A.closeDrawer(); A.openAuthor(a.code, 0); } }, h('strong', { text: 'Name, book title, coach label…' }), h('span', { class: 'muted', text: 'Onboard → the first step: who the author is' })),
        h('button', { onclick: () => { A.closeDrawer(); A.openAuthor(a.code, A.stepIdOf(a.code, 'coachPage')); } }, h('strong', { text: 'Coach page…' }), h('span', { class: 'muted', text: 'the line under the name, photo, links, book and course buttons, the four toggles'}))),
      h('p', { class: 'muted', text: 'To change the number, use "Edit number…" instead: it reaches the Worker, the subscribers and the coach page too.' }));
  }

  /* ----------------------------------------------------------------------- delete --- */

  async function deleteAuthor(a) {
    const { h } = A;
    M.previewed = null;
    const out = h('div');
    const list = h('div', { class: 'mg-list' }, h('p', { class: 'muted', text: 'Reading what this affects…' }));
    const typed = h('input', { id: 'mg-confirm', placeholder: a.code, 'aria-label': 'Type the number to confirm', autocomplete: 'off' });
    const preview = h('button', null, 'Preview (dry run)');
    const del = h('button', { class: 'danger', disabled: true }, `Delete ${a.name}`);
    const sync = () => { del.disabled = !(M.previewed === a.code && typed.value.trim() === a.code); };
    typed.addEventListener('input', sync);

    show(
      h('div', { class: 'muted', text: `${a.code} ${a.name}` }),
      h('h2', { class: 'bad-text', text: `Delete ${a.name}` }),
      list,
      h('div', { class: 'note' }, h('strong', { text: 'GHL, Shopify, Zipify and Voiceflow are left alone. ' }),
        'After the delete, this author stays in the grid as a grey row with a clean-up list: what is still there, and how to remove each thing. The row goes when everything is gone or signed off.'),
      h('div', { class: 'danger-zone' }, h('h3', { text: `Type ${a.code} to confirm` }), typed),
      h('div', { class: 'row-gap' }, preview, del), out);

    try {
      const r = await A.api(`/api/manage/impact?kind=delete&code=${a.code}`);
      A.clear(list).append(h('h3', { text: 'What will change' }), impactList(r.rows),
        r.holders && r.holders.n ? h('div', { class: 'note warn-note' }, `${r.holders.n}${r.holders.capped ? '+' : ''} contact(s) hold this coach's tag. They lose the coach at the next sync. This is only a warning: you can still delete.`) : null);
    } catch (err) { A.clear(list).append(h('p', { class: 'bad-text', text: err.message })); }

    preview.addEventListener('click', async () => {
      preview.disabled = true;
      try {
        const job = await runAction({ action: 'delete', code: a.code, params: {}, write: false, into: out });
        if (job.status === 'done') { M.previewed = a.code; sync(); }
      } catch (err) { A.toast(err.message, 8000); } finally { preview.disabled = false; }
    });
    del.addEventListener('click', async () => {
      if (!window.confirm(`Delete ${a.name} (${a.code})?\n\nRemoves them from coaches.json, the Worker and this dashboard. Undo is possible for 30 days. Nothing in GHL, Shopify or Zipify is deleted.\n\nDid the preview look right?`)) return;
      del.disabled = true; preview.disabled = true; typed.disabled = true;
      try {
        const job = await runAction({ action: 'delete', code: a.code, params: {}, write: true, into: out });
        await A.load(null);
        if (job.status === 'done') {
          A.toast(`${a.name} is deleted. The clean-up list is open`, 6000);
          out.append(subscribersBlock(a.code), h('div', { class: 'row-gap' }, h('button', { class: 'primary', onclick: () => openCleanup(a.code) }, 'Open the clean-up list →')));
        } else { A.toast('Stopped: read the output. Run the delete again to finish the Worker cleanup', 8000); }
      } catch (err) { A.toast(err.message, 8000); }
    });
  }

  /* --------------------------------------------------------------------- clean-up --- */

  const isOpen = (key) => M.cleanup && M.cleanup.open === key;

  function itemRow(rec, it) {
    const { h } = A;
    const key = `${rec.code}:${it.id}`;
    const [label, cls] = ITEM_PILL[it.state] || (it.auto ? ['still there', 'st-DONE warn'] : ['cannot check · needs you', 'st-CONFIRM']);
    const row = h('div', { class: `cl-item ${it.state !== 'todo' ? 'done' : ''}` },
      h('div', { class: 'cl-head' },
        h('span', { class: `pill ${cls}`, text: label }),
        h('div', { class: 'cl-name' }, h('div', null, h('span', { class: 'muted', text: `${it.sys} · ` }), h('strong', { text: it.name })), h('div', { class: 'muted', text: it.sub }), it.note ? h('div', { class: 'muted cl-note', text: it.note }) : null),
        it.state === 'todo' ? h('button', { class: 'ghost', onclick: () => { M.cleanup.open = isOpen(key) ? null : key; renderCleanup(); } }, isOpen(key) ? 'Hide how' : 'How?')
          : (!it.auto && it.state === 'signed' ? h('button', { class: 'ghost', onclick: () => signoff(rec.code, it.id, false) }, 'Take back') : null)));
    if (it.state === 'todo' && isOpen(key)) {
      const note = h('input', { placeholder: 'what you did (optional)', 'aria-label': 'note' });
      row.append(h('div', { class: 'cl-how' },
        h('ol', null, it.how.map((s) => h('li', { text: s }))),
        h('div', { class: 'row-gap' },
          it.auto ? h('button', { class: 'primary', onclick: () => check(rec.code) }, 'Check again') : [note, h('button', { class: 'primary', onclick: () => signoff(rec.code, it.id, true, note.value) }, 'I did this. Sign off')],
          h('button', { class: 'ghost', onclick: () => A.copy(it.how.map((s, i) => `${i + 1}. ${s}`).join('\n')) }, 'Copy the steps'))));
    }
    return row;
  }

  function renderCleanup() {
    const { h } = A;
    const rec = (A.deleted().open || []).find((r) => r.code === M.cleanup.code);
    if (!rec) {
      const fin = (A.deleted().finished || []).find((r) => r.code === M.cleanup.code);
      return show(h('h2', { text: fin ? `${fin.name} is fully cleaned up` : 'Nothing left to clean up' }), h('p', { class: 'muted', text: 'Everything in GHL, Shopify and Zipify is gone or signed off. This author has left the grid.' }));
    }
    const pct = Math.round(((rec.total - rec.left) / Math.max(1, rec.total)) * 100);
    const undoBox = h('div');
    show(
      h('div', { class: 'muted', text: `${rec.code} · deleted ${new Date(rec.deletedAt).toLocaleString()}` }),
      h('h2', { text: `${rec.name}: clean-up` }),
      h('p', { class: 'muted', text: 'The dashboard, the registry and the Worker are already done. These are still in other tools. Remove them there, then press Check again: what the dashboard can see turns gone by itself, the rest you sign off.' }),
      h('div', { class: 'cl-progress' }, h('span', { text: `${rec.left} of ${rec.total} left` }), h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })), h('button', { onclick: () => check(rec.code) }, 'Check again')),
      h('div', { class: 'cl-list' }, rec.items.map((it) => itemRow(rec, it))),
      rec.canUndo ? h('details', { class: 'cl-undo' }, h('summary', { text: `Undo the delete (until ${new Date(rec.undoUntil).toLocaleDateString()})` }),
        h('p', { class: 'muted', text: 'Puts the author back into coaches.json and the Worker. Things you already removed by hand in GHL, Shopify or Zipify do not come back.' }),
        h('div', { class: 'row-gap' }, h('button', { onclick: () => undo(rec, undoBox) }, 'Preview undo (dry run)')), undoBox) : null);
  }

  async function undo(rec, out) {
    try {
      const dry = await runAction({ action: 'undo-delete', code: rec.code, params: {}, write: false, into: out });
      if (dry.status !== 'done') return;
      if (!window.confirm(`Undo the delete of ${rec.name} (${rec.code})?\n\nThe author comes back into coaches.json and the Worker. Things already removed by hand do not come back.\n\nDid the preview look right?`)) return;
      const job = await runAction({ action: 'undo-delete', code: rec.code, params: {}, write: true, into: out });
      await A.load(null);
      if (job.status === 'done') { A.toast(`${rec.name} is back`); out.append(subscribersBlock(rec.code)); }
    } catch (err) { A.toast(err.message, 8000); }
  }

  async function check(code) {
    A.toast('Reading GHL and Shopify…', 2500);
    try {
      const r = await A.api('/api/deleted/check', { code });
      A.setDeleted(r);
      A.renderGrid();
      renderCleanup();
      const rec = (r.open || []).find((x) => x.code === code);
      A.toast(rec ? `Checked: ${rec.left} of ${rec.total} left` : 'Everything is cleaned up. This author has left the grid', 6000);
    } catch (err) { A.toast(err.message, 8000); }
  }

  async function signoff(code, id, value, note = '') {
    try {
      const r = await A.api('/api/deleted/signoff', { code, id, note, value });
      A.setDeleted(r);
      A.renderGrid();
      renderCleanup();
      A.toast(value ? 'Signed off' : 'Sign-off taken back');
    } catch (err) { A.toast(err.message, 8000); }
  }

  function openCleanup(code) {
    M.cleanup = { code, open: null };
    renderCleanup();
  }

  window.PipelineManage = { mount, openMenu, openCleanup };
})();
