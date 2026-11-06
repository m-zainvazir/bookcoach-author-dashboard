/**
 * lib-access.mjs — who has access right now: every person × author, Paid / Trial / Gift /
 * Staff / Test / Unknown, and the days left on a trial. Plan: plans/07-who-has-access.md.
 *
 * Pure: no I/O. lib-live.mjs reads GHL (one tag census + the paying subscriptions) and the
 * last 30 days of Shopify orders, and hands them in. Never KV, never the Worker: zero load on
 * Cloudflare (the project's standing rule).
 *
 * THE TAG IS THE ACCESS. The Worker removes an author's tag when a trial ends and the reconcile
 * keeps it on a payer — so "has access" is "holds the author's tag". Everything else only
 * explains WHY they have it. The order the rules are tried in (§3 of the plan):
 *   Test → Staff → Paid → Gift → Trial → Unknown
 */

import { FIELD_IDS } from '../coach-router/lib-verify-author.mjs';
import { parseTrialEnd } from './lib-health.mjs';

export const ACCESS_TYPES = ['Paid', 'Trial', 'Gift', 'Staff', 'Test', 'Unknown'];
/** Every column the table can sort by. `daysLeft` is the default (soonest first). */
export const SORT_COLUMNS = ['person', 'code', 'author', 'access', 'daysLeft', 'since'];
export const DEFAULT_SORT = { column: 'daysLeft', dir: 'asc' };
/** How far back Shopify orders are read — only to tell a gift from a buyer. A trial is 10 days. */
export const ORDER_WINDOW_DAYS = 30;

const DAY = 24 * 3600 * 1000;
const lower = (x) => String(x || '').toLowerCase();
const orderKey = (x) => String(x || '').trim().replace(/^#/, '');

/** The GHL page for a contact. */
export const ghlContactUrl = (locationId, contactId) =>
  locationId && contactId ? `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/contacts/detail/${encodeURIComponent(contactId)}` : '';

/** Whole days from today (UTC) to the end day: 10 on 5 Nov for "15 November 2026"; 0 on the day; negative once past. */
export function daysLeftOf(endMs, now = new Date()) {
  if (!Number.isFinite(endMs)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((endMs - today) / DAY);
}

/**
 * The rows and the per-author counts.
 *   census          contacts holding any coach tag or the staff tag ({ id, email, tags, fields, dateAdded })
 *   subscriptions   the paying ones ({ contactId, productId })
 *   orders          Shopify orders of the last 30 days ({ name, cancelledAt }), or null when not read
 *   coaches         coaches.json
 *   staffTag        the runtime config's staff tag ('' = none)
 */
export function accessView({ census = [], subscriptions = [], orders = null, coaches = [], staffTag = '', locationId = '', now = new Date() } = {}) {
  const staff = lower(staffTag);
  const byTag = new Map(coaches.filter((c) => c.ghlTag).map((c) => [lower(c.ghlTag), c]));
  const cancelled = orders ? new Set(orders.filter((o) => o.cancelledAt).map((o) => orderKey(o.name))) : null;
  const field = (c, key) => (c.fields || {})[FIELD_IDS[key]];
  const sameCoach = (coach, code) => String(code) === String(coach.code) || (coach.formerCodes || []).map(String).includes(String(code));
  const rows = [];

  for (const c of census) {
    const tags = (c.tags || []).map(lower);
    const held = [...new Set(tags)].map((t) => byTag.get(t)).filter(Boolean);
    const isStaff = !!staff && tags.includes(staff);
    const isTest = /\+verify-/i.test(c.email || '');
    const status = lower(field(c, 'coach_status'));
    const trialCode = field(c, 'coach_code');
    const startMs = Date.parse(field(c, 'coach_trial_started') || '');
    const endRaw = field(c, 'coach_trial_ends') || '';
    const endMs = parseTrialEnd(endRaw);
    const base = { contactId: c.id, email: c.email || '', ghlUrl: ghlContactUrl(locationId, c.id) };

    // The staff tag grants every coach: one row, when it is all they hold.
    if (isStaff && !held.length) {
      rows.push({ ...base, code: '', author: 'All coaches', access: isTest ? 'Test' : 'Staff', daysLeft: null, endsAt: null, since: c.dateAdded || null, note: 'the staff tag gives every coach' });
      continue;
    }

    for (const coach of held) {
      const row = { ...base, code: coach.code, author: coach.displayName || coach.name || '', trialDays: Number(coach.trialDays) || 10, daysLeft: null, endsAt: null, since: c.dateAdded || null, note: '' };
      const paid = subscriptions.some((s) => s.contactId === c.id && s.productId && s.productId === coach.ghlProductId);
      // The trial fields belong to ONE author per contact: the one coach_code names (blank = the only one).
      const thisTrial = status === 'trial' && (!trialCode || sameCoach(coach, trialCode));
      if (thisTrial) {
        if (Number.isFinite(startMs)) row.since = new Date(startMs).toISOString();
        if (Number.isFinite(endMs)) { row.daysLeft = daysLeftOf(endMs, now); row.endsAt = new Date(endMs).toISOString().slice(0, 10); }
      }

      if (isTest) { row.access = 'Test'; row.note = 'a step-14 test contact — delete it in GHL'; }
      else if (isStaff) { row.access = 'Staff'; row.daysLeft = null; row.endsAt = null; }
      else if (paid) { row.access = 'Paid'; row.daysLeft = null; row.endsAt = null; }
      else if (thisTrial) {
        const order = orderKey(field(c, 'shopify_order_number'));
        row.access = cancelled && order && cancelled.has(order) ? 'Gift' : 'Trial';
        if (row.daysLeft === null) row.note = endRaw ? `end date "${endRaw}" could not be read` : 'no end date on the contact';
        else if (row.daysLeft < 0) row.note = 'ended — the tag was not removed yet';
      } else if (status === 'trial') {
        row.access = 'Trial';
        row.note = `the end date on the contact is for coach ${trialCode} — GHL keeps one per person`;
      } else {
        row.access = 'Unknown';
        row.note = `holds the tag, no subscription and no trial (coach_status "${status || 'empty'}")`;
      }
      rows.push(row);
    }
  }

  const summary = coaches.map((coach) => {
    const mine = rows.filter((r) => r.code === coach.code);
    const count = Object.fromEntries(ACCESS_TYPES.map((t) => [t, mine.filter((r) => r.access === t).length]));
    return { code: coach.code, author: coach.displayName || coach.name || '', total: mine.length, ...count };
  });
  const people = new Set(rows.map((r) => r.contactId)).size;
  return { rows: sortRows(rows), summary, people, giftChecked: !!orders };
}

/**
 * Sort by any column, either way. Rows with no days left (paid, staff, an undated trial)
 * always come after the dated ones, so "soonest first" never opens on a wall of payers.
 * Ties: coach #, then email — so the order never jumps between reads.
 */
export function sortRows(rows, { column = DEFAULT_SORT.column, dir = DEFAULT_SORT.dir } = {}) {
  const col = SORT_COLUMNS.includes(column) ? column : DEFAULT_SORT.column;
  const sign = dir === 'desc' ? -1 : 1;
  const text = (r) => ({ person: lower(r.email), code: r.code || 'zzzz', author: lower(r.author), access: r.access, since: r.since || '' })[col];
  const tie = (a, b) => (a.code || 'zzzz').localeCompare(b.code || 'zzzz') || lower(a.email).localeCompare(lower(b.email));
  return [...rows].sort((a, b) => {
    if (col === 'daysLeft') {
      const an = a.daysLeft === null || a.daysLeft === undefined;
      const bn = b.daysLeft === null || b.daysLeft === undefined;
      if (an !== bn) return an ? 1 : -1;
      if (!an && a.daysLeft !== b.daysLeft) return sign * (a.daysLeft - b.daysLeft);
      return tie(a, b);
    }
    return sign * String(text(a)).localeCompare(String(text(b))) || tie(a, b);
  });
}

/** The rows for the "ending soon" strip: dated trials and gifts within `days` (ended ones included — they need a look). */
export const endingSoon = (rows, days) => rows.filter((r) => (r.access === 'Trial' || r.access === 'Gift') && r.daysLeft !== null && r.daysLeft <= days);
