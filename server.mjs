#!/usr/bin/env node
/**
 * server.mjs — the pipeline dashboard, on this machine only.
 *
 *   npm run dashboard                  http://127.0.0.1:5178
 *   npm run dashboard -- --port 5300   another port
 *   npm run dashboard -- --open        and open the browser
 *
 * The same answers as `npm run pipeline`, from the same code (lib-live.mjs), in
 * a grid, a health tab and a canvas. No dependencies: node:http and static files.
 * Plan: ../ghl-shopify subscription/plans/22-pipeline-dashboard.md §8, M2-M4.
 *
 * WHY THE GUARDS — a server on 127.0.0.1 is NOT private by default. Any website
 * open in the same browser can send requests to localhost, and this server can
 * read GHL and Shopify with real credentials. So:
 *
 *   - it binds 127.0.0.1 only, never 0.0.0.0
 *   - a Host header that is not 127.0.0.1:<port> / localhost:<port> is refused,
 *     which also defeats DNS rebinding
 *   - every /api call needs the per-run session token, which is only ever
 *     delivered inside the page — a cross-origin site cannot read it
 *   - a request carrying a foreign Origin is refused
 *   - writes are JSON POSTs only (a plain HTML form cannot send one)
 *   - every response is checked against the actual credential values in
 *     coaches.json, and refused if it would carry one
 *   - nothing runs a shell command; the only writes are a sign-off, a switch,
 *     and what that switch controls, the wizard's allowlisted commands
 *     (lib-actions.mjs), and the step-2 coach page file (lib-pages.mjs)
 *   - the coach page can hold the Voiceflow key, so it is never sent to the
 *     browser: "Copy" puts it on the clipboard here (clip.exe), "Open" starts
 *     Notepad or Explorer here — always on a path this server worked out
 */

import { createServer as httpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DASH } from './lib-paths.mjs';
import { findSecret } from './lib-live.mjs';
import { signoffFor, STATE_LABEL } from './lib-pipeline.mjs';
import { PIPELINE_STEPS, AFTER_LAUNCH, DOC, stepById } from '../coach-router/steps.mjs';
import { HEALTH_CHECKS } from './lib-health.mjs';

const WEB = resolve(DASH, 'web');
const STATIC = {
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/canvas.js': ['canvas.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/wizard.js': ['wizard.js', 'text/javascript; charset=utf-8'],
  '/manage.js': ['manage.js', 'text/javascript; charset=utf-8'],
  '/prototype.js': ['prototype.js', 'text/javascript; charset=utf-8'],
  '/access.js': ['access.js', 'text/javascript; charset=utf-8'],
};
const CODE_RE = /^\d{4}$/;
const PAGE_PATH = /^\/(pipeline|canvas|health|access|onboard)(\/[A-Za-z0-9-]{1,80}){0,2}\/?$/;
const MAX_BODY = 16 * 1024;

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Build the request handler. Everything it needs is injected, so the tests can
 * drive it with a fake pipeline and fake switches — no network, no GHL.
 *
 *   pipeline   lib-live openPipeline() (or a fake with the same surface)
 *   token      the session token
 *   port       for the Host / Origin check
 *   settings   { read(), write(changes), apply(changes, next), reality(next) }
 *   signoffs   { record(code, step, value) }
 *   wizard     { start(), view(code), resolve(nameOrSlug), saveDraft(code, values), discard(code), generate(code, kind, from),
 *                buildPage(code, values), openPage(code, how) }  — buildPage/openPage: step 2, lib-pages.mjs
 *   actions    { describe(), plan(body), start(plan), get(id) }  — lib-actions.mjs
 *   manage     { impact({kind, code, newCode}), view(), check(code), signoff(code, id, note, value) }
 *              — edit a number / delete an author, and the clean-up list after (lib-manage.mjs, plan 05)
 *   prototypes { list(), build(values, {id, another}), open(id, how), forget(id) }
 *              — prototype coach pages: no coach code, nothing live, files only in All Coaches (Demo) (lib-prototypes.mjs, plan 06)
 */
export function makeHandler({ pipeline, token, port, settings, signoffs, wizard = null, actions = null, manage = null, prototypes = null, web = WEB }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  let stateJob = null;
  let healthJob = null;
  let accessJob = null;

  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    // The last line of defence: never let a credential out, whatever the bug.
    if (findSecret(text, pipeline.secrets())) {
      res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'refused: this response would have contained a credential' }));
    }
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': type });
    res.end(text);
  };

  const readJson = (req) => new Promise((ok, bad) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { bad(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { bad(new Error('body is not JSON')); }
    });
    req.on('error', bad);
  });

  /**
   * One computation at a time. A plain request while one runs shares it; a
   * refresh waits its turn, so two Refreshes of different authors both happen.
   * `fresh`: null (the saved readings), or { codes: 'all' | [codes], health }.
   */
  const state = (fresh) => {
    if (stateJob && !fresh) return stateJob;
    const job = (stateJob || Promise.resolve()).catch(() => null).then(async () => {
      if (fresh) pipeline.refresh(fresh);
      return {
        generatedAt: new Date().toISOString(),
        doc: DOC,
        steps: PIPELINE_STEPS.map((s) => ({ id: s.id, title: s.title, long: s.long, platform: s.platform, kind: s.kind, needs: s.needs, gate: !!s.gate, signoff: s.signoff || '' })),
        labels: STATE_LABEL,
        authors: await pipeline.authors(),
      };
    });
    stateJob = job;
    const done = () => { if (stateJob === job) stateJob = null; };
    job.then(done, done);
    return job;
  };
  const health = (refresh) => {
    if (refresh && !healthJob) pipeline.refresh({ codes: [], health: true });
    if (!healthJob) {
      healthJob = (async () => {
        const h = await pipeline.health();
        // When it was READ — a saved reading says so — not when it was sent.
        return { generatedAt: (h.reading && h.reading.at) || new Date().toISOString(), checks: HEALTH_CHECKS, ...h };
      })().finally(() => { healthJob = null; });
    }
    return healthJob;
  };
  /**
   * ?refresh=all (or =1): every author. ?refresh=1001,1003: those. ?health=1: the
   * health checks too. Neither: the saved readings. → { fresh } or { problem }.
   */
  const freshOf = (q) => {
    const r = q.get('refresh');
    const health = q.get('health') === '1';
    if (r === null && !health) return { fresh: null };
    if (r === null || r === '') return { fresh: { codes: [], health } };
    if (r === '1' || r === 'all') return { fresh: { codes: 'all', health } };
    const codes = [...new Set(r.split(','))];
    const bad = codes.find((c) => !CODE_RE.test(c) || !pipeline.coaches.some((x) => x.code === c));
    return bad ? { problem: `no author ${bad.slice(0, 12)} to refresh` } : { fresh: { codes, health } };
  };
  const switchesView = (s) => ({ settings: s, reality: settings.reality(s) });

  return async function handle(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'x'}`);
    try {
      if (!hosts.has(String(req.headers.host || ''))) return send(res, 421, { error: 'wrong host' });
      if (req.headers.origin && !origins.has(req.headers.origin)) return send(res, 403, { error: 'foreign origin' });

      // The page itself, at "/" and at each view's own address: /pipeline, /canvas, /health,
      // /onboard, /onboard/1002-freddy-davis, /onboard/1002-freddy-davis/6. Nothing else.
      if (req.method === 'GET' && (url.pathname === '/' || PAGE_PATH.test(url.pathname))) {
        const html = readFileSync(resolve(web, 'index.html'), 'utf8').replace('{{TOKEN}}', token);
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        return send(res, 200, readFileSync(resolve(web, file), 'utf8'), type);
      }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });

      // ---- everything below needs the session token ----
      if (!sameToken(req.headers['x-pipeline-token'], token)) return send(res, 401, { error: 'missing or wrong session token — reload the page' });
      if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON only' });

      const refresh = url.searchParams.get('refresh') === '1';
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const { fresh, problem } = freshOf(url.searchParams);
        if (problem) return send(res, 400, { error: problem });
        return send(res, 200, { ...(await state(fresh)), ...switchesView(settings.read()) });
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { ...(await health(refresh)), afterLaunch: AFTER_LAUNCH });
      }
      // Who has access (plan 07). Reads only. ?saved=1: the last reading or { none: true } — never
      // a live read (the grid column). ?refresh=1: read GHL and Shopify again now.
      if (req.method === 'GET' && url.pathname === '/api/access' && typeof pipeline.access === 'function') {
        if (url.searchParams.get('saved') === '1') {
          const a = await pipeline.access({ savedOnly: true });
          return send(res, 200, a ? { ...a, soonDays: settings.read().accessSoonDays } : { none: true, soonDays: settings.read().accessSoonDays });
        }
        if (!accessJob) {
          if (refresh) pipeline.refresh({ codes: [], health: false, access: true });
          accessJob = pipeline.access().finally(() => { accessJob = null; });
        }
        return send(res, 200, { ...(await accessJob), soonDays: settings.read().accessSoonDays });
      }
      if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        return send(res, 200, await pipeline.snapshot());
      }
      if (req.method === 'POST' && (url.pathname === '/api/signoff' || url.pathname === '/api/unsignoff')) {
        const body = await readJson(req);
        const code = String(body.code || '');
        const step = Number(body.step);
        if (!pipeline.coaches.some((c) => c.code === code)) return send(res, 400, { error: `no coach ${code}` });
        if (!stepById(step)) return send(res, 400, { error: `no step ${body.step}` });
        if (url.pathname === '/api/unsignoff') {
          signoffs.record(code, step, null);
          return send(res, 200, { ok: true, author: await pipeline.author(code) });
        }
        // Signed against the LIVE rows, exactly as the CLI does: a saved reading older than the read cache is read again.
        const a = await pipeline.author(code, { maxAgeMs: 10 * 60 * 1000 });
        const [value, problem] = signoffFor(a.steps.find((s) => s.id === step), { note: body.note || '' });
        if (problem) return send(res, 400, { error: problem });
        signoffs.record(code, step, value);
        return send(res, 200, { ok: true, author: await pipeline.author(code) });
      }
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        const body = await readJson(req);
        const changes = body && typeof body.changes === 'object' && body.changes ? body.changes : {};
        // The API key is set from the terminal only — it never travels through a browser.
        if ('uptimeApiKey' in changes) return send(res, 400, { error: 'set uptimeApiKey from the terminal: npm run pipeline -- config --uptimeApiKey …' });
        let next;
        try {
          next = settings.write(changes);
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
        const applied = await settings.apply(changes, next);
        return send(res, 200, { applied, ...switchesView(settings.read()) });
      }
      // ---- the Add-author wizard -------------------------------------------------
      if (wizard && req.method === 'GET' && url.pathname === '/api/wizard/start') {
        return send(res, 200, await wizard.start());
      }
      if (wizard && req.method === 'GET' && url.pathname === '/api/wizard') {
        let code = String(url.searchParams.get('code') || '').trim();
        // A name or slug ("freddy", "rick-meyer") finds the author; a new code starts a draft.
        if (!CODE_RE.test(code) && wizard.resolve) {
          const found = wizard.resolve(code);
          if (found.problem) return send(res, 404, { error: found.problem });
          code = found.coach.code;
        }
        if (!CODE_RE.test(code)) return send(res, 400, { error: 'a four-digit coach code, or an author’s name or slug, is required' });
        return send(res, 200, await wizard.view(code));
      }
      if (wizard && req.method === 'POST' && url.pathname === '/api/wizard/draft') {
        const body = await readJson(req);
        const r = wizard.saveDraft(String(body.code || ''), body.values || {});
        if (r.problems) return send(res, 400, { error: 'some answers need fixing', problems: r.problems });
        return send(res, 200, await wizard.view(String(body.code)));
      }
      if (wizard && req.method === 'POST' && url.pathname === '/api/wizard/discard') {
        const body = await readJson(req);
        return send(res, 200, { ok: wizard.discard(String(body.code || '')) });
      }
      if (wizard && req.method === 'POST' && url.pathname === '/api/wizard/generate') {
        const body = await readJson(req);
        try {
          return send(res, 200, wizard.generate(String(body.code || ''), String(body.kind || ''), body.from ? String(body.from) : null));
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }
      // ---- step 2: the coach page, built from the form ----------------------------
      // The page file can hold the Voiceflow key, so it never travels through here:
      // the browser gets where it was saved, and copying/opening happens on this PC.
      if (wizard && req.method === 'POST' && url.pathname === '/api/wizard/page') {
        const body = await readJson(req);
        const code = String(body.code || '');
        if (!CODE_RE.test(code)) return send(res, 400, { error: 'a four-digit coach code is required' });
        try {
          const r = await wizard.buildPage(code, body.values && typeof body.values === 'object' ? body.values : {});
          if (r.problems) return send(res, 400, { error: 'some answers need fixing', problems: r.problems });
          if (r.error) return send(res, 400, { error: r.error, job: r.job || null });
          return send(res, 200, r);
        } catch (err) {
          return send(res, err.status || 400, { error: err.message });
        }
      }
      if (wizard && req.method === 'POST' && url.pathname === '/api/wizard/page/open') {
        const body = await readJson(req);
        const code = String(body.code || '');
        const how = String(body.how || '');
        if (!CODE_RE.test(code)) return send(res, 400, { error: 'a four-digit coach code is required' });
        if (!['copy', 'notepad', 'folder'].includes(how)) return send(res, 400, { error: 'how must be copy, notepad or folder' });
        try {
          return send(res, 200, await wizard.openPage(code, how));
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }
      // ---- Generate Landing Pages ----------------------------------------------------
      if (wizard && req.method === 'POST' && url.pathname === '/api/wizard/landing') {
        const body = await readJson(req);
        const code = String(body.code || '');
        const kind = String(body.kind || '');
        const how = String(body.how || '');
        if (!CODE_RE.test(code)) return send(res, 400, { error: 'a four-digit coach code is required' });
        if (!['sales', 'collection'].includes(kind)) return send(res, 400, { error: 'kind must be sales or collection' });
        if (!['open', 'folder', 'build', 'claude'].includes(how)) return send(res, 400, { error: 'how must be open, folder, build or claude' });
        try {
          return send(res, 200, await wizard.landing(code, kind, how));
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }
      // ---- step 0: "where you stand" — a person's own ticks -------------------------
      if (wizard && req.method === 'POST' && url.pathname === '/api/wizard/checklist') {
        const body = await readJson(req);
        const code = String(body.code || '');
        if (!CODE_RE.test(code)) return send(res, 400, { error: 'a four-digit coach code is required' });
        if (![true, false, null].includes(body.value)) return send(res, 400, { error: 'value must be true, false or null' });
        try {
          return send(res, 200, wizard.checklist(code, String(body.key || ''), body.value));
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }
      // ---- edit a number, delete an author, and the clean-up after (plan 05) ------------
      // Reads only. The writes themselves run through /api/action (previewed, confirmed). The
      // clean-up checks read GHL/Shopify only when asked: nothing polls.
      if (manage && req.method === 'GET' && url.pathname === '/api/manage/impact') {
        const kind = String(url.searchParams.get('kind') || '');
        const code = String(url.searchParams.get('code') || '');
        if (!['renumber', 'delete'].includes(kind)) return send(res, 400, { error: 'kind must be renumber or delete' });
        if (!CODE_RE.test(code)) return send(res, 400, { error: 'a four-digit coach code is required' });
        try {
          return send(res, 200, await manage.impact({ kind, code, newCode: String(url.searchParams.get('newCode') || '') }));
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }
      if (manage && req.method === 'GET' && url.pathname === '/api/deleted') {
        return send(res, 200, manage.view());
      }
      if (manage && req.method === 'POST' && (url.pathname === '/api/deleted/check' || url.pathname === '/api/deleted/signoff')) {
        const body = await readJson(req);
        const code = String(body.code || '');
        if (!CODE_RE.test(code)) return send(res, 400, { error: 'a four-digit coach code is required' });
        try {
          if (url.pathname === '/api/deleted/check') return send(res, 200, { author: await manage.check(code), ...manage.view() });
          if (typeof body.value !== 'boolean') return send(res, 400, { error: 'value must be true (sign off) or false (take it back)' });
          return send(res, 200, { author: manage.signoff(code, String(body.id || ''), String(body.note || ''), body.value), ...manage.view() });
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }
      // ---- prototype coach pages (plan 06) -------------------------------------------
      // Nothing live is read or changed here: the only writes are the page file, its .bak and the
      // answers file, all inside All Coaches (Demo). The page can hold the Voiceflow key, so it never
      // travels through here: "Copy" and "Show in folder" happen on this PC, like a final page's.
      if (prototypes && req.method === 'GET' && url.pathname === '/api/prototypes') {
        return send(res, 200, prototypes.list());
      }
      if (prototypes && req.method === 'POST' && url.pathname === '/api/prototypes') {
        const body = await readJson(req);
        try {
          const r = prototypes.build(body.values && typeof body.values === 'object' ? body.values : {}, { id: body.id ? String(body.id) : null, another: body.another === true });
          if (r.problems) return send(res, 400, { error: 'some answers need fixing', problems: r.problems });
          return send(res, 200, { built: r, ...prototypes.list() });
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }
      if (prototypes && req.method === 'POST' && (url.pathname === '/api/prototypes/open' || url.pathname === '/api/prototypes/forget')) {
        const body = await readJson(req);
        const id = String(body.id || '');
        try {
          if (url.pathname === '/api/prototypes/forget') return send(res, 200, { ok: prototypes.forget(id), ...prototypes.list() });
          const how = String(body.how || '');
          if (!['copy', 'folder'].includes(how)) return send(res, 400, { error: 'how must be copy or folder' });
          return send(res, 200, await prototypes.open(id, how));
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
      }
      // ---- running a command: allowlisted, previewed, confirmed ------------------
      if (actions && req.method === 'GET' && url.pathname === '/api/actions') {
        return send(res, 200, actions.describe());
      }
      if (actions && req.method === 'POST' && url.pathname === '/api/action') {
        const body = await readJson(req);
        let plan;
        try {
          plan = actions.plan({ action: body.action, code: String(body.code || ''), params: body.params || {}, write: body.write === true, confirm: String(body.confirm || '') });
        } catch (err) {
          return send(res, 400, { error: err.message });
        }
        try {
          return send(res, 202, { job: actions.start(plan) });
        } catch (err) {
          return send(res, err.status || 500, { error: err.message });
        }
      }
      if (actions && req.method === 'GET' && url.pathname === '/api/job') {
        const job = actions.get(String(url.searchParams.get('id') || ''));
        return job ? send(res, 200, { job }) : send(res, 404, { error: 'no such job' });
      }
      return send(res, 404, { error: 'no such endpoint' });
    } catch (err) {
      return send(res, 500, { error: String((err && err.message) || err).slice(0, 300) });
    }
  };
}

/* ------------------------------------------------------------- the binary --- */

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;

if (isMain) {
  const argv = process.argv.slice(2);
  const valOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const { openPipeline } = await import('./lib-live.mjs');
  const S = await import('./lib-settings.mjs');
  const W = await import('./lib-switches.mjs');
  const { recordSignoff } = await import('../coach-router/lib-registry.mjs');
  const { loadConfig } = await import('../coach-router/lib-config.mjs');
  const { findCoach } = await import('../coach-router/lib-find.mjs');
  const WZ = await import('./lib-wizard.mjs');
  const AC = await import('./lib-actions.mjs');
  const PG = await import('./lib-pages.mjs');
  const CL = await import('./lib-checklist.mjs');
  const M = await import('./lib-manage.mjs');
  const PT = await import('./lib-prototypes.mjs');
  const LP = await import('./lib-landing.mjs');
  const { spawnSync } = await import('node:child_process');
  const { REPO_ROOT } = await import('./lib-paths.mjs');
  // Where claude.exe is — found once; "claude" (the PATH) if it cannot be found.
  const claudePath = (() => {
    try {
      const r = spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true });
      return (r.stdout || '').split(/\r?\n/).map((x) => x.trim()).find((x) => /\.exe$/i.test(x)) || 'claude';
    } catch { return 'claude'; }
  })();
  const { readFileSync: readFile } = await import('node:fs');
  const nodeFs = await import('node:fs');

  const port = Number(valOf('--port') || S.readSettings().dashboardPort || 5178);
  const token = randomBytes(24).toString('base64url');
  let pipeline;
  try {
    // Each author's last reading is kept (readings.local.json): the dashboard opens on it, and
    // Refresh reads again only what it names. Live reads are cached 10 minutes within a refresh.
    pipeline = openPipeline({ ttlMs: 10 * 60 * 1000, saved: resolve(DASH, 'readings.local.json') });
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  // An existing author, as last read. A coach created a moment ago is not in
  // the pipeline's copy of coaches.json yet, so a miss re-reads that file once.
  const liveAuthor = async (code) => {
    if (!pipeline.coaches.some((c) => c.code === code)) pipeline.reload();
    return pipeline.author(code);
  };
  /**
   * Who a coach page is for: the coaches.json entry — or, before step 3 creates
   * the author, the draft's answers. The page comes first (step 2).
   */
  const pageSubject = (code) => {
    const coach = loadConfig().coaches.find((c) => c.code === code);
    if (coach) return { coach, draft: false };
    const d = WZ.readDrafts()[code];
    return d ? { coach: { code, ...(d.values || {}) }, draft: true } : { coach: null, draft: false };
  };
  /** Before the author exists there are no live checks: just "is the page published?" One request. */
  const pageLive = async (url) => {
    try {
      return (await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) })).status;
    } catch {
      return 0;
    }
  };
  const wizard = {
    start() {
      const { coaches } = loadConfig();
      const drafts = WZ.readDrafts();
      // Numbers deleted authors had: never suggested, and typing one asks for a second OK (plan 05).
      const used = Object.values(M.readDeleted().authors).flatMap((r) => r.usedCodes || [r.code]);
      return {
        suggestedCode: WZ.nextCode(coaches, drafts, used),
        reuseWarnings: Object.fromEntries(used.map((c) => [c, M.reuseWarning(c)]).filter(([, w]) => w)),
        drafts: Object.entries(drafts).map(([code, d]) => ({ code, name: (d.values && d.values.displayName) || '', updatedAt: d.updatedAt })),
        authors: coaches.map((c) => ({ code: c.code, name: c.displayName || c.name })),
      };
    },
    async view(code) {
      const { shared, coaches } = loadConfig();
      const coach = coaches.find((c) => c.code === code) || null;
      const draft = WZ.readDrafts()[code] || null;
      const live = coach ? await liveAuthor(code) : null;
      const view = WZ.wizardView({ code, coach, draft, shared, live, coaches });
      // When this author was last read from the live systems (Refresh reads it again).
      view.reading = (live && live.reading) || null;
      // Step 2's form: the page's answers and where the file goes — for a draft too. Never the key.
      view.page = PG.pageFormView(coach || { code, ...((draft && draft.values) || {}) }, { shared, settings: PG.readPageSettings(code) });
      if (!coach && view.page.publishAt) view.page.live = await pageLive(view.page.publishAt);
      // "Where you stand" (step 0, Inputs): what the dashboard can see is saved, and the person's own ticks.
      view.checklist = CL.checklistView(code, coach || { code, ...((draft && draft.values) || {}) }, PG.readPageSettings(code));
      // Generate Landing Pages (the Zipify and collection steps): what exists, the prompt to paste,
      // and whether the Claude Code button is switched on. File names and times only — never the text.
      {
        const st = S.readSettings();
        const slug = (coach && coach.slug) || (draft && draft.values && draft.values.slug) || '';
        const name = view.name || '';
        view.landing = {
          on: st.landingPages === 'on', model: st.landingModel, effort: st.landingEffort,
          status: slug ? LP.landingStatus(slug) : null,
          prompts: Object.fromEntries(LP.KINDS.map((k) => [k, LP.landingPrompt(code, k, { name })])),
        };
      }
      // Every author and draft, for the switcher beside the steps. Names and codes only.
      view.roster = [
        ...coaches.map((c) => ({ code: c.code, name: c.displayName || c.name, slug: c.slug || '', draft: false })),
        ...Object.entries(WZ.readDrafts()).map(([c, d]) => ({ code: c, name: (d.values && d.values.displayName) || '(no name yet)', slug: (d.values && d.values.slug) || '', draft: true })),
      ];
      return view;
    },
    /** Tick (true), untick (false) or forget (null) one checklist item — for an author or a draft. */
    checklist(code, key, value) {
      const { coach } = pageSubject(code);
      if (!coach) throw new Error(`no author or draft ${code}`);
      return { checklist: CL.setChecklistItem(code, key, value, { values: coach, page: PG.readPageSettings(code) }) };
    },
    /**
     * Step 2: save the answers, then build the whole page. For an author in
     * coaches.json the answers go through `author set` (the job runner: its
     * backup and validation), and only if that succeeds is the page written.
     * For a draft — the page comes before step 3 — they are kept in the draft,
     * and onboard carries them into coaches.json.
     */
    async buildPage(code, values) {
      const { coaches } = loadConfig();
      const { coach, draft } = pageSubject(code);
      if (!coach) return { error: 'fill in steps 0 and 1 first — the page is built from them' };
      const { record, page, problems } = PG.validatePageForm(values, coach);
      if (Object.keys(problems).length) return { problems };
      let job = null;
      if (Object.keys(record).length && draft) {
        const r = WZ.saveDraft(code, PG.recordParams(record), { coaches });
        if (r.problems) return { problems: r.problems };
      } else if (Object.keys(record).length) {
        const plan = AC.planAction({ action: 'set', code, params: { values: PG.recordParams(record) }, coaches, drafts: WZ.readDrafts() });
        job = await runner.wait(runner.start(plan).id);
        if (job.status !== 'done') return { error: 'coaches.json did not take the answers, so the page was not built — the output below says why', job };
      }
      PG.savePageSettings(code, page);
      const built = PG.buildPage(pageSubject(code).coach, page, { shared: loadConfig().shared, secrets: pipeline.secrets() });
      return { built, saved: Object.keys(record), savedTo: draft ? 'the draft' : 'coaches.json', job };
    },
    /** Copy the built page to the clipboard, or open it — on this PC, so the key never crosses HTTP. */
    async openPage(code, how) {
      const { coach } = pageSubject(code);
      if (!coach) throw new Error(`no author or draft ${code}`);
      const file = PG.pageFileFor(coach);
      if (!file.exists) throw new Error('build the page first — press "Save and build the page"');
      if (process.platform !== 'win32') throw new Error(`this button works on Windows only — the page is at ${file.path}`);
      if (how === 'copy') {
        await PG.copyToClipboard(readFile(file.path, 'utf8'));
        return { ok: true, said: `Copied the whole page (${file.name}). Now paste it into the GHL Custom Code element.` };
      }
      PG.showPage(file.path, how);
      return { ok: true, said: how === 'notepad' ? `Opened ${file.name} in Notepad` : `Opened the folder — ${file.name} is selected` };
    },
    saveDraft(code, values) {
      const { coaches } = loadConfig();
      if (coaches.some((c) => c.code === code)) return { problems: { code: `${code} already exists — its answers are saved straight to coaches.json` } };
      return WZ.saveDraft(code, values, { coaches });
    },
    discard: (code) => WZ.deleteDraft(code),
    /** Generate Landing Pages: open the page, show its folder, rebuild it, or start Claude Code on it. */
    landing(code, kind, how) {
      const { coaches } = loadConfig();
      const coach = coaches.find((c) => c.code === code);
      if (!coach || !coach.slug) throw new Error(`create the author first — ${code} is not in coaches.json yet`);
      const paths = LP.landingPaths(coach.slug, kind);
      if (how === 'claude') {
        const st = S.readSettings();
        if (st.landingPages !== 'on') throw new Error('switch "Landing pages" on first (top of the Pipeline tab) — or use "Copy the prompt"');
        const l = LP.claudeLaunch({ code, kind, model: st.landingModel, effort: st.landingEffort, claude: claudePath, cwd: REPO_ROOT });
        const child = spawn(l.command, l.args, l.options);
        if (child && child.unref) child.unref();
        return { ok: true, said: `Opened Claude Code in a new window (${st.landingModel}, ${st.landingEffort} effort). It reads the book, writes the words, builds the page — answer it there if it asks.` };
      }
      if (how === 'build') {
        const r = LP.writeLanding(coach.slug, kind, { secrets: pipeline.secrets() });
        return { ok: true, said: `Rebuilt ${r.file.split(/[\\/]/).pop()} from its answers file.` };
      }
      const { existsSync } = nodeFs;
      if (!existsSync(paths.html)) throw new Error('there is no page yet — generate it first');
      if (how === 'open') {
        // The default browser opens the file; its Copy buttons copy with the formatting.
        const child = spawn('explorer.exe', [paths.html], { shell: false, detached: true, stdio: 'ignore' });
        if (child && child.unref) child.unref();
        return { ok: true, said: `Opened ${paths.html.split(/[\\/]/).pop()} — press a box's Copy button, then Ctrl+V in Zipify` };
      }
      PG.showPage(paths.html, 'folder');
      return { ok: true, said: 'Opened the folder — the page is selected' };
    },
    resolve: (q) => findCoach(loadConfig().coaches, q),
    generate(code, kind, from) {
      const { shared, coaches } = loadConfig();
      const coach = coaches.find((c) => c.code === code);
      if (!coach) throw new Error(`create the author first (step 3) — ${code} is not in coaches.json yet`);
      return WZ.generate(kind, coach, { coaches, shared, from, secrets: pipeline.secrets() });
    },
  };
  const runner = AC.makeJobRunner({
    secrets: () => pipeline.secrets(),
    async onDone(job) {
      // Whatever ran may have changed coaches.json, Shopify or KV for this author: read
      // this author afresh next time (and the health checks, which look at every author).
      pipeline.refresh({ codes: [job.code], health: true });
      // The author now exists: the draft has done its job. (Until 2026-10-12 a draft's
      // "the coach is built" tick became a sign-off here; the saved IDs are the proof now.)
      if (job.action === 'onboard' && job.write && job.status === 'done') WZ.deleteDraft(job.code);
      // Plan 05: keep the dashboard's own number-keyed files in step with what the commands did.
      if (job.write && job.status === 'done') {
        if (job.action === 'renumber') {
          const now = loadConfig().coaches.find((c) => (c.formerCodes || []).map(String).includes(job.code));
          if (now) { M.followNumber({ from: job.code, to: now.code }); pipeline.refresh({ codes: [job.code, now.code], health: true }); }
        } else if (job.action === 'delete') {
          M.followNumber({ from: job.code });
          WZ.deleteDraft(job.code);
          pipeline.reload();
          // First look at what is left, so items that never existed read "gone" straight away.
          try { await M.runCheck(job.code, pipeline.ctx()); } catch { /* the list is still there; Check again */ }
        } else if (job.action === 'undo-delete') {
          pipeline.reload();
        }
      }
    },
  });
  const manage = {
    async impact({ kind, code, newCode }) {
      const { coaches } = loadConfig();
      const coach = coaches.find((c) => c.code === code);
      if (!coach) throw new Error(`no author ${code}`);
      if (kind === 'delete') {
        const holders = await M.tagHolders(pipeline.ctx(), coach);
        return { ok: true, rows: M.deleteImpact(coach, { holders }), holders, name: coach.displayName || coach.name };
      }
      const v = M.validateNewNumber(newCode, { oldCode: code, coaches, drafts: WZ.readDrafts(), deleted: M.readDeleted() });
      if (!v.ok) return { ok: false, problem: v.problem, rows: [] };
      const holders = await M.tagHolders(pipeline.ctx(), coach);
      return { ok: true, warning: v.warning || null, rows: M.renumberImpact(coach, newCode, { holders }), holders, name: coach.displayName || coach.name };
    },
    view: () => M.deletedView(),
    check: (code) => M.runCheck(code, pipeline.ctx()),
    signoff: (code, id, note, value) => M.runSignoff(code, id, { note, value }),
  };
  const prototypes = {
    list: () => ({ items: PT.listPrototypes(), folder: PT.DEMO_DIR }),
    build: (values, o) => PT.buildPrototype(values, { ...o, shared: loadConfig().shared, secrets: pipeline.secrets() }),
    async open(id, how) {
      const f = PT.prototypeFile(id);
      if (process.platform !== 'win32') throw new Error(`this button works on Windows only — the page is at ${f.path}`);
      if (how === 'copy') {
        await PG.copyToClipboard(readFile(f.path, 'utf8'));
        return { ok: true, said: `Copied the whole page (${f.name}). Paste it into the GHL Custom Code element.` };
      }
      PG.showPage(f.path, 'folder');
      return { ok: true, said: `Opened the folder — ${f.name} is selected` };
    },
    forget: (id) => PT.forgetPrototype(id),
  };
  const actions = {
    describe: () => Object.fromEntries(Object.entries(AC.ACTIONS).map(([k, a]) => [k, { label: a.label, changes: a.changes, dry: a.dry }])),
    plan: (body) => AC.planAction({ ...body, coaches: loadConfig().coaches, drafts: WZ.readDrafts() }),
    start: (plan) => runner.start(plan),
    get: (id) => runner.get(id),
  };
  const handle = makeHandler({
    pipeline, token, port, wizard, actions, manage, prototypes,
    settings: {
      read: () => S.publicSettings(S.readSettings()),
      write: (changes) => S.writeSettings(changes),
      apply: (changes, next) => W.applySwitches(changes, next),
      reality: () => W.switchReality(S.readSettings()),
    },
    signoffs: { record: (code, step, value) => recordSignoff(code, step, value) },
  });
  const server = httpServer((req, res) => { handle(req, res); });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error([
        '',
        `  Port ${port} is already in use — most likely a dashboard is still running in another window.`,
        `    · If you can see it: open http://127.0.0.1:${port} — or press Ctrl+C in that window and start this again.`,
        '    · If you cannot find it, in PowerShell:',
        `        Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess`,
        `    · Or run this one on another port:  npm run dashboard -- --port ${port + 1}`,
        '',
      ].join('\n'));
    } else {
      console.error(`\n  could not start on 127.0.0.1:${port}: ${err.message}\n`);
    }
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n  Pipeline dashboard: ${url}`);
    console.log('  This machine only. Reads freely; writes only through the Add-author wizard, after a preview and your confirmation.');
    console.log('  Ctrl+C to stop.\n');
    if (argv.includes('--open') && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  });
}
