/**
 * lib-prototypes.mjs — prototype coach pages: a quick demo coach, no coach number.
 *
 * A prototype is the CURRENT coach page (templates/coach-page.template.html) filled in
 * for direct mode: it talks straight to Voiceflow and never to the Worker. It has no
 * coach code and no Worker address, and nothing is created in GHL, Shopify, Cloudflare
 * or Twilio. coaches.json is only READ, for the one Voiceflow key (shared.vfApiKey).
 *
 * EVERYTHING this file writes lives in ONE folder, `All Coaches (Demo)` (decided
 * 2026-11-03): the finished pages, the `.bak-<date>` copy of a page a rebuild replaces,
 * and the small answers file (`_prototypes.json`, no key in it) that lets a prototype be
 * edited again. Nothing goes into the dashboard folder or any other place.
 *
 * Plan: BookCoach Author Dashboard/plans/06-prototype-coach-pages.md.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { REPO_ROOT } from './lib-paths.mjs';
import { TEMPLATE, validatePageForm } from './lib-pages.mjs';
import { replaceConfigBlock, suggestSlug } from './lib-wizard.mjs';
import { initialsOf, pageVersionId } from '../coach-router/lib-author.mjs';
import { withAuthor } from '../coach-router/lib-onboard.mjs';
import { bearer } from '../coach-router/lib-config.mjs';

export const DEMO_DIR = resolve(REPO_ROOT, 'All Coaches (Demo)');
export const ANSWERS_NAME = '_prototypes.json';

const UNSAFE = /[<>]/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const stampOf = (now) => now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const lit = (v) => JSON.stringify(String(v ?? '')).replace(/</g, '\\u003c');
const titleSlug = (id) => id.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('-');

/** The only way a path is made: a name from an id, inside the folder, never outside it. */
export function pagePathFor(id, { dir = DEMO_DIR } = {}) {
  if (!ID_RE.test(String(id || ''))) throw new Error('not a prototype id');
  const name = `${titleSlug(id)}-demo`;
  const path = resolve(dir, name);
  if (!path.startsWith(resolve(dir) + sep)) throw new Error('that path is outside the demo folder');
  return { name, path };
}

/* ---------------------------------------------------------- the answers file --- */

const answersFile = (dir) => resolve(dir, ANSWERS_NAME);

export function readPrototypes({ dir = DEMO_DIR } = {}) {
  try {
    const d = existsSync(answersFile(dir)) ? JSON.parse(readFileSync(answersFile(dir), 'utf8')) : null;
    return d && d.v === 1 && d.items && typeof d.items === 'object' ? d : { v: 1, items: {} };
  } catch {
    return { v: 1, items: {} };
  }
}

function writePrototypes(data, { dir = DEMO_DIR } = {}) {
  mkdirSync(dir, { recursive: true });
  const tmp = `${answersFile(dir)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, answersFile(dir));
}

/** The id a new prototype gets: the name as a slug; a name already taken is "make another" (-2, -3…). */
export function idFor(name, items = {}, { another = false } = {}) {
  const base = suggestSlug(name);
  if (!base) throw new Error('the author name needs letters or digits');
  if (!another || !items[base]) return base;
  for (let n = 2; n < 100; n++) if (!items[`${base}-${n}`]) return `${base}-${n}`;
  throw new Error('too many prototypes with this name');
}

/* ------------------------------------------------------------- the answers --- */

/**
 * Check the form. Returns { clean, problems }. `clean` is what is saved: no coach code, no
 * connection or key choice (a prototype is always direct, with the key in the page, and the
 * activation button off — that button needs the Worker).
 */
export function validatePrototype(values = {}) {
  const problems = {};
  const name = String(values.name || '').trim();
  const bookTitle = String(values.bookTitle || '').trim();
  const versionID = String(values.versionID || '').trim().toLowerCase();
  if (!name) problems.name = 'the author name is required';
  else if (name.length > 80) problems.name = 'keep the name under 80 characters';
  else if (UNSAFE.test(name)) problems.name = 'it cannot contain < or >';
  else if (!suggestSlug(name)) problems.name = 'the name needs letters or digits';
  if (!bookTitle) problems.bookTitle = 'the book title is required';
  else if (bookTitle.length > 200) problems.bookTitle = 'keep the title under 200 characters';
  else if (UNSAFE.test(bookTitle)) problems.bookTitle = 'it cannot contain < or >';
  if (!/^[0-9a-f]{24}$/.test(versionID)) problems.versionID = 'the Voiceflow version ID is 24 characters (0-9, a-f)';

  // The page's own form, checked by the very rules the final coach page uses.
  const form = validatePageForm({
    subtitle: values.subtitle, authorPhotoURL: values.authorPhotoURL, authorInitials: values.authorInitials, authorURL: values.authorURL,
    books: values.books, pageTitle: values.pageTitle, courses: values.courses,
    showBooks: values.showBooks, showCourses: values.showCourses, showMeetAuthor: values.showMeetAuthor,
    showActivation: false, connection: 'direct', includeKey: true,
  }, { bookTitle });
  Object.assign(problems, form.problems);
  if (Object.keys(problems).length) return { clean: null, problems };

  const { record, page } = form;
  const books = record.books || [];
  const courses = page.courses || [];
  return {
    problems: {},
    clean: {
      name, bookTitle, versionID,
      subtitle: page.subtitle || '',
      authorPhotoURL: record.authorPhotoURL || '',
      authorInitials: record.authorInitials || '',
      authorURL: record.authorURL || '',
      books, courses,
      pageTitle: page.pageTitle || '',
      // A button is shown only when it has something to show.
      showBooks: page.showBooks !== false && books.length > 0,
      showCourses: page.showCourses === true && courses.length > 0,
      showMeetAuthor: page.showMeetAuthor !== false && !!record.authorURL,
    },
  };
}

/* --------------------------------------------------------------- the page --- */

/** The CONFIG block of a prototype: direct mode, no coach code, no Worker address, activation off. */
export function prototypeConfig(p, { vfKey }) {
  const key = `Bearer ${String(vfKey).trim().replace(/^bearer\s+/i, '')}`;
  return [
    '   const CONFIG = {',
    `    authorName: ${lit(p.name)},`,
    `    bookTitle: ${lit(p.subtitle || p.bookTitle)},`,
    `    authorPhotoURL: ${lit(p.authorPhotoURL)},`,
    `    authorInitials: ${lit(p.authorInitials || initialsOf(p.name))},`,
    `    pageTitle: ${lit(p.pageTitle || withAuthor(p.name, p.bookTitle))},`,
    '',
    `    authorURL: ${lit(p.authorURL)},`,
    '',
    '    showActivation: false,',
    `    showBooks: ${!!p.showBooks},`,
    `    showCourses: ${!!p.showCourses},`,
    `    showMeetAuthor: ${!!p.showMeetAuthor},`,
    '',
    'books: [',
    ...(p.books || []).map((b) => `  { title: ${lit(b.title)}, url: ${lit(b.url)} },`),
    '],',
    'courses: [',
    ...(p.courses || []).map((c) => `  { title: ${lit(c.title)}, url: ${lit(c.url)} },`),
    '],',
    '    // A PROTOTYPE page, made by the BookCoach Author Dashboard. It has no coach code and never',
    '    // calls the coach router: it talks straight to Voiceflow. The key below is readable in this',
    "    // page's source, so share the page only with people you trust.",
    '    CONNECTION: "direct",',
    `    VF_API_KEY: ${lit(key)},`,
    `    VF_VERSION_ID: ${lit(p.versionID)}`,
    '  };',
  ].join('\n');
}

/**
 * The final coach page minus everything a prototype never uses: the coach router (Worker),
 * the member session from a GHL lesson, and the phone-activation box (Twilio). What is left
 * talks only to Voiceflow. The text under the photo ("text + voice-in only") is switched on.
 * Every cut is looked for by its marker; if the template has changed so that one is not found,
 * this throws rather than quietly shipping Worker code in a prototype.
 */
export function stripForPrototype(html) {
  let page = String(html);
  const need = (ok, what) => { if (!ok) throw new Error(`the page template has changed: cannot find ${what} to change for the prototype`); };
  const cut = (from, to, text = '') => {
    const a = page.indexOf(from);
    const b = a < 0 ? -1 : page.indexOf(to, a + from.length);
    need(a >= 0 && b >= 0, `"${(a < 0 ? from : to).slice(0, 40)}"`);
    page = page.slice(0, a) + text + page.slice(b);
  };
  const swap = (re, fn) => { need(re.test(page), String(re).slice(0, 50)); page = page.replace(re, fn); };

  // The phone-activation box: its style, its HTML and its whole second script.
  cut('/* --- phone activation', '.book-menu-wrap{');
  swap(/[ 	]*<div class="activate" id="activate" hidden>[\s\S]*?id="activateOut"[^>]*><\/div>\s*<\/div>\s*/, () => '    ');
  swap(/<script>\s*\/\*[\s=]*Phone activation[\s\S]*?<\/script>\s*/, () => '');

  // The note under the photo is commented out in the final page; a prototype shows it.
  swap(/<!--\s*(<p class="presence-note">[\s\S]*?<\/p>)\s*-->/, (_m, note) => note);

  // No photo: the author's initials sit in the ring, and the ring turns slowly (as in the old
  // demo pages, e.g. Tara-demo). With a photo nothing turns. Off for "reduce motion" users.
  swap(/@keyframes spin\{ to\{ transform:rotate\(360deg\); \} \}/, (m) => `${m}\n  .photo-ring.spin{animation:spin 10s linear infinite;}\n  @media (prefers-reduced-motion: reduce){ .photo-ring.spin{animation:none;} }`);
  swap(/(if\(CONFIG\.authorPhotoURL\)\{\s*const inner = document\.querySelector\('\.photo-inner'\);[\s\S]*?\n\})/, (_m, block) => `${block} else {\n  document.querySelector('.photo-ring').classList.add('spin');\n}`);

  // The member from a GHL lesson, the verified session, the Worker calls and the "auto" fallback.
  cut('// The member, when the lesson iframe', '// Only used WITHOUT a verified session', '');
  cut('// Only used WITHOUT a verified session', 'const VF_USER_ID', '// A random id for this browser, so a returning visitor finds their conversation again.\n');
  cut('// --- Verified session', '// Voiceflow direct. The version ID', [
    "const VF_RUNTIME = 'https://general-runtime.voiceflow.com';",
    'const DIRECT_READY = /^Bearer\s+\S+/.test(String(CONFIG.VF_API_KEY || "")) &&',
    '                     /^[0-9a-f]{24}$/i.test(String(CONFIG.VF_VERSION_ID || ""));',
    'if(!DIRECT_READY){',
    "  console.error('[coach] VF_API_KEY / VF_VERSION_ID are not set - the coach cannot connect.');",
    '}',
    '',
    ''].join('\n'));
  cut('// Once the Worker has failed in "auto"', "// Saves this session to the project's Transcripts tab", [
    'async function vfInteract(action){',
    '  // tts:true asks Voiceflow to render audio with the voice set on the project itself.',
    '  return vfDirect.interact(action);',
    '}',
    ''].join('\n'));
  swap(/await viaConnection\(\s*\(\) => workerPost\('\/api\/vf-state', \{ op: 'reset' \}\),\s*\(\) => vfDirect\.reset\(\)\s*\);/, () => 'await vfDirect.reset();');
  swap(/return await viaConnection\([\s\S]*?\(\) => vfDirect\.getState\(\)\s*\);/, () => 'return await vfDirect.getState();');

  // Nothing that belongs to the Worker, GHL or Twilio may be left.
  const left = ['workers.dev', 'WORKER_URL', 'COACH_CODE', 'workerPost', 'viaConnection', 'getSessionToken', 'MEMBER', 'activat', 'bind/', 'sessionToken'].filter((w) => page.includes(w));
  if (left.length) throw new Error(`the prototype page still has code for the Worker / GHL / Twilio (${left.join(', ')})`);
  return page;
}

/** Check the answers, build the whole page and write it into the demo folder. A page it
 * replaces is kept beside it as `<name>.bak-<date>`. Refuses if the result would carry any
 * credential other than the one Voiceflow key. Returns a summary — never the key or the page.
 */
export function buildPrototype(values, { id = null, another = false, shared = {}, secrets = [], dir = DEMO_DIR, template = TEMPLATE, now = new Date() } = {}) {
  const { clean, problems } = validatePrototype(values);
  if (!clean) return { problems };
  const vfKey = bearer(shared.vfApiKey);
  if (!vfKey) throw new Error('there is no Voiceflow key in coaches.json (shared.vfApiKey) — add it first');
  if (!existsSync(template)) throw new Error(`the page template is missing: ${template}`);

  const data = readPrototypes({ dir });
  // A new prototype never silently replaces a saved one: same name = "Edit again" (id) or "Make another".
  if (!id && !another && data.items[idFor(clean.name)]) {
    return { problems: { name: `a prototype for "${clean.name}" already exists — open it with "Edit again", or tick "Make another"` } };
  }
  const useId = id || idFor(clean.name, data.items, { another });
  if (id && !data.items[id]) throw new Error(`no saved prototype "${id}"`);
  const file = pagePathFor(useId, { dir });

  const page = replaceConfigBlock(stripForPrototype(readFileSync(template, 'utf8')), prototypeConfig(clean, { vfKey }));
  if (!page) throw new Error('the page template has no CONFIG block to fill in');
  const allowed = new Set([vfKey, vfKey.replace(/^Bearer\s+/i, '')]);
  if (secrets.filter((s) => s && !allowed.has(s)).some((s) => page.includes(s))) throw new Error('refusing to write the page: it would contain a credential');

  mkdirSync(dir, { recursive: true });
  let backup = null;
  if (existsSync(file.path)) {
    backup = `${file.name}.bak-${stampOf(now)}`;
    copyFileSync(file.path, resolve(dir, backup));
  }
  writeFileSync(file.path, page, 'utf8');

  const at = now.toISOString();
  data.items[useId] = { ...clean, file: file.name, createdAt: (data.items[useId] || {}).createdAt || at, builtAt: at };
  writePrototypes(data, { dir });
  return { id: useId, name: file.name, folder: dir, bytes: Buffer.byteLength(page), backup, builtAt: at, versionOk: !!pageVersionId({ versionID: clean.versionID }) };
}

/* ---------------------------------------------------------------- the list --- */

/** What the screen shows and edits: the saved answers (no key) and whether each file is still there. */
export function listPrototypes({ dir = DEMO_DIR } = {}) {
  const { items } = readPrototypes({ dir });
  return Object.entries(items)
    .map(([id, p]) => ({ id, ...p, exists: existsSync(resolve(dir, p.file)), size: existsSync(resolve(dir, p.file)) ? statSync(resolve(dir, p.file)).size : 0 }))
    .sort((a, b) => String(b.builtAt).localeCompare(String(a.builtAt)));
}

/** Take a prototype off the list. Its page file and backups stay where they are. */
export function forgetPrototype(id, { dir = DEMO_DIR } = {}) {
  const data = readPrototypes({ dir });
  if (!data.items[id]) return false;
  delete data.items[id];
  writePrototypes(data, { dir });
  return true;
}

/** The finished page's path, for Copy / Show in folder (done on this PC, never sent to the browser). */
export function prototypeFile(id, { dir = DEMO_DIR } = {}) {
  const p = readPrototypes({ dir }).items[id];
  if (!p) throw new Error(`no saved prototype "${id}"`);
  const f = pagePathFor(id, { dir });
  if (!existsSync(f.path)) throw new Error('the page file is not in the demo folder — build it again');
  return f;
}
