/**
 * lib-sales.mjs — step 8: the book's own sales text for the Zipify page.
 *
 * Every sales page from 1002 on was cloned from one written for a book about
 * publishing, so they all still sell a "Publishing Coach". The dashboard does
 * not write sales copy itself — no AI, no tokens, $0. It builds a PROMPT: this
 * author's book, the master example (templates/sales-page.example.md — the
 * same shape for every page), and the rules. Paste it into Claude Code or any
 * AI; the answer goes straight into Zipify. It is not pasted back: the live
 * page is the record, and step 8's check reads it ("the sales text is this
 * book's own", coach-router/lib-author.mjs).
 *
 * The purchase terms at the end are fixed text, filled in here — an AI is told
 * to copy them word for word, and step 8 shows them to copy as well.
 *
 * Only "About the book" is kept, in sales.local.json (gitignored), so the
 * prompt can be made again without typing it twice.
 *
 * Plan: plans/01-zipify-sales-text.md.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DASH } from './lib-paths.mjs';
import { COACH_PRICE } from '../coach-router/lib-onboard.mjs';

export const EXAMPLE = resolve(DASH, 'templates', 'sales-page.example.md');
export const SALES_FILE = resolve(DASH, 'sales.local.json');
export const ABOUT_MAX = 4000; // characters: under the server's 16 KB request limit even in 3-byte letters

/* ------------------------------------------------------- about the book --- */

const readAll = (file) => {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; } catch { return {}; }
};

export const readSalesAbout = (code, { file = SALES_FILE } = {}) => (readAll(file)[code] || {}).about || '';

/** Save "About the book" for one author. Empty forgets it. */
export function saveSalesAbout(code, about, { file = SALES_FILE, now = new Date() } = {}) {
  const text = cleanAbout(about);
  const all = readAll(file);
  if (text) all[code] = { about: text, updatedAt: now.toISOString() };
  else delete all[code];
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
  return text;
}

export function cleanAbout(about) {
  const text = String(about ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > ABOUT_MAX) throw new Error(`"About the book" is too long — keep it under ${ABOUT_MAX} characters (the back-cover text is plenty)`);
  return text;
}

/* ---------------------------------------------------------- the facts --- */

function factsOf(coach) {
  const name = coach.displayName || coach.name || '';
  const title = String(coach.bookTitle || '').replace(/™$/, '');
  const label = coach.coachLabel || '';
  // A label that only repeats "<Author> – <Book>" says nothing about the coach.
  const coachName = label && !label.includes(title) && label !== name ? label : '';
  return { name, title, coachName, days: Number(coach.trialDays) || 10, monthly: COACH_PRICE.amount };
}

/**
 * The end of the text after Add to Cart: the access and the subscription terms.
 * Fixed wording (from the live pages), only the title and the days filled in.
 * Plain text — it is copied straight into Zipify.
 */
export function salesEnding(coach) {
  const { title, days, monthly } = factsOf(coach);
  if (!title) return '';
  return [
    '_____________________________________________________________________',
    '',
    `Your Book + ${days}-Day BookCoach AI Access`,
    '',
    `Your copy of ${title}™ will be shipped to you immediately after your order is completed.`,
    '',
    `With your book, you’ll receive ${days} days of access to the BookCoach AI, so you can experience the coach for yourself and begin applying what you’re reading.`,
    '',
    `After your included ${days}-day access period, you may continue using the BookCoach AI for $${monthly} per month.`,
    '',
    `Subscription Terms: Your ${days}-day access to the BookCoach AI is included with your purchase. After the ${days}-day period, continued access is $${monthly}/month. The subscription automatically renews monthly until canceled. You may cancel at any time before your next billing date to avoid the next monthly charge. Cancellation stops future charges and does not affect charges already incurred. No long-term commitment is required.`,
    '',
    'The book is yours to keep whether or not you continue with the BookCoach AI.',
  ].join('\n');
}

/* ---------------------------------------------------------- the prompt --- */

export const readExample = ({ file = EXAMPLE } = {}) => readFileSync(file, 'utf8').trim();

/**
 * The whole prompt for one author. `about` is "About the book" — without it the
 * AI is told to ask for it first rather than guess what the book says.
 */
export function salesPrompt(coach, { about = '', example = readExample() } = {}) {
  const { name, title, coachName } = factsOf(coach);
  if (!title) throw new Error('this author has no book title yet (step 0)');
  const aboutText = cleanAbout(about);
  return [
    'You are writing the sales text for a book’s sales page on leadershipbooks.com (a Shopify store, page built in Zipify).',
    'The buyer gets the printed book plus a few days of the "BookCoach AI": an AI coach built on this book, which helps the reader apply the book to their own life and situation.',
    '',
    '=== THE BOOK ===',
    `Title: ${title}`,
    `Author: ${name}`,
    coachName ? `The coach is called: ${coachName}` : null,
    '',
    'About the book:',
    aboutText || '(Not given. Before you write anything, ask me what the book is about and who it is for — then wait for my answer. Do not guess.)',
    '',
    '=== WHAT TO WRITE — three pieces, each under its own label ===',
    '',
    'PIECE 1 — LINE UNDER THE PAGE TITLE',
    'One or two sentences under the product title at the top of the page: a question that speaks to this book’s reader, like "Are you wondering what…?"',
    '',
    'PIECE 2 — "WHAT YOU RECEIVE" (two items, a bold first line and one sentence each):',
    `✓ ${title}™`,
    '  one sentence: what this book gives the reader',
    '✓ Your Personal BookCoach AI',
    '  one sentence: what the coach does with the reader, about this book’s subject',
    '',
    'PIECE 3 — THE LONG TEXT after the Add to Cart button.',
    'Follow the EXAMPLE below closely: the same length, the same kind of sections, the same rhythm of short one-line paragraphs, headings, bold and lists.',
    'But the example is about ANOTHER book — Treasure Hunt, a novel about publishing, with a "Publishing Coach". Every part about publishing, writing a book or authors must become this book’s own subject and this book’s reader.',
    'Keep these ideas, in your own words for this book:',
    '  - "This isn’t a chatbot… It’s a coach." — a chatbot gives you an answer; a coach asks you questions (keep that whole section, adapted).',
    '  - "The Coach Starts With You" — the questions the coach asks the reader first, about their own situation.',
    '  - Several sections on what the coach helps with — the topics of THIS book.',
    `  - "The Book Shows You…, The Coach Helps You…" and a closing section ending with the heading "${title}™ + BookCoach AI" and a three-part tagline like "Read the story. Meet your coach. Publish your book." — for this book.`,
    'Then end Piece 3 with the PURCHASE TERMS below, copied word for word — do not change them.',
    '',
    '=== RULES ===',
    '- Use only what is given above about the book and the author. Do not invent years of experience, numbers of clients or readers, awards, endorsements, quotes, or facts about the author.',
    '- The example’s "20+ Years of Publishing Experience" section is about that book’s publisher. Do NOT copy that claim. Replace the section with one on what the coach is built from: this book and the author’s own message.',
    '- Do not call the book fiction or a story unless "About the book" says so.',
    `- Write the title as ${title}™, in bold the first time, as the example does.`,
    '- Say "BookCoach AI" exactly like that.',
    '- Warm, plain American English. Curly quotes and em dashes, like the example.',
    '- Format: Markdown — ## for headings, ** for bold, - for lists, a blank line between paragraphs. Chat apps show it formatted: select the text and copy it, and the formatting goes with it into Zipify.',
    '- Give only the three pieces, each under its label — no notes before or after.',
    '',
    '=== PURCHASE TERMS — the end of Piece 3, word for word ===',
    salesEnding(coach),
    '',
    '=== THE EXAMPLE (another book — copy its shape, not its subject) ===',
    example,
    '=== END OF THE EXAMPLE ===',
  ].filter((l) => l !== null).join('\n');
}
