/**
 * lib-pipeline.mjs — where an author is in the pipeline, decided from live rows.
 *
 * Pure. Takes the rows lib-author.mjs reads from the live systems, the
 * sign-offs a person recorded, and the step definitions in steps.mjs, and says
 * for each step: DONE, READY (do this next), BLOCKED (waiting on an earlier
 * step), CONFIRM (only a person can say), FAIL (started and wrong) or, for an
 * optional step, OPTIONAL (not done, and nothing waits on it).
 * Plan: ghl-shopify subscription/plans/22-pipeline-dashboard.md §4.
 *
 * STATE IS READ, NEVER STORED (plan 22 rule 3). Nothing here remembers where an
 * author was. Every call recomputes it, so a step done by hand in GHL shows up
 * the next time anyone looks — and a step that later breaks shows up too.
 *
 * 🚨 A sign-off can only turn a MANUAL row into DONE. It never overrides FAIL
 * or TODO: a tick recorded last week must not hide a breakage found today.
 */

import { PIPELINE_STEPS, stepById, commandFor, instructionsFor } from '../coach-router/steps.mjs';
import { authorStatus } from '../coach-router/lib-author.mjs';
import { helpFor, publicValues } from './lib-help.mjs';

export const STATE_ORDER = ['FAIL', 'READY', 'CONFIRM', 'BLOCKED', 'OPTIONAL', 'DONE'];

export const STATE_LABEL = {
  DONE: 'done',
  READY: 'do this next',
  BLOCKED: 'waiting on an earlier step',
  CONFIRM: 'needs your confirmation',
  FAIL: 'wrong — fix it',
  OPTIONAL: 'optional',
};

/**
 * One entry per step, in order. `signoffs` is { [stepId]: { at, note, checks } }.
 * `needs` only ever points at lower ids (steps.mjs), so one pass resolves it.
 */
export function deriveSteps(rows, { signoffs = {}, steps = PIPELINE_STEPS } = {}) {
  const states = {};
  const out = [];
  for (const s of steps) {
    const mine = rows.filter((r) => r.step === s.id);
    const sign = signoffs[s.id] || signoffs[String(s.id)] || null;
    const signed = new Set(sign && Array.isArray(sign.checks) ? sign.checks : []);
    const manual = mine.filter((r) => r.status === 'MANUAL');
    const unsigned = manual.filter((r) => !signed.has(r.check));
    const blockers = s.needs.filter((n) => states[n] !== 'DONE');
    const needsDone = blockers.length === 0;

    let state;
    if (!mine.length) state = needsDone ? 'READY' : 'BLOCKED'; // nothing looked at it: never DONE
    else if (mine.some((r) => r.status === 'FAIL')) state = 'FAIL';
    else if (mine.some((r) => r.status === 'TODO')) state = needsDone ? 'READY' : 'BLOCKED';
    else if (s.gate && !needsDone) state = 'BLOCKED';
    else if (unsigned.length) state = needsDone ? 'CONFIRM' : 'BLOCKED';
    else state = 'DONE';
    // An optional step (Course Collection) never asks to be done next and never blocks:
    // until it is DONE (or signed off) it reads OPTIONAL. Wrong is still wrong: FAIL stays.
    if (s.optional && state !== 'DONE' && state !== 'FAIL') state = 'OPTIONAL';
    states[s.id] = state;

    out.push({
      id: s.id,
      key: s.key,
      title: s.title,
      long: s.long,
      platform: s.platform,
      kind: s.kind,
      needs: s.needs,
      gate: !!s.gate,
      optional: !!s.optional,
      state,
      warn: state === 'DONE' && mine.some((r) => r.status === 'WARN'),
      blockers,
      rows: mine.map((r) => (r.status === 'MANUAL' ? { ...r, signed: signed.has(r.check) } : r)),
      signoff: sign,
      // What a sign-off would confirm right now. Empty means there is nothing to sign.
      unsigned: unsigned.map((r) => r.check),
    });
  }
  return out;
}

/** "Where am I": the first FAIL, else the first READY, else the first CONFIRM. */
export function whereAmI(derived) {
  for (const want of ['FAIL', 'READY', 'CONFIRM']) {
    const hit = derived.find((s) => s.state === want);
    if (hit) return hit;
  }
  return null;
}

export function counts(derived) {
  const c = { DONE: 0, READY: 0, BLOCKED: 0, CONFIRM: 0, FAIL: 0, OPTIONAL: 0 };
  for (const s of derived) c[s.state]++;
  return c;
}

/** The next action for a step, with this author's values filled in. */
export function actionFor(stepId, coach, derivedStep = null) {
  const step = stepById(stepId);
  if (!step) return null;
  const fixes = derivedStep
    ? [...new Set(derivedStep.rows.filter((r) => r.status === 'FAIL' || r.status === 'TODO').map((r) => r.fix).filter(Boolean))]
    : [];
  return {
    step: step.id,
    title: step.long,
    platform: step.platform,
    kind: step.kind,
    command: commandFor(step, coach),
    instructions: instructionsFor(step, coach),
    signoff: step.signoff || '',
    fixes,
  };
}

/**
 * Validate a sign-off before it is written. `derivedStep` is the step as it
 * reads LIVE right now, so only checks that actually need a person are signed.
 * Returns [value, problem].
 */
export function signoffFor(derivedStep, { note = '', now = new Date() } = {}) {
  if (!derivedStep) return [null, 'no such step'];
  const manual = derivedStep.rows.filter((r) => r.status === 'MANUAL').map((r) => r.check);
  if (!manual.length) {
    return [null, `step ${derivedStep.id} (${derivedStep.title}) has no check that needs a person — it is decided by the live systems`];
  }
  return [{ at: now.toISOString(), note: String(note || '').slice(0, 500), checks: manual }, null];
}

/** Everything about one author, live. `ctx` is lib-readers + cfg + lastVerify. */
export async function pipelineFor(coach, ctx, { all = [], signoffs = {}, deep = false } = {}) {
  const rows = await authorStatus(coach, ctx, { all, deep });
  // Every step carries its own action, so any step can say how it is done.
  // …and its help in plain words, built from public values only.
  const pub = publicValues(coach);
  const steps = deriveSteps(rows, { signoffs }).map((s) => {
    const step = { ...s, action: actionFor(s.id, coach, s) };
    return { ...step, help: helpFor(s.id, pub, step) };
  });
  const where = whereAmI(steps);
  return {
    code: coach.code,
    name: coach.displayName || coach.name,
    book: coach.bookTitle || '',
    steps,
    where: where ? { id: where.id, title: where.title, state: where.state } : null,
    next: where ? actionFor(where.id, coach, where) : null,
    counts: counts(steps),
  };
}
