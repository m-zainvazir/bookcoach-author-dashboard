/**
 * lib-landing.mjs — "Generate Landing Pages": the copy-paste pages for Zipify.
 *
 * Two kinds, both made the way the earlier Claude Code chats made them by hand
 * (2026-10-07 to 10-12), so every author's page looks the same:
 *
 *   sales        generated/<slug>/sales-text-v2.html — three boxes with Copy buttons:
 *                1 the main image's slogan, 2 the top text box, 3 the long text after
 *                Add to Cart, ending with the fixed subscription terms.
 *                Answers: generated/<slug>/landing.json
 *   collection   generated/Courses collections/<slug>-course.html — two boxes, above and
 *                below the collection's Add to Cart (the course collection, step 8).
 *                Answers: generated/Courses collections/<slug>-course.json
 *
 * THE LAYOUT IS CODE; ONLY THE WORDS ARE WRITTEN. Claude (the /landing-page skill)
 * writes the answers file; this builds the page from templates/*.template.html. So
 * the fonts, the boxes, the Copy buttons and the subscription terms can never drift
 * between authors — and a page can be rebuilt any time from its answers.
 *
 * Plan: plans/01-merge-steps-landing-pages-collection.md §3.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DASH } from './lib-paths.mjs';
import { findSecret } from './lib-live.mjs';
import { MODELS, EFFORTS } from './lib-settings.mjs';

export { MODELS, EFFORTS };

export const GENERATED = resolve(DASH, 'generated');
export const COLLECTIONS_DIR = resolve(GENERATED, 'Courses collections');
export const SALES_TEMPLATE = resolve(DASH, 'templates', 'sales-text.template.html');
export const COLLECTION_TEMPLATE = resolve(DASH, 'templates', 'course-collection.template.html');
export const SKILL_TEMPLATE = resolve(DASH, 'skill', 'landing-page.SKILL.md');
export const KINDS = ['sales', 'collection'];

/** Where each kind's answers and page live for one author. */
export function landingPaths(slug, kind, { generated = GENERATED, collections = COLLECTIONS_DIR } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug || ''))) throw new Error(`not a slug: "${slug}"`);
  if (kind === 'sales') return { dir: resolve(generated, slug), json: resolve(generated, slug, 'landing.json'), html: resolve(generated, slug, 'sales-text-v2.html') };
  if (kind === 'collection') return { dir: collections, json: resolve(collections, `${slug}-course.json`), html: resolve(collections, `${slug}-course.html`) };
  throw new Error(`unknown kind "${kind}" — sales or collection`);
}

/* ------------------------------------------------------------ the words --- */

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * The HTML allowed inside a written piece: what Zipify's text box keeps when
 * pasted. Anything else — a script, an event handler, a link, an image — is refused.
 */
const TAGS = new Set(['p', 'h2', 'h3', 'h4', 'strong', 'em', 'b', 'i', 'u', 'br', 'ul', 'ol', 'li', 'span']);
export function htmlProblems(html) {
  const p = [];
  const s = String(html || '');
  for (const m of s.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (!TAGS.has(tag)) { p.push(`<${tag}> is not allowed (only ${[...TAGS].join(', ')})`); continue; }
    for (const a of m[2].matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) {
      const name = a[1].toLowerCase();
      if (name === 'style' && /^[a-z0-9\s:;#.,%()-]*$/i.test(a[2]) && !/url\s*\(|expression/i.test(a[2])) continue;
      if (name === 'class' && a[2] === 'lead') continue;
      p.push(`attribute ${name}="${a[2].slice(0, 30)}" is not allowed on <${tag}> (only style, and class="lead")`);
    }
    if (/\bon\w+\s*=|javascript:/i.test(m[2])) p.push(`<${tag}> carries a script`);
  }
  if (/<!--|<script|<\/?(iframe|img|a|form|input|style)\b/i.test(s)) p.push('only text, headings, bold/italic and lists are allowed');
  return [...new Set(p)];
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** The sales page's answers: every field present, the right shape, safe HTML. */
export function salesProblems(a) {
  const p = [];
  if (!a || typeof a !== 'object') return ['the answers are not a JSON object'];
  for (const k of ['author', 'book', 'description', 'question', 'coach', 'beside', 'long']) if (!isText(a[k])) p.push(`"${k}" is missing`);
  if (!Array.isArray(a.slogan) || a.slogan.length !== 2 || !a.slogan.every(isText)) p.push('"slogan" must be two lines, e.g. ["SEE THROUGH THE MIRAGE.", "KNOW WHAT YOU BELIEVE."]');
  if (!Array.isArray(a.strip) || a.strip.length !== 3 || !a.strip.every((x) => Array.isArray(x) && x.length === 2 && x.every(isText))) p.push('"strip" must be three [WORD, rest] pairs, e.g. [["UNDERSTAND", "your worldview"], …]');
  if (!Array.isArray(a.receive) || !a.receive.length || !a.receive.every((x) => Array.isArray(x) && x.length === 2 && x.every(isText))) p.push('"receive" must be [title, text] pairs — the book, then "Your Personal BookCoach AI"');
  if (!Array.isArray(a.canDo) || a.canDo.length < 3 || !a.canDo.every(isText)) p.push('"canDo" must be at least three lines (six is the house style)');
  if (isText(a.long)) p.push(...htmlProblems(a.long).map((x) => `"long": ${x}`));
  if (isText(a.long) && /Subscription Terms|_{10,}/.test(a.long)) p.push('"long" must stop before the line and the subscription terms — they are added for you');
  for (const k of ['author', 'book', 'coach', 'question', 'description', 'beside']) if (isText(a[k]) && /[<>]/.test(a[k])) p.push(`"${k}" is plain text — no < or >`);
  return p;
}

/** The collection page's answers. */
export function collectionProblems(a) {
  const p = [];
  if (!a || typeof a !== 'object') return ['the answers are not a JSON object'];
  for (const k of ['author', 'book', 'piece1', 'piece2']) if (!isText(a[k])) p.push(`"${k}" is missing`);
  if (a.price !== undefined && !/^\d+(\.\d{2})?$/.test(String(a.price))) p.push('"price" must look like 97.00');
  for (const k of ['piece1', 'piece2']) if (isText(a[k])) p.push(...htmlProblems(a[k]).map((x) => `"${k}": ${x}`));
  return p;
}

/* ------------------------------------------------------------ the pages --- */

const fill = (tpl, values) => tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => {
  if (!(k in values)) throw new Error(`the template asks for {{${k}}}, which nothing fills`);
  return values[k];
});

/** The sales page, exactly as the approved ones (Freddy Davis's is the pattern). */
export function buildSales(a, { template = readFileSync(SALES_TEMPLATE, 'utf8') } = {}) {
  const problems = salesProblems(a);
  if (problems.length) throw new Error(`the answers are not complete:\n  x ${problems.join('\n  x ')}`);
  const poss = a.authorPossessive || `${a.author}’s`;
  const piece1 = [
    `<p><strong>${esc(a.slogan[0])}</strong></p>`,
    `<p><strong>${esc(a.slogan[1])}</strong></p>`,
    `<p>${esc(a.description)}</p>`,
    `<p>Bottom strip: ${a.strip.map(([w, rest]) => `<strong>${esc(w)}</strong> ${esc(rest)}`).join(' &nbsp;|&nbsp; ')}</p>`,
  ].join('\n');
  const piece2 = [
    `<h3>${esc(a.question)}</h3>`,
    '<h4>What You Receive</h4>',
    `<p>${esc(a.intro || 'Your purchase includes:')}</p>`,
    ...a.receive.map(([t, x]) => `<p><strong>✓ ${esc(t)}</strong><br>${esc(x)}</p>`),
    `<h3 style="margin:26px 0 14px">This Is Not a Chatbot. <span style="color:#3d1fe6">This Is a ${esc(a.coach)}.</span></h3>`,
    `<p>The <strong>${esc(a.coach)} AI</strong> is not a generic chatbot tossing out canned answers. It asks questions, helps you think, and stays faithful to ${esc(poss)} teaching.</p>`,
    '<p>&nbsp;</p>',
    `<p><strong style="color:#3d1fe6">Imagine having ${esc(a.imagineAs || a.author)} sitting beside you ${esc(a.beside)}. With the ${esc(a.coach)} AI, you can:</strong><br>`,
    `${a.canDo.map((x) => `- ${esc(x)}`).join('<br>\n')}</p>`,
  ].join('\n');
  return fill(template, {
    AUTHOR: esc(a.author),
    BOOK: esc(a.book),
    TERMS_BOOK: esc(a.termsBook || a.book),
    PIECE1: piece1,
    PIECE2: piece2,
    PIECE3: String(a.long),
  });
}

/** The collection page (the "Courses collections" pages). */
export function buildCollection(a, { template = readFileSync(COLLECTION_TEMPLATE, 'utf8') } = {}) {
  const problems = collectionProblems(a);
  if (problems.length) throw new Error(`the answers are not complete:\n  x ${problems.join('\n  x ')}`);
  return fill(template, {
    AUTHOR: esc(a.author),
    BOOK: esc(a.book),
    PRICE: esc(a.price || '97.00'),
    PIECE1: String(a.piece1).trim(),
    PIECE2: String(a.piece2).trim(),
  });
}

/* ------------------------------------------- reading an existing page back --- */

const box = (html, id) => {
  const start = html.indexOf(`<div class="box" id="${id}">`);
  if (start < 0) return null;
  const from = start + `<div class="box" id="${id}">`.length;
  return html.slice(from, html.indexOf('</div>', from));
};

/**
 * The answers of a sales page made before this builder existed — so the nine
 * pages made by hand can be edited and rebuilt like any new one.
 */
export function salesFromHtml(html) {
  const s = String(html);
  const p1 = box(s, 'pimg');
  const p2 = box(s, 'p2');
  const p3 = box(s, 'p3');
  if (p1 === null || p2 === null || p3 === null) throw new Error('not a sales-text page (no pimg / p2 / p3 boxes)');
  const author = unesc((/<title>(.*?) — Zipify sales text<\/title>/.exec(s) || [])[1] || '');
  const book = unesc((/<h1 class="page">(.*?) — Zipify sales text<\/h1>/.exec(s) || [])[1] || '');
  const slogan = [...p1.matchAll(/<p><strong>(.*?)<\/strong><\/p>/g)].map((m) => unesc(m[1]));
  const description = unesc((/<\/strong><\/p>\n<p>(.*?)<\/p>\n<p>Bottom strip:/.exec(p1) || [])[1] || '');
  const strip = [...((/<p>Bottom strip: (.*?)<\/p>/.exec(p1) || [])[1] || '').split(' &nbsp;|&nbsp; ')].map((x) => {
    const m = /^<strong>(.*?)<\/strong> (.*)$/.exec(x);
    return m ? [unesc(m[1]), unesc(m[2])] : [x, ''];
  });
  const question = unesc((/^\n?<h3>(.*?)<\/h3>/.exec(p2) || [])[1] || '');
  const intro = unesc((/<h4>What You Receive<\/h4>\n<p>(.*?)<\/p>/.exec(p2) || [])[1] || '');
  const receive = [...p2.matchAll(/<p><strong>✓ (.*?)<\/strong><br>(.*?)<\/p>/g)].map((m) => [unesc(m[1]), unesc(m[2])]);
  const coach = unesc((/This Is a (.*?)\.<\/span><\/h3>/.exec(p2) || [])[1] || '');
  const poss = unesc((/stays faithful to (.*?) teaching\./.exec(p2) || [])[1] || '');
  const im = /Imagine having (.*?) sitting beside you (.*?)\. With the .*? AI, you can:<\/strong><br>\n([\s\S]*?)<\/p>/.exec(p2) || [];
  const canDo = String(im[3] || '').split('<br>\n').map((x) => unesc(x.replace(/^- /, '')));
  const cut = p3.indexOf('\n<p>____');
  const long = (cut >= 0 ? p3.slice(0, cut) : p3).replace(/^\n/, '');
  const termsBook = unesc((/<p>Your copy of (.*?) will be shipped/.exec(p3) || [])[1] || book);
  const out = { author, book, slogan, description, strip, question, receive, coach, beside: unesc(im[2] || ''), canDo, long };
  if (intro && intro !== 'Your purchase includes:') out.intro = intro;
  if (poss && poss !== `${author}’s`) out.authorPossessive = poss;
  if (termsBook !== book) out.termsBook = termsBook;
  // The name readers know, when it is not the registry's ("Dr. Cié Gee", "Joey Pinz").
  if (im[1] && unesc(im[1]) !== author) out.imagineAs = unesc(im[1]);
  return out;
}

/** The answers of a collection page made before this builder existed. */
export function collectionFromHtml(html) {
  const s = String(html);
  const p1 = box(s, 'p1');
  const p2 = box(s, 'p2');
  if (p1 === null || p2 === null) throw new Error('not a collection page (no p1 / p2 boxes)');
  const author = unesc((/<title>(.*?) Course - Zipify text<\/title>/.exec(s) || [])[1] || '');
  const book = unesc(((/<h1 class="page">(.*?) Course - Zipify text<\/h1>/.exec(s) || [])[1] || '').replace(`${author} - `, ''));
  const price = (/The \$(\d+(?:\.\d{2})?) price shown under Piece 1/.exec(s) || [])[1] || '97.00';
  return { author, book, price, piece1: p1.trim(), piece2: p2.trim() };
}

/* --------------------------------------------------------- build on disk --- */

export function readAnswers(slug, kind, opts = {}) {
  const { json } = landingPaths(slug, kind, opts);
  if (!existsSync(json)) return null;
  try {
    return JSON.parse(readFileSync(json, 'utf8'));
  } catch (err) {
    throw new Error(`${json} is not valid JSON: ${err.message}`);
  }
}

/**
 * Build one author's page from its answers file and write it. Refused — nothing
 * written — if the answers are incomplete or the page would carry a credential.
 */
export function writeLanding(slug, kind, { secrets = [], ...opts } = {}) {
  const paths = landingPaths(slug, kind, opts);
  const answers = readAnswers(slug, kind, opts);
  if (!answers) throw new Error(`no answers yet: ${paths.json} — the /landing-page skill writes it (or copy another author's and change the words)`);
  const html = kind === 'sales' ? buildSales(answers, opts) : buildCollection(answers, opts);
  if (findSecret(html, secrets)) throw new Error('refusing to write the page: it would contain a credential');
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.html, html, 'utf8');
  return { file: paths.html, bytes: Buffer.byteLength(html) };
}

/** What exists for one author, for the dashboard: never the content, only names and times. */
export function landingStatus(slug, opts = {}) {
  const out = {};
  for (const kind of KINDS) {
    let paths = null;
    try { paths = landingPaths(slug, kind, opts); } catch { out[kind] = { exists: false, answers: false }; continue; }
    const at = (f) => (existsSync(f) ? statSync(f).mtime.toISOString() : null);
    out[kind] = { exists: existsSync(paths.html), answers: existsSync(paths.json), builtAt: at(paths.html), file: paths.html.split(/[\\/]/).pop(), folder: paths.dir };
  }
  return out;
}

/* ------------------------------------------------------- asking Claude --- */

/**
 * What to ask Claude Code — pasted by hand into any chat, or sent by the
 * "Generate with Claude Code" button. The skill file holds everything the earlier
 * chats learned, so a fresh chat makes the same page.
 */
export function landingPrompt(code, kind = 'sales', { name = '' } = {}) {
  if (!/^\d{4}$/.test(String(code))) throw new Error('a four-digit coach code is required');
  if (!KINDS.includes(kind)) throw new Error(`unknown kind "${kind}"`);
  const what = kind === 'sales' ? 'the Zipify sales page text' : 'the course collection text (I will paste the two pieces)';
  return `Make ${what} for ${code}${name ? ` ${name}` : ''}. Follow D:/Projects/LeadershipBooks/BookCoach Author Dashboard/skill/landing-page.SKILL.md exactly (kind: ${kind}).`;
}


/**
 * The command that opens Claude Code in a new window, already working on it.
 * Only fixed words, a 4-digit code and two allowlisted settings go into it —
 * nothing typed in the browser can become part of a command.
 */
export function claudeLaunch({ code, kind = 'sales', model = 'sonnet', effort = 'medium', claude = 'claude', cwd }) {
  if (!/^\d{4}$/.test(String(code))) throw new Error('a four-digit coach code is required');
  if (!KINDS.includes(kind)) throw new Error(`unknown kind "${kind}"`);
  if (!MODELS.includes(model)) throw new Error(`model must be one of ${MODELS.join(', ')}`);
  if (!EFFORTS.includes(effort)) throw new Error(`effort must be one of ${EFFORTS.join(', ')}`);
  // Paths are quoted by us, so they may hold spaces — but never a quote of their own.
  for (const [label, v] of [['folder', cwd], ['claude', claude]]) if (!v || /["%^&|<>\r\n]/.test(v)) throw new Error(`unsafe ${label} path: ${v}`);
  // cmd's START opens a new console window; its first quoted argument is the window title.
  // The arguments are passed VERBATIM (windowsVerbatimArguments): Node's own quoting
  // (backslash-escaped quotes) is not something cmd understands.
  return {
    command: 'cmd.exe',
    args: ['/c', 'start', `"Landing page ${code}"`, '/D', `"${cwd}"`, `"${claude}"`, '--model', model, '--effort', effort, `"/landing-page ${code} ${kind}"`],
    options: { cwd, windowsVerbatimArguments: true, windowsHide: false, detached: true, stdio: 'ignore', shell: false },
  };
}
