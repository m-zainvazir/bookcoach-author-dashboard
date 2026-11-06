# BookCoach Author Dashboard

Where every Book Coach author is in onboarding, what is left, and whether anything live has quietly
broken — plus an **Add author** wizard that walks the checklist one step at a time. Runs on this
computer only, costs nothing, and adds no load on Cloudflare.

```bash
npm run dashboard        # http://127.0.0.1:5178 — Pipeline, Canvas, Health, Onboard
npm run pipeline         # the same grid in the terminal
npm test                 # 437 tests, no network
```

From `coach-router/`, `npm run dashboard` and `npm run pipeline` still work — they start this folder.

You never need an author's code: `npm run pipeline -- status --code freddy` works, and so does the slug or the full name.

Every view has its own address — bookmark it, and Back / Forward work: `/pipeline`, `/canvas`, `/health`,
`/onboard`, `/onboard/1002-freddy-davis` (that author, at the step they are on), `/onboard/1002-freddy-davis/6`.
`/onboard/freddy` works too — the name or slug finds the author.

**It opens on the last reading.** Reading the live systems takes a few seconds per author (about 40 s
for seven), so each author's last reading is kept in `readings.local.json` and the dashboard opens on
it at once — the time is under each name. **Refresh…** asks what to read again: everything, or the
authors you tick (each shows how long it took last time), and the health checks if ticked. In the
Onboard tab the button is **Refresh this author** — it reads only the author open there.
An author is read again by itself, without a Refresh, when its own inputs change: its `coaches.json`
entry, its sign-offs, its last end-to-end test. After an update of the dashboard's checks, older
readings are still shown, with a note and a button to refresh them; a change to the step list drops them.

## What it is made of

| Here | In `../coach-router` (unchanged home) |
|---|---|
| the dashboard server, the web UI, the CLI | `coaches.json` — the one registry |
| the health checks, the switches, the wizard | `steps.mjs` — the one step list |
| `drafts.local.json` — authors not created yet | the live checks (`lib-author.mjs`), the readers |
| `generated/<slug>/` — paste-ready notes, the sales page text and its answers (`landing.json`) | every command that writes: onboard, author, seed, secrets, verify-author |
| `templates/coach-page.template.html` — the coach page, the same for every author | |
| `templates/sales-text.template.html`, `course-collection.template.html` — the landing pages' layout | |
| `skill/landing-page.SKILL.md` — how Claude Code writes a landing page's words | |
| `page-settings.local.json` — page-only answers (tab title, courses, connection) | |
| `readings.local.json` — each author's last reading, so the dashboard opens at once | |

The dashboard never keeps a second copy of anything in `coach-router`. It reads the registry and
runs the existing commands.

## The Add-author wizard

**+ Add author** → pick the coach code → the checklist, one step per screen, **Previous / Next**:

- **Steps 0-2** are a draft, saved on this computer. Nothing is created in GHL yet.
- **Step 1 is the Voiceflow coach and its IDs** — save the version ID and it is done. No tick box.
- **Step 2 is the coach page — first**, a form: the page's answers in, the whole page out (see
  below). It works before the author exists; its details wait in the draft.
- **Step 3** runs `onboard.mjs`: the GHL tag, the $59 product and price, and the `coaches.json`
  entry — then saves the step-2 page details into it. After that, answers are saved straight to
  `coaches.json` (`author set`, backed up first).
- **Step 5, Course360, is made through HighLevel's Courses API** (since 2026-10-13, plan 03): you click
  **Duplicate** on the master course in GHL (Freddy Davis' — the 7 intro videos can only be copied there), then
  **Make the course** finds the copy and gives it this author's name and description, this
  author's coach in its "BookCoach AI" lesson, and a Free Offer that is already **Published** — and saves the
  course, the Offer and the lesson link (so step 6 fills itself). Its checks read all of that live; no sign-off.
  By hand in GHL: check the intro videos play, and add the course picture on the course's own screen (⋮ → Edit) —
  GHL shows only a picture uploaded there, so the dashboard sets none; a check says whether it shows.
- **Steps 10, 11** show paste-ready notes (and can save them under `generated/<slug>/`): the funnel and the
  grant workflow.
- **Step 7 (Zipify) and step 8 have Generate Landing Pages** — see below.
- **Steps 4, 12, 14** create the Shopify bundle, go live, and run the real $0-order test. Step 4 can
  also upload the product's image — a file on this computer or a link — full size, as it is; for a
  product that already exists, "Add the image to the product" adds only the picture.
- **Step 8, Course Collection + Bundle Image, is optional**: it creates "<Book title> - Collection
  Bundle" ($97 to start, no inventory tracked, no shipping address; category + standard description, so it sells abroad) with its image —
  or you sign it off. It never blocks anything, and buying it does not give the coach yet (plan 02).

The order was changed on 2026-10-05 (the coach page moved up) and again on 2026-10-12: the two
Voiceflow steps became one, and the optional step 8 came in after Zipify — still 0-16, after launch
17-25. Code names steps by key (`STEP.coachPage` in `steps.mjs`), never by number, so the next
reorder moves everything at once.

## Generate Landing Pages — steps 7 and 8

The Zipify sales page text (3 boxes) and the course collection text (2 boxes), as copy-paste pages with
Copy buttons. **The layout is code; only the words are written**: Claude Code writes an answers file
(`generated/<slug>/landing.json`, or `generated/Courses collections/<slug>-course.json`), and
`npm run pipeline -- landing --code <n> [--kind collection]` builds the page from the templates — the
subscription terms included. Every page made by hand before this was read back into its answers file
and rebuilds byte for byte.

- **Copy the prompt** — paste it into any Claude Code chat. Always there.
- **Generate with Claude Code** — only with the **Landing pages** switch on: opens a new Claude Code
  window (your login — no API key, no new bill) running `/landing-page <code>`, on the model and effort
  set beside the switch (Sonnet, medium). Answer it there if it asks — e.g. for the collection text.
- **Open the page**, **Rebuild from its answers**, **Show in folder**.

**What you type stays in its box** — through a Preview, a Refresh, or moving to another step or author
(in that browser tab). Anything typed but not saved or used for real yet is marked ✎: under the box (what makes
it count — "Save to coaches.json", or the button's "— for real"), in a yellow line above the boxes, and beside the
step in the step list. A Preview never uses it for real; a real run or a save clears the mark.

Every real change shows a **Preview (dry run)** first, then asks you to confirm. Only ten commands
can run at all (`lib-actions.mjs`), never through a shell, one at a time, and any credential in
their output is blanked out before you see it.

## Step 2 — the coach page, from a form

Every coach page is the same code; only its `CONFIG` block differs. That code lives once, in
`templates/coach-page.template.html` (committed, no key, no author). At **Onboard → step 2** you
check a short form — the line under the author's name (above "Coach online"; it starts as the book
title), photo, initials, the author's own website, book buttons, and optionally a tab
title, course buttons, four on/off toggles for the page's buttons ("Get my activation code", "Buy the
Book", "Buy the Course", "Meet the Author" — the `showActivation`, `showBooks`, `showCourses` and
`showMeetAuthor` lines), how the page connects, and whether the Voiceflow key goes in as a backup —
and press **Save and build the page**:

- answers that belong in `coaches.json` are saved there with `author set` (backed up, validated) —
  or, before step 3 has created the author, kept in the draft until step 3 saves them;
- the whole page is written to `../All Coaches/<code>-<Author-Name>` (for example `1001-Michael-Stickler`) —
  an author who already has a page keeps it, and the version it replaces is kept as
  `<code>-<Author-Name>.bak-<date>`. These files can hold the key, so they are gitignored;
- **Copy the whole page** puts it on the clipboard (done on this PC — the page never travels to the
  browser), then in GHL: the page's Custom Code element → Ctrl+A, Ctrl+V → Save → Publish.

From the terminal: `npm run pipeline -- page --author rick --copy` rebuilds from the saved answers.
If the page's code itself ever changes, make the finished page the new master for everyone with
`npm run pipeline -- page-template --from "../All Coaches/<code>-<Author-Name>"` (refused if it
would leave a key or an author's name outside `CONFIG`), then build each author's page again.

## Edit a number, delete an author (plan 05)

The **⋯** button on each Pipeline row:

- **Edit number…** — a new four-digit number everywhere: `coaches.json` (the old number is kept as a former number, so live coach pages and links keep working), the Worker's KV entry and secret, and this dashboard's own files. A list shows what will change; **Preview (dry run)** first, then confirm. Then **Update subscribers now**, and rebuild the coach page (you paste it into GHL once). A number a *deleted* author had is allowed, with a warning and a second tick.
- **Edit details…** — opens the forms that already save straight to `coaches.json`: name, book title and label (Onboard, first step) or the coach page.
- **Delete author…** — removes the author from `coaches.json` (backed up, undo for 30 days), the Worker and this dashboard. **GHL, Shopify, Zipify and Voiceflow are left alone.** The author stays in the grid as a **grey row** with a clean-up list: what is still there, how to remove each, **Check again** (reads GHL and Shopify only when you press it). What the dashboard can see turns *gone* by itself; the rest you sign off. When everything is gone or signed, the row leaves. Paying subscribers are only warned about, never blocked.

Commands (in `coach-router/`): `node delete-author.mjs --code N [--write]`, `--undo`, and `node renumber-coaches.mjs --map old=new`. Plan: `plans/05-edit-delete-authors.md`.

## Prototype coaches (plan 06)

Onboard → **Add a new author** → **What are you making?**

- **Final BookCoachAI** — as always: a coach code, steps 0-25.
- **Prototype Coach** — a quick demo coach. **No coach code, no GHL, Shopify, Cloudflare or Twilio.** One page asks the author name, book title, the Voiceflow version ID and the coach page details; **Build the page**, then **Copy the whole page** and paste it into a GHL Custom Code element. The page talks straight to Voiceflow (the key from `coaches.json` is inside it, readable in the page source) and the page has none of the coach-router, GHL-lesson or phone-activation code. The three buttons start unticked, and website / book / course buttons / tab title are in a closed "More page options" dropdown.

The dropdown remembers your last choice in this browser. A **Prototype coaches** list under the form has **Edit again**, **Copy the page**, **Show in folder** and **Remove** (off the list only). **Everything a prototype creates lives in `All Coaches (Demo)`**: the page `<Author-Name>-demo`, the `.bak-<date>` copy a rebuild replaces, and `_prototypes.json` (the saved answers, no key). The folder is gitignored. Plan: `plans/06-prototype-coach-pages.md`.

## The switches — all off by default

| Switch | On | Off |
|---|---|---|
| Guidance | installs the `/next-step` Claude Code skill | deletes it |
| Local alerts | a Windows task checks health hourly and notifies you only when something breaks or recovers | deletes the task |
| Uptime alerts | an external monitor watches `/health` while the PC is off | paused — or "manual" with no provider set |
| Landing pages | installs the `/landing-page` skill and shows "Generate with Claude Code" (model + effort beside it) | deletes the skill, hides the button — "Copy the prompt" still works |

Plan and decisions: `../ghl-shopify subscription/plans/22-pipeline-dashboard.md`; this folder's own plans in `plans/`
(01: one Voiceflow step, Generate Landing Pages, the course collection; 02: what the collection would need to give the coach; 03: Course360 through the Courses API).
