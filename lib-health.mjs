/**
 * lib-health.mjs — after launch (checklist steps 17-25): has anything quietly broken?
 *
 * Neither system's run history is readable from here — Shopify Flow has no
 * public API, and the GHL workflow API returns names and statuses, not runs. So
 * every check below detects breakage BY ITS EFFECT on the records, which is
 * this project's standing rule for verifying anything.
 * Plan: ghl-shopify subscription/plans/22-pipeline-dashboard.md §6.
 *
 * Network is injected (`ctx`, built by lib-readers.mjs), so every check is
 * testable offline. Never throws: a failed read is a FAIL naming what could not
 * be read, and one outage cannot hide the other checks.
 *
 * ZERO KV LIST CALLS (plan 22 rule 2). Trial end dates come from the GHL
 * contact (`coach_trial_ends`, written by the Worker), not from listing trial:.
 *
 *   ctx.health()                     Worker /health (with the token)
 *   ctx.census(tags)                 contacts holding any of `tags`, custom fields as { id: value }
 *   ctx.byField(fieldId, value)      contacts whose custom field equals value
 *   ctx.subscriptions({ allowTest }) paying subscriptions, read by the Worker's own reader
 *   ctx.workflows()                  GHL workflow names + statuses
 *   ctx.shopifyOrders({ since })     recent Shopify orders with tags + product ids
 *
 * Status per check: OK, WARN (worth a look, not broken), FAIL (broken, or
 * could not be read), SKIP (cannot be read with the access configured — says why).
 */

import { FIELD_IDS, TRIAL_STARTED_TAG } from '../coach-router/lib-verify-author.mjs';

export const HEALTH_CHECKS = [
  { id: 'H1', title: 'Worker is healthy', means: 'the cron, the keys and the entitlement sync — revocation and expiry both ride the cron', steps: [19, 24, 25] },
  { id: 'H2', title: 'Flow A starts every trial', means: 'a paid bundle order older than 22 days with no coach-started tag: the 21-day backstop did not fire', steps: [17] },
  { id: 'H3', title: 'No delivered-manual order left un-run', means: 'tagging an order does nothing by itself — someone has to press Run workflow', steps: [18] },
  { id: 'H4', title: 'Trials actually end', means: 'a tag holder still on trial after their end date: the expiry sweep is not running', steps: [21] },
  { id: 'H5', title: 'No access nobody granted', means: 'a coach tag with no trial, no subscription and no known reason', steps: [23] },
  { id: 'H6', title: 'Status and tag agree', means: 'coach_status is bookkeeping, the tag is entitlement — drift between them fails silently', steps: [19] },
  { id: 'H7', title: 'No test contacts left entitled', means: 'a +verify- contact still holding a coach tag is granted a lease every cron', steps: [] },
  { id: 'H8', title: 'Trial email workflow is published', means: 'the ONE workflow that sends the welcome and day 7/9/10 emails', steps: [20] },
  { id: 'H9', title: 'Paying subscribers carry their tag', means: 'the reconcile tags a subscriber within 15 minutes; one still untagged means the purchase path is stuck', steps: [22] },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * `coach_trial_ends` as the Worker writes it — "2 October 2026", a UTC date
 * (formatTrialEnd). Parsed EXPLICITLY as UTC: Date.parse reads it as local
 * midnight, which is five hours early in Pakistan. Returns ms or NaN.
 */
export function parseTrialEnd(text) {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*$/.exec(String(text || ''));
  if (!m) return NaN;
  const month = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  if (month < 0) return NaN;
  const ms = Date.UTC(Number(m[3]), month, Number(m[1]));
  return new Date(ms).getUTCDate() === Number(m[1]) ? ms : NaN;
}

/** The sweep runs every 15 minutes during the end DAY; overdue = the day is over, plus an hour. */
export const trialOverdue = (endMs, now) => Number.isFinite(endMs) && now.getTime() > endMs + 25 * 3600 * 1000;

const result = (check, status, detail = '', items = [], fix = '') => {
  const def = HEALTH_CHECKS.find((h) => h.id === check);
  return { id: check, title: def.title, means: def.means, steps: def.steps, status, detail, items, fix };
};

const field = (c, key) => (c.fields || {})[FIELD_IDS[key]];
const DAY = 24 * 3600 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Every check, in order. `coaches` is the registry; `cfg` the runtime config
 * (lib-config runtimeConfig); `settings` the pipeline switches (knownGrants).
 */
export async function healthChecks(ctx, { coaches = [], cfg = {}, settings = {}, now = new Date() } = {}) {
  const out = [];
  const safe = async (id, fn) => {
    try {
      await fn();
    } catch (err) {
      out.push(result(id, 'FAIL', `could not read: ${err.message}`));
    }
  };
  const coachTags = coaches.map((c) => c.ghlTag).filter(Boolean);
  const staffTag = String(cfg.staffTag || '').toLowerCase();
  const tagToCoach = new Map(coaches.filter((c) => c.ghlTag).map((c) => [c.ghlTag, c]));
  const known = new Set(settings.knownGrants || []);

  // Shared reads, made once. A failure surfaces in every check that needed it.
  let census = null;
  let censusErr = null;
  try {
    census = await ctx.census([...coachTags, staffTag]);
  } catch (err) {
    censusErr = err;
  }
  const needCensus = () => {
    if (censusErr) throw censusErr;
    return census;
  };
  let subs = null;
  const getSubs = async () => (subs || (subs = await ctx.subscriptions({ allowTest: cfg.allowTestSubscriptions === true })));
  let orders = null;
  const getOrders = async () => (orders || (orders = await ctx.shopifyOrders({ since: isoDay(now.getTime() - 60 * DAY) })));
  const shopifyOff = ctx.shopifyConfigured === false;

  // H1 — the Worker ---------------------------------------------------------------
  await safe('H1', async () => {
    const h = await ctx.health();
    const problems = Array.isArray(h.problems) ? h.problems : [];
    const sync = h.sync || {};
    const unresolved = (h.coaches || []).filter((c) => !c.keyResolved).map((c) => c.code);
    const bad = h.ok !== true || problems.length || h.httpStatus >= 400 || sync.lastOk === false || unresolved.length;
    const c = sync.counts || {};
    out.push(bad
      ? result('H1', 'FAIL', `/health ${h.httpStatus || ''} ok=${h.ok}`, [...problems, ...(unresolved.length ? [`key not resolved: ${unresolved.join(', ')}`] : [])], 'read the problems above; npm run subs -- --dry shows the reconcile')
      : result('H1', 'OK', `${(h.coaches || []).length} coaches, ${c.trialsTracked ?? '?'} trials tracked, ${c.contacts ?? '?'} entitled contacts, entitlement ${sync.entitlementMode || '?'}`));
  });

  // H2 + H3 — Shopify Flows, by effect -----------------------------------------------
  if (shopifyOff) {
    out.push(result('H2', 'SKIP', 'Shopify is not configured in coaches.json', [], 'shared.shopifyShop + shopifyClientId + shopifyClientSecret (plans/21 §D)'));
    out.push(result('H3', 'SKIP', 'Shopify is not configured in coaches.json'));
  } else {
    const bundleIds = new Set(coaches.map((c) => c.shopifyProductId).filter(Boolean).map(String));
    await safe('H2', async () => {
      const list = await getOrders();
      const late = list.filter((o) =>
        o.productIds.some((p) => bundleIds.has(p))
        && !o.cancelledAt
        && o.financial === 'PAID'
        && now.getTime() - Date.parse(o.createdAt) > 22 * DAY
        && !o.tags.includes('coach-started'));
      const bundles = list.filter((o) => o.productIds.some((p) => bundleIds.has(p)));
      out.push(late.length
        ? result('H2', 'FAIL', `${late.length} paid bundle order(s) past 22 days with no trial started`, late.map((o) => `${o.name} (${isoDay(Date.parse(o.createdAt))})`),
          'open the order in Shopify → Flow run log for Flow A. Then tag delivered-manual + Run workflow to start the trial now')
        : result('H2', 'OK', `${bundles.length} bundle order(s) in the last 60 days, none overdue`));
    });
    await safe('H3', async () => {
      const list = await getOrders();
      const waiting = list.filter((o) => !o.cancelledAt && o.tags.includes('delivered-manual') && !o.tags.includes('coach-started'));
      const stale = waiting.filter((o) => now.getTime() - Date.parse(o.updatedAt || o.createdAt) > 3600 * 1000);
      out.push(stale.length
        ? result('H3', 'FAIL', `${stale.length} order(s) tagged delivered-manual but never run`, stale.map((o) => o.name), 'Shopify order → More actions → Automate with Flow → Run workflow')
        : waiting.length
          ? result('H3', 'WARN', `${waiting.length} order(s) just tagged — press Run workflow`, waiting.map((o) => o.name))
          : result('H3', 'OK', 'every delivered-manual order has started its trial'));
    });
  }

  // H4 — trials end -----------------------------------------------------------------
  await safe('H4', async () => {
    const holders = needCensus();
    const onTrial = holders.filter((c) => field(c, 'coach_status') === 'trial' && c.tags.some((t) => tagToCoach.has(t)));
    const overdue = [];
    const unreadable = [];
    for (const c of onTrial) {
      const raw = field(c, 'coach_trial_ends');
      if (!raw) continue; // trials started before coach_trial_ends existed — nothing to compare
      const end = parseTrialEnd(raw);
      if (!Number.isFinite(end)) unreadable.push(`${c.id} "${raw}"`);
      else if (trialOverdue(end, now)) overdue.push(`${c.id} ended ${raw}`);
    }
    const mode = String(cfg.trialExpiryMode || 'off');
    if (overdue.length) {
      out.push(result('H4', 'FAIL', `${overdue.length} trial(s) past their end date still hold the coach tag`, overdue,
        mode === 'on' ? 'the sweep should have ended these: check /health errors and npm run subs -- --dry' : `config.trialExpiryMode is "${mode}" — nothing is ending trials`));
    } else if (mode !== 'on') {
      out.push(result('H4', 'WARN', `config.trialExpiryMode is "${mode}" — no trial will ever end`, [], 'set shared.config.trialExpiryMode "on", then npm run push'));
    } else if (unreadable.length) {
      out.push(result('H4', 'WARN', 'trial end date(s) not in the expected "2 October 2026" form', unreadable));
    } else {
      out.push(result('H4', 'OK', `${onTrial.length} on trial, none overdue`));
    }
  });

  // H5 + H6 + H7 — what the tag holders look like -----------------------------------------
  await safe('H5', async () => {
    const holders = needCensus();
    const paying = await getSubs();
    const unexplained = [];
    for (const c of holders) {
      if (known.has(c.id) || (staffTag && c.tags.includes(staffTag))) continue;
      const status = field(c, 'coach_status');
      if (status === 'expired') continue; // H6 reports it
      for (const t of c.tags) {
        const coach = tagToCoach.get(t);
        if (!coach) continue;
        const trialCode = field(c, 'coach_code');
        const sameCoach = (x) => String(x) === String(coach.code) || (coach.formerCodes || []).map(String).includes(String(x));
        const onTrial = status === 'trial' && (!trialCode || sameCoach(trialCode));
        const subscribed = paying.some((s) => s.contactId === c.id && s.productId === coach.ghlProductId);
        if (!onTrial && !subscribed) unexplained.push(`${c.id} holds ${t} — coach_status "${status || ''}", no subscription`);
      }
    }
    out.push(unexplained.length
      ? result('H5', 'FAIL', `${unexplained.length} coach tag(s) with no trial, no subscription and no known reason`, unexplained,
        'remove the tag in GHL — or, if it is deliberate, npm run pipeline -- config --known-grant <contactId>')
      : result('H5', 'OK', `${holders.length} tag holder(s), every one explained`));
  });

  await safe('H6', async () => {
    const holders = needCensus();
    const drift = [];
    for (const c of holders) {
      if (field(c, 'coach_status') === 'expired' && c.tags.some((t) => tagToCoach.has(t))) drift.push(`${c.id}: coach_status "expired" but still holds ${c.tags.filter((t) => tagToCoach.has(t)).join(', ')}`);
    }
    const holderIds = new Set(holders.map((c) => c.id));
    const paying = await getSubs().catch(() => []);
    for (const status of ['trial', 'active']) {
      for (const c of await ctx.byField(FIELD_IDS.coach_status, status)) {
        if (holderIds.has(c.id) || c.tags.some((t) => tagToCoach.has(t))) continue;
        if (status === 'active' && paying.some((s) => s.contactId === c.id)) continue; // H9's question
        drift.push(`${c.id}: coach_status "${status}" but holds no coach tag — gets nothing, silently`);
      }
    }
    out.push(drift.length
      ? result('H6', 'FAIL', `${drift.length} contact(s) where coach_status and the tag disagree`, drift, 'fix the contact in GHL: the tag is what grants access, coach_status only records it')
      : result('H6', 'OK', 'every coach_status matches its tag'));
  });

  await safe('H7', async () => {
    const tests = needCensus().filter((c) => /\+verify-/.test(c.email) && c.tags.some((t) => tagToCoach.has(t)));
    out.push(tests.length
      ? result('H7', 'FAIL', `${tests.length} verify-author test contact(s) still entitled`, tests.map((c) => c.id), 'delete them in GHL (checklist step 16)')
      : result('H7', 'OK', 'no test contact holds a coach tag'));
  });

  // H8 — the one trial email workflow ---------------------------------------------------
  await safe('H8', async () => {
    let list;
    try {
      list = await ctx.workflows();
    } catch (err) {
      if (/401/.test(err.message)) return out.push(result('H8', 'SKIP', 'the GHL token has no workflows.readonly scope'));
      throw err;
    }
    const hits = list.filter((w) => /delivery\s*[→>-]+\s*trial start/i.test(w.name || ''));
    const live = hits.filter((w) => w.status === 'published');
    out.push(live.length
      ? result('H8', 'OK', live.map((w) => w.name).join(', '), [], `it triggers on the ${TRIAL_STARTED_TAG} tag — the API cannot show the trigger, so a workflow with NO trigger still reads published`)
      : result('H8', 'FAIL', hits.length ? `"${hits[0].name}" is ${hits[0].status}` : 'no workflow named "Book Coach — Delivery → Trial Start"', [], 'publish it — without it no trial customer gets a welcome or day 7/9/10 email'));
  });

  // H9 — paying subscribers carry the tag -------------------------------------------------
  await safe('H9', async () => {
    const holders = needCensus();
    const paying = await getSubs();
    const byId = new Map(holders.map((c) => [c.id, c]));
    const untagged = [];
    for (const s of paying) {
      const coach = coaches.find((c) => c.ghlProductId && c.ghlProductId === s.productId);
      if (!coach || !coach.ghlTag) continue;
      const c = byId.get(s.contactId);
      if (!c || !c.tags.includes(coach.ghlTag)) untagged.push(`${s.contactId} pays for ${coach.code} but has no ${coach.ghlTag}`);
    }
    const mode = String(cfg.tagOnSubscription || 'off');
    if (!untagged.length) out.push(result('H9', 'OK', `${paying.filter((s) => coaches.some((c) => c.ghlProductId === s.productId)).length} paying coach subscriber(s), all tagged`));
    else if (mode !== 'on') out.push(result('H9', 'WARN', `${untagged.length} subscriber(s) without the tag, and config.tagOnSubscription is "${mode}"`, untagged, 'they still text and call (entitled by subscription), but get no course — so no activation code'));
    else out.push(result('H9', 'WARN', `${untagged.length} subscriber(s) not tagged yet — the reconcile tags within 15 minutes`, untagged, 'if this is still here an hour from now, the purchase path is stuck: npm run subs -- --dry'));
  });

  const order = HEALTH_CHECKS.map((h) => h.id);
  return out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** OK / WARN / FAIL for the whole set — the worst wins; SKIP never fails it. */
export function healthOverall(rows) {
  if (rows.some((r) => r.status === 'FAIL')) return 'FAIL';
  if (rows.some((r) => r.status === 'WARN')) return 'WARN';
  return 'OK';
}

/**
 * What changed since the last alert run — the only thing worth a notification.
 * Keyed on check id + status, so a check that stays broken notifies once.
 */
export function healthChanges(prev = {}, rows = []) {
  const now = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  const broke = rows.filter((r) => r.status === 'FAIL' && prev[r.id] !== 'FAIL');
  const recovered = Object.entries(prev).filter(([id, st]) => st === 'FAIL' && now[id] && now[id] !== 'FAIL').map(([id]) => rows.find((r) => r.id === id));
  return { broke, recovered, state: now };
}
