/*
 * prototype.js — "Prototype Coach" on the Add author screen (plan 06, Option 2: one single page).
 *
 * A prototype is a quick demo coach: three parts on one form (who, the Voiceflow coach, the
 * coach page), one Build button, then Copy. No coach code; nothing is created in GHL, Shopify
 * or Cloudflare. The page file, its backup and the saved answers all live in the demo folder.
 * The page can hold the Voiceflow key, so it never reaches this browser: Copy and Show in
 * folder happen on the server's PC. All text is rendered with textContent — never as HTML.
 */
(() => {
  'use strict';

  let A = null; // { api, h, clear, toast }
  const P = { items: [], folder: '', form: null, editId: null, built: null, problems: {}, another: false, busy: false, anotherNeeded: false, moreOpen: false, copied: false };
  const blank = () => ({ name: '', bookTitle: '', versionID: '', authorInitials: '', subtitle: '', authorPhotoURL: '', authorURL: '', books: '', pageTitle: '', courses: '', showBooks: false, showCourses: false, showMeetAuthor: false });
  const linesOf = (list) => (Array.isArray(list) ? list.map((b) => `${b.title}|${b.url}`).join('\n') : '');

  function mount(deps) { A = deps; P.form = blank(); }

  async function refresh() {
    const r = await A.api('/api/prototypes');
    P.items = r.items || [];
    P.folder = r.folder || '';
  }

  /** The two cards for the Add author screen: the form, and the saved prototypes. */
  async function cards(modeField, rerender) {
    const { h } = A;
    try { await refresh(); } catch (err) { A.toast(err.message, 8000); }
    const draw = () => rerender();

    const field = (key, label, help, opts = {}) => {
      const bad = P.problems[key];
      const common = { id: `pt-${key}`, 'aria-label': label, placeholder: opts.placeholder || '', oninput: (e) => { P.form[key] = e.target.value; P.built = null; } };
      const input = opts.area ? h('textarea', { ...common, rows: '3' }) : h('input', { ...common, value: P.form[key] || '' });
      if (opts.area) input.value = P.form[key] || '';
      return h('label', { class: `field${bad ? ' bad' : ''}` }, h('span', { class: 'lbl', text: label }), input, h('span', { class: 'help', text: bad || help || '' }));
    };
    const toggle = (key, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!P.form[key], onchange: (e) => { P.form[key] = e.target.checked; P.built = null; } }), h('span', { text: label }));

    const build = async () => {
      if (P.busy) return;
      P.busy = true; P.problems = {};
      try {
        const r = await A.api('/api/prototypes', { values: P.form, id: P.editId, another: P.another });
        P.built = r.built; P.items = r.items; P.folder = r.folder; P.editId = r.built.id; P.another = false; P.anotherNeeded = false;
        try { await A.api('/api/prototypes/open', { id: r.built.id, how: 'copy' }); P.copied = true; A.toast(`Built ${r.built.name} and copied to the clipboard`, 6000); }
        catch (err) { P.copied = false; A.toast(`Built ${r.built.name}, but it could not be copied: ${err.message}`, 9000); }
      } catch (err) {
        P.problems = err.problems || {};
        if (P.problems.name && /already exists/.test(P.problems.name)) P.anotherNeeded = true;
        A.toast(err.problems ? 'Some answers need fixing' : err.message, 8000);
      } finally { P.busy = false; draw(); }
    };
    const act = async (id, how) => {
      try { A.toast((await A.api('/api/prototypes/open', { id, how })).said, 6000); } catch (err) { A.toast(err.message, 8000); }
    };

    const result = P.built ? h('div', { class: 'proto-result' },
      h('div', null, h('strong', { text: P.copied ? 'Page built and copied. ' : 'Page built. ' }), h('span', { class: 'muted', text: `Saved as ${P.built.name} in ${P.folder}${P.built.backup ? ` (the page it replaced is kept as ${P.built.backup})` : ''}` })),
      h('div', { class: 'proto-result-row' },
        h('span', { class: 'muted', text: (P.copied ? 'It is already on the clipboard: paste' : 'Press Copy, then paste') + ' it into the page’s Custom Code element (Ctrl+A, Ctrl+V), then Save and Publish.' }),
        h('span', { class: 'proto-btns' }, h('button', { class: 'primary', onclick: () => act(P.built.id, 'copy') }, 'Copy the whole page'), h('button', { class: 'ghost', onclick: () => act(P.built.id, 'folder') }, 'Show in folder')))) : null;

    // Closed by default; it opens by itself only when one of its answers needs fixing.
    const more = P.moreOpen || ['authorURL', 'books', 'courses', 'pageTitle'].some((k) => P.problems[k]);
    const form = h('div', { class: 'card' },
      h('h2', { text: P.editId ? `Prototype: ${P.form.name || 'edit'}` : 'Add a new author' }),
      modeField,
      h('p', { class: 'muted', text: 'A prototype has no coach code and no steps after the page. Nothing is created in GHL, Shopify or Cloudflare: you get one page to copy and paste.' }),
      h('h3', { class: 'proto-h', text: '0 · Who' }),
      field('name', 'Author name', 'As readers see it, e.g. Jane Smith', { placeholder: 'Jane Smith' }),
      field('bookTitle', 'Book title', 'The real title of the book'),
      field('authorInitials', 'Initials (optional)', 'Shown if the photo cannot load. Taken from the name if empty', { placeholder: 'JS' }),
      h('h3', { class: 'proto-h', text: '1 · The Voiceflow coach' }),
      field('versionID', 'Voiceflow version ID', '24 characters (0-9, a-f). The Voiceflow key is read from coaches.json, you never type it', { placeholder: '6ad879ac777718f228065cd1' }),
      h('h3', { class: 'proto-h', text: '2 · The coach page' }),
      field('subtitle', 'Line under the author’s name (optional)', 'Starts as the book title'),
      field('authorPhotoURL', 'Author photo (web address)', 'Right-click the photo online → "Copy image address"', { placeholder: 'https://…' }),
      h('details', { class: 'proto-more', open: more || null, ontoggle: (e) => { P.moreOpen = e.target.open; } },
        h('summary', { text: 'More page options (website, book and course buttons, tab title)' }),
        field('authorURL', 'Author’s own website', 'Leave empty to hide the link', { placeholder: 'https://…' }),
        field('books', 'Book buttons', 'One per line:  Title|https://link-to-buy', { area: true, placeholder: 'Title|https://…' }),
        field('courses', 'Course buttons (optional)', 'One per line:  Title|https://link', { area: true, placeholder: 'Title|https://…' }),
        field('pageTitle', 'Browser tab title (optional)', 'Leave empty to use “Author - Book title”')),
      h('div', { class: 'proto-toggles' }, toggle('showBooks', '“Buy the Book” button'), toggle('showCourses', '“Buy the Course” button'), toggle('showMeetAuthor', '“Meet the Author” button')),
      h('p', { class: 'muted proto-fixed' }, 'Fixed for a prototype: the page talks straight to Voiceflow, the page has no phone-activation or coach-router code at all, and the Voiceflow key is inside the page. Anyone who views the page’s source can read it.'),
      P.anotherNeeded ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: P.another, onchange: (e) => { P.another = e.target.checked; } }), h('span', { text: 'Make another (a second prototype with this name)' })) : null,
      result,
      h('div', { class: 'proto-actions' },
        P.editId ? h('button', { class: 'ghost', onclick: () => { P.form = blank(); P.editId = null; P.built = null; P.problems = {}; draw(); } }, '+ New prototype') : h('span'),
        h('button', { class: 'primary', disabled: P.busy, onclick: build }, P.editId ? 'Build again' : 'Build the page')));

    const list = h('div', { class: 'card' },
      h('h3', { text: 'Prototype coaches' }),
      P.items.length ? h('ul', { class: 'wz-list' }, P.items.map((p) => h('li', null,
        h('span', null, h('strong', { text: p.name }), h('span', { class: 'muted', text: ` — ${p.bookTitle} · ${p.exists ? p.file : 'page file missing'} · built ${new Date(p.builtAt).toLocaleString()}` })),
        h('span', { class: 'proto-btns' },
          h('button', { onclick: () => { P.form = { ...blank(), ...p, books: linesOf(p.books), courses: linesOf(p.courses) }; P.editId = p.id; P.built = null; P.problems = {}; P.another = false; P.anotherNeeded = false; draw(); window.scrollTo({ top: 0 }); } }, 'Edit again'),
          h('button', { disabled: !p.exists, onclick: () => act(p.id, 'copy') }, 'Copy the page'),
          h('button', { class: 'ghost', disabled: !p.exists, onclick: () => act(p.id, 'folder') }, 'Show in folder'),
          h('button', { class: 'ghost', title: 'Takes it off this list. The page file stays in the folder', onclick: async () => {
            if (!window.confirm(`Take ${p.name} off the list?\n\nThe page file stays in ${P.folder}.`)) return;
            try { const r = await A.api('/api/prototypes/forget', { id: p.id }); P.items = r.items; if (P.editId === p.id) { P.form = blank(); P.editId = null; P.built = null; } draw(); } catch (err) { A.toast(err.message, 8000); }
          } }, 'Remove'))))) : h('p', { class: 'muted', text: `None yet. Pages are saved in ${P.folder || 'All Coaches (Demo)'}.` }));
    return [form, list];
  }

  window.PipelinePrototype = { mount, cards };
})();
