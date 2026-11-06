/**
 * lib-live.mjs — one way to open the pipeline against the live systems.
 *
 * `npm run pipeline` and the dashboard server both call openPipeline(), so the
 * terminal and the browser can never show two different answers. The pure
 * logic is in lib-pipeline.mjs / lib-health.mjs; this file only wires the
 * registry, the readers, the sign-offs and the switches together.
 * Plan: ghl-shopify subscription/plans/22-pipeline-dashboard.md §3.
 */

import { loadConfig, runtimeConfig } from '../coach-router/lib-config.mjs';
import { makeReaders } from '../coach-router/lib-readers.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DASH } from './lib-paths.mjs';
import { readState, readSignoffs } from '../coach-router/lib-registry.mjs';
import { checklistView } from './lib-checklist.mjs';
import { readPageSettings } from './lib-pages.mjs';
import { STEP } from '../coach-router/steps.mjs';
import { pipelineFor } from './lib-pipeline.mjs';
import { healthChecks, healthOverall } from './lib-health.mjs';
import { accessView, ORDER_WINDOW_DAYS } from './lib-access.mjs';
import { healthHelp } from './lib-help.mjs';
import { readSettings, publicSettings } from './lib-settings.mjs';
import { shopifyConfig } from '../coach-router/lib-shopify.mjs';
import { PIPELINE_STEPS, AFTER_LAUNCH, DOC } from '../coach-router/steps.mjs';
import { openReadings, keptReading, refreshDrops } from './lib-readings.mjs';
import { snapshotSecrets } from '../coach-router/lib-deleted.mjs';

/**
 * Every credential-shaped value in coaches.json. The server refuses to send any
 * response containing one of them — an exact-value check, so it can neither
 * miss a real secret nor false-alarm on an ordinary word.
 */
export function secretValues(shared = {}, coaches = [], settings = {}) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && v.trim().length >= 8) out.add(v.trim()); };
  for (const [k, v] of Object.entries(shared)) if (/token|secret|key|sid|password/i.test(k)) add(v);
  for (const c of coaches) { add(c.vfKey); add(c.apiKey); }
  add(settings.uptimeApiKey);
  // A personal key travels as "Bearer <key>" — the bare key must not leak either.
  for (const v of [...out]) if (/^bearer\s+/i.test(v)) add(v.replace(/^bearer\s+/i, ''));
  return [...out];
}

export function findSecret(text, secrets) {
  const s = String(text);
  return secrets.find((v) => s.includes(v)) || null;
}

/**
 * `saved`: a readings file (lib-readings.mjs). With one — the dashboard — an
 * author is read from the live systems only when it has no saved reading, its
 * inputs changed, or refresh() names it. Without one — the terminal — every
 * call reads live, as it always did.
 */
export function openPipeline({ ttlMs = Infinity, saved = null } = {}) {
  let config = loadConfig();
  let readers = makeReaders(config.shared, { ttlMs });
  const store = saved ? openReadings({ file: saved, secrets: () => secrets() }) : null;

  /** coaches.json can change between refreshes (`author set`), so re-read it — and read afresh from here on. */
  function reload() {
    config = loadConfig();
    readers = makeReaders(config.shared, { ttlMs });
  }

  /**
   * Read again from the live systems: `codes` — 'all' or a list — and the
   * health checks. refresh() alone is everything, as before.
   */
  function refresh({ codes = 'all', health = true, access = false } = {}) {
    reload();
    if (store) store.forget(refreshDrops({ codes, health, access }));
  }

  const kept = (key, inputs, readLive, opts) => keptReading(store, key, inputs, readLive, opts);

  /** Is every item of the step-0 "where you stand" checklist ticked (by the dashboard or by hand)? */
  const inputsTicked = (coach) => {
    // (page-settings.local.json is read here directly: lib-pages imports this file, so it cannot be imported back.)
    try {
      const file = resolve(DASH, 'page-settings.local.json');
      const page = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})[coach.code] || {};
      return checklistView(coach.code, coach, page).every((i) => i.checked);
    } catch { return false; }
  };
  const inputsSigned = (code) => {
    const s = readSignoffs(code)[STEP.inputs] || readSignoffs(code)[String(STEP.inputs)];
    return !!(s && Array.isArray(s.checks) && s.checks.includes('inputs confirmed'));
  };
  // A tick or a sign-off changes this author's reading, so both are part of what it depends on.
  /** What an author's reading depends on, besides the live systems. */
  const inputsOf = (coach) => ({ coach, signoffs: readSignoffs(coach.code), ticked: inputsTicked(coach), lastVerify: (readState()[coach.code] || {}).lastVerify || null });

  const ctxFor = () => {
    const state = readState();
    return {
      cfg: runtimeConfig(config.shared),
      ...readers,
      shopifyConfigured: shopifyConfig(config.shared).missing.length === 0,
      lastVerify: (code) => state[code] && state[code].lastVerify,
    };
  };

  const find = (code) => config.coaches.find((c) => c.code === String(code));

  /**
   * One author. `maxAgeMs`: a saved reading older than this is read again (a
   * sign-off is checked against rows no older than the read cache). `deep`
   * reads KV too, and is never saved.
   */
  async function author(code, { deep = false, maxAgeMs = Infinity } = {}) {
    const coach = find(code);
    if (!coach) throw new Error(`no coach ${code} in coaches.json`);
    const readLive = () => pipelineFor(coach, { ...ctxFor(), inputsTicked: inputsTicked(coach), inputsSigned: inputsSigned(coach.code) }, { all: config.coaches, signoffs: readSignoffs(coach.code), deep });
    return deep ? readLive() : kept(`author:${coach.code}`, inputsOf(coach), readLive, { maxAgeMs });
  }

  /** Every author, one after another — gentle on GHL, and the readers share one cache. */
  async function authors() {
    const out = [];
    for (const c of config.coaches) out.push(await author(c.code));
    // An author gone from coaches.json takes its reading with it.
    if (store) store.forget((k) => k.startsWith('author:') && !config.coaches.some((c) => `author:${c.code}` === k));
    return out;
  }

  async function health() {
    const readLive = async () => {
      const rows = await healthChecks(ctxFor(), {
        coaches: config.coaches,
        cfg: runtimeConfig(config.shared),
        settings: readSettings(),
        now: new Date(),
      });
      return { overall: healthOverall(rows), rows: rows.map((r) => ({ ...r, help: healthHelp(r) })), afterLaunch: AFTER_LAUNCH };
    };
    // The health checks look at every author and at the alert switches.
    return kept('health', { codes: config.coaches.map((c) => c.code), settings: publicSettings(readSettings()) }, readLive);
  }

  /**
   * Who has access (plan 07): GHL's tag census + paying subscriptions, and 30 days of Shopify
   * orders to tell a gift from a buyer. Never KV. `savedOnly`: the last reading or null —
   * never a live read (the Pipeline grid's Access column uses it, so loading the grid reads nothing).
   */
  async function access({ savedOnly = false } = {}) {
    const cfg = runtimeConfig(config.shared);
    const inputs = { coaches: config.coaches.map((c) => [c.code, c.ghlTag, c.ghlProductId, c.displayName || c.name, c.formerCodes || []]), staffTag: cfg.staffTag || '' };
    if (savedOnly) {
      const hit = store && store.get('access', inputs);
      return hit ? { ...hit.value, reading: hit.reading } : null;
    }
    const readLive = async () => {
      const ctx = ctxFor();
      const tags = config.coaches.map((c) => c.ghlTag).filter(Boolean);
      const census = await ctx.census([...tags, cfg.staffTag].filter(Boolean));
      const subscriptions = await ctx.subscriptions({ allowTest: cfg.allowTestSubscriptions === true });
      let orders = null;
      let ordersProblem = '';
      if (!ctx.shopifyConfigured) ordersProblem = 'Shopify is not configured, so gifts show as Trial';
      else {
        try {
          orders = await ctx.shopifyOrders({ since: new Date(Date.now() - ORDER_WINDOW_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10) });
        } catch (err) {
          ordersProblem = `Shopify orders could not be read (${err.message}), so gifts show as Trial`;
        }
      }
      const view = accessView({ census, subscriptions, orders, coaches: config.coaches, staffTag: cfg.staffTag || '', locationId: config.shared.ghlLocationId, now: new Date() });
      return { ...view, ordersProblem };
    };
    return kept('access', inputs, readLive);
  }

  /**
   * Status only, safe to share: step states and health, never a credential.
   * The basis for team access (plan 22 M5) — read-only by construction.
   */
  async function snapshot() {
    const [list, h] = [await authors(), await health()];
    const generatedAt = new Date().toISOString();
    const body = {
      generatedAt,
      checklist: DOC,
      steps: PIPELINE_STEPS.map((s) => ({ id: s.id, title: s.title, long: s.long, needs: s.needs })),
      authors: list.map((a) => ({
        code: a.code, name: a.name, book: a.book, where: a.where, counts: a.counts, readAt: a.reading ? a.reading.at : generatedAt,
        steps: a.steps.map((s) => ({ id: s.id, title: s.title, state: s.state, warn: s.warn, rows: s.rows.map((r) => ({ check: r.check, status: r.status, detail: r.detail })) })),
      })),
      health: { overall: h.overall, readAt: h.reading ? h.reading.at : generatedAt, rows: h.rows.map((r) => ({ id: r.id, title: r.title, status: r.status, detail: r.detail, items: r.items })) },
    };
    const leak = findSecret(JSON.stringify(body), secrets());
    if (leak) throw new Error('refusing to produce a snapshot: it would contain a credential');
    return body;
  }

  // A deleted author's key sits in its undo snapshot (deleted-authors.local.json): it counts too.
  const secrets = () => [...new Set([...secretValues(config.shared, config.coaches, readSettings()), ...snapshotSecrets()])];

  return {
    get coaches() { return config.coaches; },
    get shared() { return config.shared; },
    refresh,
    reload,
    clear: () => readers.clear(),
    /** The read-only readers (Shopify catalogue, GHL GETs) — for the clean-up checks of a deleted author. */
    ctx: ctxFor,
    author,
    authors,
    health,
    access,
    snapshot,
    secrets,
    settings: () => publicSettings(readSettings()),
  };
}
