/**
 * lib-wizard.mjs — "Add author": the onboarding checklist as a step-by-step form.
 *
 * It asks for each input at the step that needs it, validates it with the SAME
 * rules the commands use (lib-author parseRecordValue, lib-onboard, lib-shopify),
 * and keeps a DRAFT for an author who does not exist yet. The coaches.json
 * entry itself is only ever created by `onboard.mjs` (step GHL + registry), run by
 * lib-actions.mjs — the wizard never writes the registry by itself.
 *
 * It also writes paste-ready notes LOCALLY, under generated/<slug>/ (gitignored):
 * the Course360 lesson iframe, the funnel and Zipify notes. They are refused if
 * they would contain a credential. The coach page itself (step Coach page) is built from
 * a form by lib-pages.mjs — before the author exists, from the draft.
 *
 * Plan: ../ghl-shopify subscription/plans/22-pipeline-dashboard.md §14.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DASH } from './lib-paths.mjs';
import { findSecret } from './lib-live.mjs';
import { parseRecordValue, RECORD_FIELDS, zipifyReplacements, slugOf } from '../coach-router/lib-author.mjs';
import { SLUG_RE, slugConventions, ghlNames, projectFromVersion, withAuthor, courseDescription, zipifyPageName, zipifyHandle, zipifyMetaTitle, coachPageName, youtubeEmbed } from '../coach-router/lib-onboard.mjs';
import { bundleTitle, collectionTitle, cleanImagePath } from '../coach-router/lib-shopify.mjs';
import { emailProblems } from '../coach-router/lib-verify-author.mjs';
import { PIPELINE_STEPS, stepById, STEP as S } from '../coach-router/steps.mjs';
import { helpFor } from './lib-help.mjs';
import { coachLessonHtml, courseIdFrom, DEFAULT_COURSE_MASTER_TITLE } from '../coach-router/lib-course360.mjs';

export const DRAFTS_FILE = resolve(DASH, 'drafts.local.json');
export const GENERATED_DIR = resolve(DASH, 'generated');

/**
 * Every input the wizard asks for, at the step that uses it.
 *   where: draft   held in drafts.local.json until GHL + registry creates the author
 *          record  a coaches.json field, saved with `author set` once the author exists
 *          param   an option for that step's command, not stored
 *          shared  coaches.json "shared" (the test inbox)
 *   form: 'page'   asked by the step-3 page form (lib-pages.mjs), not the generic list.
 *                  Before the author exists they live in the draft and onboard carries them over.
 */
export const FIELDS = {
  displayName: { step: S.inputs, where: 'record', required: true, label: 'Author name', help: 'As readers see it, e.g. Jane Smith' },
  name: { step: S.inputs, where: 'draft', label: 'Internal spelling', help: 'Only if it differs from how readers see it — e.g. Micheal. Leave blank otherwise' },
  code: { step: S.inputs, where: 'draft', required: true, label: 'Coach code', help: 'Four digits, the next free number. A caller can key it on a phone' },
  slug: { step: S.inputs, where: 'record', required: true, label: 'Page slug', help: 'Filled in from the author’s name — change it if you like. lowercase-words-with-hyphens; the coach page is book-coach.ai/<slug>' },
  bookTitle: { step: S.inputs, where: 'record', required: true, label: 'Book title', help: 'The real title of the book' },
  coachLabel: { step: S.inputs, where: 'record', required: true, label: 'Coach label', help: 'Filled in as “<Author> – <Book title>” — change it if you like (e.g. Worldview Coach). Used in the Course360 course name and the coach page’s browser tab. (The line under the author’s name on the page is set in the Coach page step — it starts as the book title.)' },
  versionID: { step: S.voiceflow, where: 'record', required: true, label: 'Voiceflow version ID', help: '24 characters from the address bar, with Main selected — never "main"' },
  projectID: { step: S.voiceflow, where: 'draft', label: 'Voiceflow project ID', help: 'Settings → General. Leave blank to work it out from the version ID' },
  price: { step: S.shopify, where: 'param', label: 'Bundle price', help: 'In US dollars. Filled in as 29.95 — change it if this book sells for something else', default: '29.95' },
  sku: { step: S.shopify, where: 'param', label: 'SKU (optional)', help: 'BC + the ISBN, e.g. BC9781951648213' },
  grams: { step: S.shopify, where: 'param', label: 'Weight in grams (optional)', help: 'Blank = a paperback weight (0.95 lb). Shopify needs a weight to sell the bundle outside the US' },
  shopifyProductId: { step: S.shopify, where: 'record', label: 'Shopify product id (only if you made it by hand)', help: 'The number at the end of the product\'s address in Shopify admin' },
  // The optional Course Collection product (2026-10-12).
  collectionPrice: { step: S.collection, where: 'param', label: 'Collection price', help: 'In US dollars. Filled in as 97.00 — change it if this collection sells for something else', default: '97.00' },
  collectionImageFile: { step: S.collection, where: 'param', label: 'Collection image — a file on this computer', placeholder: 'C:\\Users\\…\\collection.jpg', help: 'Shift + right-click the picture → "Copy as path", paste it here. Uploaded full size, as it is' },
  collectionImageUrl: { step: S.collection, where: 'param', label: '…or a link to the image', placeholder: 'https://…', help: 'A direct link to the picture (right-click it → "Copy image address"). Google Drive and Dropbox share links work too. Fill in ONE of the two' },
  collectionProductId: { step: S.collection, where: 'record', label: 'Collection product id (only if you made it by hand)', help: 'The number at the end of the product\'s address in Shopify admin' },
  collectionVariantId: { step: S.collection, where: 'record', label: 'Collection variant id (only if you made it by hand)', help: 'Its cart link is leadershipbooks.com/cart/<this>:1' },
  shopifyVariantId: { step: S.shopify, where: 'record', label: 'Shopify variant id (only if you made it by hand)', help: 'Shown on the product\'s variant — this step\'s live check also prints it' },
  // The image boxes last on the step, just above "Do it" (Muhammad, 2026-10-13).
  imageFile: { step: S.shopify, where: 'param', label: 'Product image — a file on this computer (optional)', placeholder: 'C:\\Users\\…\\cover.jpg', help: 'In File Explorer: Shift + right-click the picture → "Copy as path", paste it here. JPG, PNG, WebP or GIF. Uploaded full size, as it is' },
  imageUrl: { step: S.shopify, where: 'param', label: '…or a link to the image (optional)', placeholder: 'https://…', help: 'A direct link to the picture (right-click it → "Copy image address"). Google Drive and Dropbox share links work too. Fill in ONE of the two' },
  authorPhotoURL: { step: S.coachPage, form: 'page', where: 'record', label: 'Author photo URL', help: 'https:// image shown on the coach page' },
  authorURL: { step: S.coachPage, form: 'page', where: 'record', label: 'Author\'s own page', help: 'https:// — THIS author\'s page, never another author\'s' },
  authorInitials: { step: S.coachPage, form: 'page', where: 'record', label: 'Initials', help: 'Shown when there is no photo. Blank = worked out from the name' },
  books: { step: S.coachPage, form: 'page', where: 'record', type: 'lines', label: 'Book buttons', help: 'One per line: Title|https://link-to-buy' },
  // Step Course360 through the Courses API (plans/03, 2026-10-13).
  // No picture box: GHL shows a course picture only when it is uploaded on the course's own screen (2026-10-13).
  courseLink: { step: S.course360, where: 'param', label: 'Course link — leave empty (only if the preview cannot find the copy)', placeholder: 'https://…/courses/products/…', help: 'It finds the copy you duplicated by itself. Only if the preview asks: open the course in GHL and paste its address here' },
  courseLessonUrl: { step: S.lessonUrl, where: 'record', label: 'Course360 lesson URL', help: 'Saved for you by "Make the course" in the Course360 step. Only for a course made by hand: paste the preview link — the preview part is stripped automatically' },
  videoUrl: { step: S.zipify, where: 'record', label: 'Book video on YouTube (optional)', help: 'Has the book a video? Paste its normal YouTube link and press Save — the code to paste on the sales page appears under "What you need for this step"' },
  bookLandingUrl: { step: S.salesUrl, where: 'record', label: 'Sales page URL', help: 'https://leadershipbooks.com/pages/…' },
  verifyEmail: { step: S.e2e, where: 'shared', label: 'Test inbox', help: 'A real inbox you read — every test sends a real welcome email there. Saved once; change it any time and press Save again' },
  guestEmail: { step: S.e2e, where: 'param', card: 'gift', label: 'Their email', placeholder: 'friend@theirdomain.com', help: 'A real person who should not pay. They get the normal free trial (10 days) and the real welcome email. Their contact is kept; nothing is deleted. This is not a test.' },
  keep: { step: S.e2e, where: 'param', type: 'checkbox', label: 'Keep the test contact for the hands-on check (the next step)', help: 'Unticked: the test cleans itself up after 5 minutes' },
};

export const STEP_FIELDS = {};
// The page form's fields are rendered by the page form, not in the generic list.
for (const [k, f] of Object.entries(FIELDS)) if (!f.form) (STEP_FIELDS[f.step] = STEP_FIELDS[f.step] || []).push(k);

/** The step that creates the author (onboard). Everything before it lives in the draft. */
export const CREATE_STEP = S.ghl;

/** What creating an author (GHL + registry) needs from the draft. */
export const ONBOARD_NEEDS = ['code', 'displayName', 'bookTitle', 'coachLabel', 'slug', 'versionID'];

/** Values the browser may see. A credential is never on this list. */
export const PUBLIC_FIELDS = ['code', 'name', 'displayName', 'bookTitle', 'coachLabel', 'slug', 'aliases', 'projectID', 'versionID',
  'ghlTag', 'ghlProductId', 'ghlPriceId', 'shopifyProductId', 'shopifyVariantId', 'collectionProductId', 'collectionVariantId', 'landingPageUrl', 'courseLessonUrl', 'bookLandingUrl',
  'authorPhotoURL', 'authorURL', 'authorInitials', 'books', 'trialDays', 'videoUrl'];

const TWIML_UNSAFE = /[&<>"']/;

/** The books field as the form sends it: one "Title|url" per line. */
export const booksFromText = (raw) => (Array.isArray(raw) ? raw : String(raw || '').split(/\r?\n/)).map((x) => String(x).trim()).filter(Boolean);

/**
 * Validate one input. Returns [value, problem]. An empty optional input is
 * [undefined, null] — "not given", which is different from "given and wrong".
 */
export function validateField(key, raw, { coaches = [], drafts = {}, code = '' } = {}) {
  const f = FIELDS[key];
  if (!f) return [null, `unknown field "${key}"`];
  const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && !raw.length);
  if (f.type === 'checkbox') return [raw === true || raw === 'true' || raw === 'on', null];
  if (empty) return f.required ? [null, `${f.label} is required`] : [undefined, null];
  const s = typeof raw === 'string' ? raw.trim() : raw;
  switch (key) {
    case 'code': {
      if (!/^\d{4}$/.test(s)) return [null, 'the coach code is four digits — a caller keys it on a phone'];
      const taken = coaches.find((c) => c.code === s);
      if (taken) return [null, `code ${s} is already ${taken.displayName || taken.name}`];
      const was = coaches.find((c) => Array.isArray(c.formerCodes) && c.formerCodes.map(String).includes(s));
      if (was) return [null, `code ${s} used to be ${was.displayName || was.name}'s (now ${was.code}) — old codes still lead to them, so pick another`];
      if (drafts[s] && s !== code) return [null, `code ${s} is already used by another draft`];
      return [s, null];
    }
    case 'name':
      return TWIML_UNSAFE.test(s) ? [null, 'the internal spelling cannot contain & < > " \' (they break the phone line)'] : [s, null];
    case 'slug': {
      if (!SLUG_RE.test(s)) return [null, 'lowercase words joined by hyphens, e.g. jane-smith'];
      const other = coaches.find((c) => slugOf(c) === s && c.code !== code);
      return other ? [null, `slug "${s}" already belongs to ${other.displayName || other.name}`] : [s, null];
    }
    case 'projectID':
      return /^[0-9a-f]{24}$/i.test(s) ? [s.toLowerCase(), null] : [null, 'the project ID is 24 characters (0-9, a-f)'];
    case 'price':
    case 'collectionPrice':
      return /^\d+(\.\d{2})?$/.test(s) ? [s, null] : [null, 'a price like 29.95'];
    case 'sku':
      return /^BC\d{10,13}$/.test(s) ? [s, null] : [null, 'BC followed by the ISBN, e.g. BC9781951648213'];
    case 'grams':
      return Number(s) > 0 ? [String(Number(s)), null] : [null, 'a positive weight in grams'];
    case 'courseLink': {
      if (courseIdFrom(s)) return [courseIdFrom(s), null];
      // The usual slip: the picture pasted into this box (2026-10-13). Say where it goes.
      const picture = /\.(jpe?g|png|webp|gif)["']?\s*$/i.test(s) || /^["']?([a-z]:[\\/]|\\\\)/i.test(s);
      return [null, picture
        ? 'that is a picture, not a course — leave this box empty. The course picture is added in GHL: the course → ⋮ → Edit → its image'
        : 'leave it empty — or the course\'s address in GHL (…/courses/products/…), only if the preview asks for it'];
    }
    case 'imageFile':
    case 'collectionImageFile': {
      // The full check (is it really an image, how big) is the command's, in the preview.
      const p = cleanImagePath(s);
      if (!/^([a-z]:[\\/]|\\\\)/i.test(p)) return [null, 'the full path, e.g. C:\\Users\\you\\Pictures\\cover.jpg'];
      if (!/\.(jpe?g|png|webp|gif)$/i.test(p)) return [null, 'a .jpg, .png, .webp or .gif file'];
      return existsSync(p) ? [p, null] : [null, `no file at ${p}`];
    }
    case 'imageUrl':
    case 'collectionImageUrl':
      return /^https?:\/\/[^\s]+$/i.test(s) ? [s, null] : [null, 'a link starting with https://'];
    case 'fromCode': {
      const src = coaches.find((c) => c.code === s && c.code !== code);
      return src ? [s, null] : [null, 'pick an existing author to clone from'];
    }
    case 'verifyEmail':
    case 'guestEmail': {
      const p = emailProblems(s);
      return p.length ? [null, p.join('; ')] : [s.toLowerCase(), null];
    }
    case 'books':
      return parseRecordValue('books', booksFromText(s));
    default:
      // Every record field is validated by the very rule `author set` applies.
      if (key in RECORD_FIELDS) return parseRecordValue(key, s);
      return [s, null];
  }
}

/** Validate a set of inputs. Returns { values, problems: { key: message } }. */
export function validateFields(values, ctx) {
  const out = {};
  const problems = {};
  for (const [k, raw] of Object.entries(values || {})) {
    const [v, p] = validateField(k, raw, ctx);
    if (p) problems[k] = p;
    else if (v !== undefined) out[k] = v;
  }
  return { values: out, problems };
}

/* ------------------------------------------------------------------ drafts --- */

export function readDrafts({ file = DRAFTS_FILE } = {}) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  } catch {
    return {};
  }
}

function writeDrafts(drafts, file) {
  writeFileSync(file, `${JSON.stringify(drafts, null, 2)}\n`, 'utf8');
}

/**
 * Save draft inputs (every step before GHL + registry creates the author). Only
 * `draft` and `record` fields are kept; every value is validated first and one
 * bad value saves nothing.
 */
export function saveDraft(code, values, { coaches = [], file = DRAFTS_FILE, now = new Date() } = {}) {
  const drafts = readDrafts({ file });
  const [c, codeProblem] = validateField('code', code, { coaches, drafts, code });
  if (codeProblem) return { problems: { code: codeProblem } };
  const allowed = Object.fromEntries(Object.entries(values || {}).filter(([k]) => FIELDS[k] && FIELDS[k].step < CREATE_STEP && FIELDS[k].where !== 'param' && k !== 'code'));
  const { values: clean, problems } = validateFields(allowed, { coaches, drafts, code: c });
  if (Object.keys(problems).length) return { problems };
  const prev = drafts[c] || { createdAt: now.toISOString(), values: {} };
  const merged = { ...prev.values, ...clean };
  // A blank optional field clears it.
  for (const [k, raw] of Object.entries(allowed)) if (!FIELDS[k].required && (raw === '' || raw === null)) delete merged[k];
  // The "coach is built" tick of old drafts is not carried on (2026-10-12: the IDs are the proof).
  const { confirmations, ...rest } = prev;
  drafts[c] = { ...rest, values: merged, updatedAt: now.toISOString() };
  writeDrafts(drafts, file);
  return { draft: drafts[c] };
}

export function deleteDraft(code, { file = DRAFTS_FILE } = {}) {
  const drafts = readDrafts({ file });
  if (!drafts[code]) return false;
  delete drafts[code];
  writeDrafts(drafts, file);
  return true;
}

/** The next free four-digit code after the last real author, skipping any a draft holds. */
export function nextCode(coaches = [], drafts = {}, usedBefore = []) {
  // Codes start at 1001 (renumbered 2026-10-02). A former code is never handed out again — and a
  // number a DELETED author had is never SUGGESTED (typing it by hand is allowed, with a warning; plan 05).
  const former = new Set([...coaches.flatMap((c) => (Array.isArray(c.formerCodes) ? c.formerCodes.map(String) : [])), ...usedBefore.map(String)]);
  let n = Math.max(1000, ...coaches.map((c) => Number(c.code)).filter(Number.isFinite)) + 1;
  while (drafts[String(n)] || former.has(String(n))) n++;
  return String(n);
}

/** Where the wizard words a step differently from the checklist, because it asks in a different place. */
export const WIZARD_NOTES = {
  [S.inputs]: `Who the author is. The photo, the author’s own page and the book buttons are asked at step ${S.coachPage}, in the coach page form.`,
};

/** The default coach label, “<Author> – <Book title>” (an en dash). The form fills it until you type your own. */
export const suggestLabel = (name, book) => {
  const n = String(name || '').trim();
  const b = String(book || '').trim();
  return n && b ? `${n} – ${b}` : '';
};

export const suggestSlug = (name) => String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** What onboarding still needs before GHL + registry can create the author. */
export function onboardMissing(values = {}) {
  return ONBOARD_NEEDS.filter((k) => !values[k]).map((k) => FIELDS[k].label);
}

/* ------------------------------------------------------------- the view --- */

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '').map((k) => [k, o[k]]));

/** Name/label/ids the steps print, from the record (or the draft before the author exists). */
function facts(v, shared) {
  const name = v.displayName || v.name || '<Author>';
  const label = v.coachLabel || v.bookTitle || '<Label>';
  const conv = v.slug ? slugConventions(v.slug) : null;
  const names = ghlNames(name);
  return {
    name, label, conv, names,
    courseName: `BookCoach AI — ${withAuthor(name, label, ' — ')}`,
    courseDescription: courseDescription(name),
    workflowName: `Book Coach — Grant Course (${name})`,
    // What the course's "BookCoach AI" lesson holds — written by `author course360` (step Course360).
    iframe: v.slug ? coachLessonHtml(v.slug) : '',
    cartLink: v.shopifyVariantId ? `https://leadershipbooks.com/cart/${v.shopifyVariantId}:1` : '',
    zipifyName: zipifyPageName(name, v.bookTitle),
    zipifyHandle: zipifyHandle(name, v.bookTitle),
    zipifyMetaTitle: v.bookTitle ? zipifyMetaTitle(v.bookTitle) : '',
    workerUrl: String(shared.workerUrl || '').replace(/\/+$/, ''),
  };
}

/** Things to copy on each step: [{ label, value, copy }]. Nothing secret, ever. */
export function infoFor(stepId, v, shared = {}) {
  const f = facts(v, shared);
  const item = (label, value, copy = true) => (value ? { label, value: String(value), copy } : null);
  const list = {
    [S.voiceflow]: [item('How', 'Build it with the book-coach-ai-builder skill, in Voiceflow — prompts, knowledge base, playbooks. Chat with it: does it answer like the author, about this book?', false),
      v.versionID && !v.projectID ? item('Project ID (worked out from the version)', projectFromVersion(v.versionID)) : null],
    [S.coachPage]: [item('Publish the page at', f.conv && f.conv.pageUrl), item('Name for page (in GHL)', v.displayName || v.name ? coachPageName(f.name) : ''), item('Page path in GHL', v.slug)],
    [S.ghl]: [
      item('GHL tag it will create', f.conv && f.conv.ghlTag),
      item('$59 product it will create', f.names.product),
      item('…and its monthly price', f.names.price),
      item(`Funnel page address (built at step ${S.funnel})`, f.conv && f.conv.landingPageUrl),
    ],
    [S.shopify]: [item('Product title', v.bookTitle ? bundleTitle({ bookTitle: v.bookTitle, displayName: v.displayName, name: v.name }) : ''), item('Shopify product id', v.shopifyProductId), item('Variant id', v.shopifyVariantId)],
    [S.course360]: [item('Duplicate this master course in GHL first', DEFAULT_COURSE_MASTER_TITLE), item('The course will be named', f.courseName), item('…with this description', f.courseDescription),
      item('Its "BookCoach AI" lesson will hold (done for you)', f.iframe), item('Offer', 'one Offer, Free and Published, made for you', false),
      item('The course picture', 'Add it in GHL yourself: Memberships → Courses → this course → ⋮ → Edit → upload the image. (A program cannot set one that shows.)', false)],
    [S.lessonUrl]: [item('Looks like', 'https://login.leadershipbookspublishers.com/courses/products/…', false)],
    [S.zipify]: [item('Add to Cart: in Zipify\'s Product block, choose this product', v.bookTitle ? bundleTitle({ bookTitle: v.bookTitle, displayName: v.displayName, name: v.name }) : ''), item('Page name in Zipify', f.zipifyName),
      item('URL and Handle (Publish Settings — the part after /pages/)', f.zipifyHandle), item('Meta Title (Publish Settings)', f.zipifyMetaTitle),
      item('Book video — paste into a Custom HTML element where the video goes', youtubeEmbed(v.videoUrl))],
    [S.collection]: [item('Product title', v.bookTitle ? collectionTitle(v) : ''), item('Collection product id', v.collectionProductId),
      item('Its Add to Cart link (for the collection button on the sales page)', v.collectionVariantId ? `https://leadershipbooks.com/cart/${v.collectionVariantId}:1` : '')],
    [S.salesUrl]: [item('Its address should be', f.zipifyHandle ? `https://leadershipbooks.com/pages/${f.zipifyHandle}` : '')],
    [S.funnel]: [
      item('Clone a coach-access page to', f.conv && f.conv.landingPageUrl),
      item('Order form product id', v.ghlProductId),
      item('Order form price id', v.ghlPriceId),
      item('Replace the author name with', f.name),
    ],
    [S.grant]: [item('Workflow name', f.workflowName), item('Trigger', `Contact Tag added = ${f.conv ? f.conv.ghlTag : '<tag>'}`), item('Action', `Grant Offer → the "${f.courseName}" Offer → PUBLISH before the first order`, false)],
    [S.goLive]: [item('What it does', 'Pushes coaches.json to the Worker (KV) and its Voiceflow key to the Worker secrets. Refuses on any problem.', false)],
    [S.e2e]: [item('What happens', 'A real $0 Shopify order for this bundle → Flow B → Worker → GHL. Checks both tags and all ten fields, cancels the order. Sends a REAL welcome email to the test inbox.', false)],
    [S.handsOn]: [item('Check by hand', 'The welcome email names the author · the Course360 invite opens the course · the coach answers · "Get my activation code" works', false)],
    [S.cleanUp]: [item('If you kept the test contact', 'Delete it in GHL — left tagged, every cron grants it a lease', false)],
  };
  return (list[stepId] || []).filter(Boolean);
}

/** Files already generated for this author: [{ name, bytes, path }]. */
export function generatedFiles(slug, { dir = GENERATED_DIR } = {}) {
  if (!slug) return [];
  const d = resolve(dir, slug);
  if (!existsSync(d)) return [];
  return readdirSync(d).sort().map((name) => ({ name, bytes: statSync(resolve(d, name)).size, path: resolve(d, name) }));
}

/**
 * Everything the wizard shows for one author (or draft). `coach` is the
 * coaches.json entry when the author exists; `live` is lib-pipeline's view.
 */
export function wizardView({ code, coach = null, draft = null, shared = {}, live = null, coaches = [], generatedDir = GENERATED_DIR }) {
  const exists = !!coach;
  const values = exists ? pick(coach, PUBLIC_FIELDS) : { code, ...((draft && draft.values) || {}) };
  if (exists && draft && draft.values) for (const [k, v] of Object.entries(draft.values)) if (values[k] === undefined) values[k] = v;
  if (shared.verifyEmail) values.verifyEmail = shared.verifyEmail;
  const liveById = Object.fromEntries(((live && live.steps) || []).map((s) => [s.id, s]));
  const steps = PIPELINE_STEPS.map((s) => {
    const fields = (STEP_FIELDS[s.id] || []).map((k) => ({
      key: k, ...FIELDS[k],
      // `default`: what the box starts with when nothing is saved (the bundle price) — still editable.
      value: FIELDS[k].type === 'lines' && Array.isArray(values[k]) ? values[k].map((b) => `${b.title}|${b.url}`).join('\n') : values[k] ?? FIELDS[k].default ?? '',
      // Once the author exists, the code and the internal spelling are fixed.
      readOnly: k === 'code' || (exists && (k === 'name' || k === 'projectID')),
    }));
    const l = liveById[s.id];
    return {
      id: s.id, title: s.title, long: s.long, platform: s.platform, kind: s.kind, needs: s.needs,
      instructions: WIZARD_NOTES[s.id] || (l && l.action && l.action.instructions) || s.instructions || '',
      command: (l && l.action && l.action.command) || '',
      fields,
      info: infoFor(s.id, values, shared),
      actions: STEP_ACTIONS[s.id] || [],
      live: l ? { state: l.state, warn: l.warn, rows: l.rows, unsigned: l.unsigned, signoff: l.signoff, blockers: l.blockers } : null,
      help: (l && l.help) || helpFor(s.id, values, null),
      reminder: STEP_REMINDERS[s.title] ? STEP_REMINDERS[s.title](facts(values, shared)) : '',
      needsAuthor: !exists && s.id > CREATE_STEP,
      key: s.key,
      optional: !!s.optional,
    };
  });
  return {
    code, exists,
    name: values.displayName || values.name || '',
    draft: draft ? { updatedAt: draft.updatedAt } : null,
    values,
    missingForCreate: exists ? [] : onboardMissing(values),
    where: live && live.where,
    steps,
    authors: coaches.filter((c) => c.code !== code).map((c) => ({ code: c.code, name: c.displayName || c.name, hasLanding: !!c.bookLandingUrl })),
    generated: generatedFiles(values.slug, { dir: generatedDir }).map(({ name, bytes }) => ({ name, bytes })),
  };
}

/**
 * A reminder shown right under a step's answers — for what no API can do and no
 * check can see. Keyed by step NAME, so a reorder cannot move it to the wrong step.
 */
export const STEP_REMINDERS = {};

/** Which actions a step offers. Names are lib-actions.mjs ACTIONS keys, or generate:<kind>. */
export const STEP_ACTIONS = {
  [S.inputs]: ['set'],
  [S.voiceflow]: ['set'],
  [S.coachPage]: ['page'], // the coach page form: lib-pages.mjs, POST /api/wizard/page — works on a draft too
  [S.ghl]: ['onboard'],
  [S.shopify]: ['shopify', 'set'],
  [S.course360]: ['course360'], // author course360 — after a Duplicate in GHL (plans/03)
  [S.lessonUrl]: ['set'],
  [S.zipify]: ['set', 'landing:sales'], // Save (the YouTube link) right under its box, then Generate Landing Pages (lib-landing.mjs)
  [S.collection]: ['shopify-collection', 'landing:collection', 'set'],
  [S.salesUrl]: ['set'],
  [S.funnel]: ['generate:funnel'],
  [S.grant]: ['generate:course360'],
  [S.goLive]: ['push'],
  [S.e2e]: ['verify-email', 'verify', 'guest'],
};

/* ------------------------------------------------------------- generators --- */

/** Replace the `const CONFIG = { … };` block of a page source (lib-pages.mjs). Null when there is none. */
export function replaceConfigBlock(source, block) {
  const lines = String(source).split('\n');
  const start = lines.findIndex((l) => /^\s*const CONFIG = \{\s*$/.test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^\s*\};\s*$/.test(l));
  if (end < 0) return null;
  return [...lines.slice(0, start), ...block.split('\n'), ...lines.slice(end + 1)].join('\n');
}

/**
 * Write a generated note, refusing if it would contain a credential. None of
 * these notes ever needs one, and this check proves it.
 */
function writeChecked(dir, name, text, secrets) {
  const leak = findSecret(text, secrets);
  if (leak) throw new Error(`refusing to write ${name}: it would contain a credential`);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, name);
  writeFileSync(path, text, 'utf8');
  return { name, path, bytes: Buffer.byteLength(text) };
}

/**
 * Generate paste-ready files for one step. Returns { files: [...], text } where
 * `text` is the main thing to copy, shown in the wizard.
 *   course360   course name, lesson iframe, Offer, grant workflow
 *   funnel      the $59 funnel clone: address, product and price ids
 *   zipify      the ordered find-and-replace list and the cart link
 */
export function generate(kind, coach, { coaches = [], shared = {}, from = null, secrets = [], dir = GENERATED_DIR } = {}) {
  const slug = slugOf(coach);
  if (!slug) throw new Error('this author has no slug yet');
  const out = resolve(dir, slug);
  const f = facts(coach, shared);
  const stamp = `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} by the BookCoach Author Dashboard for ${coach.code} ${f.name}.`;
  const files = [];
  let text = '';

  if (kind === 'course360') {
    text = [
      `Course name:   ${f.courseName}`,
      `Description:   ${f.courseDescription}`,
      `Made by:       step ${S.course360} — Duplicate "${DEFAULT_COURSE_MASTER_TITLE}" in GHL, then "Make the course"`,
      'Its "BookCoach AI" lesson holds:',
      '',
      f.iframe,
      '',
      'Offer:         one Offer — Free and Published, made by "Make the course"',
      '               (it grants access; money is taken by Shopify and the $59 funnel)',
      '',
      `Grant workflow: ${f.workflowName}`,
      `  Trigger:     Contact Tag added = ${f.conv.ghlTag}`,
      `  Action:      Grant Offer → the "${f.courseName}" Offer`,
      '  PUBLISH it before the first order — the trigger only applies to tags added after publishing.',
      '',
      `The lesson link (step ${S.lessonUrl}) is saved by "Make the course".`,
    ].join('\n');
    files.push(writeChecked(out, 'course360.txt', `${stamp}\n\n${text}\n`, secrets));
  } else if (kind === 'funnel') {
    text = [
      `Clone an existing coach-access page to:  ${f.conv.landingPageUrl}`,
      `Repoint the order form → product ${coach.ghlProductId || `(step ${S.ghl} not done)`}, price ${coach.ghlPriceId || `(step ${S.ghl} not done)`}`,
      `Replace the author's name in the copy with:  ${f.name}`,
      'Publish. Then the Pipeline tab proves the page sells THIS author\'s product and names no other author.',
    ].join('\n');
    files.push(writeChecked(out, 'funnel.txt', `${stamp}\n\n${text}\n`, secrets));
  } else if (kind === 'zipify') {
    const src = coaches.find((c) => c.code === String(from));
    if (!src) throw new Error('pick the author whose Zipify page you are cloning');
    const pairs = zipifyReplacements(src, coach);
    text = [
      `Clone the Zipify page of ${src.displayName || src.name}: ${src.bookLandingUrl || '(that author has no sales page recorded)'}`,
      `Name the new page:  ${f.zipifyName}`,
      `Publish Settings:   URL and Handle  /pages/${f.zipifyHandle}`,
      `                    Meta Title      ${f.zipifyMetaTitle}`,
      '',
      'Find and replace, IN THIS ORDER:',
      ...pairs.map((p, i) => `  ${String(i + 1).padStart(2)}. "${p.find}"  →  "${p.replace}"${p.why ? `   (${p.why})` : ''}`),
      '',
      'Add to Cart: Zipify\'s Product block, set to this author\'s bundle:',
      `  Product: ${coach.bookTitle ? bundleTitle(coach) : '(no book title yet)'}`,
      `  (its plain cart link, if ever needed: ${f.cartLink || `https://leadershipbooks.com/cart/<VARIANT_ID>:1 — step ${S.shopify} not done yet`})`,
      '',
      'Then rewrite the pitch and the About-the-Author section — ~70% of the page is about the book.',
      `Then record the page URL in the wizard (step ${S.salesUrl}).`,
    ].join('\n');
    files.push(writeChecked(out, 'zipify.txt', `${stamp}\n\n${text}\n`, secrets));
  } else {
    throw new Error(`unknown file kind "${kind}"`);
  }
  return { files: files.map(({ name, bytes }) => ({ name, bytes })), text, folder: out };
}

/** The step a wizard should open on: where the author is, or 0 for a draft. */
export const openingStep = (view) => (view.where ? view.where.id : 0);

export { stepById };
