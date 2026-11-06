# Step 8 — the book's own sales text for Zipify

## Context
The client wants every Zipify sales page written for that author's book. Today every page from 1002 down
was cloned and still carries the "Publishing Coach" text (checked live on Sue's page): the long text after
**Add to Cart** ("You've thought about writing a book… It's fiction…") and the short parts above it (the
line under the title, the "What You Receive" box: "a fictional journey through the real world of publishing",
"20 years of publishing experience").

User's decisions (2026-10-07): the dashboard never calls AI and costs nothing; step 8 gives a **prompt**
to paste into Claude Code or any AI; the answer goes **straight into Zipify — not pasted back or saved**
(the live page is the record). Both parts (above and after Add to Cart). The user reviews the first
results and asks for changes.

## What step 8 will show (plain words)
1. **About the book (optional)** — one box: paste the back-cover text / what the book is about and who it
   is for. Saved on this PC (`page-settings.local.json`, the same per-author store step 3 uses). Empty is
   fine: the prompt then tells the AI to ask you about the book first.
2. **Copy the prompt** — one button. The prompt holds: author, book title, coach name, what the book is
   about, the user's example text as the exact format to follow (same sections, rhythm, short lines,
   headings, bold), and the rules: rewrite every publishing-specific part for THIS book and THIS coach;
   never invent credentials, numbers, awards or quotes — use only what is given; keep "BookCoach AI" and
   the chatbot-vs-coach idea; write three pieces, labelled: (a) line under the title, (b) the two "What
   You Receive" lines, (c) the long text after Add to Cart — stopping before the purchase terms. It asks
   for formatted output (headings and bold), so selecting the answer and copying keeps the formatting.
3. **Fixed text, no AI** — the "Your Book + 10-Day BookCoach AI Access" block with the Subscription Terms,
   and the price lines under "What You Receive", filled with the book title and trial days
   (`trialDays`, 10). Copy buttons. Legal terms are never rewritten by an AI.

Terminal too: `npm run pipeline -- sales-prompt --author sue` prints the same prompt — so in Claude Code
you can just say "write Sue's sales text" and I use it.

## The live check (so all 7 get fixed and stay fixed)
Step 8 gets a new check, read from the live sales page the dashboard already reads: **"the sales text is
this book's own"** — red when the page still has the publishing-coach text (marker phrases such as
"it isn't another publishing textbook" / "traditional publishing, self-publishing, hybrid publishing"),
green once it's gone. This shows on the Pipeline grid which authors are still to do, with no saving.
(It will turn 1002-1008 red at first — that is the truth today.)

## Files
- `templates/sales-page.example.txt` — **new**, committed: the user's text verbatim, the one master
  format (edit it to change the format for everyone, like the coach-page template).
- `lib-sales.mjs` — **new**: `salesPrompt(coach, about)`, `fixedSalesBlocks(coach)`. Pure, no network.
- `lib-wizard.mjs` — step 8 in `infoFor()` gets the prompt + fixed blocks; the "About the book" answer box
  (saved like step 3's page-only answers via `lib-pages.mjs`'s settings store).
- `web/wizard.js` (+ `web/app.css`) — a long copy value shown in a short scrolling box with its copy
  button (reuses the existing copy in `web/app.js`).
- `pipeline.mjs` — `sales-prompt` subcommand.
- `../coach-router/lib-author.mjs` — the new step-8 check, next to `wrongCartLinks`;
  `lib-help.mjs` — its plain-words "what is wrong / how to fix" (a test requires one for every check).
- Tests: `dashboard.test.mjs`, `../coach-router/verify.test.mjs` — prompt has the author/book and no
  "Publishing Coach" leftovers in the rules, fixed block has the right title and days, the check goes red
  on the old text and green on new text, filed under step NAME "Zipify page".
- `README.md`, plan 22 → new §20.

## After it's built — fixing 1002-1008
Optional, on request: here in Claude Code I write the three pieces for each author (reading the Voiceflow
coach through the Voiceflow connector when it's connected, else asking you about the book), and show each
one in a page you can copy from with the formatting. You paste into Zipify; the check turns green.

## Verification
- `npm test` here and in `../coach-router`.
- Real browser: Onboard → Sue → step 8: type about-the-book, Copy the prompt, paste into Claude → text
  comes back in the right format; fixed blocks show "Let's Raise Media-Savvy Kids" and 10 days.
- Pipeline grid: Refresh → 1002-1008 show the new red step-8 row with the plain fix text.
- Nothing secret in the prompt (the existing response credential check covers it).
