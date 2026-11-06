/**
 * lib-pages.mjs — step 2: the coach page, built from a form instead of by hand.
 *
 * Every coach page is the SAME code (templates/coach-page.template.html — the
 * final code, identical for every author apart from their CONFIG block).
 * Only the CONFIG block differs per author. So the dashboard asks for those
 * answers in a form, fills the block in, and writes the whole page next to the
 * others in `All Coaches/` (1001-Michael-Stickler, 1002-Freddy-Davis …),
 * keeping a backup of any version it replaces.
 *
 * Answers that live in coaches.json (photo, initials, the author's own page,
 * book buttons) are saved there by `author set` — one source of truth. The page
 * comes first (step 2), before step 3 creates the author: until then those
 * answers wait in the draft, and onboard carries them over. Answers only the page uses (tab title, course
 * buttons, connection, the backup key) are kept in page-settings.local.json,
 * so building the page again keeps them.
 *
 * Plan: ../ghl-shopify subscription/plans/22-pipeline-dashboard.md §17.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { DASH, REPO_ROOT } from './lib-paths.mjs';
import { findSecret } from './lib-live.mjs';
import { replaceConfigBlock, booksFromText } from './lib-wizard.mjs';
import { coachPageConfig, parseRecordValue, initialsOf, slugOf, pageVersionId } from '../coach-router/lib-author.mjs';
import { slugConventions, withAuthor } from '../coach-router/lib-onboard.mjs';
import { bearer } from '../coach-router/lib-config.mjs';
import { STEP as S } from '../coach-router/steps.mjs';

export const TEMPLATE = resolve(DASH, 'templates', 'coach-page.template.html');
export const PAGES_DIR = resolve(REPO_ROOT, 'All Coaches');
export const PAGE_SETTINGS_FILE = resolve(DASH, 'page-settings.local.json');

/** The empty CONFIG block a template carries. */
export const TEMPLATE_BLOCK = [
  '   const CONFIG = {',
  '    // Filled in for each author by the BookCoach Author Dashboard (Onboard -> Coach page).',
  '    // Never edit a page by hand: change the answers in the form and build it again.',
  '  };',
].join('\n');

/**
 * The form. `where`: record = coaches.json (saved with `author set`),
 * page = page-settings.local.json. `config` is the CONFIG key it becomes.
 * The author's name and coach name come from step 0 and are shown, not asked.
 */
export const PAGE_FIELDS = [
  { key: 'subtitle', where: 'page', config: 'bookTitle', label: 'Line under the author’s name',
    help: 'Shown on the coach page right below the author’s name and above "Coach online". Starts as the book title — type anything else to change it; empty goes back to the book title' },
  { key: 'authorPhotoURL', where: 'record', config: 'authorPhotoURL', label: 'Author photo (web address)', help: 'Open the photo online, right-click it → "Copy image address", paste it here' },
  { key: 'authorInitials', where: 'record', config: 'authorInitials', label: 'Initials', help: 'Shown if the photo cannot load. Leave empty and they are taken from the name' },
  { key: 'authorURL', where: 'record', config: 'authorURL', label: 'Author’s own website', help: 'THIS author’s website — never another author’s. Leave empty to hide the link' },
  { key: 'books', where: 'record', type: 'lines', config: 'books', label: 'Book buttons', help: 'One per line, written as  Title|https://link-to-buy' },
  { key: 'pageTitle', where: 'page', config: 'pageTitle', label: 'Browser tab title (optional)', help: 'Leave empty to use the one shown in grey' },
  { key: 'courses', where: 'page', type: 'lines', config: 'courses', label: 'Course buttons (optional)', help: 'One per line, written as  Title|https://link. Leave empty for none' },
  // The page's four on/off switches — CONFIG show… lines, one toggle each.
  { key: 'showActivation', where: 'page', type: 'toggle', config: 'showActivation', label: '"Get my activation code" button',
    help: 'Lets customers switch on texting and calling. Keep it on — when it is off, step 2 shows as wrong' },
  { key: 'showBooks', where: 'page', type: 'toggle', config: 'showBooks', label: '"Buy the Book" button', help: 'Shows the book buttons above — needs at least one' },
  { key: 'showCourses', where: 'page', type: 'toggle', config: 'showCourses', label: '"Buy the Course" button', help: 'Shows the course buttons above — needs at least one' },
  { key: 'showMeetAuthor', where: 'page', type: 'toggle', config: 'showMeetAuthor', label: '"Meet the Author" button', help: 'Links to the author’s own website above — needs one' },
  { key: 'connection', where: 'page', type: 'select', config: 'CONNECTION', label: 'How the page reaches the coach',
    help: 'auto: through the coach router, and straight to Voiceflow if the router is ever down',
    options: [['auto', 'auto — router first, Voiceflow as backup (recommended)'], ['worker', 'worker — router only, no backup'], ['direct', 'direct — Voiceflow only (the old way)']] },
  { key: 'includeKey', where: 'page', type: 'checkbox', config: 'VF_API_KEY', label: 'Put the Voiceflow key in the page (needed for the backup)',
    help: 'Same as ms-v2 and freddy-v2: anyone viewing the page source can read the key. The file stays on this computer and is never committed' },
];

export const RECORD_KEYS = PAGE_FIELDS.filter((f) => f.where === 'record').map((f) => f.key);
const UNSAFE_TEXT = /[<>]/;

/* --------------------------------------------------------- page settings --- */

const readAll = (file) => {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; } catch { return {}; }
};

export const readPageSettings = (code, { file = PAGE_SETTINGS_FILE } = {}) => readAll(file)[code] || {};

export function savePageSettings(code, settings, { file = PAGE_SETTINGS_FILE, now = new Date() } = {}) {
  const all = readAll(file);
  all[code] = { ...settings, updatedAt: now.toISOString() };
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  return all[code];
}

/* ---------------------------------------------------------- the file name --- */

/** "michael-stickler" -> "Michael-Stickler" (the author part of a page file name). */
const titleSlug = (slug) => slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('-');

/**
 * Where this author's page lives: `All Coaches/<code>-<Author-Name>`, e.g.
 * 1001-Michael-Stickler. An author who already has a page file keeps it (found
 * by the COACH_CODE inside it, the current or a former one); a new author gets
 * the name above. A backup (`.bak-…`) is never mistaken for a page.
 */
export function pageFileFor(coach, { dir = PAGES_DIR } = {}) {
  const codes = new Set([String(coach.code), ...((coach.formerCodes || []).map(String))]);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => !/\.bak-/.test(n)).sort()) {
      if (!statSync(resolve(dir, name)).isFile()) continue;
      const m = /COACH_CODE:\s*"(\d+)"/.exec(readFileSync(resolve(dir, name), 'utf8'));
      if (m && codes.has(m[1])) return { name, path: resolve(dir, name), exists: true };
    }
  }
  const name = `${coach.code}-${titleSlug(slugOf(coach) || 'coach')}`;
  const path = resolve(dir, name);
  return { name, path, exists: existsSync(path) };
}

/* -------------------------------------------------------------- the form --- */

const linesOf = (list) => (Array.isArray(list) ? list.map((b) => `${b.title}|${b.url}`).join('\n') : '');

/** A switch nobody has set yet: the same defaults coachPageConfig writes. */
export const SWITCH_KEYS = PAGE_FIELDS.filter((f) => f.type === 'toggle').map((f) => f.key);
function switchDefault(key, coach, settings) {
  if (key === 'showBooks') return Array.isArray(coach.books) && coach.books.length > 0;
  if (key === 'showCourses') return Array.isArray(settings.courses) && settings.courses.length > 0;
  return true; // showActivation, showMeetAuthor
}

/** The form with its current answers, the fixed values, and where the file goes. Never a key. */
export function pageFormView(coach, { shared = {}, settings = {}, dir = PAGES_DIR, template = TEMPLATE } = {}) {
  const file = pageFileFor(coach, { dir });
  const name = coach.displayName || coach.name || '';
  const label = coach.coachLabel || coach.bookTitle || '';
  const value = (f) => {
    if (f.key === 'connection') return settings.connection || 'auto';
    if (f.key === 'includeKey') return settings.includeKey ?? true;
    if (f.key === 'courses') return linesOf(settings.courses);
    if (f.key === 'pageTitle') return settings.pageTitle || '';
    if (f.key === 'subtitle') return settings.subtitle || coach.bookTitle || '';
    if (f.key === 'books') return linesOf(coach.books);
    if (f.type === 'toggle') return typeof settings[f.key] === 'boolean' ? settings[f.key] : switchDefault(f.key, coach, settings);
    return coach[f.key] || '';
  };
  const placeholder = { subtitle: coach.bookTitle || '', pageTitle: withAuthor(name, label), authorInitials: initialsOf(name), books: 'Title|https://…', courses: 'Title|https://…', authorPhotoURL: 'https://…', authorURL: 'https://…' };
  const slug = slugOf(coach);
  return {
    fields: PAGE_FIELDS.map((f) => ({ ...f, value: value(f), placeholder: placeholder[f.key] || '' })),
    fixed: [
      // `step`: where the value is changed — the form links there instead of asking twice.
      { label: 'Author name (from step 0)', value: name, step: S.inputs },
      { label: 'Coach code', value: coach.code },
      { label: 'Coach router address', value: String(shared.workerUrl || '').replace(/\/+$/, '') || '(not set in coaches.json)' },
      { label: `Voiceflow version (from step ${S.voiceflow})`, value: pageVersionId(coach) || `(not set — step ${S.voiceflow})`, step: S.voiceflow },
    ],
    publishAt: slug ? slugConventions(slug).pageUrl : '',
    keyAvailable: !!bearer(shared.vfApiKey),
    templateReady: existsSync(template),
    file: { name: file.name, folder: dir, exists: file.exists, builtAt: file.exists ? statSync(file.path).mtime.toISOString() : null },
  };
}

/**
 * Check the answers. Returns { record, page, problems }. `record` holds only
 * the coaches.json fields that CHANGED (parsed), so an unchanged form runs no
 * `author set` at all. `author set` can change a saved value but not remove
 * one, so emptying a saved answer is a problem, said plainly.
 */
export function validatePageForm(values = {}, coach = {}) {
  const problems = {};
  const record = {};
  const page = {};
  const textLines = (raw) => booksFromText(raw);
  for (const f of PAGE_FIELDS) {
    const raw = values[f.key];
    if (f.where === 'record') {
      const empty = raw === undefined || raw === null || String(raw).trim() === '';
      const saved = coach[f.key];
      const hasSaved = Array.isArray(saved) ? saved.length > 0 : !!saved;
      if (empty) {
        if (hasSaved) problems[f.key] = 'this can be changed here but not emptied — type the right value (or ask to have it removed from coaches.json)';
        continue;
      }
      const [v, p] = parseRecordValue(f.key, f.type === 'lines' ? textLines(raw) : raw);
      if (p) { problems[f.key] = p; continue; }
      if (JSON.stringify(v) !== JSON.stringify(saved)) record[f.key] = v;
    } else if (f.key === 'subtitle') {
      const s = String(raw || '').trim();
      if (s.length > 120) problems.subtitle = 'keep it under 120 characters';
      else if (UNSAFE_TEXT.test(s)) problems.subtitle = 'it cannot contain < or >';
      // The book title (or nothing) is stored as "not set", so it follows the book title if that changes.
      else page.subtitle = s === String(coach.bookTitle || '').trim() ? '' : s;
    } else if (f.key === 'pageTitle') {
      const s = String(raw || '').trim();
      if (s.length > 120) problems.pageTitle = 'keep the title under 120 characters';
      else if (UNSAFE_TEXT.test(s)) problems.pageTitle = 'the title cannot contain < or >';
      else page.pageTitle = s;
    } else if (f.key === 'courses') {
      const items = textLines(raw).map((x) => { const [title, url] = x.split('|').map((y) => (y || '').trim()); return { title, url }; });
      const bad = items.find((c) => !c.title || !/^https:\/\/\S+$/.test(c.url || ''));
      if (bad) problems.courses = 'each line must be  Title|https://link';
      else if (items.some((c) => UNSAFE_TEXT.test(c.title))) problems.courses = 'a course title cannot contain < or >';
      else page.courses = items;
    } else if (f.key === 'connection') {
      const s = String(raw || 'auto');
      if (!['auto', 'worker', 'direct'].includes(s)) problems.connection = 'pick auto, worker or direct';
      else page.connection = s;
    } else if (f.key === 'includeKey') {
      page.includeKey = raw === true || raw === 'true' || raw === 'on';
    } else if (f.type === 'toggle' && raw !== undefined && raw !== null) {
      // Only what the form sent: a switch it did not send keeps its default.
      page[f.key] = raw === true || raw === 'true' || raw === 'on';
    }
  }
  if (page.connection === 'direct' && page.includeKey === false) problems.includeKey = '"direct" goes straight to Voiceflow, so it needs the key — tick this, or pick "auto"';
  return { record, page, problems };
}

/** The changed record fields as `author set` arguments (lib-actions "set" params). */
export const recordParams = (record) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, k === 'books' ? v.map((b) => `${b.title}|${b.url}`) : String(v)]));

/* ------------------------------------------------------------- the build --- */

const stampOf = (now) => now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/**
 * Build the whole page and write it. Refuses if the result would carry any
 * credential other than the Voiceflow key the form asked to include.
 */
export function buildPage(coach, settings = {}, { shared = {}, secrets = [], template = TEMPLATE, dir = PAGES_DIR, now = new Date() } = {}) {
  if (!existsSync(template)) throw new Error(`the page template is missing: ${template}`);
  const includeKey = settings.includeKey !== false;
  const vfKey = includeKey ? bearer(shared.vfApiKey) : '';
  if (includeKey && !vfKey) throw new Error('there is no Voiceflow key in coaches.json (shared.vfApiKey) — untick "Put the Voiceflow key in the page", or add the key first');
  if (!pageVersionId(coach)) throw new Error('there is no Voiceflow version ID yet — do step 1 first');
  const block = coachPageConfig(coach, {
    workerUrl: String(shared.workerUrl || '').replace(/\/+$/, ''),
    pageTitle: settings.pageTitle || '',
    connection: settings.connection || 'auto',
    courses: settings.courses || [],
    vfKey,
    by: 'the BookCoach Author Dashboard (Onboard → step 2)',
    switches: Object.fromEntries(SWITCH_KEYS.filter((k) => typeof settings[k] === 'boolean').map((k) => [k, settings[k]])),
    subtitle: settings.subtitle || '',
  });
  const page = replaceConfigBlock(readFileSync(template, 'utf8'), block);
  if (!page) throw new Error('the page template has no CONFIG block to fill in');
  // The key the form asked for is allowed; any OTHER credential is a refusal.
  const allowed = new Set(vfKey ? [vfKey, vfKey.replace(/^Bearer\s+/i, '')] : []);
  if (findSecret(page, secrets.filter((s) => !allowed.has(s)))) throw new Error('refusing to write the page: it would contain a credential');
  const file = pageFileFor(coach, { dir });
  let backup = null;
  if (existsSync(file.path)) {
    backup = `${file.name}.bak-${stampOf(now)}`;
    copyFileSync(file.path, resolve(dir, backup));
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file.path, page, 'utf8');
  return { name: file.name, folder: dir, bytes: Buffer.byteLength(page), backup, includesKey: !!vfKey, builtAt: now.toISOString() };
}

/**
 * Make a finished page the template for every author: its code is kept, its
 * CONFIG block emptied. Refused if anything secret or author-specific is left.
 */
export function refreshTemplate(fromFile, { secrets = [], coaches = [], template = TEMPLATE } = {}) {
  const out = replaceConfigBlock(readFileSync(fromFile, 'utf8'), TEMPLATE_BLOCK);
  if (!out) throw new Error(`${fromFile} has no CONFIG block`);
  if (findSecret(out, secrets)) throw new Error('refusing: a credential is in the page outside its CONFIG block');
  const names = [...new Set(coaches.flatMap((c) => [c.displayName, c.name]).filter((n) => n && n.length > 3))];
  const left = names.filter((n) => out.includes(n));
  if (left.length) throw new Error(`refusing: the code outside CONFIG still names ${left.join(', ')} — remove that first`);
  const before = existsSync(template) ? readFileSync(template, 'utf8') : '';
  writeFileSync(template, out, 'utf8');
  return { template, bytes: Buffer.byteLength(out), changed: before !== out };
}

/* --------------------------------------------- copy / open, on this PC --- */

/**
 * Put the page on the Windows clipboard, so it can be pasted straight into GHL.
 * Done HERE, never in the browser: the page can hold the Voiceflow key, and no
 * response from this server may carry one. clip.exe reads UTF-16 as Unicode
 * (tested: em dashes and arrows survive; a byte-order mark would be pasted as
 * an invisible character, so none is sent). No shell.
 */
export function copyToClipboard(text, { spawnImpl = spawn } = {}) {
  return new Promise((ok, bad) => {
    let child;
    try {
      child = spawnImpl('clip.exe', [], { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch (err) {
      return bad(err);
    }
    child.on('error', bad);
    child.on('close', (code) => (code === 0 ? ok() : bad(new Error(`the clipboard refused it (clip.exe exit ${code})`))));
    child.stdin.end(Buffer.from(String(text), 'utf16le'));
  });
}

/** Open a page file in Notepad, or its folder with the file selected. The path is always one pageFileFor made. */
export function showPage(path, how, { spawnImpl = spawn } = {}) {
  if (/["\r\n]/.test(path)) throw new Error('unexpected characters in the page path');
  // explorer wants /select,"<path>" exactly as written, so that one argument is passed verbatim.
  const [cmd, args, extra] = how === 'notepad'
    ? ['notepad.exe', [path], {}]
    : ['explorer.exe', [`/select,"${path}"`], { windowsVerbatimArguments: true }];
  const child = spawnImpl(cmd, args, { shell: false, detached: true, stdio: 'ignore', ...extra });
  if (child && child.unref) child.unref();
}
