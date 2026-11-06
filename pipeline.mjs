#!/usr/bin/env node
/**
 * pipeline.mjs — where every author is, what is left, and whether anything broke.
 *
 *   npm run pipeline                                every author x checklist steps 0-16
 *   npm run pipeline -- status --code 1044 [--json] each step: state, why, what to do
 *   npm run pipeline -- next --code 1044 [--json]   just "where am I" and the next action
 *   npm run pipeline -- signoff --code 1044 --step 5[,8] [--note "…"]
 *   npm run pipeline -- unsignoff --code 1044 --step 5
 *   npm run pipeline -- health [--json]             steps 17-25: has anything quietly broken?
 *   npm run pipeline -- config [--guidance on|off] [--alertsLocal on|off] [--alertsUptime on|off] …
 *   npm run pipeline -- snapshot [--out file.json]  status only, no credentials — safe to share
 *   npm run pipeline -- alerts-test                 one test notification
 *   npm run pipeline -- page --code 1004 [--copy]   build the author's whole coach page (step 2)
 *                                                   from the answers saved by the dashboard's form
 *   npm run pipeline -- page-template --from <file> make a finished page the master for everyone
 *   npm run pipeline -- landing --code 1011 [--kind sales|collection]
 *                                                   build the Zipify landing page text from its answers
 *                                                   file (written by the /landing-page skill)
 *   npm run dashboard                               the same, in a browser (server.mjs)
 *
 * --code takes the code, the slug, the name or a unique part of it — `--code freddy`
 * works — and --author is the same (coach-router/lib-find.mjs).
 *
 * Reads the live systems and writes nothing to them. The only writes are local:
 * sign-offs to onboarding-state.local.json, switches to pipeline.local.json,
 * and what a switch itself controls (the skill file, the scheduled task), and
 * the step-2 coach page file (lib-pages.mjs).
 *
 * Plan: ../ghl-shopify subscription/plans/22-pipeline-dashboard.md
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openPipeline } from './lib-live.mjs';
import { STATE_LABEL, signoffFor } from './lib-pipeline.mjs';
import { PIPELINE_STEPS, stepById, DOC } from '../coach-router/steps.mjs';
import { recordSignoff } from '../coach-router/lib-registry.mjs';
import { coachFromArgs } from '../coach-router/lib-find.mjs';
import { readSettings, writeSettings, publicSettings, SETTING_DEFAULTS, SETTING_HELP } from './lib-settings.mjs';
import { applySwitches, switchReality, notify, readAlertState, writeAlertState } from './lib-switches.mjs';
import { healthChanges } from './lib-health.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'all';
const has = (f) => argv.includes(f);
const valOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

const GLYPH = { DONE: '✓', READY: '▶', BLOCKED: '·', CONFIRM: '?', FAIL: '✗', OPTIONAL: '○' };
const cell = (s) => (s.state === 'DONE' && s.warn ? '!' : GLYPH[s.state]);
const HEALTH_GLYPH = { OK: '✓', WARN: '!', FAIL: '✗', SKIP: '–' };

// The health job runs unattended. Its first act is the second lock on the
// switch: if alerts were switched off, it does nothing at all.
if (cmd === 'health' && has('--notify') && readSettings().alertsLocal !== 'on') {
  console.log(`${new Date().toISOString()}  alerts are off — exiting without checking`);
  process.exit(0);
}

let P;
try {
  P = openPipeline();
} catch (err) {
  die(err.message);
}
// --code 1043, --code freddy-davis, --code freddy, --author freddy: all the same author.
const pick = () => {
  const { coach, problem } = coachFromArgs(P.coaches, valOf);
  if (problem) die(`${cmd}: ${problem}`);
  return coach;
};
const json = (v) => {
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
};

/* -------------------------------------------------------------- the grid --- */

if (cmd === 'all') {
  const list = await P.authors();
  console.log(`\nPipeline — every author x every checklist step, read live (${DOC})`);
  console.log(`  ✓ done  ! done, with a note  ▶ do this next  ? needs your confirmation  · waiting on an earlier step  ○ optional  ✗ wrong\n`);
  console.log(`  ${'code'.padEnd(6)}${'author'.padEnd(20)}${PIPELINE_STEPS.map((s) => String(s.id).padStart(2)).join(' ')}   where`);
  for (const a of list) {
    const cells = a.steps.map((s) => ` ${cell(s)}`).join(' ');
    const where = a.where ? `${a.where.id} ${a.where.title} — ${STATE_LABEL[a.where.state]}` : 'every step done';
    console.log(`  ${a.code.padEnd(6)}${String(a.name).slice(0, 19).padEnd(20)}${cells}   ${where}`);
  }
  console.log(`\n  ${PIPELINE_STEPS.map((s) => `${s.id} ${s.title}`).join(' · ')}`);
  console.log(`\n  One author: npm run pipeline -- status --code <code>     After launch: npm run pipeline -- health\n`);
  process.exit(0);
}

/* ------------------------------------------------------------ one author --- */

if (cmd === 'status') {
  const coach = pick();
  const a = await P.author(coach.code, { deep: has('--deep') });
  if (has('--json')) json(a);
  console.log(`\n${a.code} ${a.name} — ${a.book}`);
  console.log(a.where ? `Where you are: step ${a.where.id} ${a.where.title} — ${STATE_LABEL[a.where.state]}\n` : 'Every step done.\n');
  for (const s of a.steps) {
    const head = `${String(s.id).padStart(2)} ${s.title.padEnd(32)} ${cell(s)} ${STATE_LABEL[s.state]}${s.warn ? ' (with a note)' : ''}`;
    console.log(`  ${head}${s.state === 'BLOCKED' && s.blockers.length ? `  — needs step ${s.blockers.join(', ')}` : ''}`);
    for (const r of s.rows) {
      if (r.status === 'DONE' && s.state === 'DONE') continue;
      const mark = r.status === 'MANUAL' ? (r.signed ? '✓ signed' : '? confirm') : r.status.toLowerCase();
      console.log(`       ${mark.padEnd(9)} ${r.check}${r.detail ? `  — ${r.detail}` : ''}`);
      if (r.fix && r.status !== 'DONE' && !(r.status === 'MANUAL' && r.signed)) console.log(`       ${''.padEnd(9)} → ${r.fix}`);
    }
    if (s.state === 'CONFIRM' || (s.state === 'OPTIONAL' && s.unsigned.length)) console.log(`       ${''.padEnd(9)} → npm run pipeline -- signoff --code ${a.code} --step ${s.id} --note "…"`);
  }
  const c = a.counts;
  console.log(`\n  ${c.DONE} done · ${c.READY} to do now · ${c.CONFIRM} to confirm · ${c.BLOCKED} waiting · ${c.FAIL} wrong${c.OPTIONAL ? ` · ${c.OPTIONAL} optional` : ''}\n`);
  process.exit(c.FAIL ? 1 : 0);
}

if (cmd === 'next') {
  const coach = pick();
  const a = await P.author(coach.code);
  const out = { code: a.code, name: a.name, where: a.where, next: a.next, counts: a.counts };
  if (has('--json')) json(out);
  if (!a.where) {
    console.log(`\n${a.code} ${a.name}: every step is done. After launch: npm run pipeline -- health\n`);
    process.exit(0);
  }
  const n = a.next;
  console.log(`\n${a.code} ${a.name} — step ${n.step}: ${n.title}  (${STATE_LABEL[a.where.state]})`);
  console.log(`  where:   ${n.platform} · ${n.kind}`);
  if (n.fixes.length) for (const f of n.fixes) console.log(`  fix:     ${f}`);
  if (n.command) console.log(`  command: ${n.command}`);
  if (n.instructions) console.log(`  how:     ${n.instructions}`);
  if (a.where.state === 'CONFIRM') console.log(`  confirm: ${n.signoff}\n           npm run pipeline -- signoff --code ${a.code} --step ${n.step} --note "…"`);
  console.log(`  doc:     ${DOC}\n`);
  process.exit(0);
}

/* -------------------------------------------------------------- sign-offs --- */

if (cmd === 'signoff' || cmd === 'unsignoff') {
  const coach = pick();
  const raw = valOf('--step');
  if (!raw) die(`${cmd} needs --step <n>[,<n>]. Steps with a sign-off: ${PIPELINE_STEPS.filter((s) => s.signoff).map((s) => `${s.id} (${s.signoff})`).join('; ')}`);
  const ids = raw.split(',').map((x) => Number(x.trim()));
  if (ids.some((n) => !stepById(n))) die(`unknown step in "${raw}" — steps are 0-16`);
  if (cmd === 'unsignoff') {
    for (const id of ids) recordSignoff(coach.code, id, null);
    console.log(`\n  ${coach.code}: sign-off removed from step ${ids.join(', ')}\n`);
    process.exit(0);
  }
  // Sign against the LIVE rows, so only checks that really need a person are recorded.
  const a = await P.author(coach.code);
  const problems = [];
  for (const id of ids) {
    const s = a.steps.find((x) => x.id === id);
    const [value, problem] = signoffFor(s, { note: valOf('--note') || '' });
    if (problem) { problems.push(problem); continue; }
    recordSignoff(coach.code, id, value);
    console.log(`\n  ${coach.code} step ${id} signed off: ${value.checks.join('; ')}`);
    if (s.state === 'FAIL' || s.state === 'READY' || s.state === 'BLOCKED') {
      console.log(`  ⚠ step ${id} still reads "${STATE_LABEL[s.state]}" — a sign-off never overrides a live check that is wrong or not done`);
    }
  }
  if (problems.length) die(`Not signed:\n  x ${problems.join('\n  x ')}`);
  console.log('');
  process.exit(0);
}

/* -------------------------------------------------------------- health --- */

if (cmd === 'health') {
  const h = await P.health();
  if (has('--notify')) {
    // Unattended: notify only on CHANGE — a check that breaks, or one that recovers.
    const prev = readAlertState();
    const { broke, recovered, state } = healthChanges(prev.state || {}, h.rows);
    for (const r of broke) notify(`Book Coach: ${r.title} — BROKEN`, `${r.detail}${r.items.length ? ` (${r.items.length})` : ''}`);
    for (const r of recovered) notify(`Book Coach: ${r.title} — recovered`, r.detail);
    writeAlertState({ state, lastRunAt: new Date().toISOString(), overall: h.overall });
    console.log(`${new Date().toISOString()}  health ${h.overall} — ${broke.length} broke, ${recovered.length} recovered`);
    process.exit(0);
  }
  if (has('--json')) json(h);
  console.log(`\nAfter launch — checklist steps 17-25, checked by their effect on the records: ${h.overall}\n`);
  for (const r of h.rows) {
    console.log(`  ${HEALTH_GLYPH[r.status]} ${r.id} ${r.title.padEnd(36)} ${r.detail}`);
    for (const it of r.items.slice(0, 10)) console.log(`        · ${it}`);
    if (r.items.length > 10) console.log(`        · …and ${r.items.length - 10} more`);
    if (r.fix && r.status !== 'OK') console.log(`        → ${r.fix}`);
  }
  console.log(`\n  ${h.afterLaunch.map((s) => `${s.id} ${s.checks.join('+')}`).join(' · ')}\n`);
  process.exit(h.overall === 'FAIL' ? 1 : 0);
}

/* -------------------------------------------------------------- switches --- */

if (cmd === 'config') {
  const changes = {};
  for (const k of Object.keys(SETTING_DEFAULTS)) {
    if (k === 'knownGrants') continue;
    const v = valOf(`--${k}`);
    if (v !== undefined) changes[k] = v;
  }
  const add = valOf('--known-grant');
  const remove = valOf('--unknown-grant');
  if (add || remove) {
    const cur = new Set(readSettings().knownGrants);
    if (add) cur.add(add);
    if (remove) cur.delete(remove);
    changes.knownGrants = [...cur];
  }
  const unknown = argv.filter((a) => a.startsWith('--') && !(a.slice(2) in SETTING_DEFAULTS) && !['--known-grant', '--unknown-grant'].includes(a));
  if (unknown.length) die(`unknown setting ${unknown.join(', ')}. Settings:\n    ${Object.entries(SETTING_HELP).map(([k, v]) => `--${k.padEnd(22)} ${v}`).join('\n    ')}`);

  if (!Object.keys(changes).length) {
    const s = readSettings();
    const real = switchReality(s);
    console.log('\n  Pipeline switches (pipeline.local.json) — all default OFF\n');
    for (const k of ['guidance', 'alertsLocal', 'alertsUptime', 'landingPages']) {
      const r = real[k];
      const mismatch = r.actual !== 'manual' && r.actual !== r.setting;
      console.log(`    ${k.padEnd(14)} ${r.setting.padEnd(4)}  actual: ${r.actual}${mismatch ? '  ⚠ differs — re-apply with the same --' + k : ''}   ${r.detail}`);
    }
    const pub = publicSettings(s);
    for (const k of ['landingModel', 'landingEffort', 'alertsIntervalMinutes', 'uptimeProvider', 'uptimeMonitorId', 'uptimeApiKeySet', 'knownGrants', 'dashboardPort', 'autoRefreshMinutes']) {
      console.log(`    ${k.padEnd(22)} ${JSON.stringify(pub[k])}`);
    }
    console.log(`\n  Change one: npm run pipeline -- config --alertsLocal on\n`);
    process.exit(0);
  }
  let next;
  try {
    next = writeSettings(changes);
  } catch (err) {
    die(err.message);
  }
  const applied = await applySwitches(changes, next);
  for (const [k, v] of Object.entries(changes)) if (k !== 'uptimeApiKey') console.log(`\n  ${k} = ${JSON.stringify(v)}`);
  if (changes.uptimeApiKey !== undefined) console.log('\n  uptimeApiKey = (set)');
  for (const [k, r] of Object.entries(applied)) console.log(`  ${r.applied ? '✓' : r.manual ? '…' : '✗'} ${k}: ${r.detail}`);
  console.log('');
  process.exit(Object.values(applied).some((r) => !r.applied && !r.manual) ? 1 : 0);
}

if (cmd === 'alerts-test') {
  const r = notify('Book Coach pipeline', 'Test notification — local alerts can reach you.');
  console.log(`\n  ${r.shown ? '✓' : '✗'} ${r.detail}\n`);
  process.exit(r.shown ? 0 : 1);
}

/* -------------------------------------------------------------- snapshot --- */

if (cmd === 'snapshot') {
  const snap = await P.snapshot();
  const out = valOf('--out');
  if (out) {
    writeFileSync(out, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
    console.log(`\n  snapshot written to ${out} — status only, no credentials\n`);
    process.exit(0);
  }
  json(snap);
}

/* ------------------------------------------------------ step 2: the page --- */

if (cmd === 'page') {
  // Rebuild from the answers already saved (coaches.json + page-settings.local.json).
  // To change an answer, use the form: Onboard -> step 2.
  const PG = await import('./lib-pages.mjs');
  const { loadConfig } = await import('../coach-router/lib-config.mjs');
  const coach = pick();
  let r;
  try {
    r = PG.buildPage(coach, PG.readPageSettings(coach.code), { shared: loadConfig().shared, secrets: P.secrets() });
  } catch (err) {
    die(`page: ${err.message}`);
  }
  console.log(`\n  ✓ built ${r.name} (${Math.round(r.bytes / 1024)} KB) in ${r.folder}`);
  if (r.backup) console.log(`    the previous version was kept as ${r.backup}`);
  console.log(r.includesKey ? '    it holds the Voiceflow key (the backup) — local only, never commit it' : '    no Voiceflow key in it — the page works through the coach router only');
  if (has('--copy')) {
    await PG.copyToClipboard(readFileSync(resolve(r.folder, r.name), 'utf8'));
    console.log('  ✓ copied — paste it into the GHL Custom Code element (Ctrl+A, Ctrl+V), Save, Publish');
  }
  console.log('');
  process.exit(0);
}

if (cmd === 'page-template') {
  const from = valOf('--from');
  if (!from) die('page-template --from <a finished coach page>, e.g. --from "../ghl-shopify subscription/rick-meyer-v2"');
  const PG = await import('./lib-pages.mjs');
  try {
    const r = PG.refreshTemplate(resolve(from), { secrets: P.secrets(), coaches: P.coaches });
    console.log(r.changed
      ? `\n  ✓ the master page is now ${from}'s code (${Math.round(r.bytes / 1024)} KB). Build each author's page again to pass it on.\n`
      : '\n  The master page already is this code — nothing changed.\n');
  } catch (err) {
    die(`page-template: ${err.message}`);
  }
  process.exit(0);
}

/* --------------------------------------- the Zipify step: landing pages --- */

if (cmd === 'landing') {
  // Builds the page from its answers file — the words are Claude's (the /landing-page
  // skill), the layout is lib-landing's. Refuses an incomplete answers file.
  const LP = await import('./lib-landing.mjs');
  const coach = pick();
  const kind = valOf('--kind') || 'sales';
  if (!LP.KINDS.includes(kind)) die(`landing: --kind is ${LP.KINDS.join(' or ')}, not "${kind}"`);
  const slug = coach.slug;
  if (!slug) die(`landing: ${coach.code} has no slug yet`);
  let r;
  try {
    r = LP.writeLanding(slug, kind, { secrets: P.secrets() });
  } catch (err) {
    die(`landing: ${err.message}`);
  }
  console.log(`\n  ✓ built ${r.file} (${Math.round(r.bytes / 1024)} KB)`);
  console.log('    open it, press a box\'s Copy button, then in Zipify: click the text box, Ctrl+A, Ctrl+V\n');
  process.exit(0);
}

die(`unknown command "${cmd}". Use: (none) | status | next | signoff | unsignoff | health | config | snapshot | alerts-test | page | page-template | landing`);

