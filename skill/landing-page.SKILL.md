---
name: landing-page
description: Use when asked to make (or remake) a Book Coach author's Zipify landing page text — "landing page for 1011", "/landing-page 1011 sales", "the collection text for Reinhard". Writes the author's answers file and builds the copy-paste page with the BookCoach Author Dashboard. Installed by the dashboard's "Landing pages" switch.
---

# Generate a Book Coach landing page

Muhammad pastes these pages into Zipify. The **layout is code** — you only write the **words**, into an
answers file, and the dashboard builds the page. Never hand-write the HTML page itself.

Arguments: `<code> [sales|collection]` (default `sales`). Dashboard folder:
`{{DASHBOARD}}` — run every command from there.

## Rules that always hold

- **Invent nothing.** Every claim comes from the author's Voiceflow coach (its prompt and knowledge base),
  the coaches.json entry, or text Muhammad gives you. No years of experience, awards, numbers, sales
  figures or quotes that are not in those sources. Unsure? Leave it out or ask.
- **Never print or copy a key** (`vfKey`, `apiKey`, anything starting `VF.` or `Bearer`). Read only the
  fields named below. Never edit coaches.json. Never commit.
- **Keep tokens low.** Read one example answers file, not all of them. If something would take many reads
  (a whole book), ask Muhammad for a short blurb instead.
- Explain what you did in **very plain words**, short.

## 1 · Who the author is

```bash
node -e "const c=require('../coach-router/coaches.json').coaches.find(x=>x.code==='<code>');const {displayName,name,bookTitle,coachLabel,slug,projectID,versionID}=c;console.log(JSON.stringify({displayName,name,bookTitle,coachLabel,slug,projectID,versionID},null,2))"
```

## 2a · kind `sales` — the Zipify sales page (3 boxes)

**Read the book's substance** from the Voiceflow coach: the Voiceflow tools (`voiceflow_agent` get with
`includePrompt` for the project id above; `voiceflow_knowledge_base` query for the book's main ideas).
If the Voiceflow tools are not connected or the project cannot be read: use
`generated/Courses collections/<slug>-course.html` if it exists, else **ask Muhammad** for a short blurb
about the book and what the coach helps with. Say which source you used.

**Read one example**: `generated/freddy-davis/landing.json` (the approved pattern). Then write
`generated/<slug>/landing.json` with exactly these fields:

| Field | What | Example (Freddy) |
|---|---|---|
| `author` | the author's name | `Freddy Davis` |
| `book` | the book title with ™ | `The Truth Mirage™` |
| `slogan` | 2 short CAPITALS lines for the main image | `["SEE THROUGH THE MIRAGE.", "KNOW WHAT YOU BELIEVE."]` |
| `description` | one line under the slogan: "Coaching <who> to <outcome>." | `Coaching Christians to understand worldviews…` |
| `strip` | 3 × [VERB, rest] for the strip under the image | `[["UNDERSTAND","your worldview"],…]` |
| `question` | the opening question a reader recognises | `Have you ever wondered why…?` |
| `receive` | [title, text] × 2: the book, then `Your Personal BookCoach AI` | |
| `coach` | the coach's short name, ends in "Coach" | `Worldview Coach` |
| `beside` | finishes "Imagine having <author> sitting beside you …" | `through the toughest questions about faith and culture` |
| `canDo` | 6 short lines, what the coach helps you do | `["Explore the assumptions behind any belief", …]` |
| `long` | piece 3, the long text after Add to Cart, as HTML | see below |
| `imagineAs` | optional: the name readers know, if not `author` | `Dr. Cié Gee` |

`long`: short paragraphs (`<p>`), section headings (`<h2>`), `<strong>`/`<em>` for emphasis — the shape of
Freddy's: the reader's problem → what the book shows → "Your Own BookCoach AI" (a coach asks, a chatbot
answers) → the author's teaching built into the coach → how a conversation starts → "Six Ways Your Coach
Can Help" (bold name + one line each) → honest with you → "The Book Shows You the Map. The Coach Helps You
Walk It." → a closing call → `<h2><book> + BookCoach AI</h2>` and one line. **Stop there**: the line and the
subscription terms are added for you. Allowed tags: p, h2, h3, h4, strong, em, br, ul, ol, li, span.

Then build it:

```bash
npm run pipeline -- landing --code <code>
```

It refuses an incomplete file and says what is missing — fix and re-run. It writes
`generated/<slug>/sales-text-v2.html`. **Only that file** — never a `sales-text.html`.

## 2b · kind `collection` — the course collection text (2 boxes)

Muhammad writes these words. **Ask him to paste** Piece 1 (above "Add to cart") and Piece 2 (below it).
Do not rewrite them; only format. Read one example: `generated/Courses collections/reinhard-klett-course.json`.
Write `generated/Courses collections/<slug>-course.json`:

| Field | What |
|---|---|
| `author`, `book` | as above (book WITHOUT ™ here, as on the existing pages) |
| `price` | the price in his text, e.g. `97.00` |
| `piece1`, `piece2` | his text as HTML: `<h2>` the big headline, `<h3>` section lines ("For a Limited Time…", "Total Value…"), `<h4>` small headings, `<p>` text, `<ul><li>` lists, `<p>&nbsp;</p>` for a blank line, `<p class="lead">` for piece 2's intro lines |

```bash
npm run pipeline -- landing --code <code> --kind collection
```

## 3 · Show it

```bash
start "" "<the file the command printed>"
```

Tell Muhammad, plainly: where the file is, that each box has a **Copy** button (Zipify: click the text box,
Ctrl+A, Ctrl+V), which source you used, and anything you were unsure of.
