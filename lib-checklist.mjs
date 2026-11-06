/**
 * lib-checklist.mjs — "where I stand" on one author: a short checklist shown on
 * step 0, Inputs (Muhammad, 2026-10-06). Each item ticks itself when the dashboard can see
 * the thing is saved; a person can tick or untick any item by hand. Unticking one
 * the dashboard ticked asks first (in the page) — then the person's choice wins.
 *
 * Only a person's DIFFERENCE from the automatic answer is stored, in
 * checklists.local.json (gitignored), so an item follows the dashboard again the
 * moment it agrees with it. To add an item: add it to ITEMS.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DASH } from './lib-paths.mjs';
import { PIPELINE_STEPS } from '../coach-router/steps.mjs';

export const CHECKLIST_FILE = resolve(DASH, 'checklists.local.json');

// Step numbers by NAME, so a reorder of the checklist cannot make these wrong.
const stepNo = (title) => (PIPELINE_STEPS.find((s) => s.title === title) || {}).id;
const count = (list) => (Array.isArray(list) ? list.length : 0);
const saved = (n, one, many) => `${n} ${n === 1 ? one : many} saved`;

/**
 * Each item: `label(values, page)` and `auto(values, page)` → { on, why }.
 * `values` is the author (or the draft), `page` its page settings (the courses).
 */
export const ITEMS = [
  {
    key: 'authorLink',
    label: () => 'About the author link',
    auto: (v) => ({ on: !!v.authorURL, why: `a Meet the Author link is saved at step ${stepNo('Coach page')}` }),
  },
  {
    key: 'video',
    label: () => 'YouTube video link',
    auto: (v) => ({ on: !!v.videoUrl, why: `a YouTube link is saved at step ${stepNo('Zipify page')}` }),
  },
  {
    key: 'books',
    label: (v) => `Books (${count(v.books)})`,
    auto: (v) => ({ on: count(v.books) > 0, why: `${saved(count(v.books), 'book button is', 'book buttons are')} at step ${stepNo('Coach page')}` }),
  },
  {
    key: 'courses',
    label: (v, page) => `Courses (${count(page.courses)})`,
    auto: (v, page) => ({ on: count(page.courses) > 0, why: `${saved(count(page.courses), 'course button is', 'course buttons are')} at step ${stepNo('Coach page')}` }),
  },
];

const readAll = (file) => {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; } catch { return {}; }
};

/**
 * The checklist as the page shows it. `source`:
 *   auto      ticked by the dashboard (it can see the thing is saved)
 *   you       ticked by hand
 *   unticked  unticked by hand, although the dashboard sees it — said, never hidden
 *   ''        not ticked, nothing saved yet
 */
export function checklistView(code, values = {}, page = {}, { file = CHECKLIST_FILE } = {}) {
  const mine = (readAll(file)[code] || {}).items || {};
  return ITEMS.map((it) => {
    const a = it.auto(values, page);
    const manual = typeof mine[it.key] === 'boolean' ? mine[it.key] : undefined;
    const checked = manual === undefined ? a.on : manual;
    const source = checked ? (manual === undefined ? 'auto' : 'you') : (manual === false && a.on ? 'unticked' : '');
    return { key: it.key, label: it.label(values, page), checked, auto: a.on, source, why: a.on ? a.why : '' };
  });
}

/**
 * A person ticks (true) or unticks (false) one item. Stored only when it differs
 * from the automatic answer; `null` forgets the person's choice.
 */
export function setChecklistItem(code, key, value, { values = {}, page = {}, file = CHECKLIST_FILE, now = new Date() } = {}) {
  const it = ITEMS.find((x) => x.key === key);
  if (!it) throw new Error(`no checklist item "${key}"`);
  if (value !== true && value !== false && value !== null) throw new Error('tick (true), untick (false) or forget (null)');
  const all = readAll(file);
  const mine = { items: {}, ...(all[code] || {}) };
  mine.items = { ...mine.items };
  if (value === null || value === it.auto(values, page).on) delete mine.items[key];
  else mine.items[key] = value;
  mine.updatedAt = now.toISOString();
  all[code] = mine;
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  return checklistView(code, values, page, { file });
}
