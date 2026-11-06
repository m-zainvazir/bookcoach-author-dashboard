/**
 * dashboard.test.mjs — tests for the pipeline tracker and dashboard.
 * Run: npm test   (no network: every reader is faked)
 * Plan: ../ghl-shopify subscription/plans/22-pipeline-dashboard.md
 */
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}
       expected: ${JSON.stringify(expected)}
       actual:   ${JSON.stringify(actual)}`); }
};
const truthy = (name, v) => t(name, !!v, true);
const falsy = (name, v) => t(name, !!v, false);

/* ---------------------------------------------------------------------------
 * the pipeline (steps.mjs, lib-pipeline, lib-settings, lib-health, lib-switches)
 * plans/22-pipeline-dashboard.md
 * ------------------------------------------------------------------------- */
{
  const ST = await import('../coach-router/steps.mjs');
  const PL = await import('./lib-pipeline.mjs');
  const A = await import('../coach-router/lib-author.mjs');
  const SE = await import('./lib-settings.mjs');
  const HE = await import('./lib-health.mjs');
  const SW = await import('./lib-switches.mjs');
  const LV = await import('./lib-live.mjs');
  const RG = await import('../coach-router/lib-registry.mjs');

  console.log('\npipeline - the registry');
  {
    const ids = ST.PIPELINE_STEPS.map((s) => s.id);
    t('steps are 0-16, in order, no gaps', ids, Array.from({ length: 17 }, (_, i) => i));
    truthy('needs only ever point at LOWER steps (one pass resolves them)', ST.PIPELINE_STEPS.every((s) => s.needs.every((n) => n < s.id)));
    const idOf = (title) => ST.PIPELINE_STEPS.find((s) => s.title === title).id;
    truthy('🔑 the end-to-end test needs the grant workflow: it is published before the first order', ST.stepById(idOf('End-to-end test')).needs.includes(idOf('Grant workflow')));
    truthy('🔑 Zipify needs the bundle: the cart link is the variant id', ST.stepById(idOf('Zipify page')).needs.includes(idOf('Shopify bundle')));
    t('🔑 Zipify, the optional course collection, its address, the funnel, then the grant workflow (2026-10-12)', ['Zipify page', 'Course Collection + Bundle Image', 'Sales page URL', 'Funnel page', 'Grant workflow'].map(idOf), [7, 8, 9, 10, 11]);
    t('...and Zipify waits only on the bundle (its cart link)', ST.stepById(idOf('Zipify page')).needs, [idOf('Shopify bundle')]);
    t('🔑 the coach page is step 2 — right after the Voiceflow coach + IDs, before the author is created', [ST.stepById(2).title, ST.stepById(2).needs, ST.stepById(3).title], ['Coach page', [1], 'GHL + registry']);
    t('lib-author numbers its rows from the same list', A.STEPS, ST.STEPS);
    t('after launch is 17-25', ST.AFTER_LAUNCH.map((s) => s.id), [17, 18, 19, 20, 21, 22, 23, 24, 25]);
    const hIds = HE.HEALTH_CHECKS.map((h) => h.id);
    truthy('every after-launch step is watched by a real health check', ST.AFTER_LAUNCH.every((s) => s.checks.length && s.checks.every((c) => hIds.includes(c))));
    t('commands fill in the author', ST.commandFor(ST.stepById(4), { code: '1045' }), 'npm run author -- shopify --code 1045 --write');
  }

  // An offline world in which nothing exists yet, and one in which everything does.
  const blank = { code: '1099', name: 'New Author' };
  const empty = {
    locationId: 'L', cfg: {},
    fetchText: async () => ({ status: 404, text: '' }), catalog: async () => new Map(),
    ghl: async (p) => (p.startsWith('/workflows/') ? { workflows: [] } : p === '/contacts/search' ? { contacts: [] } : {}),
    health: async () => ({ coaches: [] }), kvGet: async () => null, lastVerify: () => null,
  };

  console.log('\npipeline - no check is lost');
  {
    const ids = new Set(ST.PIPELINE_STEPS.map((s) => s.id));
    const rows = await A.authorStatus(blank, { ...empty }, { all: [blank] });
    truthy('🚨 every row authorStatus produces lands in a registry step', rows.every((r) => ids.has(r.step)));
    t('every step 0-16 gets at least one row, so none reads done unlooked-at', [...ids].filter((id) => !rows.some((r) => r.step === id)), []);
    const steps = PL.deriveSteps(rows);
    t('...and deriveSteps places every row exactly once', steps.reduce((n, s) => n + s.rows.length, 0), rows.length);
    // Inputs complete (2026-10-13): all saved — or, when one is missing, every "where you stand" box ticked, or signed off.
    {
      const PLX = await import('./lib-pipeline.mjs');
      const SX = await import('../coach-router/steps.mjs');
      const noLabel = { code: '1003', name: 'Rick Meyer', displayName: 'Rick Meyer', bookTitle: 'Running on Faith', slug: 'rick-meyer' };
      const inputsRows = async (coach, extra = {}) => (await A.authorStatus(coach, { ...empty, ...extra }, { all: [coach] })).filter((r) => r.step === SX.STEP.inputs);
      const st = (rows, signoffs = {}) => PLX.deriveSteps(rows, { steps: SX.PIPELINE_STEPS.filter((s) => s.id === 0), signoffs })[0].state;
      let r0 = await inputsRows(noLabel);
      t('a missing coach label, nothing ticked, no sign-off: still to do — and a sign-off is offered', [st(r0), r0.map((r) => r.status)], ['READY', ['TODO', 'MANUAL']]);
      r0 = await inputsRows(noLabel, { inputsTicked: true });
      t('🔑 (1) every "where you stand" box ticked: complete — the gap stays as a note', [st(r0), r0.map((r) => r.status)], ['DONE', ['WARN', 'DONE']]);
      r0 = await inputsRows(noLabel, { inputsSigned: true });
      t('🔑 (2) signed off: complete — the gap stays as a note', [st(r0, { 0: { checks: ['inputs confirmed'] } }), r0[0].status], ['DONE', 'WARN']);
      t('...and the sign-off can be made while it is still open', PLX.signoffFor(PLX.deriveSteps(await inputsRows(noLabel), { steps: SX.PIPELINE_STEPS.filter((s) => s.id === 0) })[0])[0].checks, ['inputs confirmed']);
      const full = await inputsRows({ ...noLabel, coachLabel: 'Rick Meyer – Running on Faith' });
      t('everything saved: done as before — no sign-off asked, whatever the checklist says', [st(full), full.map((r) => r.status)], ['DONE', ['DONE']]);
    }
    t('a brand-new author starts at step 0', PL.whereAmI(steps).id, 0);
    falsy('...and nothing reads DONE that was never done', steps.some((s) => s.state === 'DONE'));
  }

  console.log('\npipeline - how a step state is decided');
  {
    const r = (step, status, check = `c${step}`) => ({ step, check, status, detail: '', fix: '' });
    const only = (rows, ids) => PL.deriveSteps(rows, { steps: ST.PIPELINE_STEPS.filter((s) => ids.includes(s.id)) });
    const st = (out, id) => out.find((s) => s.id === id).state;
    let out = only([r(0, 'DONE'), r(1, 'TODO')], [0, 1]);
    t('TODO with its needs done is READY (do this next)', st(out, 1), 'READY');
    out = only([r(0, 'TODO'), r(1, 'TODO')], [0, 1]);
    t('TODO with a need not done is BLOCKED, never READY', st(out, 1), 'BLOCKED');
    out = only([r(0, 'DONE'), r(1, 'FAIL'), r(1, 'DONE')], [0, 1]);
    t('any FAIL row makes the step FAIL', st(out, 1), 'FAIL');
    out = only([r(0, 'DONE'), r(1, 'MANUAL', 'built?')], [0, 1]);
    t('only MANUAL rows left, nobody signed: CONFIRM', st(out, 1), 'CONFIRM');
    out = PL.deriveSteps([r(0, 'DONE'), r(1, 'MANUAL', 'built?')], { steps: ST.PIPELINE_STEPS.filter((s) => s.id <= 1), signoffs: { 1: { checks: ['built?'] } } });
    t('a sign-off turns MANUAL into DONE', st(out, 1), 'DONE');
    out = PL.deriveSteps([r(0, 'DONE'), r(1, 'MANUAL', 'built?'), r(1, 'FAIL', 'broken')], { steps: ST.PIPELINE_STEPS.filter((s) => s.id <= 1), signoffs: { 1: { checks: ['built?'] } } });
    t('🚨 a sign-off NEVER overrides a FAIL', st(out, 1), 'FAIL');
    out = PL.deriveSteps([r(0, 'DONE'), r(1, 'MANUAL', 'built?'), r(1, 'TODO', 'missing')], { steps: ST.PIPELINE_STEPS.filter((s) => s.id <= 1), signoffs: { 1: { checks: ['built?'] } } });
    t('🚨 ...nor a TODO', st(out, 1), 'READY');
    out = PL.deriveSteps([r(0, 'DONE'), r(1, 'MANUAL', 'a new check')], { steps: ST.PIPELINE_STEPS.filter((s) => s.id <= 1), signoffs: { 1: { checks: ['an older check'] } } });
    t('a sign-off covers only the checks it named — a later check still needs one', st(out, 1), 'CONFIRM');
    out = only([r(0, 'DONE'), r(1, 'DONE'), r(1, 'WARN')], [0, 1]);
    t('WARN rows: DONE, with a note', [st(out, 1), out[1].warn], ['DONE', true]);
    out = only([r(0, 'TODO')], [0, 1]);
    t('a step nothing looked at is never DONE', st(out, 1), 'BLOCKED');
    const gateSteps = ST.PIPELINE_STEPS.filter((s) => s.id <= 13);
    const allButOne = Array.from({ length: 13 }, (_, i) => r(i, i === 6 ? 'MANUAL' : 'DONE')).concat([r(13, 'DONE')]);
    out = PL.deriveSteps(allButOne, { steps: gateSteps });
    t('step 13 is a gate: rows green but step 6 unconfirmed reads BLOCKED', st(out, 13), 'BLOCKED');
    t('...and says what it waits on', out.find((s) => s.id === 13).blockers, [6]);
    out = PL.deriveSteps(allButOne, { steps: gateSteps, signoffs: { 6: { checks: ['c6'] } } });
    t('...and opens once step 6 is signed off', st(out, 13), 'DONE');
    out = only([r(0, 'DONE'), r(1, 'FAIL'), r(2, 'TODO')], [0, 1, 2]);
    t('where am I: a FAIL comes before a READY', PL.whereAmI(out).id, 1);
    out = only([r(0, 'DONE'), r(1, 'MANUAL'), r(2, 'DONE')], [0, 1, 2]);
    t('...and a CONFIRM is reported when nothing else is open', PL.whereAmI(out).state, 'CONFIRM');
    t('every step DONE: nowhere left to be', PL.whereAmI(only([r(0, 'DONE')], [0])), null);
    // An optional step (Course Collection, 2026-10-12): never "do this next", never blocks.
    const C = ST.STEP.collection;
    const upTo = ST.PIPELINE_STEPS.filter((x) => x.id <= ST.STEP.allChecks);
    const green = upTo.filter((x) => x.id !== C).map((x) => r(x.id, 'DONE'));
    out = PL.deriveSteps([...green, r(C, 'MANUAL', 'collection product')], { steps: upTo });
    t('an optional step nobody has decided reads OPTIONAL — not "confirm", not "do next"', st(out, C), 'OPTIONAL');
    t('...and All checks is not held up by it', st(out, ST.STEP.allChecks), 'DONE');
    t('...and "where am I" never stops there', PL.whereAmI(out), null);
    out = PL.deriveSteps([...green, r(C, 'MANUAL', 'collection product')], { steps: upTo, signoffs: { [C]: { checks: ['collection product'] } } });
    t('signed off ("this author has none"): DONE', st(out, C), 'DONE');
    out = PL.deriveSteps([...green, r(C, 'FAIL', 'collection product')], { steps: upTo });
    t('🚨 but wrong is still wrong: a recorded product the store does not have is FAIL', [st(out, C), PL.whereAmI(out).id], ['FAIL', C]);
    t('counts include the optional ones', PL.counts(PL.deriveSteps([...green, r(C, 'MANUAL', 'x')], { steps: upTo })).OPTIONAL, 1);
  }

  console.log('\npipeline - sign-offs');
  {
    const step = { id: 7, title: 'Course360', rows: [{ check: 'Offer is Free and unlisted', status: 'MANUAL' }, { check: 'lesson URL', status: 'DONE' }] };
    const [v, p] = PL.signoffFor(step, { note: 'checked in Course360', now: new Date('2026-10-02T10:00:00Z') });
    t('a sign-off names exactly the MANUAL checks it covers', [v.checks, v.note, v.at, p], [['Offer is Free and unlisted'], 'checked in Course360', '2026-10-02T10:00:00.000Z', null]);
    const [, p2] = PL.signoffFor({ id: 4, title: 'Shopify bundle', rows: [{ check: 'bundle product', status: 'TODO' }] });
    truthy('a step decided by the live systems cannot be signed off', /no check that needs a person/.test(p2));
    const dir = mkdtempSync(join(tmpdir(), 'pipe-'));
    const file = join(dir, 'state.json');
    writeFileSync(file, JSON.stringify({ 1043: { lastVerify: { passed: true } } }));
    RG.recordSignoff('1043', 7, v, { file });
    const saved = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'));
    t('recorded beside lastVerify, which survives', [saved['1043'].lastVerify.passed, saved['1043'].signoffs['7'].checks], [true, ['Offer is Free and unlisted']]);
    RG.recordSignoff('1043', 7, null, { file });
    t('unsignoff removes it', JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'))['1043'].signoffs, {});
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('\npipeline - settings');
  {
    const dir = mkdtempSync(join(tmpdir(), 'pipe-'));
    const file = join(dir, 'pipeline.local.json');
    const s = SE.readSettings({ file });
    t('🔑 every switch defaults OFF', [s.guidance, s.alertsLocal, s.alertsUptime], ['off', 'off', 'off']);
    let err = null;
    try { SE.writeSettings({ guidance: 'yes' }, { file }); } catch (e) { err = e; }
    truthy('only on/off is accepted', err && /on or off/.test(err.message));
    err = null;
    try { SE.writeSettings({ alertsLocal: 'on', mystery: 1 }, { file }); } catch (e) { err = e; }
    truthy('an unknown setting is refused, and NOTHING is written', err && /unknown setting/.test(err.message) && SE.readSettings({ file }).alertsLocal === 'off');
    truthy('auto-refresh can never be faster than 15 minutes', SE.parseSetting('autoRefreshMinutes', 5)[1]);
    const next = SE.writeSettings({ alertsLocal: 'on', uptimeApiKey: 'u1234567890-secret' }, { file });
    t('a valid change is written', SE.readSettings({ file }).alertsLocal, 'on');
    const pub = SE.publicSettings(next);
    t('the uptime API key never leaves the file', [pub.uptimeApiKey, pub.uptimeApiKeySet], [undefined, true]);
    writeFileSync(file, '{ not json');
    t('a broken file reads as defaults — all off, never "on by accident"', SE.readSettings({ file }).alertsLocal, 'off');
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('\npipeline - switches are real');
  {
    const dir = mkdtempSync(join(tmpdir(), 'pipe-'));
    const tpl = join(dir, 'tpl.md');
    writeFileSync(tpl, '---\nname: next-step\n---\nrun {{DASHBOARD}}/pipeline.mjs');
    const skill = join(dir, '.claude', 'skills', 'next-step');
    const on = SW.applyGuidance(true, { template: tpl, dir: skill });
    const body = (await import('node:fs')).readFileSync(join(skill, 'SKILL.md'), 'utf8');
    truthy('guidance on: the skill is installed, with this repo\'s path filled in', on.applied && !body.includes('{{DASHBOARD}}') && body.includes('/pipeline.mjs'));
    const off = SW.applyGuidance(false, { template: tpl, dir: skill });
    t('🔑 guidance off: the skill is DELETED, not just marked off', [off.applied, (await import('node:fs')).existsSync(skill)], [true, false]);
    t('off twice is harmless', SW.applyGuidance(false, { dir: skill }).applied, true);
    rmSync(dir, { recursive: true, force: true });

    t('60 minutes is an hourly task', SW.scheduleArgs(60), ['/SC', 'HOURLY', '/MO', '1']);
    t('90 minutes is a minute schedule', SW.scheduleArgs(90), ['/SC', 'MINUTE', '/MO', '90']);
    t('1440 minutes is daily (MINUTE caps at 1439)', SW.scheduleArgs(1440), ['/SC', 'DAILY']);
    const vbs = SW.taskScript({ dir: 'C:\\a b\\coach-router', node: 'C:\\Program Files\\nodejs\\node.exe' });
    truthy('the launcher runs hidden (window style 0) so nothing flashes up hourly', /, 0, False/.test(vbs));
    truthy('...with paths containing spaces quoted the VBS way (doubled)', vbs.includes('""C:\\Program Files\\nodejs\\node.exe""') && vbs.includes('""C:\\a b\\coach-router""'));
    truthy('...running the health job in notify mode', vbs.includes('pipeline.mjs health --notify'));

    const manual = await SW.applyAlertsUptime(true, { uptimeProvider: '' });
    t('uptime with no provider API is honest: manual, not "applied"', [manual.applied, manual.manual], [false, true]);
    let sent = null;
    const ok = await SW.applyAlertsUptime(false, { uptimeProvider: 'uptimerobot', uptimeApiKey: 'k', uptimeMonitorId: '77' }, {
      fetchImpl: async (url, init) => { sent = { url, body: init.body }; return new Response(JSON.stringify({ stat: 'ok' }), { status: 200 }); },
    });
    truthy('uptime off pauses the monitor (status=0) through the API', ok.applied && /editMonitor/.test(sent.url) && /status=0/.test(sent.body) && /id=77/.test(sent.body));
    const refused = await SW.applyAlertsUptime(true, { uptimeProvider: 'uptimerobot', uptimeApiKey: 'k', uptimeMonitorId: '77' }, {
      fetchImpl: async () => new Response(JSON.stringify({ stat: 'fail', error: { message: 'bad key' } }), { status: 200 }),
    });
    falsy('a provider refusal is reported, never claimed as applied', refused.applied);
    const calls = [];
    await SW.applySwitches({ alertsIntervalMinutes: 30 }, { alertsLocal: 'off', alertsIntervalMinutes: 30 }, { applyAlertsLocal: (...a) => { calls.push(a); return { applied: true }; } });
    t('changing the interval while alerts are OFF schedules nothing', calls.length, 0);
    await SW.applySwitches({ alertsIntervalMinutes: 30 }, { alertsLocal: 'on', alertsIntervalMinutes: 30 }, { applyAlertsLocal: (...a) => { calls.push(a); return { applied: true }; } });
    t('...while ON it re-creates the task at the new interval', calls[0], [true, { intervalMinutes: 30 }]);
  }

  console.log('\npipeline - no credential leaves');
  {
    const shared = { ghlApiToken: 'pit-1234567890abcdef', healthToken: 'h-very-secret-1', vfApiKey: 'Bearer vfp_secretkey123', workerUrl: 'https://w', ghlLocationId: 'LOC' };
    const secrets = LV.secretValues(shared, [{ vfKey: 'VF.DM.projectkey99' }], { uptimeApiKey: 'u-secret-key-1' });
    truthy('every token, secret and key is collected', ['pit-1234567890abcdef', 'h-very-secret-1', 'VF.DM.projectkey99', 'u-secret-key-1'].every((s) => secrets.includes(s)));
    truthy('...and a Bearer key without its prefix too', secrets.includes('vfp_secretkey123'));
    falsy('...but not plain config like the Worker URL or location', secrets.includes('https://w') || secrets.includes('LOC'));
    t('a body carrying one is caught', LV.findSecret('{"x":"vfp_secretkey123"}', secrets), 'vfp_secretkey123');
    t('a clean body passes', LV.findSecret('{"state":"DONE"}', secrets), null);
  }

  console.log('\nhealth - trial end dates');
  {
    t('"2 October 2026" is UTC midnight, not local', new Date(HE.parseTrialEnd('2 October 2026')).toISOString(), '2026-10-02T00:00:00.000Z');
    truthy('a malformed date is NaN, never a silent pass', Number.isNaN(HE.parseTrialEnd('2026-10-02')));
    truthy('...and an impossible one too', Number.isNaN(HE.parseTrialEnd('31 February 2026')));
    const end = HE.parseTrialEnd('2 October 2026');
    falsy('the sweep has all of the end day', HE.trialOverdue(end, new Date('2026-10-02T23:00:00Z')));
    truthy('...overdue an hour after the day is over', HE.trialOverdue(end, new Date('2026-10-03T01:30:00Z')));
  }

  // A world for the health checks: every reader returns what a test sets.
  const FI = (await import('../coach-router/lib-verify-author.mjs')).FIELD_IDS;
  const S1 = { code: '1042', ghlTag: 'bookcoach-a-active', ghlProductId: 'P42', shopifyProductId: '111' };
  const S2 = { code: '1043', ghlTag: 'bookcoach-b-active', ghlProductId: 'P43', shopifyProductId: '222' };
  const contact = (id, tags, fields = {}, email = `${id}@x.com`) => ({ id, email, tags, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [FI[k], v])) });
  const NOW = new Date('2026-10-02T12:00:00Z');
  const hworld = (o = {}) => ({
    health: async () => o.health || { ok: true, httpStatus: 200, problems: [], sync: { lastOk: true, counts: {} }, coaches: [{ code: '1042', keyResolved: true }] },
    census: async () => o.census || [],
    byField: async (id, v) => (o.byField || []).filter((c) => c.fields[id] === v),
    subscriptions: async () => o.subs || [],
    workflows: async () => (o.workflows === 'deny' ? (() => { throw new Error('GHL 401 on /workflows/'); })() : o.workflows || [{ name: 'Book Coach — Delivery → Trial Start', status: 'published' }]),
    shopifyOrders: async () => o.orders || [],
    shopifyConfigured: o.shopify !== false,
  });
  const run = (o, extra = {}) => HE.healthChecks(hworld(o), { coaches: [S1, S2], cfg: { trialExpiryMode: 'on', tagOnSubscription: 'on', staffTag: 'bookcoach-staff-all', ...extra.cfg }, settings: extra.settings || {}, now: NOW });
  const st = (rows, id) => rows.find((r) => r.id === id).status;

  console.log('\nhealth - a healthy system');
  {
    const rows = await run({});
    t('every check runs, in order', rows.map((r) => r.id), ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9']);
    t('all OK', rows.map((r) => r.status), Array(9).fill('OK'));
    t('overall OK', HE.healthOverall(rows), 'OK');
  }

  console.log('\nhealth - each failure is caught');
  {
    let rows = await run({ health: { ok: false, httpStatus: 503, problems: ['no reconcile in 120min'], sync: {}, coaches: [] } });
    t('H1: /health not ok FAILS, with its problems', [st(rows, 'H1'), rows[0].items], ['FAIL', ['no reconcile in 120min']]);
    const old = new Date(NOW.getTime() - 30 * 86400000).toISOString();
    const recent = new Date(NOW.getTime() - 3 * 86400000).toISOString();
    rows = await run({ orders: [
      { name: '#1', createdAt: old, updatedAt: old, tags: [], cancelledAt: null, financial: 'PAID', productIds: ['111'] },
      { name: '#2', createdAt: old, updatedAt: old, tags: ['coach-started'], cancelledAt: null, financial: 'PAID', productIds: ['111'] },
      { name: '#3', createdAt: old, updatedAt: old, tags: [], cancelledAt: old, financial: 'PAID', productIds: ['111'] },
      { name: '#4', createdAt: old, updatedAt: old, tags: [], cancelledAt: null, financial: 'REFUNDED', productIds: ['111'] },
      { name: '#5', createdAt: recent, updatedAt: recent, tags: [], cancelledAt: null, financial: 'PAID', productIds: ['111'] },
      { name: '#6', createdAt: old, updatedAt: old, tags: [], cancelledAt: null, financial: 'PAID', productIds: ['999'] },
    ] });
    t('🚨 H2: a paid bundle order past 22 days with no trial FAILS — only that one', [st(rows, 'H2'), rows.find((r) => r.id === 'H2').items.map((x) => x.split(' ')[0])], ['FAIL', ['#1']]);
    rows = await run({ orders: [{ name: '#7', createdAt: old, updatedAt: old, tags: ['delivered-manual'], cancelledAt: null, financial: 'PAID', productIds: ['111'] }] });
    t('🚨 H3: tagged delivered-manual, never run, FAILS', st(rows, 'H3'), 'FAIL');
    rows = await run({ orders: [{ name: '#8', createdAt: old, updatedAt: new Date(NOW.getTime() - 60000).toISOString(), tags: ['delivered-manual'], cancelledAt: null, financial: 'PAID', productIds: ['111'] }] });
    t('...just tagged is a WARN — press Run workflow', st(rows, 'H3'), 'WARN');
    t('H2/H3 without Shopify configured: SKIP with the reason, never OK', (await HE.healthChecks({ ...hworld({}), shopifyConfigured: false }, { coaches: [S1], cfg: { trialExpiryMode: 'on' }, now: NOW })).filter((r) => r.id === 'H2' || r.id === 'H3').map((r) => r.status), ['SKIP', 'SKIP']);

    rows = await run({ census: [contact('C1', ['bookcoach-a-active'], { coach_status: 'trial', coach_trial_ends: '20 September 2026', coach_code: '1042' })] });
    t('🚨 H4: a tag holder past their trial end FAILS', st(rows, 'H4'), 'FAIL');
    rows = await run({ census: [contact('C1', ['bookcoach-a-active'], { coach_status: 'trial', coach_trial_ends: '5 October 2026', coach_code: '1042' })] });
    t('...one still inside their trial is OK', st(rows, 'H4'), 'OK');
    rows = await run({}, { cfg: { trialExpiryMode: 'off' } });
    t('...and with the sweep switched off it WARNS: nothing will ever end', st(rows, 'H4'), 'WARN');

    rows = await run({ census: [contact('C2', ['bookcoach-a-active'], { coach_status: '' })] });
    t('🚨 H5: a coach tag with no trial and no subscription FAILS', st(rows, 'H5'), 'FAIL');
    rows = await run({ census: [contact('C2', ['bookcoach-a-active'], { coach_status: 'active' })], subs: [{ contactId: 'C2', productId: 'P42' }] });
    t('...a paying subscriber is explained', st(rows, 'H5'), 'OK');
    rows = await run({ census: [contact('C2', ['bookcoach-a-active'], {})] }, { settings: { knownGrants: ['C2'] } });
    t('...so is a known grant', st(rows, 'H5'), 'OK');
    rows = await run({ census: [contact('C2', ['bookcoach-a-active', 'bookcoach-staff-all'], {})] });
    t('...and the staff tag', st(rows, 'H5'), 'OK');
    rows = await run({ census: [contact('C3', ['bookcoach-b-active'], { coach_status: 'trial', coach_code: '1042' })] });
    t('...but a trial for ANOTHER coach does not explain this coach\'s tag', st(rows, 'H5'), 'FAIL');

    rows = await run({ census: [contact('C4', ['bookcoach-a-active'], { coach_status: 'expired' })] });
    t('🚨 H6: "expired" but still holding the tag FAILS', st(rows, 'H6'), 'FAIL');
    rows = await run({ byField: [contact('C5', [], { coach_status: 'trial' })] });
    t('🚨 ...and "trial" with no tag at all FAILS — that reader gets nothing, silently', st(rows, 'H6'), 'FAIL');
    rows = await run({ byField: [contact('C6', [], { coach_status: 'active' })], subs: [{ contactId: 'C6', productId: 'P42' }] });
    t('..."active" with no tag but a live subscription is H9\'s question, not drift', st(rows, 'H6'), 'OK');

    rows = await run({ census: [contact('C7', ['bookcoach-a-active'], { coach_status: 'trial' }, 'me+verify-1042-1@x.com')] });
    t('H7: a +verify- test contact still entitled FAILS', st(rows, 'H7'), 'FAIL');

    rows = await run({ workflows: [{ name: 'Book Coach — Delivery → Trial Start', status: 'draft' }] });
    t('🚨 H8: the trial email workflow in draft FAILS', st(rows, 'H8'), 'FAIL');
    rows = await run({ workflows: 'deny' });
    t('...no workflows scope is a SKIP that names it', [st(rows, 'H8'), /workflows\.readonly/.test(rows.find((r) => r.id === 'H8').detail)], ['SKIP', true]);

    rows = await run({ subs: [{ contactId: 'C8', productId: 'P43' }] });
    t('H9: a paying subscriber without the coach tag WARNS', st(rows, 'H9'), 'WARN');

    rows = await HE.healthChecks({ ...hworld({}), census: async () => { throw new Error('GHL 503'); } }, { coaches: [S1], cfg: { trialExpiryMode: 'on' }, now: NOW });
    t('a census outage FAILS every check that needed it, and names why', ['H4', 'H5', 'H6', 'H7', 'H9'].map((id) => st(rows, id)), ['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL']);
    t('...while the checks that did not need it still report', st(rows, 'H1'), 'OK');
  }

  console.log('\nhealth - alerts notify on change only');
  {
    const rows = [{ id: 'H1', status: 'OK' }, { id: 'H4', status: 'FAIL' }];
    let c = HE.healthChanges({}, rows);
    t('a new FAIL is a notification', c.broke.map((r) => r.id), ['H4']);
    c = HE.healthChanges(c.state, rows);
    t('🔑 the same FAIL an hour later is silence, not a second alert', [c.broke.length, c.recovered.length], [0, 0]);
    c = HE.healthChanges(c.state, [{ id: 'H1', status: 'OK' }, { id: 'H4', status: 'OK' }]);
    t('a recovery is a notification', c.recovered.map((r) => r.id), ['H4']);
  }
}

/* ---------------------------------------------------------------------------
 * the dashboard server (server.mjs) — plans/22-pipeline-dashboard.md §8
 * Driven over a real local socket with a fake pipeline: no GHL, no Shopify.
 * ------------------------------------------------------------------------- */
{
  const { makeHandler } = await import('./server.mjs');
  const http = await import('node:http');
  const SECRET = 'pit-0123456789abcdef0123456789';
  const author = (detail = 'fine') => ({
    code: '1043', name: 'Freddy Davis', book: 'The Truth Mirage', where: { id: 6, title: 'Course360', state: 'CONFIRM' }, counts: {},
    steps: [
      { id: 5, title: 'Shopify bundle', state: 'DONE', rows: [{ step: 4, check: 'bundle product', status: 'DONE', detail }], unsigned: [], blockers: [], needs: [4] },
      { id: 6, title: 'Course360', state: 'CONFIRM', rows: [{ step: 5, check: 'Offer is Free and unlisted', status: 'MANUAL', detail: '' }], unsigned: ['Offer is Free and unlisted'], blockers: [], needs: [4] },
    ],
  });
  const recorded = [];
  const refreshed = [];
  const authorOpts = [];
  let leak = false;
  const pipeline = {
    coaches: [{ code: '1043' }],
    secrets: () => [SECRET],
    refresh(what) { refreshed.push(what); },
    authors: async () => [author(leak ? `token ${SECRET}` : 'fine')],
    author: async (code, opts) => { authorOpts.push(opts || null); return author(); },
    health: async () => ({ overall: 'OK', rows: [] }),
    snapshot: async () => ({ generatedAt: 'x', authors: [] }),
  };
  const settingsCalls = [];
  const settings = {
    read: () => ({ guidance: 'off', alertsLocal: 'off', alertsUptime: 'off' }),
    write: (c) => { if ('bogus' in c) throw new Error('Nothing written: unknown setting'); settingsCalls.push(c); return { ...c }; },
    apply: async () => ({ guidance: { applied: true, detail: 'ok' } }),
    reality: () => ({}),
  };
  const server = http.createServer();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  const token = 'tok-abc-123';
  const handle = makeHandler({ pipeline, token, port, settings, signoffs: { record: (...a) => recorded.push(a) } });
  server.on('request', (q, s) => handle(q, s));

  const call = ({ method = 'GET', path = '/', headers = {}, body } = {}) => new Promise((ok, bad) => {
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', bad);
    if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
  const auth = { 'x-pipeline-token': token };
  const post = (path, body, extra = {}) => call({ method: 'POST', path, body, headers: { ...auth, 'content-type': 'application/json', ...extra } });

  console.log('\ndashboard - the page');
  {
    const r = await call();
    t('the page is served', r.status, 200);
    truthy('...with the session token embedded for the page itself', r.text.includes(`content="${token}"`));
    {
      const page = async (p) => { const x = await call({ path: p }); return [x.status, x.text.includes(`content="${token}"`)]; };
      t('every view has its own address that serves the page: tabs, an author, an author at a step',
        await Promise.all(['/pipeline', '/canvas', '/health', '/onboard', '/onboard/1002-freddy-davis', '/onboard/1002-freddy-davis/5', '/onboard/freddy/'].map(page)),
        Array(7).fill([200, true]));
      t('🔒 ...and nothing else does: not a deeper path, a dot-dot, or an unknown tab',
        (await Promise.all(['/onboard/a/b/c', '/onboard/..%2Fserver.mjs', '/onboard/a.js', '/admin', '/pipeline/x/y/z'].map((p) => call({ path: p })))).map((x) => x.status),
        [404, 404, 404, 404, 404]);
    }
    truthy('...and a CSP allowing only its own scripts — nothing from a CDN', /script-src 'self'/.test(r.headers['content-security-policy']) && /default-src 'none'/.test(r.headers['content-security-policy']));
    t('...that cannot be framed', r.headers['x-frame-options'], 'DENY');
    t('the app script is served', (await call({ path: '/app.js' })).status, 200);
    t('anything else is not', (await call({ path: '/../coaches.json' })).status, 404);
  }

  console.log('\ndashboard - the guards');
  {
    t('🔒 a foreign Host is refused (defeats DNS rebinding)', (await call({ headers: { host: 'evil.example:80' } })).status, 421);
    t('🔒 an API call without the session token is refused', (await call({ path: '/api/state' })).status, 401);
    t('🔒 ...and with a wrong one', (await call({ path: '/api/state', headers: { 'x-pipeline-token': 'guess' } })).status, 401);
    t('🔒 a foreign Origin is refused even with the token', (await call({ path: '/api/state', headers: { ...auth, origin: 'https://evil.example' } })).status, 403);
    t('the page\'s own origin is fine', (await call({ path: '/api/state', headers: { ...auth, origin: `http://127.0.0.1:${port}` } })).status, 200);
    t('🔒 a POST that is not JSON is refused (a plain form cannot write)', (await call({ method: 'POST', path: '/api/signoff', body: 'code=1043', headers: { ...auth, 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
    leak = true;
    const r = await call({ path: '/api/state', headers: auth });
    t('🔒 a response that would carry a credential is REFUSED', r.status, 500);
    falsy('...and the credential is not in what was sent', r.text.includes(SECRET));
    leak = false;
  }

  console.log('\ndashboard - sign-offs and switches');
  {
    let r = await post('/api/signoff', { code: '1043', step: 6, note: 'checked' });
    t('signing a step that needs a person works', r.status, 200);
    t('...recording exactly the MANUAL checks, against the live rows', [recorded[0][0], recorded[0][1], recorded[0][2].checks], ['1043', 6, ['Offer is Free and unlisted']]);
    r = await post('/api/signoff', { code: '1043', step: 5 });
    t('a step decided by the live systems cannot be signed off', r.status, 400);
    t('an unknown author is refused', (await post('/api/signoff', { code: '9999', step: 6 })).status, 400);
    t('an unknown step is refused', (await post('/api/signoff', { code: '1043', step: 99 })).status, 400);
    r = await post('/api/unsignoff', { code: '1043', step: 6 });
    t('unsignoff records a removal', [r.status, recorded[1][2]], [200, null]);
    r = await post('/api/settings', { changes: { guidance: 'on' } });
    t('a switch flips, and reports what it actually did', [r.status, JSON.parse(r.text).applied.guidance.detail], [200, 'ok']);
    t('🔒 the uptime API key cannot be set through the browser', (await post('/api/settings', { changes: { uptimeApiKey: 'x' } })).status, 400);
    t('a bad setting is refused with the reason', (await post('/api/settings', { changes: { bogus: 1 } })).status, 400);
  }

  console.log('\ndashboard - Refresh reads again only what it names');
  {
    const st = async (q) => (await call({ path: `/api/state${q}`, headers: auth })).status;
    refreshed.length = 0;
    await st('');
    t('🔑 opening the dashboard reads nothing again: it shows the last readings', refreshed, []);
    t('refresh=all (and the old refresh=1) is every author', [await st('?refresh=all'), await st('?refresh=1')], [200, 200]);
    t('...without the health checks unless asked', refreshed, [{ codes: 'all', health: false }, { codes: 'all', health: false }]);
    refreshed.length = 0;
    await st('?refresh=all&health=1');
    await st('?refresh=1043');
    await st('?health=1');
    t('"Everything"; one author (the Onboard tab); the health checks only', refreshed, [{ codes: 'all', health: true }, { codes: ['1043'], health: false }, { codes: [], health: true }]);
    refreshed.length = 0;
    t('🔒 an unknown author, a bad code or a path is refused', [await st('?refresh=9999'), await st('?refresh=1043,abc'), await st('?refresh=..%2Fx')], [400, 400, 400]);
    t('...and nothing is read for it', refreshed, []);
    await Promise.all([st('?refresh=1043'), st('?refresh=all')]);
    t('🔑 two refreshes at once both happen — the second waits its turn', refreshed.length, 2);
    refreshed.length = 0;
    await call({ path: '/api/health?refresh=1', headers: auth });
    t('the Health refresh reads only the health checks again', refreshed, [{ codes: [], health: true }]);
    authorOpts.length = 0;
    await post('/api/signoff', { code: '1043', step: 6, note: 'checked' });
    t('a sign-off is checked against rows no older than the 10-minute read cache', authorOpts[0], { maxAgeMs: 600000 });
  }
  server.close();
}


/* ---------------------------------------------------------------------------
 * the Add-author wizard (lib-wizard) and the commands it may run (lib-actions)
 * ------------------------------------------------------------------------- */
{
  const WZ = await import('./lib-wizard.mjs');
  const AC = await import('./lib-actions.mjs');
  const { EventEmitter } = await import('node:events');
  const { readFileSync, existsSync } = await import('node:fs');
  const coaches = [
    { code: '1042', name: 'Micheal Stickler', displayName: 'Michael Stickler', slug: 'michael-stickler', bookTitle: 'Life Without Reservation', bookLandingUrl: 'https://leadershipbooks.com/pages/lwr', shopifyProductId: '1', shopifyVariantId: '11', landingPageUrl: 'https://www.book-coach.ai/michael-stickler-coach-access' },
    { code: '1043', name: 'Freddy Davis', displayName: 'Freddy Davis', slug: 'freddy-davis', bookTitle: 'The Truth Mirage', coachLabel: 'Worldview Coach', ghlTag: 'bookcoach-freddy-davis-active', ghlProductId: 'P43', ghlPriceId: 'R43', shopifyVariantId: '54120408187194' },
  ];

  console.log('\nwizard - every answer is checked by the commands\' own rules');
  {
    const v = (k, x, ctx = {}) => WZ.validateField(k, x, { coaches, ...ctx });
    t('a free four-digit code is accepted', v('code', '1045'), ['1045', null]);
    truthy('a code already in use is refused, naming who has it', /Michael Stickler/.test(v('code', '1042')[1]));
    truthy('a code another draft holds is refused', v('code', '1045', { drafts: { 1045: {} }, code: '1046' })[1]);
    truthy('a three-digit code is refused — a caller keys four', v('code', '104')[1]);
    truthy('a slug that is not lowercase-with-hyphens is refused', v('slug', 'Jane Smith')[1]);
    truthy('a slug another author has is refused', /Freddy Davis/.test(v('slug', 'freddy-davis', { code: '1045' })[1]));
    truthy('🚨 a Voiceflow alias like "main" is refused — the personal key rejects it', v('versionID', 'main')[1]);
    t('a 24-character version is accepted', v('versionID', '6A3339B6EB283C59B70CFA53'), ['6a3339b6eb283c59b70cfa53', null]);
    truthy('a required answer cannot be blank', v('bookTitle', '  ')[1]);
    t('an optional blank answer is "not given", not wrong', v('projectID', ''), [undefined, null]);
    t('book buttons: one "Title|url" per line', v('books', 'A Book|https://x/1\nB|https://x/2')[0], [{ title: 'A Book', url: 'https://x/1' }, { title: 'B', url: 'https://x/2' }]);
    truthy('an internal spelling with & is refused — it breaks the phone line', v('name', 'Jo & Co')[1]);
    t('the lesson URL loses its preview token, exactly as author set does', v('courseLessonUrl', 'https://login.x/courses/products/u?is_preview=true&token=S')[0], 'https://login.x/courses/products/u');
    t('a slug is suggested from the name', WZ.suggestSlug('Jöhn  O\'Brien'), 'john-o-brien');
    t('the coach label defaults to "<Author> – <Book title>"', WZ.suggestLabel(' Sue Summers ', 'Let\'s Raise Media-Savvy Kids'), 'Sue Summers – Let\'s Raise Media-Savvy Kids');
    t('...and stays empty until both are known', WZ.suggestLabel('Sue Summers', ''), '');
    const { withAuthor } = await import('../coach-router/lib-onboard.mjs');
    t('a label that already names the author is not prefixed with the name again', withAuthor('Sue Summers', 'Sue Summers – Her Book'), 'Sue Summers – Her Book');
    t('...an ordinary label still is', withAuthor('Freddy Davis', 'Worldview Coach'), 'Freddy Davis - Worldview Coach');
    const sue = WZ.wizardView({ code: '1004', draft: { values: { displayName: 'Sue Summers', slug: 'sue-summers', bookTitle: 'Her Book', coachLabel: 'Sue Summers – Her Book' } }, coaches });
    t('the Course360 name does not say the author twice', sue.steps[5].info.find((i) => i.label === 'The course will be named').value, 'BookCoach AI — Sue Summers – Her Book');
    const desc = sue.steps[5].info.find((i) => i.label === '…with this description');
    truthy('step 6 gives a course description to copy, with this author\'s name in it', desc && desc.copy && /built on the teaching of Sue Summers\./.test(desc.value));
    t('...the same words for every coach but the name', (await import('../coach-router/lib-onboard.mjs')).courseDescription('Rick Meyer').replace('Rick Meyer', 'X'), desc.value.replace('Sue Summers', 'X'));
    const help6 = JSON.stringify(sue.steps[5].help);
    truthy('step 6\'s how-to no longer sends you to "Generate the files" — it says Duplicate the master, then "Make the course"', !/Generate the files|course360\.txt/.test(help6) && /Duplicate/.test(help6) && help6.includes('BookCoach AI — Freddy Davis — Worldview Coach') && /Make the course/.test(help6));
    truthy('...nor does the page\'s tab title', (await import('../coach-router/lib-author.mjs')).coachPageConfig({ code: '1004', displayName: 'Sue Summers', coachLabel: 'Sue Summers – Her Book' }, { workerUrl: 'w' }).includes('pageTitle: "Sue Summers – Her Book"'));
    t('the next code follows the last real author', WZ.nextCode(coaches, { 1050: {} }), '1044');
    t('...skipping a code a draft already holds', WZ.nextCode(coaches, { 1044: {}, 1045: {} }), '1046');
  }

  console.log('\nwizard - drafts');
  {
    const dir = mkdtempSync(join(tmpdir(), 'wz-'));
    const file = join(dir, 'drafts.local.json');
    let r = WZ.saveDraft('1045', { displayName: 'Jane Smith', slug: 'jane-smith', bookTitle: 'Her Book', coachLabel: 'Her Coach' }, { coaches, file });
    t('step 0 answers are saved as a draft', r.draft.values.slug, 'jane-smith');
    r = WZ.saveDraft('1045', { versionID: 'main', projectID: '' }, { coaches, file });
    truthy('one bad answer saves nothing, and says which', r.problems && r.problems.versionID && !WZ.readDrafts({ file })['1045'].values.versionID);
    r = WZ.saveDraft('1045', { versionID: '6a3339b6eb283c59b70cfa53' }, { coaches, file });
    t('later steps merge into the same draft', [r.draft.values.displayName, r.draft.values.versionID], ['Jane Smith', '6a3339b6eb283c59b70cfa53']);
    falsy('...and there is no "the coach is built" tick to keep any more (2026-10-12): the IDs are the proof', 'confirmations' in r.draft);
    t('only what comes before the author is created belongs in a draft', WZ.saveDraft('1045', { courseLessonUrl: 'https://x/y' }, { coaches, file }).draft.values.courseLessonUrl, undefined);
    truthy('a draft cannot take an existing author\'s code', WZ.saveDraft('1042', { displayName: 'X' }, { coaches, file }).problems.code);
    t('what step 4 still needs is listed', WZ.onboardMissing({ code: '1045', displayName: 'J' }), ['Book title', 'Coach label', 'Page slug', 'Voiceflow version ID']);
    const pageBits = WZ.saveDraft('1045', { authorPhotoURL: 'https://img.example/jane.jpg', books: ['Her Book|https://buy.example/her'] }, { coaches, file });
    t('the coach page comes first, so a draft keeps its photo and book buttons', [pageBits.draft.values.authorPhotoURL, pageBits.draft.values.books], ['https://img.example/jane.jpg', [{ title: 'Her Book', url: 'https://buy.example/her' }]]);
    truthy('...validated like any answer', WZ.saveDraft('1045', { authorURL: 'http://not-https' }, { coaches, file }).problems.authorURL);
    t('discard removes it', [WZ.deleteDraft('1045', { file }), WZ.readDrafts({ file })['1045']], [true, undefined]);
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('\nwizard - the view');
  {
    const draft = { values: { displayName: 'Jane Smith', slug: 'jane-smith', bookTitle: 'Her Book', coachLabel: 'Her Coach', versionID: '6a3339b6eb283c59b70cfa53' }, confirmations: {} };
    const v = WZ.wizardView({ code: '1045', draft, shared: { workerUrl: 'https://w', verifyEmail: 'me@x.com' }, coaches });
    t('17 steps, in the checklist\'s order', v.steps.map((s) => s.id), Array.from({ length: 17 }, (_, i) => i));
    t('the Zipify step gives the product to pick in its Product block, then the page name, URL handle and meta title, to copy', v.steps[7].info.map((i) => i.value), ['Her Book [Jane Smith] + Your Personal AI Coach', 'Book Coach AI - Jane Smith - Her Book', 'book-coach-ai-jane-smith-her-book', 'Her Book + BookCoach AI | LeadershipBooks.com']);
    t('...and step 9 says the exact address the page should end up at', v.steps[9].info.map((i) => i.value), ['https://leadershipbooks.com/pages/book-coach-ai-jane-smith-her-book']);
    const ON = await import('../coach-router/lib-onboard.mjs');
    t('...the same pattern as the live pages', [ON.zipifyPageName('Freddy Davis', 'The Truth Mirage'), ON.zipifyHandle('Freddy Davis', 'The Truth Mirage')], ['Book Coach AI - Freddy Davis - The Truth Mirage', 'book-coach-ai-freddy-davis-the-truth-mirage']);
    t('...a handle is lowercase, with the apostrophe dropped', ON.zipifyHandle('Sue Summers', "Let's Raise Media-Savvy Kids"), 'book-coach-ai-sue-summers-lets-raise-media-savvy-kids');
    // The book video: any YouTube link in, the live pages' embed code out.
    t('a YouTube link is read in every form a person pastes', ['https://www.youtube.com/watch?v=xLm7kOWSynA', 'https://youtu.be/xLm7kOWSynA?si=x', 'youtube.com/shorts/xLm7kOWSynA', 'https://m.youtube.com/watch?v=xLm7kOWSynA&t=42s&list=PL1', 'https://www.youtube.com/embed/xLm7kOWSynA', 'xLm7kOWSynA', 'https://vimeo.com/1', 'not a link'].map(ON.youtubeId),
      ['xLm7kOWSynA', 'xLm7kOWSynA', 'xLm7kOWSynA', 'xLm7kOWSynA', 'xLm7kOWSynA', 'xLm7kOWSynA', '', '']);
    t('...and becomes exactly the embed code the sales pages use', ON.youtubeEmbed('https://youtu.be/xLm7kOWSynA'),
      '<iframe src="https://www.youtube.com/embed/xLm7kOWSynA?playlist=xLm7kOWSynA&autoplay=0&loop=1&mute=0&controls=1"  loading="lazy" width="100%" height="100%" preload="metadata" allowfullscreen="1" mozallowfullscreen="" webkitallowfullscreen="" oallowfullscreen="" msallowfullscreen=""></iframe>');
    t('the video box asks at step 8 and saves one plain link; anything not YouTube is refused', [WZ.validateField('videoUrl', 'https://youtu.be/xLm7kOWSynA?si=x')[0], !!WZ.validateField('videoUrl', 'https://vimeo.com/1')[1]], ['https://www.youtube.com/watch?v=xLm7kOWSynA', true]);
    const withVideo = WZ.infoFor(7, { displayName: 'Jane Smith', bookTitle: 'Her Book', videoUrl: 'https://www.youtube.com/watch?v=xLm7kOWSynA' }, {});
    truthy('...once saved, step 8 shows the embed code to copy', withVideo.some((i) => /^Book video/.test(i.label) && i.copy && i.value.startsWith('<iframe src="https://www.youtube.com/embed/xLm7kOWSynA?playlist=xLm7kOWSynA')));
    falsy('...and without one, no empty box', WZ.infoFor(7, { displayName: 'Jane Smith', bookTitle: 'Her Book' }, {}).some((i) => /^Book video/.test(i.label)));
    t('the Shopify bundle price starts filled in as 29.95 — an answer you can change, not a grey hint', v.steps[4].fields.find((f) => f.key === 'price').value, '29.95');
    falsy('the coach page (step 3) can be done before the author exists — it comes first', v.steps[2].needsAuthor);
    falsy('step 4 can run before the author exists — it is what creates them', v.steps[3].needsAuthor);
    truthy('every later step waits for step 4', v.steps.slice(5).every((s) => s.needsAuthor));
    t('...and the coach page offers its own form, not the generic field list', [v.steps[2].actions, v.steps[2].fields.map((f) => f.key)], [['page'], []]);
    truthy('the coach code cannot be edited in the form', v.steps[0].fields.find((f) => f.key === 'code').readOnly);
    t('a complete draft has nothing missing', v.missingForCreate, []);
    const info4 = Object.fromEntries(v.steps[3].info.map((i) => [i.label, i.value]));
    t('step 4 says exactly what it will create — the tag', info4['GHL tag it will create'], 'bookcoach-jane-smith-active');
    t('...and the product, by the naming convention', info4['$59 product it will create'], 'BookCoach AI - Jane Smith - Coach Access');
    truthy('step 6 shows the lesson iframe exactly as GHL stores it (a plain &) — the command writes it', v.steps[5].info.some((i) => i.value.includes('jane-smith?cid={{contact.id}}&em={{contact.email}}" width="100%" height="800" allow="microphone"')));
    truthy('step 2 works out the project id from the version', v.steps[1].info.some((i) => i.value === '6a3339b6eb283c59b70cfa52'));
    const e = WZ.wizardView({ code: '1043', coach: { ...coaches[1], vfKey: 'VF.DM.secret', apiKey: 'Bearer vfp_x' }, coaches, shared: {} });
    falsy('🔒 an existing author\'s Voiceflow key never reaches the view', JSON.stringify(e).includes('VF.DM.secret') || JSON.stringify(e).includes('vfp_x'));
    truthy('...and once created, the internal spelling is fixed too', e.steps[0].fields.find((f) => f.key === 'name').readOnly);
  }

  console.log('\nwizard - files written on this computer');
  {
    const dir = mkdtempSync(join(tmpdir(), 'wz-'));
    const jane = { code: '1045', name: 'Jane Smith', displayName: 'Jane Smith', slug: 'jane-smith', bookTitle: 'Her Book', coachLabel: 'Her Coach', shopifyVariantId: '999', ghlProductId: 'P45', ghlPriceId: 'R45' };
    let err = null;
    try { WZ.generate('coach-page', jane, { coaches, shared: {}, secrets: [], dir }); } catch (x) { err = x; }
    truthy('the coach page is no longer a generated note — step 3 builds it from a form (lib-pages)', err && /unknown/.test(err.message));
    t('step 3 offers the form, not "Generate the files"', WZ.STEP_ACTIONS[2], ['page']);
    const z = WZ.generate('zipify', jane, { coaches, shared: {}, from: '1042', secrets: [], dir });
    truthy('the Zipify list replaces the ™ title before the plain one', z.text.indexOf('Life Without Reservation™') < z.text.indexOf('"Life Without Reservation"'));
    truthy('...and gives the plain cart link', z.text.includes('https://leadershipbooks.com/cart/999:1'));
    truthy('the funnel note names this author\'s product and price', WZ.generate('funnel', jane, { coaches, shared: {}, secrets: [], dir }).text.includes('product P45, price R45'));
    truthy('the Course360 note names the course, the iframe and the grant workflow', /BookCoach AI — Jane Smith — Her Coach[\s\S]*iframe[\s\S]*Grant Course \(Jane Smith\)/.test(WZ.generate('course360', jane, { coaches, shared: {}, secrets: [], dir }).text));
    t('the files are listed back', WZ.generatedFiles('jane-smith', { dir }).map((f) => f.name), ['course360.txt', 'funnel.txt', 'zipify.txt']);
    err = null;
    try { WZ.generate('everything', jane, { dir }); } catch (x) { err = x; }
    truthy('an unknown kind of file is refused', err && /unknown/.test(err.message));
    rmSync(dir, { recursive: true, force: true });
  }

  console.log('\nactions - only these commands, only like this');
  {
    const drafts = { 1045: { values: { displayName: 'Jane Smith', name: 'Jayne Smith', slug: 'jane-smith', bookTitle: 'Her Book', coachLabel: 'Her Coach', versionID: '6a3339b6eb283c59b70cfa53' } } };
    const plan = (o) => AC.planAction({ coaches, drafts, ...o });
    let err = null;
    try { plan({ action: 'rm -rf', code: '1045' }); } catch (x) { err = x; }
    truthy('🔒 anything not on the list is refused', err && /unknown action/.test(err.message));
    let p = plan({ action: 'onboard', code: '1045' });
    t('onboard: a dry run by default, built from the validated draft', p.steps[0], { script: 'onboard.mjs', args: ['--code', '1045', '--author', 'Jane Smith', '--book', 'Her Book', '--slug', 'jane-smith', '--label', 'Her Coach', '--version', '6a3339b6eb283c59b70cfa53', '--project', '6a3339b6eb283c59b70cfa52', '--name', 'Jayne Smith'] });
    falsy('...with no --write', p.write);
    err = null;
    try { plan({ action: 'onboard', code: '1045', write: true }); } catch (x) { err = x; }
    truthy('🔒 a real run without the confirmation is refused', err && /onboard 1045/.test(err.message));
    p = plan({ action: 'onboard', code: '1045', write: true, confirm: AC.confirmPhrase('onboard', '1045') });
    t('...with it, the same command plus --write', p.steps[0].args.slice(-1), ['--write']);
    const withPage = { 1045: { values: { ...drafts[1045].values, authorPhotoURL: 'https://img.example/j.jpg', books: [{ title: 'B', url: 'https://b.example' }] } } };
    p = AC.planAction({ action: 'onboard', code: '1045', coaches, drafts: withPage });
    t('the preview of creating the author is onboard alone', p.steps.map((x) => x.script), ['onboard.mjs']);
    p = AC.planAction({ action: 'onboard', code: '1045', coaches, drafts: withPage, write: true, confirm: AC.confirmPhrase('onboard', '1045') });
    t('...the real run then saves the page details from step 3 into the new entry', [p.steps.map((x) => x.script), p.steps[0].args.slice(-1), p.steps[1].args],
      [['onboard.mjs', 'author.mjs'], ['--write'], ['set', '--code', '1045', '--authorPhotoURL', 'https://img.example/j.jpg', '--books', 'B|https://b.example']]);
    err = null;
    try { plan({ action: 'onboard', code: '1043' }); } catch (x) { err = x; }
    truthy('onboard refuses an author that already exists', err && /already exists/.test(err.message));
    err = null;
    try { plan({ action: 'shopify', code: '1045' }); } catch (x) { err = x; }
    truthy('a step after 3 refuses until the author exists', err && /create the author first/.test(err.message));
    p = plan({ action: 'set', code: '1043', params: { values: { courseLessonUrl: 'https://login.x/c/u?is_preview=true', books: ['A|https://x/a', 'B|https://x/b'] } } });
    t('set: validated values, books repeated, preview token stripped', p.steps[0].args, ['set', '--code', '1043', '--courseLessonUrl', 'https://login.x/c/u', '--books', 'A|https://x/a', '--books', 'B|https://x/b']);
    err = null;
    try { plan({ action: 'set', code: '1043', params: { values: { vfKey: 'x' } } }); } catch (x) { err = x; }
    truthy('🔒 set refuses a field that is not a registry field — the key cannot be written from the page', err && /not a registry field/.test(err.message));
    p = plan({ action: 'push', code: '1043', write: true, confirm: 'push 1043' });
    t('go live: seed for real, then the secrets', p.steps.map((s) => [s.script, ...s.args]), [['seed-coaches.mjs', '--write'], ['sync-secrets.mjs', '--write']]);
    t('...and its preview is seed alone, dry', plan({ action: 'push', code: '1043' }).steps.map((s) => [s.script, ...s.args]), [['seed-coaches.mjs']]);
    t('the end-to-end test uses the saved test inbox only (no per-run override)', plan({ action: 'verify', code: '1043', params: { runEmail: 'Other@Real.org' } }).steps[0].args, ['--code', '1043', '--shopify-order']);
    t('free access: a real person, their exact address, the guest flag', plan({ action: 'guest', code: '1043', params: { guestEmail: 'Friend@Real.org' } }).steps[0].args, ['--code', '1043', '--shopify-order', '--guest', '--email', 'friend@real.org']);
    t('...needs an email that can receive mail', ['', 'a@example.com', 'nope'].map((x) => { try { plan({ action: 'guest', code: '1043', params: { guestEmail: x } }); return 'ran'; } catch { return 'refused'; } }), ['refused', 'refused', 'refused']);
    t('the end-to-end test keeps the contact only when asked', plan({ action: 'verify', code: '1043', params: { keep: true } }).steps[0].args, ['--code', '1043', '--shopify-order', '--keep']);
    err = null;
    try { plan({ action: 'shopify', code: '1043', params: { price: '29.95; rm -rf /' } }); } catch (x) { err = x; }
    truthy('a malformed value is refused before anything runs', err && /price/.test(err.message));

    // The product image (step 5): a file on this computer OR a link; the command reads and checks it.
    const picDir = mkdtempSync(join(tmpdir(), 'bc-img-'));
    const pic = join(picDir, 'Rick cover.jpg');
    const notPic = join(picDir, 'notes.txt');
    writeFileSync(pic, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    writeFileSync(notPic, 'x');
    const refused = (params) => { try { plan({ action: 'shopify', code: '1043', params }); return ''; } catch (x) { return x.message; } };
    try {
      t('an image file goes to the command as its own argument, "Copy as path" quotes dropped',
        plan({ action: 'shopify', code: '1043', params: { imageFile: `"${pic}"` } }).steps[0].args.slice(-2), ['--image-file', pic]);
      truthy('a file AND a link: refused', /not both/.test(refused({ imageFile: pic, imageUrl: 'https://x/a.png' })));
      truthy('not a picture type: refused', /\.jpg, \.png/.test(refused({ imageFile: notPic })));
    } finally {
      rmSync(picDir, { recursive: true, force: true });
    }
    t('an image link likewise', plan({ action: 'shopify', code: '1043', params: { imageUrl: 'https://cdn.example.com/cover.png' } }).steps[0].args.slice(-2), ['--image-url', 'https://cdn.example.com/cover.png']);
    truthy('a file that is not there: refused before anything runs', /no file at/.test(refused({ imageFile: 'C:\\nope\\cover.jpg' })));
    truthy('a relative path: refused', /full path/.test(refused({ imageFile: 'cover.jpg' })));
    truthy('a link that is not https: refused', /https/.test(refused({ imageUrl: 'ftp://x/a.png' })));
    t('no image: the command is unchanged', plan({ action: 'shopify', code: '1043' }).steps[0].args, ['shopify', '--code', '1043', '--price', '29.95']);
    // Step 8, the optional course collection product.
    t('the collection product: its own command, $97 unless changed', plan({ action: 'shopify-collection', code: '1043' }).steps[0].args, ['shopify-collection', '--code', '1043', '--price', '97.00']);
    t('...with a changed price and an image link', plan({ action: 'shopify-collection', code: '1043', params: { price: '120.00', imageUrl: 'https://x/c.png' } }).steps[0].args,
      ['shopify-collection', '--code', '1043', '--price', '120.00', '--image-url', 'https://x/c.png']);
    truthy('...a malformed price is refused before anything runs', /price/.test(refused({}) || (() => { try { plan({ action: 'shopify-collection', code: '1043', params: { price: '97 dollars' } }); return ''; } catch (x) { return x.message; } })()));
    const withCollection = (params) => AC.planAction({ action: 'shopify-image', code: '1043', params, coaches: [{ code: '1043', collectionProductId: '777' }], drafts: {} });
    t('an image for the existing collection product says which product', withCollection({ product: 'collection', imageUrl: 'https://x/c.png' }).steps[0].args,
      ['shopify-image', '--code', '1043', '--product', 'collection', '--image-url', 'https://x/c.png']);
    truthy('...refused for the bundle when only the collection exists', (() => { try { withCollection({ imageUrl: 'https://x/c.png' }); return false; } catch (x) { return /no Shopify product yet/.test(x.message); } })());
    // An existing product (made by hand): add only its image.
    const withProduct = (params, write = false) => AC.planAction({ action: 'shopify-image', code: '1043', params, write, confirm: write ? 'shopify-image 1043' : '',
      coaches: [{ code: '1043', name: 'Freddy Davis', shopifyProductId: '15419105935674' }], drafts: {} });
    t('an image for an existing product: preview first', withProduct({ imageUrl: 'https://cdn.example.com/c.png' }).steps[0].args, ['shopify-image', '--code', '1043', '--image-url', 'https://cdn.example.com/c.png']);
    t('...the real run only with its confirmation', withProduct({ imageUrl: 'https://cdn.example.com/c.png' }, true).steps[0].args.slice(-1), ['--write']);
    truthy('...refused with no image given', (() => { try { withProduct({}); return false; } catch (x) { return /give the image/.test(x.message); } })());
    truthy('...refused when there is no product yet (create the bundle with it instead)', (() => {
      try { AC.planAction({ action: 'shopify-image', code: '1043', params: { imageUrl: 'https://x/a.png' }, coaches: [{ code: '1043' }] }); return false; } catch (x) { return /no Shopify product yet/.test(x.message); }
    })());
    // Step Course360 through the Courses API (plans/03, 2026-10-13).
    const course = (params, o = {}) => AC.planAction({ action: 'course360', code: '1005', params, coaches: [{ code: '1005', name: 'Rob Streetman' }], drafts: {}, ...o });
    const CID = 'a89deca1-abb6-40e5-81ae-bdd1ec9666ae';
    t('Make the course: a preview first, finding the copy by itself', [course({}).write, course({}).steps], [false, [{ script: 'author.mjs', args: ['course360', '--code', '1005'] }]]);
    t('...a course link given is passed as its id — and never a picture (GHL shows one only from its own course screen)', course({ course: `https://app.x/courses/products/${CID}/edit`, imageUrl: 'https://cdn.x/p.jpg' }).steps[0].args,
      ['course360', '--code', '1005', '--course', CID]);
    truthy('...a course link that is not one is refused before anything runs', (() => { try { course({ course: 'https://evil.example/x' }); return false; } catch (x) { return /Course link/.test(x.message); } })());
    truthy('...a picture pasted into the course link box says where it goes', (() => { try { course({ course: '"F:\Users\me\rick ai land.jpg"' }); return false; } catch (x) { return /that is a picture, not a course/.test(x.message); } })());
    truthy('...the real run needs "course360 1005"', (() => { try { course({}, { write: true, confirm: 'course360 1004' }); return false; } catch (x) { return /course360 1005/.test(x.message); } })());
    t('...and with it, --write', course({}, { write: true, confirm: 'course360 1005' }).steps[0].args.slice(-1), ['--write']);
    truthy('...only for an author that exists', (() => { try { course({}, { coaches: [] }); return false; } catch (x) { return /create the author first/.test(x.message); } })());
  }

  console.log('\nactions - the runner');
  {
    const fakeSpawn = (script) => (node, args) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => {
        const step = script.find((s) => s.script === args[0]);
        child.stdout.emit('data', Buffer.from(step.out));
        child.emit('close', step.exit);
      });
      return child;
    };
    const done = [];
    const runner = AC.makeJobRunner({
      spawnImpl: fakeSpawn([{ script: 'a.mjs', out: 'token pit-0123456789abcdef in output\n', exit: 0 }, { script: 'b.mjs', out: 'b ran\n', exit: 1 }, { script: 'c.mjs', out: 'c ran\n', exit: 0 }]),
      secrets: () => ['pit-0123456789abcdef'], cwd: '.', onDone: (j) => done.push(j.id),
    });
    const job = runner.start({ action: 'push', code: '1043', write: true, steps: [{ script: 'a.mjs', args: [] }, { script: 'b.mjs', args: [] }, { script: 'c.mjs', args: [] }], timeoutMs: 5000 });
    let err = null;
    try { runner.start({ action: 'set', code: '1043', steps: [], timeoutMs: 5000 }); } catch (x) { err = x; }
    t('🔒 one job at a time — a second is refused while the first runs', err && err.status, 409);
    await new Promise((r) => setTimeout(r, 50));
    const j = runner.get(job.id);
    t('a failing step stops the job: later steps never run', [j.status, j.exitCode, j.output.includes('c ran')], ['failed', 1, false]);
    truthy('🔒 a credential in the output is scrubbed before anyone sees it', !j.output.includes('pit-0123456789abcdef') && j.output.includes('••••••'));
    t('the after-step runs once the job ends', done, [job.id]);
    const ok = AC.makeJobRunner({ spawnImpl: fakeSpawn([{ script: 'a.mjs', out: 'saved\n', exit: 0 }]), secrets: () => [], cwd: '.' });
    const waited = await ok.wait(ok.start({ action: 'set', code: '1043', write: true, steps: [{ script: 'a.mjs', args: [] }], timeoutMs: 5000 }).id);
    t('wait() resolves once the job has finished — the page build waits for its `author set`', [waited.status, waited.output.includes('saved')], ['done', true]);
    t('...and is null for a job it never ran', await ok.wait('nope'), null);
  }

  console.log('\ndashboard - wizard endpoints');
  {
    const { makeHandler } = await import('./server.mjs');
    const http = await import('node:http');
    const calls = [];
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    const handle = makeHandler({
      pipeline: { coaches: [], secrets: () => ['vfp_LEAKED_KEY_123'], refresh() {} }, token: 'tk', port,
      settings: { read: () => ({}), reality: () => ({}) }, signoffs: { record() {} },
      wizard: {
        start: () => ({ suggestedCode: '1045', drafts: [], authors: [] }), view: async (code) => ({ code }), saveDraft: (code, v) => (v.bad ? { problems: { bad: 'no' } } : { draft: {} }), discard: () => true, generate: () => ({ files: [] }),
        buildPage: async (code, v) => {
          calls.push({ page: code, v });
          if (v.bad) return { problems: { authorURL: 'must be https' } };
          if (v.refused) return { error: 'coaches.json did not take the answers', job: { id: 'j2', status: 'failed', output: 'x' } };
          if (v.leak) return { built: { name: '1045-Jane-Smith', page: 'Bearer vfp_LEAKED_KEY_123' }, saved: [] };
          return { built: { name: '1045-Jane-Smith', bytes: 10 }, saved: ['authorURL'], job: null };
        },
        openPage: async (code, how) => ({ ok: true, said: `${how} ${code}` }),
        checklist: (code, key, value) => { if (key !== 'video') throw new Error(`no checklist item "${key}"`); return { checklist: [{ key, checked: value }] }; },
      },
      actions: { describe: () => ({}), plan: (b) => { if (b.action !== 'set') throw new Error('unknown action'); calls.push(b); return b; }, start: (p) => ({ id: 'j1', ...p }), get: (id) => (id === 'j1' ? { id } : null) },
    });
    server.on('request', (q, s) => handle(q, s));
    const call = (method, path, body) => new Promise((ok) => {
      const r = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, 'x-pipeline-token': 'tk', ...(body ? { 'content-type': 'application/json' } : {}) } }, (res) => {
        let s = '';
        res.on('data', (c) => { s += c; });
        res.on('end', () => ok({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
      });
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
    t('the wizard opens on the next free code', (await call('GET', '/api/wizard/start')).body.suggestedCode, '1045');
    t('a view needs a four-digit code', (await call('GET', '/api/wizard?code=abc')).status, 400);
    const bad = await call('POST', '/api/wizard/draft', { code: '1045', values: { bad: 1 } });
    t('a draft with a bad answer comes back 400, naming the field', [bad.status, bad.body.problems.bad], [400, 'no']);
    t('an action not on the list is refused', (await call('POST', '/api/action', { action: 'other', code: '1045' })).status, 400);
    const ok = await call('POST', '/api/action', { action: 'set', code: '1043', params: { values: {} }, write: true, confirm: 'x' });
    t('an allowed action starts a job', [ok.status, ok.body.job.id], [202, 'j1']);
    t('...whose progress can be read back', (await call('GET', '/api/job?id=j1')).status, 200);
    t('an unknown job is a 404', (await call('GET', '/api/job?id=nope')).status, 404);

    // step 3
    t('the page build needs a four-digit code', (await call('POST', '/api/wizard/page', { code: 'x', values: {} })).status, 400);
    const pb = await call('POST', '/api/wizard/page', { code: '1045', values: { bad: 1 } });
    t('a bad page answer comes back 400, naming the field', [pb.status, pb.body.problems.authorURL], [400, 'must be https']);
    const pr = await call('POST', '/api/wizard/page', { code: '1045', values: { refused: 1 } });
    t('when coaches.json refuses the answers: 400, with the command\'s output to read', [pr.status, pr.body.job && pr.body.job.id], [400, 'j2']);
    const pg = await call('POST', '/api/wizard/page', { code: '1045', values: { authorURL: 'https://jane.example' } });
    t('a good build says what it built and what it saved', [pg.status, pg.body.built.name, pg.body.saved], [200, '1045-Jane-Smith', ['authorURL']]);
    const pl = await call('POST', '/api/wizard/page', { code: '1045', values: { leak: 1 } });
    truthy('🔒 a build response that would carry the key is refused — the page never travels to the browser', pl.status === 500 && !JSON.stringify(pl.body).includes('vfp_LEAKED'));
    t('copy / open accept only copy, notepad or folder', (await call('POST', '/api/wizard/page/open', { code: '1045', how: 'cmd.exe' })).status, 400);
    t('...and do it on this computer', (await call('POST', '/api/wizard/page/open', { code: '1045', how: 'copy' })).body.said, 'copy 1045');
    // step 0: where you stand
    t('a checklist tick is saved', (await call('POST', '/api/wizard/checklist', { code: '1045', key: 'video', value: true })).body.checklist[0].checked, true);
    t('...a value other than tick / untick / forget is refused', (await call('POST', '/api/wizard/checklist', { code: '1045', key: 'video', value: 'yes' })).status, 400);
    t('...and so is an item that does not exist', (await call('POST', '/api/wizard/checklist', { code: '1045', key: 'rm -rf', value: true })).status, 400);
    server.close();
  }
}

/* ---------------------------------------------------------------------------
 * the wizard opens by name as well as by code
 * ------------------------------------------------------------------------- */
{
  const { makeHandler } = await import('./server.mjs');
  const { findCoach } = await import('../coach-router/lib-find.mjs');
  const http = await import('node:http');
  const coaches = [{ code: '1043', name: 'Freddy Davis', displayName: 'Freddy Davis', slug: 'freddy-davis' }, { code: '1042', name: 'Micheal Stickler', displayName: 'Michael Stickler', slug: 'michael-stickler' }];
  const server = http.createServer();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  const handle = makeHandler({
    pipeline: { coaches, secrets: () => [], refresh() {} }, token: 'tk', port,
    settings: { read: () => ({}), reality: () => ({}) }, signoffs: { record() {} },
    wizard: { view: async (code) => ({ code }), resolve: (q) => findCoach(coaches, q) },
  });
  server.on('request', (q, s) => handle(q, s));
  const get = (path) => new Promise((ok) => {
    http.get({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, 'x-pipeline-token': 'tk' } }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(s) }));
    });
  });
  console.log('\nwizard - opened by name');
  t('by name: "freddy" opens 1043', (await get('/api/wizard?code=freddy')).body.code, '1043');
  t('by slug', (await get('/api/wizard?code=michael-stickler')).body.code, '1042');
  t('a new four-digit code still opens a fresh draft', (await get('/api/wizard?code=1050')).body.code, '1050');
  const miss = await get('/api/wizard?code=nobody');
  t('a name that fits nobody is a 404 that lists who exists', [miss.status, /Freddy Davis/.test(miss.body.error)], [404, true]);
  server.close();
}

/* ---------------------------------------------------------------------------
 * codes from 1001 (renumbered 2026-10-02) — new authors continue at 1004
 * ------------------------------------------------------------------------- */
{
  const WZ = await import('./lib-wizard.mjs');
  const HE = await import('./lib-health.mjs');
  const renumbered = [
    { code: '1001', name: 'Micheal Stickler', displayName: 'Michael Stickler', slug: 'michael-stickler', formerCodes: ['1042'] },
    { code: '1002', name: 'Freddy Davis', displayName: 'Freddy Davis', slug: 'freddy-davis', formerCodes: ['1043'] },
    { code: '1003', name: 'Rick Meyer', displayName: 'Rick Meyer', slug: 'rick-meyer', formerCodes: ['1044'] },
  ];
  console.log('\ncodes - new authors continue from 1004');
  t('the next author is 1004', WZ.nextCode(renumbered, {}), '1004');
  t('with no authors at all, the first is 1001', WZ.nextCode([], {}), '1001');
  truthy('🔑 an old code is never handed out again — it still leads to its author', /used to be Michael Stickler/.test(WZ.validateField('code', '1042', { coaches: renumbered })[1]));
  const FI = (await import('../coach-router/lib-verify-author.mjs')).FIELD_IDS;
  const coach = { code: '1001', ghlTag: 'bookcoach-a-active', ghlProductId: 'P', formerCodes: ['1042'] };
  const rows = await HE.healthChecks({
    health: async () => ({ ok: true, httpStatus: 200, problems: [], sync: { lastOk: true }, coaches: [] }),
    census: async () => [{ id: 'C1', email: 'c@x.com', tags: ['bookcoach-a-active'], fields: { [FI.coach_status]: 'trial', [FI.coach_code]: '1042' } }],
    byField: async () => [], subscriptions: async () => [], workflows: async () => [{ name: 'Book Coach — Delivery → Trial Start', status: 'published' }],
    shopifyOrders: async () => [], shopifyConfigured: false,
  }, { coaches: [coach], cfg: { trialExpiryMode: 'on' }, now: new Date('2026-10-02T12:00:00Z') });
  t('a trial recorded under the old code (1042) still counts as this author\'s', rows.find((r) => r.id === 'H5').status, 'OK');
}

/* ---------------------------------------------------------------------------
 * Everything is filed under the right step — checked by the step's NAME.
 * The checklist was reordered three times on 2026-10-05 and twice a number was
 * left behind. These tests do not care what the numbers are: they care that
 * "lesson URL" is asked at Lesson URL, the funnel's help sits on Funnel page …
 * ------------------------------------------------------------------------- */
{
  const ST = await import('../coach-router/steps.mjs');
  const WZ = await import('./lib-wizard.mjs');
  const HP = await import('./lib-help.mjs');
  const { readFileSync } = await import('node:fs');
  const title = (id) => (ST.stepById(id) || {}).title;
  const idOf = (t) => ST.PIPELINE_STEPS.find((s) => s.title === t).id;
  console.log('\nsteps - everything filed under the right step, by name');

  // The live checks: each check name lands on the step it belongs to.
  const src = readFileSync(new URL('../coach-router/lib-author.mjs', import.meta.url), 'utf8');
  const filed = {};
  // Rows name their step by key (row(S.coachPage, …)) — a bare number is refused below.
  const byKey = (k) => (ST.stepByKey(k) || {}).title;
  for (const m of src.matchAll(/row\(\s*S\.(\w+)\s*,\s*'((?:[^'\\]|\\.)+)'/g)) (filed[m[2].replace(/\\'/g, "'")] ||= new Set()).add(byKey(m[1]));
  falsy('🚨 no row is filed under a bare step number', /\brow\(\s*\d/.test(src));
  const CHECK_STEP = {
    'name, book, coach label and slug recorded': 'Inputs',
    'project, version and key recorded': 'Voiceflow coach + IDs', 'page details recorded': 'Coach page', 'author photo': 'Coach page', 'book buttons': 'Coach page',
    'page exists': 'Coach page', 'showActivation: true': 'Coach page', 'talks through the Worker': 'Coach page',
    'coach tag': 'GHL + registry', '$59 product': 'GHL + registry', '$59 monthly price': 'GHL + registry',
    'bundle product': 'Shopify bundle', 'variant recorded': 'Shopify bundle',
    'course made': 'Course360', 'course exists': 'Course360', 'course title': 'Course360', "coach lesson opens this author's coach": 'Course360',
    'course matches the master': 'Course360', 'course picture shows in GHL': 'Course360', 'Offer is Free, Published and gives this course': 'Course360', 'course readable': 'Course360', 'lesson URL': 'Lesson URL',
    'Zipify page': 'Zipify page', 'landing page': 'Zipify page', "Add to Cart is this author's product button": 'Zipify page', 'no template placeholders': 'Zipify page', 'no Add to Cart link points elsewhere': 'Zipify page', 'Zipify product block linked to another bundle': 'Zipify page',
    'collection product': 'Course Collection + Bundle Image', 'collection image': 'Course Collection + Bundle Image', 'collection variant recorded': 'Course Collection + Bundle Image',
    'sales page URL recorded': 'Sales page URL',
    'funnel page': 'Funnel page', 'sells THIS author\'s product': 'Funnel page', '...at the $59 price': 'Funnel page',
    'grant workflow published': 'Grant workflow', 'exactly one grant workflow': 'Grant workflow', 'triggers on this coach\'s tag': 'Grant workflow',
    'pushed to KV': 'Go live', 'Worker holds the key': 'Go live', 'steps 0-12 read green': 'All checks',
    'verify-author': 'End-to-end test', '$0 real order': 'End-to-end test',
    'welcome email, course invite, coach reply, activation code': 'Hands-on', 'no test contacts left entitled': 'Clean up',
  };
  t('🚨 every live check is filed under its own step', Object.entries(CHECK_STEP).filter(([c, want]) => !filed[c] || filed[c].size !== 1 || !filed[c].has(want)).map(([c]) => `${c} → ${filed[c] ? [...filed[c]].join('/') : 'missing'}`), []);
  t('...and the page-reading helper is called with the coach page, Zipify and funnel steps', [...src.matchAll(/foreignRows\(S\.(\w+),/g)].map((m) => byKey(m[1])).sort(), ['Coach page', 'Coach page', 'Funnel page', 'Zipify page']);
  t('...and the funnel-only SEO advice is tied to the funnel step', [...src.matchAll(/step === S\.(\w+) \/\* the \$59 funnel page \*\//g)].map((m) => byKey(m[1])), ['Funnel page']);

  // The wizard: each box is asked at its step, each button sits on its step.
  const FIELD_STEP = { displayName: 'Inputs', slug: 'Inputs', versionID: 'Voiceflow coach + IDs', authorPhotoURL: 'Coach page', books: 'Coach page', price: 'Shopify bundle',
    shopifyVariantId: 'Shopify bundle', courseLink: 'Course360', courseLessonUrl: 'Lesson URL', videoUrl: 'Zipify page',
    collectionPrice: 'Course Collection + Bundle Image', collectionImageFile: 'Course Collection + Bundle Image', collectionProductId: 'Course Collection + Bundle Image', bookLandingUrl: 'Sales page URL', verifyEmail: 'End-to-end test', guestEmail: 'End-to-end test', keep: 'End-to-end test' };
  t('🚨 every answer box is asked at its own step', Object.entries(FIELD_STEP).filter(([k, want]) => title(WZ.FIELDS[k].step) !== want).map(([k]) => `${k} → ${title(WZ.FIELDS[k].step)}`), []);
  const ACTION_STEP = { 'Coach page': ['page'], 'GHL + registry': ['onboard'], 'Shopify bundle': ['shopify', 'set'], 'Course360': ['course360'], 'Lesson URL': ['set'],
    'Zipify page': ['set', 'landing:sales'], 'Course Collection + Bundle Image': ['shopify-collection', 'landing:collection', 'set'], 'Sales page URL': ['set'], 'Funnel page': ['generate:funnel'], 'Grant workflow': ['generate:course360'], 'Go live': ['push'], 'End-to-end test': ['verify-email', 'verify', 'guest'] };
  t('🚨 every button sits on its own step', Object.entries(ACTION_STEP).filter(([s, want]) => JSON.stringify(WZ.STEP_ACTIONS[idOf(s)]) !== JSON.stringify(want)).map(([s]) => s), []);
  const v = { displayName: 'Jane Smith', slug: 'jane-smith', bookTitle: 'Her Book', coachLabel: 'Her Coach', shopifyVariantId: '9', ghlProductId: 'P', versionID: '6a3339b6eb283c59b70cfa53' };
  const INFO_STEP = { 'Coach page': 'Publish the page at', 'GHL + registry': 'GHL tag it will create', 'Shopify bundle': 'Product title', 'Course360': '…with this description',
    'Zipify page': 'Page name in Zipify', 'Sales page URL': 'Its address should be', 'Funnel page': 'Clone a coach-access page to', 'Grant workflow': 'Workflow name', 'Go live': 'What it does' };
  t('🚨 every "what you need" box sits on its own step', Object.entries(INFO_STEP).filter(([s, label]) => !WZ.infoFor(idOf(s), v, {}).some((i) => i.label === label)).map(([s]) => s), []);
  t('the coach page step gives its GHL page name between the address and the path — "AI Coach Final — <Author> — Book Coach"',
    WZ.infoFor(idOf('Coach page'), { displayName: 'Rob Streetman', slug: 'rob-streetman' }, {}).map((i) => i.value),
    ['https://www.book-coach.ai/rob-streetman', 'AI Coach Final — Rob Streetman — Book Coach', 'rob-streetman']);
  truthy('...and its how-to says to name the page that', JSON.stringify(HP.STEP_HELP[idOf('Coach page')]({ name: 'Jane Smith' }).how).includes('AI Coach Final — Jane Smith — Book Coach'));

  // The help: each step's plain words are that step's, and the numbers they cite point at the right step.
  const HELP_TITLE = { 'Inputs': 'Write down who the author is', 'Voiceflow coach + IDs': 'Build the AI coach in Voiceflow, then save its IDs',
    'Course Collection + Bundle Image': 'Make the course collection product in Shopify (optional)',
    'Coach page': 'Put up the coach page', 'GHL + registry': 'Create the author in the system', 'Shopify bundle': 'Create the book product in Shopify',
    'Course360': 'Make the private course in Course360', 'Lesson URL': 'Save the lesson\'s link', 'Zipify page': 'Make the sales page on Zipify',
    'Sales page URL': 'Save the sales page\'s address', 'Funnel page': 'Make the $59 sign-up page', 'Grant workflow': 'Make the GHL workflow that gives the course',
    'Go live': 'Go live', 'All checks': 'Everything checked', 'End-to-end test': 'Run the full test', 'Hands-on': 'Check it yourself', 'Clean up': 'Tidy up the test' };
  t('🚨 every step shows its own help', ST.PIPELINE_STEPS.filter((s) => HP.STEP_HELP[s.id]({ name: 'X' }).title !== HELP_TITLE[s.title]).map((s) => s.title), []);
  const rowsHelp = (check, status = 'TODO', step = 0) => JSON.stringify(HP.helpFor(step, v, { state: 'READY', rows: [{ check, status, detail: '' }] }).problems);
  const POINTS = [
    ['coach tag', 'GHL + registry'], ['bundle product', 'Shopify bundle'], ['page details recorded', 'Coach page'], ['page exists', 'Coach page'],
    ['lesson URL', 'Lesson URL'], ['Zipify page', 'Sales page URL'], ['sales page URL recorded', 'Sales page URL'], ['funnel page', 'Funnel page'],
    ['grant workflow published', 'Grant workflow'], ['pushed to KV', 'Go live'], ['verify-author', 'End-to-end test'],
  ];
  t('🚨 a problem\'s "go to step N" points at the step that fixes it', POINTS.filter(([c, s]) => !rowsHelp(c).includes(`step ${idOf(s)}`)).map(([c, s]) => `${c} ↛ ${s}`), []);
  const salesHelp = JSON.stringify(HP.STEP_HELP[idOf('Sales page URL')]({ name: 'X' }));
  truthy('...the sales address\'s help points back at Zipify and at itself', salesHelp.includes(`Zipify page from step ${idOf('Zipify page')}`) && salesHelp.includes(`into step ${idOf('Sales page URL')}`));
  truthy('...and creating the author says which step builds the funnel', WZ.infoFor(idOf('GHL + registry'), v, {}).some((i) => i.label === `Funnel page address (built at step ${idOf('Funnel page')})`));
  // Since 2026-10-13 "Make the course" publishes the Offer itself (Courses API, plans/03): no reminder to do it by hand.
  const view = WZ.wizardView({ code: '1099', draft: { values: v }, coaches: [] });
  t('no "publish the Offer" reminder any more — the command publishes it', view.steps.filter((s) => s.reminder).map((s) => s.title), []);
  truthy('...the grant workflow\'s how-to says what to do when the Offer is missing: Make the course again, in its step',
    JSON.stringify(HP.STEP_HELP[idOf('Grant workflow')]({ name: 'X' }).how).replace(/\\"/g, '"').includes(`"Make the course" in step ${idOf('Course360')}`));
  t('...and the Course360 step has the "Make the course" button, with its answer boxes', [WZ.STEP_ACTIONS[idOf('Course360')], WZ.STEP_FIELDS[idOf('Course360')]], [['course360'], ['courseLink']]);
  const zip = JSON.stringify(HP.STEP_HELP[idOf('Zipify page')]({ name: 'X', salesPage: '' }).how);
  truthy('...and Zipify\'s how-to names the grant workflow\'s and the sales address\'s numbers', zip.includes(`step ${idOf('Grant workflow')} (the grant workflow)`) && zip.includes(`step ${idOf('Sales page URL')}`));
}

/* ---------------------------------------------------------------------------
 * step 0: "where you stand" (lib-checklist) — ticks itself, a person can overrule
 * ------------------------------------------------------------------------- */
{
  const CL = await import('./lib-checklist.mjs');
  const { readFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'cl-'));
  const file = join(dir, 'checklists.local.json');
  const ST = await import('../coach-router/steps.mjs');
  const idOf = (t) => ST.PIPELINE_STEPS.find((s) => s.title === t).id;
  const at = (items, key) => items.find((i) => i.key === key);
  console.log('\nchecklist - where you stand');
  const bare = CL.checklistView('1045', { displayName: 'Jane' }, {}, { file });
  t('the four items, in order, with their counts', bare.map((i) => i.label), ['About the author link', 'YouTube video link', 'Books (0)', 'Courses (0)']);
  t('...nothing saved: nothing ticked', bare.map((i) => i.checked), [false, false, false, false]);
  const v = { authorURL: 'https://jane.example', books: [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }], videoUrl: 'https://www.youtube.com/watch?v=xLm7kOWSynA' };
  const page = { courses: [{ title: 'C', url: 'https://c' }] };
  const full = CL.checklistView('1045', v, page, { file });
  t('each ticks itself when its thing is saved — and counts books and courses', full.map((i) => [i.label, i.checked, i.source]),
    [['About the author link', true, 'auto'], ['YouTube video link', true, 'auto'], ['Books (2)', true, 'auto'], ['Courses (1)', true, 'auto']]);
  truthy('...saying where it saw it (by step name)', at(full, 'authorLink').why.includes(`step ${idOf('Coach page')}`) && at(full, 'video').why.includes(`step ${idOf('Zipify page')}`));
  let now = CL.setChecklistItem('1045', 'video', false, { values: v, page, file });
  t('a person can untick an item the dashboard ticked — and it says the dashboard still sees it', [at(now, 'video').checked, at(now, 'video').source], [false, 'unticked']);
  now = CL.setChecklistItem('1045', 'video', true, { values: v, page, file });
  t('...ticking it again goes back to following the dashboard', [at(now, 'video').checked, at(now, 'video').source], [true, 'auto']);
  now = CL.setChecklistItem('1045', 'courses', true, { values: {}, page: {}, file });
  t('a person can tick what the dashboard cannot see yet', [at(now, 'courses').checked, at(now, 'courses').source], [true, 'you']);
  now = CL.setChecklistItem('1045', 'courses', null, { values: {}, page: {}, file });
  t('...and forget their choice', at(now, 'courses').checked, false);
  t('only a person\'s difference from the dashboard is stored', JSON.parse(readFileSync(file, 'utf8'))['1045'].items, {});
  let err = null;
  try { CL.setChecklistItem('1045', 'nope', true, { file }); } catch (x) { err = x; }
  truthy('an item that does not exist is refused', err && /no checklist item/.test(err.message));
  const WZ = await import('./lib-wizard.mjs');
  rmSync(dir, { recursive: true, force: true });
  truthy('the YouTube box it watches is the one at the Zipify step', WZ.FIELDS.videoUrl.step === idOf('Zipify page'));
  truthy('it shows on step 0, Inputs — found by the step\'s name', readFileSync(new URL('./web/wizard.js', import.meta.url), 'utf8').includes("if (s.title === 'Inputs' && Array.isArray(v.checklist)) panel.append(checklistBox(v.checklist));"));
}

/* The renumber of 2026-10-05 broke the canvas: it looked up step 17 by number. */
{
  const { readFileSync } = await import('node:fs');
  const canvas = readFileSync(new URL('./web/canvas.js', import.meta.url), 'utf8');
  console.log('\ncanvas - follows the step list');
  falsy('🚨 the canvas never looks a step up by a fixed number (byId[17], pos[14] …)', /\b(byId|pos)\[\d+\]/.test(canvas));
}

/* ---------------------------------------------------------------------------
 * help in plain words (lib-help.mjs) — every step, every problem
 * ------------------------------------------------------------------------- */
{
  const HP = await import('./lib-help.mjs');
  const { readFileSync } = await import('node:fs');
  console.log('\nhelp - every step is explained');
  for (const { id } of (await import('../coach-router/steps.mjs')).PIPELINE_STEPS) {
    const h = HP.helpFor(id, { displayName: 'Jane Smith', slug: 'jane-smith' }, null);
    truthy(`step ${id}: what, why, how-to and done-when are all there`, h && h.title && h.what && h.why && h.how.length && h.done);
  }
  falsy('no help text names a "Generate the files" button — the buttons say what they make', (await import('../coach-router/steps.mjs')).PIPELINE_STEPS.some(({ id }) => /Generate the files/.test(JSON.stringify(HP.helpFor(id, { displayName: 'Jane Smith', slug: 'jane-smith' }, null)))));

  console.log('\nhelp - every problem the live checks can report has plain words');
  {
    // Every check name lib-author.mjs can emit, read straight from its source, so
    // a new check without help fails this test instead of showing up unexplained.
    const src = readFileSync(new URL('../coach-router/lib-author.mjs', import.meta.url), 'utf8');
    // A name may contain an escaped apostrophe ('coach\'s tag'), so read up to an UNescaped quote.
    const names = [...new Set([...src.matchAll(/row\(\s*S\.\w+\s*,\s*'((?:[^'\\]|\\.)+)'/g)].map((m) => m[1].replace(/\\'/g, "'")))];
    // foreignRows passes its step along — row(step, '…') — so its names are read too.
    const emitted = new Set([...names, ...[...src.matchAll(/row\(step, '((?:[^'\\]|\\.)+)'/g)].map((m) => m[1])]);
    t('every check the "just published" tip names is one the live checks really produce', [...HP.LIVE_PAGE_CHECKS].filter((c) => !emitted.has(c)), []);
    // Checks that only ever report DONE need no fix.
    const onlyDone = ['loads its config from the registry', 'served by the shared My Coaches course', 'shared My Coaches grant workflow published', 'Course360 lesson', 'GHL tag', 'GHL product', 'Shopify bundle', 'grant workflow', 'registry'];
    const missing = names.filter((n) => !(n in HP.CHECK_HELP) && !onlyDone.includes(n));
    t('🔑 no check is left without a plain explanation', missing, []);
    truthy('...and there are plenty of them', names.length >= 40);
  }

  console.log('\nhelp - it names the real fix, with this author\'s values');
  {
    const stickler = { code: '1001', displayName: 'Michael Stickler', bookTitle: 'Life Without Reservation', slug: 'michael-stickler', shopifyVariantId: '54042631733562', bookLandingUrl: 'https://leadershipbooks.com/pages/lwr', vfKey: 'VF.DM.SECRET', apiKey: 'Bearer vfp_SECRET' };
    const live = { state: 'FAIL', rows: [{ step: 7, check: "Add to Cart is this author's product button", status: 'FAIL', detail: 'nothing on the page adds this author\'s bundle to the cart' }, { step: 7, check: 'landing page', status: 'DONE' }] };
    const h = HP.helpFor(7, HP.publicValues(stickler), live);
    t('the headline says something needs fixing', h.headline, 'Something here needs fixing.');
    t('one problem, marked "fix this"', h.problems.map((p) => p.level), ['must']);
    truthy('...explained, not just named', /cannot buy it/.test(h.problems[0].say));
    truthy('...with the exact product to pick in Zipify\'s Product block, ready to copy', h.problems[0].steps.some((s) => s.copy === 'Life Without Reservation [Michael Stickler] + Your Personal AI Coach'));
    const plain = HP.helpFor(7, HP.publicValues({ ...stickler, bookTitle: 'Life Without Reservation' }), { state: 'DONE', warn: true, rows: [{ step: 7, check: "Add to Cart is this author's product button", status: 'WARN', detail: 'a plain link button' }] });
    t('the old plain link button: optional — it works, it is only not the house style', plain.problems.map((p) => p.level), ['optional']);
    truthy('an existing page: making new words is marked as safe to ignore', h.ignore.some((x) => /Generate Landing Pages/.test(x)));
    falsy('🔒 no key ever reaches the help', JSON.stringify(h).includes('SECRET'));
    const done = HP.helpFor(2, { displayName: 'X' }, { state: 'DONE', rows: [{ check: 'author photo', status: 'DONE' }] });
    t('a finished step says so, plainly', done.headline, 'Done — nothing to do here.');
    const opt = HP.helpFor(3, { displayName: 'Michael Stickler' }, { state: 'DONE', warn: true, rows: [{ check: 'name convention', status: 'WARN', detail: '"Michael Stickler - Coach Access"' }] });
    t('a cosmetic issue is marked optional — nothing breaks', [opt.problems[0].level, /Optional/.test(opt.problems[0].steps[0])], ['optional', true]);
    const confirm = HP.helpFor(5, { displayName: 'Jane Smith' }, { state: 'CONFIRM', rows: [{ check: 'course readable', status: 'MANUAL' }] });
    t('a step only a person can finish says "check, then sign off"', [confirm.problems[0].level, confirm.headline], ['confirm', 'Only you can finish this: check it, then sign off.']);
    const STL = (await import('../coach-router/steps.mjs')).PIPELINE_STEPS;
    const sid = (title) => STL.find((s) => s.title === title).id;
    const page = HP.helpFor(sid('Funnel page'), { displayName: 'Jane Smith', slug: 'jane-smith' }, { state: 'FAIL', rows: [{ check: 'no other author on the page', status: 'FAIL', detail: 'visible: Michael Stickler' }] });
    truthy('the same check on another page names THAT page', /sign-up page/.test(page.problems[0].say) && /Michael Stickler/.test(page.problems[0].say));
    t('a page step showing red says it may just be early after a publish', /wait a minute, then press Refresh/i.test(page.tip), true);
    const unrecorded = HP.helpFor(sid('Zipify page'), { displayName: 'Jane Smith' }, { state: 'READY', rows: [{ check: 'Zipify page', status: 'TODO', detail: 'not recorded yet' }] });
    t('a sales page whose address is not saved yet: no "just published" tip, and it says where to save it', [unrecorded.tip, JSON.stringify(unrecorded.problems).includes(`step ${sid('Sales page URL')}`)], ['', true]);
    falsy('...and it no longer claims there is no page', /There is no sales page yet/.test(JSON.stringify(unrecorded)));
    t('...a cosmetic note does not', HP.helpFor(sid('Funnel page'), { displayName: 'Jane Smith' }, { state: 'DONE', warn: true, rows: [{ check: 'no other author in SEO / page data', status: 'WARN', detail: 'X' }] }).tip, '');
    const unknown = HP.helpFor(4, {}, { state: 'FAIL', rows: [{ check: 'a check nobody wrote help for', status: 'FAIL', detail: 'broken' }] });
    truthy('a check without plain words is still shown — nothing wrong is ever hidden', unknown.problems.length === 1 && /broken/.test(unknown.problems[0].say));
  }

  console.log('\nhelp - the health checks');
  {
    truthy('a broken health check comes with what to do', HP.healthHelp({ id: 'H2', status: 'FAIL' }).steps.length > 0);
    t('a healthy one needs no help', HP.healthHelp({ id: 'H2', status: 'OK' }), null);
    truthy('every health check has plain help', ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9'].every((id) => HP.healthHelp({ id, status: 'FAIL' })));
  }
}

/* ---------------------------------------------------------------------------
 * step 3: the coach page, built from a form (lib-pages)
 * ------------------------------------------------------------------------- */
{
  const PG = await import('./lib-pages.mjs');
  const A = await import('../coach-router/lib-author.mjs');
  const { readFileSync, existsSync, readdirSync } = await import('node:fs');
  const { EventEmitter } = await import('node:events');
  const dir = mkdtempSync(join(tmpdir(), 'pg-'));
  const template = join(dir, 'coach-page.template.html');
  writeFileSync(template, `<html>\n<script>\n${PG.TEMPLATE_BLOCK}\n  start(CONFIG);\n</script>\n<p>page body</p>\n</html>\n`);
  const KEY = 'vfp_REAL_SECRET_KEY';
  const shared = { workerUrl: 'https://w.example/', vfApiKey: KEY };
  const secrets = [KEY, 'pit-0123456789abcdef'];
  const jane = { code: '1045', displayName: 'Jane Smith', name: 'Jane Smith', slug: 'jane-smith', bookTitle: 'Her Book', coachLabel: 'Her Coach', versionID: '6a3339b6eb283c59b70cfa53', authorURL: 'https://jane.example', books: [{ title: 'Her Book', url: 'https://buy.example/her' }] };
  const form = (o = {}) => ({ authorPhotoURL: '', authorInitials: '', authorURL: 'https://jane.example', books: 'Her Book|https://buy.example/her', pageTitle: '', courses: '', connection: 'auto', includeKey: true, ...o });

  console.log('\npage - the real master page');
  {
    const real = readFileSync(PG.TEMPLATE, 'utf8');
    truthy('the master page exists and has the empty CONFIG block to fill', real.includes(PG.TEMPLATE_BLOCK));
    falsy('🔒 it names no author and holds no key', /Stickler|Freddy|Rick Meyer|vfp_|VF\.DM\./.test(real));
    truthy('...and building from it gives a page that turns on the activation button', A.coachPageConfig(jane, { workerUrl: 'https://w' }).includes('showActivation: true'));
    truthy('the master page hides "Meet the Author" when showMeetAuthor is false', real.includes("if(CONFIG.showMeetAuthor === false){ btn.remove(); return; }"));

    console.log('\npage - the four switches');
    const block = (switches) => A.coachPageConfig({ ...jane, books: [] }, { workerUrl: 'w', switches });
    t('not set: activation and Meet the Author on, books and courses only when there are any',
      ['showActivation', 'showBooks', 'showCourses', 'showMeetAuthor'].map((k) => new RegExp(`${k}: (true|false),`).exec(block({}))[1]), ['true', 'false', 'false', 'true']);
    truthy('showMeetAuthor sits on the line under showCourses', /showCourses: (true|false),\n {4}showMeetAuthor: (true|false),/.test(block({})));
    t('each toggle writes exactly what it says', ['showActivation', 'showBooks', 'showCourses', 'showMeetAuthor'].map((k) => new RegExp(`${k}: (true|false),`).exec(block({ showActivation: false, showBooks: true, showCourses: true, showMeetAuthor: false }))[1]), ['false', 'true', 'true', 'false']);
  }

  console.log('\npage - where the file goes');
  {
    t('a new author gets <code>-<Author-Name>', [PG.pageFileFor(jane, { dir }).name, PG.pageFileFor(jane, { dir }).exists], ['1045-Jane-Smith', false]);
    writeFileSync(join(dir, '1001-Michael-Stickler'), '   const CONFIG = {\n    COACH_CODE: "1042",\n  };\n');
    t('an author who already has a page keeps it — found by its code, even a former one', PG.pageFileFor({ code: '1001', formerCodes: ['1042'], slug: 'michael-stickler' }, { dir }).name, '1001-Michael-Stickler');
    writeFileSync(join(dir, '1001-Michael-Stickler.bak-20261002-101010'), '   const CONFIG = {\n    COACH_CODE: "1045",\n  };\n');
    t('...and a backup file is never mistaken for a page', PG.pageFileFor(jane, { dir }).name, '1045-Jane-Smith');
  }

  console.log('\npage - the answers');
  {
    const v = (o) => PG.validatePageForm(form(o), jane);
    t('an unchanged form changes nothing in coaches.json', v({}).record, {});
    t('a changed answer is saved — and only that one', Object.keys(v({ authorURL: 'https://jane2.example' }).record), ['authorURL']);
    truthy('a link that is not https:// is refused', v({ authorPhotoURL: 'http://x/p.jpg' }).problems.authorPhotoURL);
    truthy('emptying a saved answer is refused, saying why — `author set` cannot remove one', /not emptied/.test(v({ authorURL: '' }).problems.authorURL));
    t('an empty optional answer with nothing saved is fine', v({ authorPhotoURL: '' }).problems, {});
    truthy('a course line must be Title|https://link', v({ courses: 'just a title' }).problems.courses);
    t('courses are read one per line', v({ courses: 'Course A|https://c/a\nCourse B|https://c/b' }).page.courses, [{ title: 'Course A', url: 'https://c/a' }, { title: 'Course B', url: 'https://c/b' }]);
    truthy('a title with < or > is refused', v({ pageTitle: 'x</script>' }).problems.pageTitle);
    truthy('"direct" without the key is refused — it would have no way to talk', v({ connection: 'direct', includeKey: false }).problems.includeKey);
    truthy('an unknown connection is refused', v({ connection: 'telepathy' }).problems.connection);
    t('book buttons go to `author set` as Title|url lines', PG.recordParams({ books: [{ title: 'B', url: 'https://b' }], authorInitials: 'JS' }), { books: ['B|https://b'], authorInitials: 'JS' });
  }

  console.log('\npage - the build');
  {
    const now = new Date('2026-10-02T10:20:30Z');
    let r = PG.buildPage(jane, { connection: 'auto', includeKey: true, courses: [{ title: 'Course A', url: 'https://c/a' }] }, { shared, secrets, template, dir, now });
    const page = readFileSync(join(dir, r.name), 'utf8');
    t('the whole page is written as <code>-<Author-Name>, next to the others', [r.name, existsSync(join(dir, '1045-Jane-Smith'))], ['1045-Jane-Smith', true]);
    truthy('it carries this author: code, router address, name, version', page.includes('COACH_CODE: "1045"') && page.includes('WORKER_URL: "https://w.example"') && page.includes('authorName: "Jane Smith"') && page.includes('VF_VERSION_ID: "6a3339b6eb283c59b70cfa53"'));
    truthy('...the activation button, the book and course buttons', page.includes('showActivation: true') && page.includes('showBooks: true') && page.includes('showCourses: true') && page.includes('{ title: "Course A", url: "https://c/a" }'));
    truthy('...and the key, because the form asked for the backup', page.includes(`VF_API_KEY: "Bearer ${KEY}"`) && r.includesKey);
    truthy('the rest of the master page is kept exactly', page.includes('  start(CONFIG);\n</script>\n<p>page body</p>'));
    t('a first build makes no backup', r.backup, null);
    r = PG.buildPage(jane, { connection: 'worker', includeKey: false }, { shared, secrets, template, dir, now });
    t('building again keeps the previous version as a backup', [r.backup, existsSync(join(dir, '1045-Jane-Smith.bak-20261002-102030'))], ['1045-Jane-Smith.bak-20261002-102030', true]);
    const noKey = readFileSync(join(dir, r.name), 'utf8');
    truthy('🔒 without the box ticked, the page holds no key at all', !noKey.includes(KEY) && noKey.includes('VF_API_KEY: "Bearer "') && noKey.includes('CONNECTION: "worker"'));
    let err = null;
    writeFileSync(template, `<p>pit-0123456789abcdef</p>\n${PG.TEMPLATE_BLOCK}\n`);
    try { PG.buildPage(jane, { includeKey: true }, { shared, secrets, template, dir, now: new Date('2026-10-02T11:00:00Z') }); } catch (x) { err = x; }
    truthy('🔒 any OTHER credential in the result is a refusal', err && /credential/.test(err.message));
    t('...and nothing was written', readFileSync(join(dir, '1045-Jane-Smith'), 'utf8'), noKey);
    writeFileSync(template, `<html>\n<script>\n${PG.TEMPLATE_BLOCK}\n</script>\n</html>\n`);
    err = null;
    try { PG.buildPage(jane, { includeKey: true }, { shared: { workerUrl: 'https://w' }, secrets, template, dir }); } catch (x) { err = x; }
    truthy('asking for the key when coaches.json has none is refused, saying what to do', err && /untick/.test(err.message));
    err = null;
    try { PG.buildPage({ ...jane, versionID: '' }, { includeKey: false }, { shared, secrets, template, dir }); } catch (x) { err = x; }
    truthy('no Voiceflow version yet: refused, pointing at the Voiceflow step', err && /step 1\b/.test(err.message));
    truthy('🔒 a title cannot end the page\'s script early', A.coachPageConfig({ ...jane, coachLabel: 'x</script><script>alert(1)' }, { workerUrl: 'w' }).includes('x\\u003c/script>'));
  }

  console.log('\npage - the form view and the saved settings');
  {
    const file = join(dir, 'page-settings.local.json');
    PG.savePageSettings('1045', { connection: 'worker', includeKey: false, courses: [{ title: 'C', url: 'https://c' }], pageTitle: 'T' }, { file });
    const settings = PG.readPageSettings('1045', { file });
    t('page-only answers are kept for the next build', [settings.connection, settings.pageTitle], ['worker', 'T']);
    const view = PG.pageFormView(jane, { shared, settings, dir, template });
    const val = Object.fromEntries(view.fields.map((f) => [f.key, f.value]));
    t('the form opens with the saved answers', [val.connection, val.includeKey, val.courses, val.books], ['worker', false, 'C|https://c', 'Her Book|https://buy.example/her']);
    truthy('the code, router and version are shown, not asked', view.fixed.some((x) => x.value === '1045') && view.fixed.some((x) => x.value === 'https://w.example'));
    t('...and the ones set at an earlier step link there to be changed', view.fixed.filter((x) => Number.isInteger(x.step)).map((x) => [x.value, x.step]), [['Jane Smith', 0], ['6a3339b6eb283c59b70cfa53', 1]]);
    // The line under the author's name (CONFIG bookTitle): its own box, starting as the BOOK title.
    const sub = view.fields.find((f) => f.key === 'subtitle');
    t('the line under the author\'s name is the form\'s first box, and starts as the book title', [view.fields[0].key, sub.value], ['subtitle', 'Her Book']);
    truthy('...and its help says where it shows: below the author\'s name, above "Coach online"', /below the author’s name and above "Coach online"/.test(sub.help));
    t('...the book title (or nothing) is kept as "not set"; anything else is kept as typed',
      [PG.validatePageForm({ ...form(), subtitle: 'Her Book' }, jane).page.subtitle, PG.validatePageForm({ ...form(), subtitle: '' }, jane).page.subtitle, PG.validatePageForm({ ...form(), subtitle: 'Worldview Coach' }, jane).page.subtitle],
      ['', '', 'Worldview Coach']);
    const sub1 = A.coachPageConfig({ ...jane, coachLabel: 'Jane Smith – Her Book' }, { workerUrl: 'w' });
    const sub2 = A.coachPageConfig({ ...jane, coachLabel: 'Jane Smith – Her Book' }, { workerUrl: 'w', subtitle: 'Worldview Coach' });
    t('the page shows the book title there by default — not the coach label — and the typed line when there is one', [/bookTitle: "([^"]*)"/.exec(sub1)[1], /bookTitle: "([^"]*)"/.exec(sub2)[1]], ['Her Book', 'Worldview Coach']);
    t('...and it says where the file is', [view.file.name, view.file.exists, view.publishAt], ['1045-Jane-Smith', true, 'https://www.book-coach.ai/jane-smith']);
    falsy('🔒 the view never carries the key', JSON.stringify(view).includes(KEY));
    t('a new author opens with the key box ticked (the backup, as ms-v2 and freddy-v2 have)', PG.pageFormView(jane, { shared, dir, template }).fields.find((f) => f.key === 'includeKey').value, true);
    const fresh = Object.fromEntries(PG.pageFormView(jane, { shared, dir, template }).fields.filter((f) => f.type === 'toggle').map((f) => [f.key, f.value]));
    t('the form shows the four switches as toggles, starting where the page would', fresh, { showActivation: true, showBooks: true, showCourses: false, showMeetAuthor: true });
    t('a toggle the form sends is kept for the next build', PG.validatePageForm({ ...form(), showMeetAuthor: false, showActivation: true }, jane).page.showMeetAuthor, false);
    t('...and one it does not send keeps its default', 'showBooks' in PG.validatePageForm(form(), jane).page, false);
    const off = PG.buildPage(jane, { includeKey: false, showMeetAuthor: false }, { shared, secrets, template, dir, now: new Date('2026-10-02T13:00:00Z') });
    truthy('the built page carries the switch', readFileSync(join(dir, off.name), 'utf8').includes('showMeetAuthor: false,'));
  }

  console.log('\npage - a finished page as the new master');
  {
    const tpl = join(dir, 'new-template.html');
    PG.buildPage(jane, { includeKey: true }, { shared, secrets, template, dir, now: new Date('2026-10-02T12:00:00Z') });
    const r = PG.refreshTemplate(join(dir, '1045-Jane-Smith'), { secrets, coaches: [jane], template: tpl });
    const out = readFileSync(tpl, 'utf8');
    truthy('its CONFIG block is emptied — the key and the author go with it', out.includes(PG.TEMPLATE_BLOCK) && !out.includes(KEY) && !out.includes('Jane Smith') && r.changed);
    writeFileSync(join(dir, 'stray'), `<p>Jane Smith</p>\n${PG.TEMPLATE_BLOCK}\n`);
    let err = null;
    try { PG.refreshTemplate(join(dir, 'stray'), { secrets, coaches: [jane], template: tpl }); } catch (x) { err = x; }
    truthy('🔒 refused if an author is named outside CONFIG — it would be on every page', err && /Jane Smith/.test(err.message));
    writeFileSync(join(dir, 'stray'), `<p>${KEY}</p>\n${PG.TEMPLATE_BLOCK}\n`);
    err = null;
    try { PG.refreshTemplate(join(dir, 'stray'), { secrets, coaches: [jane], template: tpl }); } catch (x) { err = x; }
    truthy('🔒 refused if a key is outside CONFIG', err && /credential/.test(err.message));
  }

  console.log('\npage - copy and open, on this computer');
  {
    let seen = null;
    const fake = (cmd, args, opts) => {
      const child = new EventEmitter();
      child.stdin = { end: (buf) => { seen = { cmd, args, opts, buf }; setImmediate(() => child.emit('close', 0)); } };
      child.unref = () => {};
      return child;
    };
    await PG.copyToClipboard('— →', { spawnImpl: fake });
    t('the clipboard gets UTF-16 text with no byte-order mark (it would paste as an invisible character)', [seen.cmd, seen.opts.shell, [...seen.buf]], ['clip.exe', false, [...Buffer.from('— →', 'utf16le')]]);
    const opened = [];
    const fakeOpen = (cmd, args, opts) => { opened.push([cmd, args, !!opts.windowsVerbatimArguments, opts.shell]); return { unref() {} }; };
    PG.showPage('D:\\a b\\1045-Jane-Smith', 'folder', { spawnImpl: fakeOpen });
    PG.showPage('D:\\a b\\1045-Jane-Smith', 'notepad', { spawnImpl: fakeOpen });
    t('"Show in folder" selects the file; "Open" uses Notepad; never a shell', opened, [['explorer.exe', ['/select,"D:\\a b\\1045-Jane-Smith"'], true, false], ['notepad.exe', ['D:\\a b\\1045-Jane-Smith'], false, false]]);
    let err = null;
    try { PG.showPage('D:\\x" & calc', 'folder', { spawnImpl: fakeOpen }); } catch (x) { err = x; }
    truthy('🔒 a path with a quote is refused', err);
  }
  rmSync(dir, { recursive: true, force: true });
}

/* help - two problems with one fix are one box */
{
  const HP = await import('./lib-help.mjs');
  const h = HP.helpFor(2, { displayName: 'Rick Meyer', slug: 'rick-meyer' }, { state: 'FAIL', rows: [
    { check: 'talks through the Worker', status: 'FAIL', detail: 'calls Voiceflow directly — the key is readable in page source' },
    { check: 'showActivation: true', status: 'FAIL', detail: 'is absent' },
  ] });
  console.log('\nhelp - one box per fix');
  t('two problems fixed by the same steps become one box', h.problems.length, 1);
  truthy('...that still says both', /directly/.test(h.problems[0].say) && /activation code/.test(h.problems[0].say));
  const old = HP.helpFor(2, { displayName: 'Freddy Davis', slug: 'freddy-davis' }, { state: 'DONE', warn: true, rows: [{ check: 'page uses the old coach code', status: 'WARN', detail: 'COACH_CODE is 1043, this coach\'s old code (now 1002) — it still works' }] });
  t('an old code on the page is optional, and says it still works', [old.problems[0].level, /still works/.test(old.problems[0].say)], ['optional', true]);
}

/* ---------------------------------------------------------------------------
 * the last readings — the dashboard opens on them; Refresh reads again only
 * what it names (lib-readings.mjs, 2026-10-06)
 * ------------------------------------------------------------------------- */
{
  const RD = await import('./lib-readings.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'readings-'));
  const file = join(dir, 'readings.local.json');
  const SECRET = 'pit-READINGS-SECRET-0123456789';
  const open = (o = {}) => RD.openReadings({ file, layout: 'L1', checks: 'C1', secrets: () => [SECRET], ...o });
  const inputs = { coach: { code: '1045', slug: 'jane' }, signoffs: {}, lastVerify: null };

  console.log('\nreadings - kept between runs');
  {
    let reads = 0;
    const live = async () => { reads++; return { code: '1045', where: { id: 5 } }; };
    let store = open();
    const first = await RD.keptReading(store, 'author:1045', inputs, live);
    t('no saved reading: read live once, and say when', [reads, typeof first.reading.at, first.reading.oldChecks], [1, 'string', false]);
    store = open(); // the dashboard was closed and opened again
    const again = await RD.keptReading(store, 'author:1045', inputs, live);
    t('🔑 opened again: the last reading, with NO live read', [reads, again.where.id, again.reading.at], [1, 5, first.reading.at]);
    await RD.keptReading(store, 'author:1045', { ...inputs, signoffs: { 6: { at: 'x' } } }, live);
    t('a changed input (a sign-off, `author set`) reads that author again', reads, 2);
    await RD.keptReading(open(), 'author:1045', { ...inputs, signoffs: { 6: { at: 'x' } } }, live, { maxAgeMs: -1 });
    t('...and so does a reading older than maxAgeMs (a sign-off checks fresh rows)', reads, 3);
    const later = await RD.keptReading(open({ checks: 'C2' }), 'author:1045', { ...inputs, signoffs: { 6: { at: 'x' } } }, live);
    t('the checks changed since (the dashboard was updated): still shown, marked oldChecks', [reads, later.reading.oldChecks], [3, true]);
    t('🔑 the steps changed (a reorder): every saved reading is dropped', open({ layout: 'L2' }).keys(), []);
    t('without a store (the terminal) every call reads live, with no reading attached', [await RD.keptReading(null, 'author:1045', inputs, live), reads], [{ code: '1045', where: { id: 5 } }, 4]);
  }

  console.log('\nreadings - what a refresh drops');
  {
    const keys = ['author:1001', 'author:1002', 'author:1003', 'health'];
    const drops = (o) => keys.filter(RD.refreshDrops(o));
    t('refresh() alone: everything, as before', drops(), keys);
    t('two authors ticked, health not: only those two', drops({ codes: ['1001', '1003'], health: false }), ['author:1001', 'author:1003']);
    t('the author open in the Onboard tab: only that one', drops({ codes: ['1002'], health: false }), ['author:1002']);
    t('only the health checks', drops({ codes: [], health: true }), ['health']);
    t('every author, not health', drops({ codes: 'all', health: false }), ['author:1001', 'author:1002', 'author:1003']);
  }

  console.log('\nreadings - safe on disk');
  {
    rmSync(file, { force: true });
    const store = open();
    const r = store.put('author:1046', inputs, { detail: `token ${SECRET}` }, 10);
    falsy('🔒 a reading carrying a credential is never written to disk', existsSync(file) && readFileSync(file, 'utf8').includes(SECRET));
    t('...nor kept, so the next load reads it live again', [store.get('author:1046', inputs), typeof r.at], [null, 'string']);
    store.put('author:1045', inputs, { fine: true }, 10);
    const saved = readFileSync(file, 'utf8');
    falsy('🔒 the inputs are kept only as a fingerprint — not the coaches.json entry', saved.includes('"slug"') || saved.includes('jane'));
    writeFileSync(file, '{ not json');
    t('a damaged file is ignored: start empty, read live', open().keys(), []);
    t('a fingerprint is the same for the same inputs and differs for others', [RD.fingerprint(inputs) === RD.fingerprint(JSON.parse(JSON.stringify(inputs))), RD.fingerprint(inputs) === RD.fingerprint({ ...inputs, lastVerify: 'x' })], [true, false]);
    truthy('the check-code fingerprint covers the files that decide a reading', RD.CHECK_FILES.some((f) => f.endsWith('lib-author.mjs')) && RD.CHECK_FILES.every((f) => existsSync(f)));
  }
  rmSync(dir, { recursive: true, force: true });
}

{
  const HP = await import('./lib-help.mjs');
  console.log('\nhelp - a bundle that stopped shipping (2026-10-07)');
  const h = HP.helpFor(4, { displayName: 'Freddy Davis' }, { state: 'FAIL', rows: [{ check: 'available, ships', status: 'FAIL', detail: 'available true, requires_shipping false' }] });
  truthy('says why it matters (no shipping address) and where the tick box is', /shipping address/.test(h.problems[0].say) && /This is a physical product/.test(h.problems[0].steps[0]));
  truthy('...and to refresh only this author after', /Refresh this author/.test(h.problems[0].steps[1]));
}


/* ---------------------------------------------------------------------------
 * Generate Landing Pages (lib-landing.mjs) — plans/01 §3
 * ------------------------------------------------------------------------- */
{
  const LP = await import('./lib-landing.mjs');
  const SE = await import('./lib-settings.mjs');
  const SW = await import('./lib-switches.mjs');
  const { readFileSync, existsSync, readdirSync } = await import('node:fs');
  console.log('\nlanding pages - the layout is code, only the words are written');
  {
    const a = {
      author: 'Jane Smith', book: 'Her Book™', slogan: ['LINE ONE.', 'LINE TWO.'], description: 'Coaching readers to grow.',
      strip: [['READ', 'the book'], ['ASK', 'your coach'], ['GROW', 'every day']], question: 'Ever wondered?',
      receive: [['Her Book™', 'A book.'], ['Your Personal BookCoach AI', 'A coach.']], coach: 'Growth Coach', beside: 'as you grow',
      canDo: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'], long: '<p>Hello.</p>\n<h2>Your Own BookCoach AI</h2>\n<p>Bye & <strong>more</strong>.</p>',
    };
    const html = LP.buildSales(a);
    truthy('the three boxes, each with its Copy button', ['pimg', 'p2', 'p3'].every((id) => html.includes(`id="${id}"`) && html.includes(`cp('${id}',this)`)));
    truthy('the fixed subscription terms are added, with this book', html.includes('<p><strong>Subscription Terms:</strong>') && html.includes('Your copy of Her Book™ will be shipped'));
    truthy('Zipify\'s look comes from the template (Lato 18px, #262626)', /font-size:18px;line-height:1.43;color:#262626/.test(html));
    t('read back, the page gives the same answers', LP.salesFromHtml(html), a);
    truthy('plain text: a < or > is refused, and & is written safely', LP.salesProblems({ ...a, question: 'Ever 2 > 1?' }).some((x) => /plain text/.test(x)) && LP.buildSales({ ...a, question: 'Q & A?' }).includes('<h3>Q &amp; A?</h3>'));
    t('incomplete answers are refused, naming what is missing', (() => { try { LP.buildSales({ ...a, slogan: ['ONE'] }); return ''; } catch (x) { return /slogan/.test(x.message); } })(), true);
    truthy('🔒 a script, a link or an image in the long text is refused', ['<script>x</script>', '<a href="x">y</a>', '<img src=x>', '<p onclick="x">y</p>'].every((bad) => LP.htmlProblems(bad).length));
    t('...while headings, bold, lists and a coloured span pass', LP.htmlProblems('<h2>A</h2><p class="lead"><strong style="color:#3d1fe6">B</strong></p><ul><li>c</li></ul>'), []);
    truthy('the long text must stop before the terms — they are added for you', LP.salesProblems({ ...a, long: '<p>_____________</p>' }).some((x) => /terms/.test(x)));
    const c = { author: 'Jane Smith', book: 'Her Book', price: '97.00', piece1: '<h2>Take It Further</h2>', piece2: '<h2>The Course</h2>' };
    t('the collection page reads back the same too', LP.collectionFromHtml(LP.buildCollection(c)), c);
  }
  console.log('\nlanding pages - every page made by hand is rebuilt identically from its answers');
  {
    const gen = new URL('./generated/', import.meta.url);
    const sales = existsSync(gen) ? readdirSync(gen).filter((d) => existsSync(new URL(`./generated/${d}/sales-text-v2.html`, import.meta.url))) : [];
    const differ = sales.filter((d) => {
      const html = readFileSync(new URL(`./generated/${d}/sales-text-v2.html`, import.meta.url), 'utf8');
      return LP.buildSales(LP.salesFromHtml(html)) !== html;
    });
    t(`${sales.length} sales pages on this computer: none differs`, differ, []);
  }
  console.log('\nlanding pages - asking Claude Code');
  {
    t('the prompt names the author and the skill file — it works pasted into any chat', /1011 Reinhard Klett.*landing-page\.SKILL\.md.*kind: sales/.test(LP.landingPrompt('1011', 'sales', { name: 'Reinhard Klett' })), true);
    const l = LP.claudeLaunch({ code: '1011', kind: 'collection', model: 'sonnet', effort: 'medium', claude: 'C:\\Users\\me\\.local\\bin\\claude.exe', cwd: 'D:\\Projects\\LeadershipBooks' });
    t('a new window: claude with the model, the effort and the skill', l.args.slice(5), ['"C:\\Users\\me\\.local\\bin\\claude.exe"', '--model', 'sonnet', '--effort', 'medium', '"/landing-page 1011 collection"']);
    truthy('...passed to cmd verbatim, never through Node\'s quoting', l.options.windowsVerbatimArguments === true && l.options.shell === false);
    const refused = (o) => { try { LP.claudeLaunch({ code: '1011', claude: 'claude', cwd: 'D:\\x', ...o }); return false; } catch { return true; } };
    truthy('🔒 only a 4-digit code, a known kind, model and effort get in', [{ code: '1011 & del *' }, { kind: 'x' }, { model: 'gpt' }, { effort: 'huge' }, { cwd: 'D:\\x" & calc' }].every(refused));
    const s = SE.readSettings({ file: join(tmpdir(), 'no-such-settings.json') });
    t('🔑 the "Landing pages" switch defaults OFF; Sonnet at medium effort', [s.landingPages, s.landingModel, s.landingEffort], ['off', 'sonnet', 'medium']);
    truthy('...a model or effort not on the list is refused', SE.parseSetting('landingModel', 'gpt-4')[1] && SE.parseSetting('landingEffort', 'turbo')[1]);
    const dir = mkdtempSync(join(tmpdir(), 'lp-'));
    const skill = join(dir, 'landing-page');
    const on = SW.applyLandingPages(true, { dir: skill });
    const body = readFileSync(join(skill, 'SKILL.md'), 'utf8');
    truthy('switched on: the skill is installed, pointing at this dashboard', on.applied && /^---\nname: landing-page/.test(body) && !body.includes('{{DASHBOARD}}'));
    const off = SW.applyLandingPages(false, { dir: skill });
    t('switched off: the skill is GONE, not just hidden', [off.applied, existsSync(skill)], [true, false]);
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------------------
 * plan 05 — edit a number, delete an author, and what is left after
 * plans/05-edit-delete-authors.md  (decisions 2026-11-02)
 * ------------------------------------------------------------------------- */
{
  const DL = await import('../coach-router/lib-deleted.mjs');
  const MG = await import('./lib-manage.mjs');
  const AC5 = await import('./lib-actions.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'plan05-'));
  const file = join(dir, 'deleted.json');
  const KEY = 'vf-SECRET-KEY-123456';
  const coach = {
    code: '1004', name: 'Test Author', displayName: 'Test Author', bookTitle: 'Test Book', slug: 'test-author', ghlTag: 'bookcoach-test-author-active',
    ghlProductId: 'prod1', shopifyProductId: '111', collectionProductId: '222', courseId: 'c-1', courseOfferId: 'o-1', projectID: '0123456789abcdef01234567',
    landingPageUrl: 'https://x.example/funnel', bookLandingUrl: 'https://x.example/page', apiKey: KEY, formerCodes: ['1044'],
  };
  const live = [{ code: '1001', name: 'Michael', formerCodes: ['1042'] }, { code: '1002', name: 'Freddy' }, coach];
  const T0 = new Date('2026-11-02T09:00:00Z');
  const days = (n) => new Date(T0.getTime() + n * 24 * 3600 * 1000);

  console.log('\nplan 05 - which numbers are allowed');
  {
    const v = (n, o = {}) => MG.validateNewNumber(n, { oldCode: '1004', coaches: live, ...o });
    truthy('four digits only', !v('12').ok && !v('abcd').ok && !v('12345').ok);
    truthy('the number it already has is refused', /already this author/.test(v('1004').problem));
    truthy('a number a live author holds is refused', /already belongs to Freddy/.test(v('1002').problem));
    truthy('🔑 a former number of a LIVE author is refused — it would hijack their old links', /used to be Michael/.test(v('1042').problem));
    truthy('a number an unfinished draft holds is refused', !v('1010', { drafts: { 1010: {} } }).ok);
    t('a free number is fine, with no warning', [v('1010').ok, v('1010').warning || null], [true, null]);
    // A deleted author's number: allowed, with a warning (decision 4).
    DL.recordDelete({ ...coach, code: '1003', name: 'Sample Author', displayName: 'Sample Author', formerCodes: ['1033'] }, { now: T0, file });
    const data = DL.readDeleted(file);
    const used = v('1003', { deleted: data });
    truthy('🔑 a deleted author\'s number is ALLOWED, but comes with a warning that names who had it', used.ok && /belonged to Sample Author \(deleted 2026-11-02, clean-up still open\)/.test(used.warning));
    truthy('...and so are the numbers it used to have', v('1033', { deleted: data }).ok && !!v('1033', { deleted: data }).warning);
    DL.recordDelete(coach, { now: T0, file }); // 1004 itself, for the rest
  }

  {
    const WZ5 = await import('./lib-wizard.mjs');
    t('🔑 Add author never SUGGESTS a number a deleted author had (the highest one included)', WZ5.nextCode([{ code: '1001' }, { code: '1002' }], {}, ['1003', '1004']), '1005');
    t('...and without any deleted author it suggests the next number, as before', WZ5.nextCode([{ code: '1001' }, { code: '1002' }], {}), '1003');
    t('the Add author screen is told which typed numbers need the warning', Object.keys(Object.fromEntries(['1003', '1033', '1999'].map((c) => [c, DL.reuseWarning(c, { data: DL.readDeleted(file) })]).filter(([, w]) => w))), ['1003', '1033']);
  }

  console.log('\nplan 05 - the leftover list');
  {
    const items = DL.leftoverItems(coach);
    const ids = items.map((i) => i.id);
    t('what the author had becomes a leftover, in a sensible order', ids, ['shop', 'coll', 'tag', 'ghlprod', 'workflow', 'course', 'page', 'funnel', 'zipify', 'vf']);
    truthy('shop, tag, product, workflow and course are checked live; pages and the Voiceflow project wait for a person', items.every((i) => i.auto === ['shop', 'coll', 'tag', 'ghlprod', 'workflow', 'course'].includes(i.id)));
    truthy('every leftover says how to remove it, in clicks', items.every((i) => i.how.length >= 3));
    t('an author with no collection, funnel, course or project has fewer leftovers', DL.leftoverItems({ code: '1005', name: 'Min', ghlTag: 't' }).map((i) => i.id), ['tag', 'workflow', 'page', 'zipify']);
    truthy('🔑 NOTHING in GHL, Shopify or Zipify is ever deleted: every leftover starts as "todo"', items.every((i) => i.state === 'todo'));
  }

  console.log('\nplan 05 - states: still there, gone, signed off');
  {
    const rec = DL.readDeleted(file).authors['1004'];
    DL.applyChecks(rec, [{ id: 'shop', present: false }, { id: 'tag', present: true, note: 'held by 3 contact(s)' }, { id: 'course', present: null, note: 'no scope' }], days(1));
    t('a check that finds it gone turns it gone', rec.items.find((i) => i.id === 'shop').state, 'gone');
    t('...one that finds it still there stays todo, with its note', [rec.items.find((i) => i.id === 'tag').state, rec.items.find((i) => i.id === 'tag').note], ['todo', 'held by 3 contact(s)']);
    t('🔑 a check that cannot tell (no scope) never turns an item gone', rec.items.find((i) => i.id === 'course').state, 'todo');
    DL.applyChecks(rec, [{ id: 'shop', present: true }], days(2));
    t('🔑 a "gone" item that comes back reads still there again — state is read, never remembered', rec.items.find((i) => i.id === 'shop').state, 'todo');
    DL.applyChecks(rec, [{ id: 'page', present: false }], days(2));
    t('a check never decides an item only a person can see', rec.items.find((i) => i.id === 'page').state, 'todo');
    const [okAuto, whyAuto] = DL.signOff(rec, 'tag', { now: days(2) });
    truthy('🔑 a sign-off cannot stand in for a check', !okAuto && /checked live/.test(whyAuto) && rec.items.find((i) => i.id === 'tag').state === 'todo');
    t('a sign-off works for what no API can read', [DL.signOff(rec, 'page', { note: 'deleted it', now: days(2) })[0], rec.items.find((i) => i.id === 'page').state], [true, 'signed']);
    t('...and can be taken back', [DL.signOff(rec, 'page', { value: false })[0], rec.items.find((i) => i.id === 'page').state], [true, 'todo']);
    t('still open while anything is todo', [DL.isFinished(rec), rec.finishedAt], [false, null]);
    // Everything cleared: gone by check, signed by a person.
    DL.applyChecks(rec, rec.items.filter((i) => i.auto).map((i) => ({ id: i.id, present: false })), days(3));
    for (const i of rec.items.filter((x) => !x.auto)) DL.signOff(rec, i.id, { now: days(3) });
    t('when every item is gone or signed, the author is finished and leaves the grid', [DL.isFinished(rec), rec.finishedAt], [true, days(3).toISOString()]);
    truthy('...a thing that comes back reopens nothing already finished by a sign-off, but a check finding it still re-lists the item', (() => { DL.applyChecks(rec, [{ id: 'shop', present: true }], days(4)); return rec.items.find((i) => i.id === 'shop').state === 'todo'; })());
  }

  console.log('\nplan 05 - the screen never sees the snapshot');
  {
    const rec = DL.readDeleted(file).authors['1004'];
    const view = DL.publicView(rec, days(1));
    truthy('🔒 the public view has no snapshot and no key', !JSON.stringify(view).includes(KEY) && !('snapshot' in view));
    truthy('🔒 the server\'s credential check covers a removed author too (its key sits in the snapshot)', DL.snapshotSecrets(DL.readDeleted(file)).includes(KEY));
    truthy('undo is possible inside 30 days', DL.publicView(DL.readDeleted(file).authors['1004'], days(29)).canUndo);
    falsy('...and not after', DL.publicView(DL.readDeleted(file).authors['1004'], days(31)).canUndo);
    const data = DL.readDeleted(file);
    DL.prune(data, days(31));
    const snap = data.authors['1004'].snapshot;
    truthy('after 30 days the snapshot loses its Voiceflow key but keeps the ids the checks need', !('apiKey' in snap) && snap.shopifyProductId === '111');
    truthy('🔒 ...so a key is not kept for ever', !JSON.stringify(data).includes(KEY));
    const fin = DL.readDeleted(file);
    fin.authors['1004'].finishedAt = days(3).toISOString();
    DL.prune(fin, days(40));
    truthy('a finished author collapses to a stub after 30 days, but its numbers stay "used before"', fin.authors['1004'].gone && DL.usedBefore('1044', { data: fin }) !== null);
  }

  console.log('\nplan 05 - the live checks (offline)');
  {
    const rec = DL.buildRecord(coach, { now: T0 });
    const ctx = (over = {}) => ({
      locationId: 'L',
      catalog: async () => new Map([['111', {}]]),
      ghl: async (p) => {
        if (p.startsWith('/locations/')) return { tags: [{ name: 'BookCoach-Test-Author-Active' }] };
        if (p === '/contacts/search') return { contacts: [{}, {}] };
        if (p.startsWith('/workflows/')) return { workflows: [{ name: 'Book Coach — Grant Course (Test Author)', status: 'published' }] };
        if (p.startsWith('/products/')) return {};
        if (p.startsWith('/courses/')) throw new Error('GHL 404 on /courses/products/c-1');
        return {};
      },
      ...over,
    });
    const by = (r) => Object.fromEntries(r.map((x) => [x.id, x]));
    const r = by(await DL.checkLeftovers(rec, ctx()));
    t('a product still on sale is still there', r.shop.present, true);
    t('a product missing from the public catalogue is no longer on sale', r.coll.present, false);
    t('a tag still in GHL is still there — and says how many contacts hold it', [r.tag.present, r.tag.note], [true, 'still in GHL · held by 2 contact(s)']);
    t('a workflow with the author\'s name is still there', r.workflow.present, true);
    t('a GHL product that answers is still there', r.ghlprod.present, true);
    t('a course GHL answers 404 for is gone', r.course.present, false);
    t('checks cover only the live items — never a page or the Voiceflow project', Object.keys(r), ['shop', 'coll', 'tag', 'ghlprod', 'workflow', 'course']);
    const noScope = by(await DL.checkLeftovers(rec, ctx({ ghl: async () => { throw new Error('GHL 401 on /locations/L/tags'); } })));
    truthy('🔑 a token without the scope answers "cannot tell" — never "gone"', noScope.tag.present === null && noScope.workflow.present === null && noScope.course.present === null);
    const outage = by(await DL.checkLeftovers(rec, ctx({ catalog: async () => { throw new Error('Shopify products.json 503'); } })));
    truthy('an outage is "cannot tell" too, with the reason', outage.shop.present === null && /503/.test(outage.shop.note));
  }

  console.log('\nplan 05 - the dashboard\'s own files follow the number');
  {
    const pf = join(dir, 'pages.json');
    writeFileSync(pf, JSON.stringify({ 1002: { showBooks: true }, 1004: { showCourses: false } }));
    t('a renumber moves the page settings', [MG.followNumber({ from: '1004', to: '1010' }, { pageFile: pf }), JSON.parse(readFileSync(pf, 'utf8'))], [['page settings'], { 1002: { showBooks: true }, 1010: { showCourses: false } }]);
    MG.followNumber({ from: '1010' }, { pageFile: pf });
    truthy('🔑 a delete drops them — a number given out again starts clean', !('1010' in JSON.parse(readFileSync(pf, 'utf8'))) && '1002' in JSON.parse(readFileSync(pf, 'utf8')));
    t('nothing to move is not an error', MG.followNumber({ from: '1999', to: '1998' }, { pageFile: pf }), []);
  }

  console.log('\nplan 05 - the clean-up list as the grid shows it');
  {
    const f2 = join(dir, 'view.json');
    DL.recordDelete(coach, { now: T0, file: f2 });
    const view = MG.deletedView({ file: f2, now: days(1) });
    t('one open clean-up, nothing finished', [view.open.length, view.finished.length], [1, 0]);
    t('it says how much is left', [view.open[0].left, view.open[0].total], [10, 10]);
    truthy('🔒 the list never carries the key', !JSON.stringify(view).includes(KEY));
    const checked = await MG.runCheck('1004', { locationId: 'L', catalog: async () => new Map(), ghl: async () => { throw new Error('GHL 404 on x'); } }, { file: f2, now: days(1) });
    t('the first look flips what never existed to gone', checked.items.filter((i) => i.state === 'gone').map((i) => i.id), ['shop', 'coll', 'ghlprod', 'course']);
    truthy('...the tag and workflow read 404 as "cannot tell" and wait', checked.items.find((i) => i.id === 'tag').state === 'todo');
    t('a sign-off is saved', MG.runSignoff('1004', 'page', { note: 'done', file: f2, now: days(1) }).items.find((i) => i.id === 'page').state, 'signed');
    truthy('...and refused for an item that is checked live', (() => { try { MG.runSignoff('1004', 'tag', { file: f2 }); return false; } catch (e) { return /checked live/.test(e.message); } })());
    truthy('no clean-up for an author never deleted', await MG.runCheck('1999', {}, { file: f2 }).then(() => false, (e) => /no clean-up open/.test(e.message)));
  }

  console.log('\nplan 05 - what the dashboard may run');
  {
    const plan = (action, extra = {}) => AC5.planAction({ action, coaches: live, drafts: {}, deleted: DL.readDeleted(file), ...extra });
    // --- change the number
    const dry = plan('renumber', { code: '1002', params: { newCode: '1010' } });
    t('a number change previews with the one command that plans it', dry.steps, [{ script: 'renumber-coaches.mjs', args: ['--map', '1002=1010'] }]);
    t('...and a real one is held to "renumber 1002"', (() => { try { plan('renumber', { code: '1002', params: { newCode: '1010' }, write: true }); return null; } catch (e) { return e.message; } })(), 'a real run needs the confirmation "renumber 1002"');
    const real = plan('renumber', { code: '1002', params: { newCode: '1010' }, write: true, confirm: 'renumber 1002' });
    t('the real run, in the order renumber-coaches.mjs prints: registry, secrets, KV, then the old KV entry', real.steps.map((s) => [s.script, s.args.join(' ')]),
      [['renumber-coaches.mjs', '--map 1002=1010 --write'], ['sync-secrets.mjs', '--write'], ['seed-coaches.mjs', '--write'], ['renumber-coaches.mjs', '--prune-kv --write']]);
    truthy('a number someone holds is refused before anything runs', (() => { try { plan('renumber', { code: '1002', params: { newCode: '1001' } }); return false; } catch (e) { return /already belongs/.test(e.message); } })());
    truthy('🔑 a live author\'s former number is refused', (() => { try { plan('renumber', { code: '1002', params: { newCode: '1042' } }); return false; } catch (e) { return /used to be Michael/.test(e.message); } })());
    truthy('a malformed number never reaches a command line', (() => { try { plan('renumber', { code: '1002', params: { newCode: '10 --write' } }); return false; } catch (e) { return /Four digits/.test(e.message); } })());
    // A deleted author's number: the warning must be accepted.
    const gone = DL.readDeleted(file); // holds 1003 (and 1033)
    truthy('🔑 reusing a deleted author\'s number needs the warning accepted first', (() => { try { plan('renumber', { code: '1002', params: { newCode: '1003' }, deleted: gone }); return false; } catch (e) { return /needs your OK first: 1003 belonged to Sample Author/.test(e.message); } })());
    const accepted = plan('renumber', { code: '1002', params: { newCode: '1003', acceptReuse: true }, deleted: gone, write: true, confirm: 'renumber 1002' });
    t('...once accepted it runs, and the command is told it was', accepted.steps[0].args, ['--map', '1002=1003', '--write', '--accept-reuse']);
    // --- delete
    t('a delete previews with the dry run of delete-author', plan('delete', { code: '1004' }).steps, [{ script: 'delete-author.mjs', args: ['--code', '1004'] }]);
    truthy('...and a real one needs "delete 1004"', (() => { try { plan('delete', { code: '1004', write: true, confirm: 'delete 1002' }); return false; } catch (e) { return /delete 1004/.test(e.message); } })());
    t('🔑 the real delete is ONE command: it never reaches GHL or Shopify', plan('delete', { code: '1004', write: true, confirm: 'delete 1004' }).steps, [{ script: 'delete-author.mjs', args: ['--code', '1004', '--write'] }]);
    truthy('only an author that exists can be deleted', (() => { try { plan('delete', { code: '1999' }); return false; } catch (e) { return /create the author first/.test(e.message); } })());
    t('an undo works for an author who is no longer in coaches.json', plan('undo-delete', { code: '1999', coaches: [], write: true, confirm: 'undo-delete 1999' }).steps.map((s) => s.script), ['delete-author.mjs', 'sync-secrets.mjs', 'seed-coaches.mjs']);
    t('"Update subscribers now" is dry first, then the real sync', [plan('sync-subscribers', { code: '1004' }).steps[0].args, plan('sync-subscribers', { code: '1004', write: true, confirm: 'sync-subscribers 1004' }).steps[0].args], [['--dry'], ['--sync']]);
    truthy('🔒 every step is a script name and an argument list — nothing is ever a shell string', ['renumber', 'delete', 'undo-delete', 'sync-subscribers'].every((a) => AC5.ACTIONS[a] && AC5.ACTIONS[a].dry === true));
  }

  console.log('\nplan 05 - the endpoints');
  {
    const { makeHandler } = await import('./server.mjs');
    const http = await import('node:http');
    const seen = [];
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    const view = { open: [{ code: '1004', name: 'Test Author', left: 2, total: 3, items: [] }], finished: [] };
    const handle = makeHandler({
      pipeline: { coaches: [], secrets: () => [KEY], refresh() {} }, token: 'tk', port, settings: { read: () => ({}), reality: () => ({}) }, signoffs: { record() {} },
      manage: {
        impact: async (b) => { seen.push(b); if (b.newCode === 'boom') throw new Error('no author'); return { ok: true, rows: [] }; },
        view: () => view,
        check: async (code) => (code === '1999' ? Promise.reject(new Error('no clean-up open for 1999')) : { code, left: 1 }),
        signoff: (code, id, note, value) => { seen.push({ code, id, note, value }); return { code }; },
      },
    });
    server.on('request', (q, s) => handle(q, s));
    const call = (method, path, body) => new Promise((ok) => {
      const r = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, 'x-pipeline-token': 'tk', ...(body ? { 'content-type': 'application/json' } : {}) } }, (res) => {
        let s = '';
        res.on('data', (c) => { s += c; });
        res.on('end', () => ok({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
      });
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
    t('the clean-up list is served', (await call('GET', '/api/deleted')).body.open[0].code, '1004');
    t('the impact list needs a known kind', (await call('GET', '/api/manage/impact?kind=drop&code=1004')).status, 400);
    t('...and a four-digit code', (await call('GET', '/api/manage/impact?kind=delete&code=abc')).status, 400);
    t('...and passes the number through', [(await call('GET', '/api/manage/impact?kind=renumber&code=1004&newCode=1010')).status, seen[0]], [200, { kind: 'renumber', code: '1004', newCode: '1010' }]);
    t('a failed impact read is a 400 with the reason', (await call('GET', '/api/manage/impact?kind=renumber&code=1004&newCode=boom')).body.error, 'no author');
    t('Check again returns the author and the whole list', Object.keys((await call('POST', '/api/deleted/check', { code: '1004' })).body), ['author', 'open', 'finished']);
    t('...an unknown clean-up is a 400', (await call('POST', '/api/deleted/check', { code: '1999' })).status, 400);
    t('a sign-off must say yes or no, plainly', (await call('POST', '/api/deleted/signoff', { code: '1004', id: 'page', value: 'yes' })).status, 400);
    t('...and is passed on', [(await call('POST', '/api/deleted/signoff', { code: '1004', id: 'page', note: 'ok', value: true })).status, seen.at(-1)], [200, { code: '1004', id: 'page', note: 'ok', value: true }]);
    view.open[0].leak = KEY;
    truthy('🔒 a list that would carry a key is refused outright', (await call('GET', '/api/deleted')).status === 500);
    server.close();
  }
  rmSync(dir, { recursive: true, force: true });
}

/* ---------------------------------------------------------------------------
 * plan 06 — prototype coach pages (no coach code, nothing live, files only in All Coaches (Demo))
 * plans/06-prototype-coach-pages.md  (decisions 2026-11-02 / 2026-11-03)
 * ------------------------------------------------------------------------- */
{
  const PT = await import('./lib-prototypes.mjs');
  const { readdirSync } = await import('node:fs');
  const vmModule = await import('node:vm');
  const dir = mkdtempSync(join(tmpdir(), 'plan06-'));
  const KEY = 'vfp_TEST_PERSONAL_KEY_123456789';
  const shared = { vfApiKey: `Bearer ${KEY}` };
  const T0 = new Date('2026-11-03T09:00:00Z');
  const VER = '6ad879ac777718f228065cd1';
  const good = { name: 'Tara Hayes', bookTitle: 'Panic to Picnic', versionID: VER, authorURL: 'https://tara.example', books: 'Buy the Book|https://shop.example/b', showBooks: true, showMeetAuthor: true };
  const files = () => readdirSync(dir).sort();

  console.log('\nplan 06 - the answers');
  {
    const v = PT.validatePrototype(good);
    truthy('a name, a book title and a version ID are enough', v.clean && !Object.keys(v.problems).length);
    t('...and there is no coach code anywhere in what is kept', Object.keys(v.clean).filter((k) => /code/i.test(k)), []);
    t('the three required answers are asked for', Object.keys(PT.validatePrototype({}).problems).sort(), ['bookTitle', 'name', 'versionID']);
    truthy('a version ID that is not 24 hex characters is refused', PT.validatePrototype({ ...good, versionID: 'main' }).problems.versionID);
    truthy('< and > are refused in the text a page prints', PT.validatePrototype({ ...good, name: 'A<b>' }).problems.name && PT.validatePrototype({ ...good, bookTitle: '<script>' }).problems.bookTitle);
    truthy('a link that is not https is refused, by the final coach page\'s own rule', PT.validatePrototype({ ...good, authorURL: 'http://x' }).problems.authorURL);
    t('a button with nothing to show stays off', [PT.validatePrototype({ ...good, books: '', authorURL: '', showBooks: true, showMeetAuthor: true }).clean].map((c) => [c.showBooks, c.showMeetAuthor])[0], [false, false]);
    t('the id is the name as a slug; a second one is "make another"', [PT.idFor('Tara Hayes'), PT.idFor('Tara Hayes', { 'tara-hayes': {} }, { another: true }), PT.idFor('Tara Hayes', { 'tara-hayes': {}, 'tara-hayes-2': {} }, { another: true })], ['tara-hayes', 'tara-hayes-2', 'tara-hayes-3']);
  }

  console.log('\nplan 06 - the page');
  {
    const r = PT.buildPrototype(good, { shared, secrets: [KEY, 'ghl-token-ABCDEFGH'], dir, now: T0 });
    t('the page is written into the demo folder, named from the author', [r.id, r.name], ['tara-hayes', 'Tara-Hayes-demo']);
    const page = readFileSync(join(dir, 'Tara-Hayes-demo'), 'utf8');
    const cfg = page.slice(page.indexOf('const CONFIG = {'), page.indexOf('};', page.indexOf('const CONFIG = {')));
    truthy('🔑 it connects straight to Voiceflow: direct, with the version ID', /CONNECTION: "direct"/.test(cfg) && cfg.includes(`VF_VERSION_ID: "${VER}"`));
    truthy('🔑 NO coach code and NO Worker address in the page\'s config', !/COACH_CODE\s*:/.test(cfg) && !/WORKER_URL\s*:/.test(cfg) && !/workers\.dev/.test(cfg));
    truthy('🔑 the activation button (it needs the Worker) is off', /showActivation: false/.test(cfg));
    t('the Voiceflow key is in the page exactly once', page.split(KEY).length - 1, 1);
    truthy('the author, the book and the buy button are in the page', /authorName: "Tara Hayes"/.test(cfg) && /bookTitle: "Panic to Picnic"/.test(cfg) && /Buy the Book/.test(cfg));
    truthy('the rest of the page is the final coach page: chat, voice, buttons', page.includes('const DIRECT_READY') && page.includes('vfDirect.interact') && page.includes('async function handleSend'));
    truthy('🔑 NO Worker, GHL-lesson or Twilio code left in the page (the final page keeps it)', ['workers.dev', 'WORKER_URL', 'COACH_CODE', 'workerPost', 'viaConnection', 'getSessionToken', 'MEMBER', 'sessionToken', 'bind/', 'activate'].every((w) => !page.includes(w)));
    truthy('the text under the photo is shown, not commented out', page.includes('<p class="presence-note">') && page.includes('<strong>This prototype is text + voice-in only.</strong>') && page.includes('speaking video avatar of the author here — this photo panel is a placeholder for that.') && !page.includes('<!--' + String.fromCharCode(10) + '    <p class="presence-note">'));
    truthy('no photo: the ring with the initials turns (as in Tara-demo); a photo stops it; reduce-motion stops it', page.includes('.photo-ring.spin{animation:spin 10s linear infinite;}') && page.includes("document.querySelector('.photo-ring').classList.add('spin');") && page.includes('.photo-ring.spin{animation:none;}') && page.indexOf("classList.add('spin')") > page.indexOf('if(CONFIG.authorPhotoURL){'));
    truthy('the stripped page still parses as JavaScript', page.split('<script>').slice(1).map((x) => x.split('</script>')[0]).every((code) => { try { new vmModule.Script(code); return true; } catch { return false; } }));
    truthy('🔒 a template that has changed shape is refused, not shipped with Worker code', (() => { try { PT.stripForPrototype('<html>nothing to find</html>'); return false; } catch (e) { return /template has changed/.test(e.message); } })());
    const finalPage = readFileSync(new URL('./templates/coach-page.template.html', import.meta.url), 'utf8');
    truthy('the final template itself is untouched: it still has the Worker code and the note stays a comment', finalPage.includes('workerPost') && finalPage.includes('<!--' + String.fromCharCode(10) + '    <p class="presence-note">'));
    truthy('🔒 the result for the screen carries no key and no page text', !JSON.stringify(r).includes(KEY) && !('page' in r));
    truthy('🔒 a credential other than the Voiceflow key would stop the build', (() => { try { PT.buildPrototype({ ...good, name: 'Zed Zed' }, { shared, secrets: ['Zed Zed'], dir, now: T0 }); return false; } catch (e) { return /would contain a credential/.test(e.message); } })());
    truthy('no key in coaches.json is a plain refusal, not a page without one', (() => { try { PT.buildPrototype({ ...good, name: 'No Key' }, { shared: {}, dir }); return false; } catch (e) { return /no Voiceflow key/.test(e.message); } })());
  }

  console.log('\nplan 06 - everything lands in the demo folder, and nowhere else');
  {
    t('🔑 after a build there are two files: the page and the answers (no key in the answers)', [files(), readFileSync(join(dir, '_prototypes.json'), 'utf8').includes(KEY)], [['Tara-Hayes-demo', '_prototypes.json'], false]);
    const again = PT.buildPrototype({ ...good, bookTitle: 'Panic to Picnic 2' }, { id: 'tara-hayes', shared, secrets: [], dir, now: new Date(T0.getTime() + 60000) });
    t('editing again rebuilds the same file and keeps the old page as a backup — in the same folder', [again.id, again.backup, files()], ['tara-hayes', 'Tara-Hayes-demo.bak-20261103-090100', ['Tara-Hayes-demo', 'Tara-Hayes-demo.bak-20261103-090100', '_prototypes.json']]);
    const dup = PT.buildPrototype(good, { shared, secrets: [], dir, now: T0 });
    truthy('🔑 the same name again never replaces a saved prototype by accident', dup.problems && /already exists/.test(dup.problems.name) && files().length === 3);
    const other = PT.buildPrototype(good, { another: true, shared, secrets: [], dir, now: T0 });
    t('"Make another" gets its own file', [other.id, other.name], ['tara-hayes-2', 'Tara-Hayes-2-demo']);
    truthy('🔒 a path can never leave the demo folder', ['../x', 'a/b', '..', 'A B', ''].every((id) => { try { PT.pagePathFor(id, { dir }); return false; } catch { return true; } }));
    truthy('the default folder is All Coaches (Demo), beside the dashboard', /All Coaches \(Demo\)$/.test(PT.DEMO_DIR) && PT.DEMO_DIR.includes('LeadershipBooks'));
    const src = readFileSync(new URL('./lib-prototypes.mjs', import.meta.url), 'utf8');
    truthy('🔒 the library has no reach into GHL, Shopify, Cloudflare, the registry or the live readers', !/lib-readers|lib-shopify|lib-registry|lib-live|wrangler|fetch\(|loadConfig|lib-settings|lib-readings/.test(src));
    truthy('🔒 ...and names no file of the dashboard folder: nothing is written there', !/page-settings|pipeline\.local|drafts\.local|readings\.local|DASH\b/.test(src));
  }

  console.log('\nplan 06 - the list');
  {
    const list = PT.listPrototypes({ dir });
    t('saved prototypes are listed, last built first, with whether the file is there', list.map((p) => [p.id, p.exists]), [['tara-hayes', true], ['tara-hayes-2', true]]);
    truthy('🔒 the list never carries a key', !JSON.stringify(list).includes(KEY));
    const first = list.find((p) => p.id === 'tara-hayes');
    t('the saved answers come back whole, for Edit again', [first.name, first.bookTitle, first.books], ['Tara Hayes', 'Panic to Picnic 2', [{ title: 'Buy the Book', url: 'https://shop.example/b' }]]);
    t('Remove takes it off the list but leaves every file', [PT.forgetPrototype('tara-hayes-2', { dir }), PT.listPrototypes({ dir }).length, files().includes('Tara-Hayes-2-demo')], [true, 1, true]);
    truthy('a prototype whose file is gone says so, and has no path to copy', (() => { rmSync(join(dir, 'Tara-Hayes-demo')); const l = PT.listPrototypes({ dir }); let refused = false; try { PT.prototypeFile('tara-hayes', { dir }); } catch { refused = true; } return l[0].exists === false && refused; })());
  }

  console.log('\nplan 06 - the endpoints');
  {
    const { makeHandler } = await import('./server.mjs');
    const http = await import('node:http');
    const seen = [];
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    const items = [{ id: 'tara-hayes', name: 'Tara Hayes', exists: true }];
    const handle = makeHandler({
      pipeline: { coaches: [], secrets: () => [KEY], refresh() {} }, token: 'tk', port, settings: { read: () => ({}), reality: () => ({}) }, signoffs: { record() {} },
      prototypes: {
        list: () => ({ items, folder: 'F' }),
        build: (v, o) => { seen.push({ v, o }); return v.bad ? { problems: { name: 'no' } } : v.boom ? (() => { throw new Error('no Voiceflow key'); })() : { id: 'tara-hayes', name: 'Tara-Hayes-demo' }; },
        open: async (id, how) => ({ ok: true, said: `${how} ${id}` }),
        forget: (id) => id === 'tara-hayes',
      },
    });
    server.on('request', (q, s) => handle(q, s));
    const call = (method, path, body) => new Promise((ok) => {
      const r = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, 'x-pipeline-token': 'tk', ...(body ? { 'content-type': 'application/json' } : {}) } }, (res) => {
        let s = '';
        res.on('data', (c) => { s += c; });
        res.on('end', () => ok({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
      });
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
    t('the list is served', (await call('GET', '/api/prototypes')).body.items[0].id, 'tara-hayes');
    const b = await call('POST', '/api/prototypes', { values: { name: 'x' }, id: 'tara-hayes', another: true });
    t('a build passes the answers, the id and "make another" through', [b.status, b.body.built.id, seen[0].o], [200, 'tara-hayes', { id: 'tara-hayes', another: true }]);
    const bad = await call('POST', '/api/prototypes', { values: { bad: 1 } });
    t('answers that need fixing come back 400, naming the field', [bad.status, bad.body.problems.name], [400, 'no']);
    t('a refusal (no key) is a 400 with the reason', [(await call('POST', '/api/prototypes', { values: { boom: 1 } })).status], [400]);
    t('copy / show in folder only — nothing else opens', [(await call('POST', '/api/prototypes/open', { id: 'tara-hayes', how: 'notepad' })).status, (await call('POST', '/api/prototypes/open', { id: 'tara-hayes', how: 'copy' })).body.said], [400, 'copy tara-hayes']);
    t('Remove is passed on', (await call('POST', '/api/prototypes/forget', { id: 'tara-hayes' })).body.ok, true);
    items[0].leak = KEY;
    truthy('🔒 a list that would carry the key is refused outright', (await call('GET', '/api/prototypes')).status === 500);
    server.close();
  }
  rmSync(dir, { recursive: true, force: true });
}

/* ---------------------------------------------------------------------------
 * who has access (lib-access.mjs, plan 07): every rule, the sort, the setting, the endpoint
 * ------------------------------------------------------------------------- */
{
  const AC = await import('./lib-access.mjs');
  const { FIELD_IDS: F } = await import('../coach-router/lib-verify-author.mjs');
  const SE = await import('./lib-settings.mjs');
  const RD = await import('./lib-readings.mjs');
  const NOW = new Date('2026-11-05T09:00:00Z');
  const coaches = [
    { code: '1001', name: 'michael-stickler', displayName: 'Michael Stickler', ghlTag: 'bookcoach-michael-active', ghlProductId: 'P1' },
    { code: '1002', name: 'freddy', displayName: 'Freddy Davis', ghlTag: 'bookcoach-freddy-active', ghlProductId: 'P2', formerCodes: ['1043'] },
  ];
  const contact = (id, email, tags, f = {}) => ({ id, email, tags, dateAdded: '2026-10-01T00:00:00Z', fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [F[k], v])) });
  const trial = (code, ends, extra = {}) => ({ coach_status: 'trial', coach_code: code, coach_trial_started: '2026-11-05', coach_trial_ends: ends, ...extra });
  const census = [
    contact('c1', 'reader@x.org', ['bookcoach-michael-active'], trial('1001', '15 November 2026', { shopify_order_number: '#5001' })),
    contact('c2', 'friend@x.org', ['bookcoach-michael-active'], trial('1001', '15 November 2026', { shopify_order_number: '#4262' })),
    contact('c3', 'payer@x.org', ['bookcoach-michael-active', 'bookcoach-freddy-active'], trial('1002', '7 November 2026')),
    contact('c4', 'me+verify-1001-x@x.org', ['bookcoach-michael-active'], trial('1001', '15 November 2026')),
    contact('c5', 'staff@x.org', ['bookcoach-staff-all']),
    contact('c6', 'odd@x.org', ['bookcoach-freddy-active'], { coach_status: '' }),
    contact('c7', 'late@x.org', ['BookCoach-Freddy-Active'], trial('1043', '3 November 2026')),
    contact('c8', 'two@x.org', ['bookcoach-michael-active', 'bookcoach-freddy-active'], trial('1002', '9 November 2026')),
  ];
  const subscriptions = [{ contactId: 'c3', productId: 'P1' }];
  const orders = [{ name: '#4262', cancelledAt: '2026-11-05T08:00:00Z' }, { name: '#5001', cancelledAt: null }];
  const v = AC.accessView({ census, subscriptions, orders, coaches, staffTag: 'bookcoach-staff-all', locationId: 'LOC', now: NOW });
  const row = (id, code) => v.rows.find((r) => r.contactId === id && r.code === code);

  console.log('\naccess - who has it, and why (plan 07 §3)');
  t('a trial: Trial, 10 days left on 5 Nov for "15 November 2026"', [row('c1', '1001').access, row('c1', '1001').daysLeft, row('c1', '1001').endsAt], ['Trial', 10, '2026-11-15']);
  t('🔑 a gift = a trial whose Shopify order was cancelled ("Give free access" always cancels)', row('c2', '1001').access, 'Gift');
  t('🔑 ...a real order tagged delivered-manual by hand is NOT a gift: its order is not cancelled', row('c1', '1001').access, 'Trial');
  t('paid wins over a trial of the same author', row('c3', '1001').access, 'Paid');
  t('...and their other author is still the trial the fields describe', [row('c3', '1002').access, row('c3', '1002').daysLeft], ['Trial', 2]);
  t('a +verify- contact is Test, whatever else it holds', row('c4', '1001').access, 'Test');
  t('the staff tag alone: one row, every coach', [row('c5', '').access, row('c5', '').author], ['Staff', 'All coaches']);
  t('a tag with no trial and no subscription: Unknown, flagged', row('c6', '1002').access, 'Unknown');
  t('tags match whatever their case; a trial under a FORMER number counts', [row('c7', '1002').access, row('c7', '1002').daysLeft], ['Trial', -2]);
  t('...and a past end date says so', row('c7', '1002').note, 'ended — the tag was not removed yet');
  t('two trials: only the author coach_code names has a date; the other says why not', [row('c8', '1002').daysLeft, row('c8', '1001').daysLeft, /one per person/.test(row('c8', '1001').note)], [4, null, true]);
  t('a GHL link per contact', row('c1', '1001').ghlUrl, 'https://app.gohighlevel.com/v2/location/LOC/contacts/detail/c1');
  t('the per-author counts', v.summary.map((s) => [s.code, s.total, s.Paid, s.Trial, s.Gift, s.Test, s.Unknown]), [['1001', 5, 1, 2, 1, 1, 0], ['1002', 4, 0, 3, 0, 0, 1]]);
  t('people are counted once, however many coaches they have', v.people, 8);
  t('orders not read: no gifts — they show as Trial, and the view says gifts were not checked',
    [AC.accessView({ census, subscriptions, orders: null, coaches, now: NOW }).rows.find((r) => r.contactId === 'c2').access, AC.accessView({ census, coaches, now: NOW }).giftChecked], ['Trial', false]);
  t('days left: 0 on the end day, negative after', [AC.daysLeftOf(Date.UTC(2026, 10, 5), NOW), AC.daysLeftOf(Date.UTC(2026, 10, 4), NOW), AC.daysLeftOf(NaN, NOW)], [0, -1, null]);

  console.log('\naccess - sorting (plan 07 §0)');
  const ids = (rows) => rows.map((r) => `${r.contactId}:${r.code}`);
  t('🔑 the default: Days left, soonest first (an ended trial first); undated rows after every dated one', ids(v.rows).slice(0, 6), ['c7:1002', 'c3:1002', 'c8:1002', 'c2:1001', 'c4:1001', 'c1:1001']);
  truthy('...paid, staff and unknown rows are all at the end', v.rows.slice(-4).every((r) => r.daysLeft === null));
  t('Days left the other way: latest first, undated still last', ids(AC.sortRows(v.rows, { column: 'daysLeft', dir: 'desc' })).slice(0, 3), ['c2:1001', 'c4:1001', 'c1:1001']);
  for (const column of AC.SORT_COLUMNS) {
    const up = AC.sortRows(v.rows, { column, dir: 'asc' });
    const down = AC.sortRows(v.rows, { column, dir: 'desc' });
    truthy(`every column sorts both ways: ${column}`, up.length === v.rows.length && JSON.stringify(ids(up)) !== JSON.stringify(ids(down)));
  }
  t('by Coach #: 1001 first, the staff row (no number) last', [AC.sortRows(v.rows, { column: 'code', dir: 'asc' })[0].code, AC.sortRows(v.rows, { column: 'code', dir: 'asc' }).slice(-1)[0].code], ['1001', '']);
  t('by email, A to Z', AC.sortRows(v.rows, { column: 'person', dir: 'asc' })[0].email, 'friend@x.org');
  t('an unknown column falls back to the default', ids(AC.sortRows(v.rows, { column: 'bogus' })), ids(v.rows));
  t('ending soon (5 days): dated trials and gifts, ended ones included', ids(AC.sortRows(AC.endingSoon(v.rows, 5))), ['c7:1002', 'c3:1002', 'c8:1002']);
  truthy('🔑 the browser sorts with the same rules (default column and the undated-last rule)', (() => {
    const src = readFileSync(new URL('./web/access.js', import.meta.url), 'utf8');
    return src.includes("const DEFAULT_SORT = { column: 'daysLeft', dir: 'asc' };") && src.includes('if (an !== bn) return an ? 1 : -1;');
  })());

  console.log('\naccess - the "ending soon" setting');
  t('5 days by default', SE.SETTING_DEFAULTS.accessSoonDays, 5);
  t('any whole number 1-30; nothing else', [1, 30, 0, 31, 2.5, 'x'].map((n) => SE.parseSetting('accessSoonDays', n)[0]), [1, 30, null, null, null, null]);
  const RFkeys = ['author:1001', 'health', 'access'];
  t('a health refresh drops the access reading too (same GHL contacts)', RFkeys.filter(RD.refreshDrops({ codes: [], health: true })), ['health', 'access']);
  t('an author refresh does not', RFkeys.filter(RD.refreshDrops({ codes: ['1001'], health: false })), ['author:1001']);
  t('the Access tab\'s own refresh drops only it', RFkeys.filter(RD.refreshDrops({ codes: [], health: false, access: true })), ['access']);

  console.log('\naccess - zero Cloudflare');
  {
    const live = readFileSync(new URL('./lib-live.mjs', import.meta.url), 'utf8');
    const body = live.slice(live.indexOf('async function access('), live.indexOf('Status only, safe to share'));
    truthy('🔒 the access reader never touches KV or the Worker', body.length > 200 && !/kvGet|ctx\.health\(|COACH_KV|wrangler/.test(body));
    truthy('🔒 lib-access does no I/O at all', !/import .*node:|fetch\(/.test(readFileSync(new URL('./lib-access.mjs', import.meta.url), 'utf8')));
  }

  console.log('\naccess - the endpoint');
  {
    const { makeHandler } = await import('./server.mjs');
    const http = await import('node:http');
    const calls = [];
    let saved = null;
    const pipeline = {
      coaches: [{ code: '1001' }], secrets: () => ['pit-0123456789abcdef0123456789'],
      refresh: (w) => calls.push(['refresh', w]),
      access: async (o = {}) => { calls.push(['access', o.savedOnly ? 'saved' : 'live']); return o.savedOnly ? saved : { rows: [], summary: [], people: 0 }; },
    };
    const settings = { read: () => ({ accessSoonDays: 7 }), write: () => ({}), apply: async () => ({}), reality: () => ({}) };
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    const handle = makeHandler({ pipeline, token: 'tk', port, settings, signoffs: { record: () => {} } });
    server.on('request', (q, s) => handle(q, s));
    const get = (path) => new Promise((ok, bad) => {
      http.get({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, 'x-pipeline-token': 'tk' } }, (res) => {
        const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(Buffer.concat(c).toString('utf8') || '{}') }));
      }).on('error', bad);
    });
    let r = await get('/api/access?saved=1');
    t('?saved=1 with nothing saved: { none } and the days setting — nothing live is read', [r.body.none, r.body.soonDays, calls], [true, 7, [['access', 'saved']]]);
    saved = { rows: [{ code: '1001' }], summary: [], people: 1 };
    r = await get('/api/access?saved=1');
    t('?saved=1 with a reading: that reading', r.body.people, 1);
    calls.length = 0;
    r = await get('/api/access?refresh=1');
    t('?refresh=1: drops only the access reading, then reads live', calls, [['refresh', { codes: [], health: false, access: true }], ['access', 'live']]);
    t('the page has an /access address of its own', (await new Promise((ok) => http.get({ host: '127.0.0.1', port, path: '/access', headers: { host: `127.0.0.1:${port}` } }, (res) => { res.resume(); ok(res.statusCode); }))), 200);
    server.close();
  }
}

console.log(`
${pass} passed, ${fail} failed
`);
process.exit(fail ? 1 : 0);
