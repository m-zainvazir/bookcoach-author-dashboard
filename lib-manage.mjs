/**
 * lib-manage.mjs — edit an author's number, delete an author, and what is left after.
 *
 * The dashboard's side of plan 05. The work itself is done by coach-router commands
 * (renumber-coaches.mjs, delete-author.mjs — see lib-actions.mjs); this file decides
 * what the panels say BEFORE anything runs (is the number allowed, what will change),
 * keeps the dashboard's own files in step afterwards, and serves the clean-up list of
 * deleted authors (lib-deleted.mjs holds the record and the live checks).
 *
 * Pure where it can be: every function takes its files and clock, so the tests run
 * without a network and without touching a real file.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  readDeleted, writeDeleted, publicView, reuseWarning, usedBefore, checkLeftovers, applyChecks, signOff, prune, canUndo, remaining,
} from '../coach-router/lib-deleted.mjs';
import { PAGE_SETTINGS_FILE } from './lib-pages.mjs';

/**
 * Is `newCode` allowed as `oldCode`'s new number? → { ok, problem, warning }.
 * A warning (a number a deleted author had) does not block — it asks for a second tick.
 */
export function validateNewNumber(newCode, { oldCode = '', coaches = [], drafts = {}, deleted = { v: 1, authors: {} } } = {}) {
  const s = String(newCode || '').trim();
  if (!/^\d{4}$/.test(s)) return { ok: false, problem: 'Four digits, like 1012 — a caller keys it on a phone.' };
  if (s === String(oldCode)) return { ok: false, problem: 'That is already this author\'s number.' };
  const holder = coaches.find((c) => c.code === s);
  if (holder) return { ok: false, problem: `${s} already belongs to ${holder.displayName || holder.name}.` };
  const was = coaches.find((c) => (Array.isArray(c.formerCodes) ? c.formerCodes.map(String) : []).includes(s));
  if (was) return { ok: false, problem: `${s} used to be ${was.displayName || was.name}'s (now ${was.code}). Old numbers still lead to them, so pick another.` };
  if (drafts[s]) return { ok: false, problem: `${s} is held by an unfinished draft.` };
  return { ok: true, problem: null, warning: reuseWarning(s, { data: deleted }) };
}

/** The "what will change" list for a number change. kind: auto (the dashboard does it) | hand | keep. */
export function renumberImpact(coach, newCode, { holders = null } = {}) {
  const o = coach.code;
  const people = holders === null ? 'people holding the coach tag' : `${holders.n}${holders.capped ? '+' : ''} contact(s) hold the coach tag`;
  return [
    { kind: 'auto', sys: 'coaches.json', what: `${o} becomes ${newCode}; ${o} is kept as a former number (backup first, checked by seed)` },
    { kind: 'auto', sys: 'Cloudflare Worker', what: `coach:${newCode} written, VF_KEY_${newCode} set, the old entry removed only once the new one is live` },
    { kind: 'auto', sys: 'Subscribers', what: `access rewritten with the new number now, not in 15 minutes (${people})` },
    { kind: 'auto', sys: 'This dashboard', what: `sign-offs, test results, page settings and the last reading move to ${newCode}` },
    { kind: 'auto', sys: 'GHL contacts', what: 'the coach_code field is rewritten by the Worker\'s own sync, nothing to do by hand' },
    { kind: 'hand', sys: 'Coach page in GHL', what: `rebuild it (Onboard → Coach page) and paste it once; the old page keeps working meanwhile because ${o} stays a former number` },
    { kind: 'keep', sys: 'Shopify product, Course360, tags', what: 'carry no author number, nothing to change' },
  ];
}

/** The "what will change" list for a delete. */
export function deleteImpact(coach, { holders = null } = {}) {
  const c = coach.code;
  const subs = holders === null ? 'People holding the coach tag lose this coach at the next sync' : `${holders.n}${holders.capped ? '+' : ''} contact(s) hold the coach tag and lose this coach at the next sync`;
  return [
    { kind: 'auto', sys: 'coaches.json', what: `${c} removed (backup kept; undo possible for 30 days)` },
    { kind: 'auto', sys: 'Cloudflare Worker', what: `coach:${c} deleted from KV, secret VF_KEY_${c} deleted` },
    { kind: 'auto', sys: 'This dashboard', what: 'the row, readings, page settings and sign-offs are set aside' },
    { kind: 'hand', sys: 'Subscribers', what: subs },
    { kind: 'hand', sys: 'GHL, Shopify, Zipify, Voiceflow', what: 'left alone. They appear as a clean-up list under the greyed author, with how to remove each' },
  ];
}

/** How many contacts hold this coach's tag (one search, capped at 100). → { n, capped } | null when it cannot be read. */
export async function tagHolders(ctx, coach) {
  if (!coach.ghlTag) return { n: 0, capped: false };
  try {
    const data = await ctx.ghl('/contacts/search', { method: 'POST', body: { locationId: ctx.locationId, pageLimit: 100, filters: [{ field: 'tags', operator: 'contains', value: [coach.ghlTag] }] } });
    const n = (data.contacts || []).length;
    return { n, capped: n === 100 };
  } catch {
    return null;
  }
}

const readJson = (file) => { try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; } catch { return {}; } };

/**
 * After a renumber or delete: the dashboard's own files that are keyed by author number.
 * `page-settings.local.json` — moved to the new number, or dropped. Readings are forgotten by
 * the caller (pipeline.refresh). A number given out again must start clean, never inherit a
 * deleted author's page answers.
 */
export function followNumber({ from, to = null }, { pageFile = PAGE_SETTINGS_FILE } = {}) {
  const moved = [];
  const all = readJson(pageFile);
  if (all[from]) {
    if (to && !all[to]) all[to] = all[from];
    delete all[from];
    writeFileSync(pageFile, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
    moved.push('page settings');
  }
  return moved;
}

/* ------------------------------------------------------------- the clean-up list --- */

/** Open clean-ups (the greyed rows) and recently finished ones (a line under the grid). Never a snapshot. */
export function deletedView({ file, now = new Date() } = {}) {
  const data = readDeleted(file);
  if (prune(data, now)) writeDeleted(data, file);
  const recs = Object.values(data.authors).filter((r) => !r.gone);
  return {
    open: recs.filter((r) => !r.finishedAt).map((r) => publicView(r, now)).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)),
    finished: recs.filter((r) => r.finishedAt).map((r) => ({ code: r.code, name: r.name, finishedAt: r.finishedAt })).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)),
  };
}

/**
 * Read the live systems for one deleted author's leftovers, keep the answers, return the view.
 * `ctx` is the pipeline's read context. A check that cannot tell leaves the item as it was.
 */
export async function runCheck(code, ctx, { file, now = new Date() } = {}) {
  const data = readDeleted(file);
  const rec = data.authors[code];
  if (!rec || !rec.snapshot) throw new Error(`no clean-up open for ${code}`);
  applyChecks(rec, await checkLeftovers(rec, ctx), now);
  writeDeleted(data, file);
  return publicView(rec, now);
}

/** Sign off (or take back) one leftover no API can read. */
export function runSignoff(code, id, { note = '', value = true, file, now = new Date() } = {}) {
  const data = readDeleted(file);
  const rec = data.authors[code];
  if (!rec) throw new Error(`no clean-up open for ${code}`);
  const [ok, problem] = signOff(rec, id, { note, value, now });
  if (!ok) throw new Error(problem);
  writeDeleted(data, file);
  return publicView(rec, now);
}

export { readDeleted, usedBefore, reuseWarning, canUndo, remaining };
