/**
 * lib-readings.mjs — the last reading of each author, kept between runs
 * (Muhammad, 2026-10-06). Reading the live systems took ~50 s for six authors
 * and grows with every new one, so the dashboard opens on the LAST reading and
 * reads again only what Refresh names: everything, the authors ticked, or the
 * one author open in the Onboard tab.
 *
 * Kept in readings.local.json (gitignored), one entry per author plus one for
 * the health checks. An entry is used only while
 *   - the step list is the one it was read with — a reorder would put every
 *     cell under the wrong step, so the whole file is dropped
 *   - its inputs are unchanged: for an author, the coaches.json entry, the
 *     sign-offs and the last end-to-end test. Change one (`author set`, a
 *     sign-off from the terminal) and that author alone is read again.
 * When the CHECKS changed since (the dashboard was updated), the entry is still
 * shown — marked oldChecks, so the page can say "Refresh to see the new checks".
 *
 * Only the inputs' fingerprint is stored, never the inputs; and nothing is
 * written that carries a credential.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DASH } from './lib-paths.mjs';
import { PIPELINE_STEPS } from '../coach-router/steps.mjs';

export const READINGS_FILE = resolve(DASH, 'readings.local.json');

/** The code that decides what a reading says. Changed since → the reading is marked oldChecks. */
export const CHECK_FILES = [
  '../coach-router/steps.mjs', '../coach-router/lib-author.mjs', '../coach-router/lib-onboard.mjs',
  '../coach-router/lib-readers.mjs', '../coach-router/lib-shopify.mjs', '../coach-router/lib-verify-author.mjs',
  './lib-pipeline.mjs', './lib-health.mjs', './lib-help.mjs',
].map((f) => resolve(DASH, f));

const VERSION = 1;
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The fingerprint of anything JSON: how a reading knows its inputs are still the same. */
export const fingerprint = (value) => hash(JSON.stringify(value === undefined ? null : value));

/** The step list's shape: ids, titles, what each needs. */
export const layoutKey = (steps = PIPELINE_STEPS) => fingerprint(steps.map((s) => [s.id, s.title, s.needs]));

export function checksKey(files = CHECK_FILES) {
  return hash(files.map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : '')).join('\u0000'));
}

/**
 * Open the store. `secrets()` lists the values that must never be written —
 * the same exact-value check the server makes on every response.
 */
export function openReadings({ file = READINGS_FILE, layout = layoutKey(), checks = checksKey(), secrets = () => [], now = () => new Date() } = {}) {
  let entries = {};
  try {
    const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (saved && saved.v === VERSION && saved.layout === layout && saved.entries && typeof saved.entries === 'object') entries = saved.entries;
  } catch { /* unreadable: start empty — the first load reads live, as before */ }

  const save = () => {
    const text = `${JSON.stringify({ v: VERSION, layout, entries }, null, 1)}\n`;
    if (secrets().some((s) => text.includes(s))) return false;
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, file);
    return true;
  };
  const about = (e) => ({ at: e.readAt, tookMs: e.tookMs, oldChecks: e.checks !== checks });

  return {
    /** The saved reading, if its inputs are still the same. → { value, reading } | null */
    get(key, inputs) {
      const e = entries[key];
      if (!e || e.inputs !== fingerprint(inputs)) return null;
      return { value: e.value, reading: about(e) };
    },
    /** Keep a fresh reading. → its `reading`. Not written to disk if it carries a credential. */
    put(key, inputs, value, tookMs) {
      const e = { inputs: fingerprint(inputs), checks, readAt: now().toISOString(), tookMs: Math.round(tookMs), value };
      const before = entries[key];
      entries[key] = e;
      if (!save()) { if (before) entries[key] = before; else delete entries[key]; }
      return about(e);
    },
    /** Read these again next time. `keys`: a list, or a test on the key. */
    forget(keys) {
      const drop = typeof keys === 'function' ? keys : (k) => keys.includes(k);
      const gone = Object.keys(entries).filter(drop);
      for (const k of gone) delete entries[k];
      if (gone.length) save();
      return gone;
    },
    keys: () => Object.keys(entries),
  };
}

/**
 * The saved reading while its inputs are the same (and it is not older than
 * `maxAgeMs`), else a live one — timed, saved, returned. Without a store: live.
 * → the value, with `reading: { at, tookMs, oldChecks }` when there is a store.
 */
export async function keptReading(store, key, inputs, readLive, { maxAgeMs = Infinity, clock = Date.now } = {}) {
  if (!store) return readLive();
  const hit = store.get(key, inputs);
  if (hit && clock() - Date.parse(hit.reading.at) <= maxAgeMs) return { ...hit.value, reading: hit.reading };
  const t = clock();
  const value = await readLive();
  return { ...value, reading: store.put(key, inputs, value, clock() - t) };
}

/**
 * Which saved readings a refresh drops: `codes` — 'all' or a list — the health checks, and
 * the Access list (plan 07). The Access list reads the same GHL contacts as the health checks,
 * so a health refresh drops it too; it is read again only when the Access tab or column asks.
 */
export function refreshDrops({ codes = 'all', health = true, access = false } = {}) {
  const list = codes === 'all' ? null : (codes || []).map(String);
  return (key) => (key === 'health' ? !!health : key === 'access' ? !!(access || health) : key.startsWith('author:') && (!list || list.includes(key.slice(7))));
}
