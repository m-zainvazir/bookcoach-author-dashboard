/**
 * lib-actions.mjs — the ONLY commands the dashboard can run, and how.
 *
 * Every action here is an existing coach-router command — onboard, author set,
 * author shopify, seed + secrets, verify-author — so each one keeps all of its
 * own validation, refusals, backups and dry-run behaviour. The dashboard adds
 * nothing to what they do; it only fills in their arguments from inputs it has
 * already validated.
 *
 * The guards:
 *   - an ALLOWLIST: an action name maps to a fixed script; nothing else runs
 *   - arguments are built here from validated values and passed as an array to
 *     `node` with NO shell, so no input can become a command
 *   - a write needs `write: true` AND a confirmation that names the action and
 *     the author ("onboard 1045") — typed out by the page after you confirm
 *   - one job at a time; each is timed out
 *   - every line of output is scrubbed of the real credential values before it
 *     is stored or shown
 *
 * Plan: ../ghl-shopify subscription/plans/22-pipeline-dashboard.md §14.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { COACH_ROUTER } from './lib-paths.mjs';
import { validateField, validateFields, FIELDS, ONBOARD_NEEDS, onboardMissing } from './lib-wizard.mjs';
import { RECORD_FIELDS } from '../coach-router/lib-author.mjs';

/** The coach page's details a draft can hold (step 2, before the author exists). */
const PAGE_DETAIL_FIELDS = ['authorPhotoURL', 'authorInitials', 'authorURL', 'books'];
import { projectFromVersion } from '../coach-router/lib-onboard.mjs';
import { validateNewNumber } from './lib-manage.mjs';
import { readDeleted } from '../coach-router/lib-deleted.mjs';

/**
 * A product image (the bundle, or the course collection): a file on this computer
 * OR a link. The command reads the image itself, on this computer, and checks it
 * in the preview.
 */
function imageArgs(p) {
  const [imageFile, e1] = validateField('imageFile', p.imageFile || '');
  const [imageUrl, e2] = validateField('imageUrl', p.imageUrl || '');
  const bad = [e1, e2].filter(Boolean);
  if (imageFile && imageUrl) bad.push('the product image: a file OR a link, not both — empty one of the two boxes');
  if (bad.length) throw new Error(bad.join('; '));
  if (imageFile) return ['--image-file', imageFile];
  if (imageUrl) return ['--image-url', imageUrl];
  return [];
}

/**
 * Each action: what it changes (said before you confirm), whether it has a dry
 * run, and how its command is built. `build` returns { steps: [{ script, args }] }
 * or throws with the reason it cannot run.
 */
export const ACTIONS = {
  onboard: {
    label: 'Create the author',
    changes: 'creates the GHL coach tag, the $59 SERVICE product and its monthly price, and appends the author to coaches.json (backed up first), with the coach page details from step 2',
    dry: true,
    needsAuthor: false,
    build({ code, draft, coaches }) {
      if (coaches.some((c) => c.code === code)) throw new Error(`${code} already exists — onboard creates, it never edits`);
      const v = (draft && draft.values) || {};
      const missing = onboardMissing({ code, ...v });
      if (missing.length) throw new Error(`still needed first: ${missing.join(', ')}`);
      const project = v.projectID || projectFromVersion(v.versionID);
      const args = ['--code', code, '--author', v.displayName, '--book', v.bookTitle, '--slug', v.slug, '--label', v.coachLabel, '--version', v.versionID, '--project', project];
      if (v.name && v.name !== v.displayName) args.push('--name', v.name);
      // The coach page comes first (step 2), so its details are already in the
      // draft. onboard has no flags for them: the real run saves them straight
      // after, with `author set` — its own validation and backup.
      const page = [];
      for (const k of PAGE_DETAIL_FIELDS) {
        if (k === 'books' && Array.isArray(v.books)) for (const b of v.books) page.push('--books', `${b.title}|${b.url}`);
        else if (k !== 'books' && v[k]) page.push(`--${k}`, String(v[k]));
      }
      const steps = [{ script: 'onboard.mjs', args }];
      const writeSteps = [{ script: 'onboard.mjs', args: [...args, '--write'] }];
      if (page.length) writeSteps.push({ script: 'author.mjs', args: ['set', '--code', code, ...page] });
      return { steps, writeSteps };
    },
  },
  set: {
    label: 'Save',
    changes: 'writes these fields to the author\'s coaches.json entry (backed up first; refused and restored if validation fails)',
    dry: false,
    needsAuthor: true,
    build({ code, params, coaches }) {
      const values = (params && params.values) || {};
      const keys = Object.keys(values).filter((k) => k in RECORD_FIELDS);
      const unknown = Object.keys(values).filter((k) => !(k in RECORD_FIELDS));
      if (unknown.length) throw new Error(`not a registry field: ${unknown.join(', ')}`);
      if (!keys.length) throw new Error('nothing to save');
      const { values: clean, problems } = validateFields(Object.fromEntries(keys.map((k) => [k, values[k]])), { coaches, code });
      if (Object.keys(problems).length) throw new Error(Object.entries(problems).map(([k, p]) => `${k}: ${p}`).join('; '));
      const args = ['set', '--code', code];
      for (const [k, v] of Object.entries(clean)) {
        if (k === 'books') for (const b of v) args.push('--books', `${b.title}|${b.url}`);
        else if (k === 'aliases') args.push('--aliases', v.join(','));
        else args.push(`--${k}`, String(v));
      }
      if (args.length === 3) throw new Error('nothing to save');
      return { steps: [{ script: 'author.mjs', args }] };
    },
  },
  shopify: {
    label: 'Create the Shopify bundle',
    changes: 'creates the bundle product in Shopify (with its image, if given), publishes it to the Online Store, and records its ids in coaches.json',
    dry: true,
    needsAuthor: true,
    build({ code, params }) {
      const p = params || {};
      const [price, e1] = validateField('price', p.price || '29.95');
      const [sku, e2] = validateField('sku', p.sku || '');
      const [grams, e3] = validateField('grams', p.grams || '');
      const bad = [e1, e2, e3].filter(Boolean);
      if (bad.length) throw new Error(bad.join('; '));
      const args = ['shopify', '--code', code, '--price', price];
      if (sku) args.push('--sku', sku);
      if (grams) args.push('--grams', grams);
      return { steps: [{ script: 'author.mjs', args: [...args, ...imageArgs(p)] }] };
    },
  },
  'shopify-image': {
    label: 'Add the image to the product',
    changes: 'uploads the image and adds it to this author\'s existing Shopify product — nothing else on the product changes, and no image is removed',
    dry: true,
    needsAuthor: true,
    build({ code, params, coaches }) {
      const p = params || {};
      const collection = p.product === 'collection';
      const c = coaches.find((x) => x.code === code);
      if (!c || !c[collection ? 'collectionProductId' : 'shopifyProductId']) {
        throw new Error(collection ? 'this author has no collection product yet — create it with the image instead' : 'this author has no Shopify product yet — create the bundle with the image instead');
      }
      const args = imageArgs(p);
      if (!args.length) throw new Error('give the image first: a file on this computer or a link');
      return { steps: [{ script: 'author.mjs', args: ['shopify-image', '--code', code, ...(collection ? ['--product', 'collection'] : []), ...args] }] };
    },
  },
  'shopify-collection': {
    label: 'Create the collection product',
    changes: 'creates "<Book> - Collection Bundle" in Shopify (with its image, if given; no inventory tracked, no shipping address; the Educational Services category and a standard description, so it can sell abroad), publishes it to the Online Store, and records its ids in coaches.json. It gives no coach access',
    dry: true,
    needsAuthor: true,
    build({ code, params }) {
      const p = params || {};
      const [price, e1] = validateField('collectionPrice', p.price || '97.00');
      if (e1) throw new Error(e1);
      return { steps: [{ script: 'author.mjs', args: ['shopify-collection', '--code', code, '--price', price, ...imageArgs(p)] }] };
    },
  },
  // Step Course360 through the Courses API (plans/03, 2026-10-13): after a person Duplicates
  // the master course in GHL, the command finds the copy and does the rest. Never deletes.
  course360: {
    label: 'Make the course',
    changes: 'changes the course you duplicated in Course360: this author\'s name and description, this author\'s coach in its "BookCoach AI" lesson, and a Free Offer, Published, that gives the course (made, or an existing one linked). It saves the course, the Offer and the lesson link in coaches.json (backed up first). Nothing is deleted',
    dry: true,
    needsAuthor: true,
    build({ code, params }) {
      const p = params || {};
      const [course, e] = p.course ? validateField('courseLink', p.course) : ['', null];
      if (e) throw new Error(`Course link: ${e}`);
      return { steps: [{ script: 'author.mjs', args: ['course360', '--code', code, ...(course ? ['--course', course] : [])] }] };
    },
  },
  'verify-email': {
    label: 'Save the test inbox',
    changes: 'sets the test inbox in coaches.json (shared.verifyEmail)',
    dry: false,
    needsAuthor: false,
    build({ params }) {
      const [email, e] = validateField('verifyEmail', (params && params.verifyEmail) || '');
      if (e || !email) throw new Error(e || 'a test inbox is required');
      return { steps: [{ script: 'author.mjs', args: ['config', '--verifyEmail', email] }] };
    },
  },
  push: {
    label: 'Go live',
    changes: 'pushes coaches.json to the Worker\'s KV and the Voiceflow key to the Worker secrets — the author goes live',
    dry: true,
    needsAuthor: true,
    // seed-coaches is dry without --write; secrets only ever runs for real.
    build: () => ({ steps: [{ script: 'seed-coaches.mjs', args: [] }], writeSteps: [{ script: 'seed-coaches.mjs', args: ['--write'] }, { script: 'sync-secrets.mjs', args: ['--write'] }] }),
  },
  verify: {
    label: 'Run the end-to-end test',
    changes: 'places a REAL $0 Shopify order, creates a GHL test contact, sends a REAL welcome email to the test inbox, then cancels the order (and deletes the contact unless you keep it)',
    dry: true,
    needsAuthor: true,
    timeoutMs: 20 * 60 * 1000,
    build({ code, params }) {
      const args = ['--code', code, '--shopify-order'];
      if (params && params.keep) args.push('--keep');
      return { steps: [{ script: 'verify-author.mjs', args }] };
    },
  },
  // Plan 05 (2026-11-02): change an author's number everywhere. `code` is the CURRENT number.
  renumber: {
    label: 'Change the number',
    changes: 'gives the author a new number: coaches.json (the old number is kept as a former number, so live links keep working), the Worker\'s KV entry and secret, and the dashboard\'s own files. Then "Update subscribers now" rewrites their access. The coach page is rebuilt separately and pasted by you',
    dry: true,
    needsAuthor: true,
    build({ code, params, coaches, drafts = {}, deleted }) {
      const newCode = String((params && params.newCode) || '').trim();
      const v = validateNewNumber(newCode, { oldCode: code, coaches, drafts, deleted: deleted || readDeleted() });
      if (!v.ok) throw new Error(v.problem);
      // A number a deleted author had may be reused, but only after the warning was read.
      if (v.warning && !(params && params.acceptReuse === true)) throw new Error(`needs your OK first: ${v.warning}`);
      const map = `${code}=${newCode}`;
      const accept = v.warning ? ['--accept-reuse'] : [];
      return {
        steps: [{ script: 'renumber-coaches.mjs', args: ['--map', map] }],
        // The order renumber-coaches.mjs prints: the key under the new name first, then KV, then the old KV entry.
        writeSteps: [
          { script: 'renumber-coaches.mjs', args: ['--map', map, '--write', ...accept] },
          { script: 'sync-secrets.mjs', args: ['--write'] },
          { script: 'seed-coaches.mjs', args: ['--write'] },
          { script: 'renumber-coaches.mjs', args: ['--prune-kv', '--write'] },
        ],
      };
    },
  },
  // Plan 05: delete an author from everything the dashboard controls. GHL, Shopify, Zipify and
  // Voiceflow are LEFT ALONE and listed as a clean-up (decided 2026-11-02).
  delete: {
    label: 'Delete the author',
    changes: 'removes the author from coaches.json (backed up, kept 30 days for an undo), deletes the Worker\'s KV entry and secret, and sets the dashboard\'s files for them aside. Nothing in GHL, Shopify, Zipify or Voiceflow is deleted: those are listed as a clean-up for you',
    dry: true,
    needsAuthor: true,
    build: ({ code }) => ({ steps: [{ script: 'delete-author.mjs', args: ['--code', code] }] }),
  },
  'undo-delete': {
    label: 'Undo the delete',
    changes: 'puts the author back into coaches.json from the 30-day snapshot, then the Worker gets the KV entry and secret again. Things already removed by hand in GHL, Shopify or Zipify do not come back',
    dry: true,
    needsAuthor: false,
    build: ({ code }) => ({
      steps: [{ script: 'delete-author.mjs', args: ['--code', code, '--undo'] }],
      writeSteps: [
        { script: 'delete-author.mjs', args: ['--code', code, '--undo', '--write'] },
        { script: 'sync-secrets.mjs', args: ['--write'] },
        { script: 'seed-coaches.mjs', args: ['--write'] },
      ],
    }),
  },
  // After a renumber or a delete: ask the Worker to reconcile subscriber access now, not in 15 minutes.
  'sync-subscribers': {
    label: 'Update subscribers now',
    changes: 'asks the Worker to reconcile subscriber access now instead of at its next 15-minute run. The Worker refuses, on its own, a run that would revoke most subscribers at once',
    dry: true,
    needsAuthor: false,
    build: () => ({ steps: [{ script: 'sync-subscribers.mjs', args: ['--dry'] }], writeSteps: [{ script: 'sync-subscribers.mjs', args: ['--sync'] }] }),
  },
  guest: {
    label: 'Give free access',
    changes: 'places a REAL $0 Shopify order for this author\'s bundle in this person\'s name (then cancels the order), gives them the normal free trial of the coach, and sends them the REAL welcome email. Their contact is kept',
    dry: true,
    needsAuthor: true,
    timeoutMs: 20 * 60 * 1000,
    build({ code, params }) {
      const [email, e] = validateField('guestEmail', (params && params.guestEmail) || '');
      if (e || !email) throw new Error(e || 'the person\'s email is required');
      return { steps: [{ script: 'verify-author.mjs', args: ['--code', code, '--shopify-order', '--guest', '--email', email] }] };
    },
  },
};

/** The exact confirmation a write must carry: "<action> <code>". */
export const confirmPhrase = (action, code) => `${action} ${code}`;

/**
 * Turn a request into the commands it will run. Throws on anything not allowed.
 * Returns { steps: [{ script, args }], write, action } — nothing has run yet.
 */
export function planAction({ action, code, params = {}, write = false, confirm = '', coaches = [], drafts = {}, deleted = null }) {
  const def = ACTIONS[action];
  if (!def) throw new Error(`unknown action "${action}"`);
  if (!/^\d{4}$/.test(String(code || '')) && action !== 'verify-email') throw new Error('a four-digit coach code is required');
  const exists = coaches.some((c) => c.code === String(code));
  if (def.needsAuthor && !exists) throw new Error(`create the author first (step 3) — ${code} is not in coaches.json yet`);
  // A write is only ever what the person confirmed, for the author they confirmed.
  const isWrite = def.dry ? write === true : true;
  if (isWrite && def.dry && confirm !== confirmPhrase(action, code)) {
    throw new Error(`a real run needs the confirmation "${confirmPhrase(action, code)}"`);
  }
  const built = def.build({ code: String(code), params, coaches, draft: drafts[String(code)], drafts, deleted });
  let steps = built.steps;
  if (isWrite && def.dry) steps = built.writeSteps || steps.map((s) => ({ ...s, args: [...s.args, '--write'] }));
  return { action, code: String(code), write: isWrite, steps, timeoutMs: def.timeoutMs || 5 * 60 * 1000 };
}

/** Replace every real credential value in a piece of output. */
export function redact(text, secrets = []) {
  let s = String(text);
  for (const v of secrets) if (v && v.length >= 8) s = s.split(v).join('••••••');
  return s;
}

const MAX_OUTPUT = 200 * 1024;

/**
 * Runs planned actions one at a time and remembers the last few results.
 * `spawnImpl` is injectable so the tests never start a process.
 */
export function makeJobRunner({ spawnImpl = spawn, secrets = () => [], cwd = COACH_ROUTER, node = process.execPath, onDone = () => {} } = {}) {
  const jobs = new Map();
  let running = null;

  const runStep = (job, step) => new Promise((done) => {
    job.output += `\n$ node ${step.script} ${step.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`;
    let child;
    try {
      child = spawnImpl(node, [step.script, ...step.args], { cwd, shell: false, windowsHide: true, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    } catch (err) {
      job.output += `could not start: ${err.message}\n`;
      return done(1);
    }
    const timer = setTimeout(() => {
      job.output += `\n⏱ stopped: no result after ${Math.round(job.timeoutMs / 60000)} minutes\n`;
      try { child.kill(); } catch { /* already gone */ }
    }, job.timeoutMs);
    const take = (chunk) => {
      if (job.output.length < MAX_OUTPUT) job.output = redact(job.output + chunk.toString('utf8'), secrets()).slice(0, MAX_OUTPUT);
    };
    if (child.stdout) child.stdout.on('data', take);
    if (child.stderr) child.stderr.on('data', take);
    child.on('error', (err) => { job.output += `\n${err.message}\n`; });
    child.on('close', (codeOut) => { clearTimeout(timer); done(codeOut === null ? 1 : codeOut); });
  });

  async function run(job) {
    for (const step of job.steps) {
      job.exitCode = await runStep(job, step);
      if (job.exitCode !== 0) break;
    }
    job.status = job.exitCode === 0 ? 'done' : 'failed';
    job.finishedAt = new Date().toISOString();
    job.output = redact(job.output, secrets());
    running = null;
    try { await onDone(job); } catch (err) { job.output += `\n(after-step failed: ${err.message})\n`; }
  }

  return {
    /** Start a planned action. Refuses while another is running. */
    start(plan) {
      if (running) throw Object.assign(new Error(`"${running.action}" for ${running.code} is still running — wait for it to finish`), { status: 409 });
      const job = {
        id: randomBytes(8).toString('hex'), action: plan.action, code: plan.code, write: plan.write,
        steps: plan.steps, timeoutMs: plan.timeoutMs, status: 'running', exitCode: null,
        output: '', startedAt: new Date().toISOString(), finishedAt: null,
      };
      jobs.set(job.id, job);
      if (jobs.size > 30) jobs.delete(jobs.keys().next().value);
      running = job;
      job.finished = run(job);
      return view(job);
    },
    /** Resolves with the job once it has finished (the step-5 page build waits for its `author set`). */
    wait: async (id) => {
      const job = jobs.get(id);
      if (!job) return null;
      await job.finished;
      return view(job);
    },
    get: (id) => (jobs.has(id) ? view(jobs.get(id)) : null),
    get busy() { return running ? view(running) : null; },
  };
}

const view = (j) => ({ id: j.id, action: j.action, code: j.code, write: j.write, status: j.status, exitCode: j.exitCode, output: j.output, startedAt: j.startedAt, finishedAt: j.finishedAt });

export { FIELDS, ONBOARD_NEEDS };
