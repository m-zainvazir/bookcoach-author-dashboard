# Plan 01 — one Voiceflow step, "Generate Landing Pages", and the Course Collection step

**Created:** 2026-10-12 · **Asked by:** Muhammad · **Status:** ✅ **BUILT 2026-10-12** — as built: §8. Not committed.
The three months of the coach are plan 02.

**Rules this is checked against** (plan 22 §0, memory): $0 and no new paid service · no extra Cloudflare load ·
optional extras are switches, OFF by default, and "off" really stops them · no secret ever reaches the browser ·
every real change shows a preview first and asks to confirm · one step list (`coach-router/steps.mjs`).

---

## 1. The three changes, in one table

| # | Change | Where it shows |
|---|---|---|
| A | Steps 1 "Build the Voiceflow coach" and 2 "Read its IDs" become **one step**, with no tick box | step 1 |
| B | In the Zipify step, the "Clone the Zipify page of" picker and "Make the find-and-replace list" button are replaced by **Generate Landing Pages** — with an optional button that starts Claude Code | step 7 (today's 8) |
| C | A new **optional** step, **Course Collection + Bundle Image**: creates a second Shopify product (with its image), can be signed off instead | step 8 |

### The checklist after the change — still 0–16, after launch still 17–25

| New | Step | Today |
|---|---|---|
| 0 | Inputs | 0 |
| **1** | **Voiceflow coach + IDs** (merged, no tick box) | 1 + 2 |
| 2 | Coach page | 3 |
| 3 | GHL + registry (creates the author) | 4 |
| 4 | Shopify bundle | 5 |
| 5 | Course360 | 6 |
| 6 | Lesson URL | 7 |
| 7 | Zipify page — now with **Generate Landing Pages** | 8 |
| **8** | **Course Collection + Bundle Image** (new, optional) | — |
| 9–16 | Sales page URL · Funnel page · Grant workflow · Go live · All checks · End-to-end test · Hands-on · Clean up | 9–16, **unchanged** |

One step is removed and one is added, so only steps 1–8 change their number.

---

## 2. Change A — one Voiceflow step

**What it becomes.** Step 1 "Voiceflow coach + IDs": build the coach in Voiceflow, then paste the **version ID**
(and the project ID, or leave it blank to be worked out). That is the whole step.

**Done when:** the version ID is a real 24-character ID and the key is recorded — the checks today's step 2
already makes. **No tick box:** if the IDs are there, the coach exists.

| File | Change |
|---|---|
| `coach-router/steps.mjs` | The new list; `needs` re-pointed; `RENUMBER_2026_10_12` (old → new) beside the 10-05 map |
| `coach-router/lib-author.mjs` | Drop the "the coach is built" sign-off row; every row's step by the new numbers (rows are filed by step NAME in the tests, so a missed number fails a test) |
| `lib-wizard.mjs`, `web/wizard.js` | The draft's "coach is built" confirmation (`confirm1`) goes; `CREATE_STEP` 4 → 3; fields, actions, reminders move with their step |
| `lib-help.mjs` | One help entry for the merged step; every "go to step N" line re-checked |
| `server.mjs` | The step that turns a draft's confirmation into a sign-off (after `onboard`) is removed |
| `coach-router/onboarding-state.local.json` | **One-time migration, backed up first:** the step-1 sign-off is dropped (all 11 authors have it — it no longer means anything); Course360's sign-off moves 6 → 5; 11 and 15 keep their numbers |
| `checklists.local.json` | Nothing — it is keyed by item, not by step number |
| `readings.local.json` | Nothing — a step-list change already drops every saved reading; the first open re-reads |
| Docs | `further-automation-v1.md` (+ the no-times copy), README, plan 22, `skill/next-step.SKILL.md` |

---

## 3. Change B — "Generate Landing Pages" in the Zipify step

### 3.1 What exists today (found in the two earlier chats)

Two kinds of copy-paste page were made by hand in Claude Code chats, both saved under `generated/`:

| Kind | File | Made from |
|---|---|---|
| **Book Coach AI sales page text** — 3 boxes with Copy buttons: (1) image slogan + description + 3-word strip, (2) top text box, (3) long text after Add to Cart + the fixed terms | `generated/<slug>/sales-text-v2.html` (9 authors) | the author's Voiceflow coach (prompt + knowledge base), strict "invent nothing" rules |
| **Course collection text** — 2 pieces, above and below Add to Cart | `generated/Courses collections/<slug>-course.html` (5 files) | text Muhammad pastes in; Claude only formats it |

Both use Zipify's own look so a paste keeps it: Lato 18px, `#262626`, line-height 1.43, blue `#3d1fe6`.
The scripts that built them (`gen.mjs`, `addimg.mjs`, `v2all.mjs`) live in a temp folder and will be lost.

### 3.2 What is built

**(a) The recipe moves into this folder, so any chat produces the same page.**

- `templates/sales-text.template.html` — the page shell (fonts, Copy buttons), taken from Freddy's approved v2.
- `lib-landing.mjs` — builds `sales-text-v2.html` from a small answers file
  `generated/<slug>/landing.json`: slogan (2 lines), description, 3 strip words, the question, "What You Receive"
  items, the coach's name, the "Imagine having … you can:" lines, the long text. **The layout is code; only the
  words are written by Claude** — that is what keeps every author's page identical in form, and cheap in tokens.
- `npm run pipeline -- landing --author <name>` — builds the page from `landing.json`.
- `skill/landing-page.SKILL.md` — the instructions the earlier chat learned, written down once: where to read the
  book (the Voiceflow connector; project ID from `coaches.json`, never the key), the "invent nothing" rules, the
  three boxes, "only the v2 file", ask Muhammad for a blurb when the coach has too little — then write
  `landing.json` and run the build command.

**(b) The dashboard section** — replaces the clone picker and the find-and-replace button:

| Always there (no AI, no switch) | Only when the switch is ON |
|---|---|
| Whether the page exists, and when it was made | **Generate with Claude Code** — starts Claude Code on this PC for this author |
| **Open the page** (in the browser, to copy from) | |
| **Copy the prompt** — paste it into any Claude Code chat by hand | |
| **Show in folder** | |

**(c) The switch** — `landingPages`, OFF by default, in `pipeline.local.json`, beside Guidance and Alerts.
ON installs the `/landing-page` skill (the same way Guidance installs `/next-step`); OFF deletes it and hides
the button. Two settings ride with it, changeable later: `landingModel` (**sonnet**) and `landingEffort`
(**medium**).

### 3.3 How the button reaches Claude — the answers to the questions asked

| Question | Answer |
|---|---|
| Can it add input to that one existing chat? | It can (`claude --resume <id>`), but it should not: that chat is very long, so every new message pays for its whole history again; it has already been shortened once, so its memory of the format is fading; and if the chat is open in a window at the same time, the two would clash |
| So how does it prompt Claude? | It starts a **new chat** each time, by running the Claude Code program already on this PC (`claude.exe`) with a fixed one-line request: `/landing-page <code>`. The skill file carries everything the old chat knew |
| API keys? | **None.** It uses the Claude Code login already on this PC. No new bill — it uses the normal plan allowance, the same as typing in a chat |
| Same output as before? | Yes in form (the layout is code, §3.2a). The words are written fresh for each author, as before |
| Model | Sonnet 5.5, medium effort — passed as `--model sonnet --effort medium`; both are settings |

**Recommended: the new chat opens in its own window** (not hidden). The earlier chats needed Muhammad more
than once — Rick's coach had no book text, Klett's project could not be read — so a chat he can see and answer
is the honest fit. The alternative (hidden, result shown in the dashboard) is in §6.

**Safety, same as every other button:** the request is fixed text plus the 4-digit code — nothing typed in the
browser becomes part of a command; no shell; the page never receives a credential (the skill reads the project
ID itself and is told never to print a key).

### 3.4 What happens to the find-and-replace list

The button leaves the dashboard. The command stays for the terminal (`npm run author -- zipify --code … --from …`).
"Save to coaches.json" (it saves the YouTube link) and the live checks under "Technical details" **stay** — see §6 Q1.

---

## 4. Change C — step 8, "Course Collection + Bundle Image" (optional)

**What it does.** Creates a second Shopify product for the author, with its image, exactly the way step 4
(Shopify bundle) does it: a file on this PC or a link, uploaded full size, preview first, then "for real".

| Setting | Value |
|---|---|
| Title | `<Book title> - Collection Bundle` |
| Description | none |
| Inventory | **not tracked** |
| Image | the same two boxes as step 4 (file or link); can also be added later to an existing product |
| Status | active, published to the Online Store — so its cart link works |
| Tag / collection | 🚨 **never** `coach-bundles`, and its id is **never** saved as `shopifyProductId` — the Worker starts a trial for an order whose product id equals an author's `shopifyProductId` (`coachesForProductIds`), and the collection is the fallback for the same thing. Kept apart, an order for this product starts nothing (Q7) |
| Price | $97.00 to start, changeable in the step |
| Shipping | none — no shipping address asked (`requiresShipping: false`) |
| Recorded | `collectionProductId`, `collectionVariantId` in `coaches.json` (local only — **not** pushed to the Worker) |

**Shown to copy afterwards:** the product's cart link (`…/cart/<variant>:1`).

**Optional, with a sign-off.**

| State | When |
|---|---|
| Done | the product exists in Shopify (read live), **or** it is signed off ("not needed for this author" / "made by hand") |
| Optional (grey) | neither yet |
| Problem (red) | an id is recorded but Shopify does not know it |
| Note | the product has no image |

🚨 **It never blocks anything:** no step needs it, and "All checks" (13) does not count it. An author with no
collection product still reaches "finished".

**Also (Q6):** the same "Generate Landing Pages" section here for the *collection* text — paste the two
pieces, get `generated/Courses collections/<slug>-course.html`.

| File | Change |
|---|---|
| `coach-router/lib-shopify.mjs` | `createCollectionProduct()` — reuses `stageImage` / `waitForImage`; `collectionTitle()`; refusals |
| `coach-router/author.mjs` | `shopify-collection --code … [--price] [--image-file \| --image-url] [--write]`; `shopify-image --product collection` for a later image |
| `coach-router/lib-author.mjs` | The two record fields; the step-8 rows (exists / image / optional) |
| `coach-router/steps.mjs` | Step 8, `optional: true`, sign-off text |
| `lib-pipeline.mjs` | An optional step with nothing done reads "optional", never "to do"; the gate skips it |
| `lib-actions.mjs` | An eighth allowlisted action, `shopify-collection` |
| `lib-wizard.mjs`, `web/` | The step's boxes, buttons, cart link; the grid and canvas show "optional" in grey |
| `lib-help.mjs` | Plain-words help for the step and each of its checks |

---

## 5. Order of work, and how each part is proven

| # | Part | Proven by |
|---|---|---|
| 1 | Renumber + merge (A) — the step list, rows, wizard, help, migration, docs | both test suites; every row / field / button / help entry still filed under its step's NAME; live status of two authors read under the new numbers; sign-off file backed up, then migrated |
| 2 | Step 8 (C) — command first, then the dashboard | mocked Shopify in tests (untracked inventory, no `coach-bundles` tag, image order); a live **dry run**; the first real product watched |
| 3 | Landing pages (B) — template + builder, skill, section, switch, button | the builder rebuilds Freddy's approved v2 page from a `landing.json` and matches it; switch off = skill file gone and no button; the button tested once for real on one author |
| 4 | Docs + browser check | README, plan 22 note, this file marked as built; every changed screen opened in a real browser |

Nothing is committed or pushed unless asked.

---

## 6. Answers — Muhammad, 2026-10-12

| # | Question | Answer → what is built |
|---|---|---|
| Q1 | Keep "Save to coaches.json" (YouTube link) and the live checks; replace only the clone picker + find-and-replace? | **OK** |
| Q2 | Claude Code button: a window, or hidden? | **A window** you can see and answer |
| Q3 | `<Book> - Collection Bundle` or `- Collection`? | **`<Book title> - Collection Bundle`** |
| Q4 | Price? | **$97.00**, in a box that can be changed |
| Q5 | Physical product? | **No shipping address** — `requiresShipping: false` |
| Q6 | Generate Landing Pages for the collection text at step 8 too? | **Yes** → `generated/Courses collections/<slug>-course.html` |
| Q7 | The "three months of your AI Coach" the collection text promises? | **Add it** — but as its own plan, [`02-collection-three-months.md`](02-collection-three-months.md): it changes what a paying reader gets |


---

## 8. As built — 2026-10-12

**Tests:** coach-router 967 (was 944), dashboard 430 (was 400). `npm run check` clean in both.

### A — one Voiceflow step, and steps by name
- `steps.mjs`: every step has a fixed `key`; `STEP.coachPage` etc. is how code names a step now. `lib-author.mjs`
  files every row under `S.<key>` — a test refuses a bare number. The wizard's maps (fields, buttons, notes, info,
  help) are keyed the same way; help **wording** ("go to step 6") was renumbered once by a script and is guarded by
  the by-name tests. `RENUMBER_2026_10_12` maps old → new.
- The "coach is built" tick box is gone — from the draft, the wizard, the server's onboard hook and the checks.
- **Sign-offs migrated** (`coach-router/migrate-signoffs.mjs --write`, backup `onboarding-state.local.json.bak-20261012T152658`):
  the old step-1 sign-off dropped for all 11 authors; Course360's moved 6 → 5 (1001, 1002, 1004); 11, 14, 15 kept.
  Proven live: Stickler reads exactly as before, at step 14.
- The page template's CONFIG comment names the step ("Onboard -> Coach page") instead of a number.

### C — step 8, Course Collection + Bundle Image (optional)
- `lib-shopify.mjs` `createCollectionProduct` — `"<Book> - Collection Bundle"`, type `Course Collection`, **no tag, not
  in coach-bundles**, $97 unless changed, `inventoryItem { tracked: false, requiresShipping: false }`, no description,
  published, image staged first and awaited last (same rules as the bundle). `author shopify-collection`;
  `author shopify-image --product collection` for a later picture.
- Recorded as `collectionProductId` / `collectionVariantId` — local only (not in `KV_FIELDS`), tested.
- New state **OPTIONAL** (`lib-pipeline`): an optional step never reads "do next", never blocks, and "All checks"
  does not count it; signed off → DONE; a recorded product the store does not have → FAIL. Grid, canvas, wizard and
  terminal show ○.
- Live checks: no product → one MANUAL row (make it, or sign off "none"); recorded → read from the public catalogue,
  WARN if it has no picture, TODO if its variant is not saved.
- Dry run proven live for Reinhard (`Coached by the Bible - Collection Bundle`, $97.00). Not yet created for real.

### B — Generate Landing Pages
- `lib-landing.mjs` + `templates/sales-text.template.html` (cut from Freddy's approved page) +
  `templates/course-collection.template.html` (from Reinhard's). Answers files: `generated/<slug>/landing.json`,
  `generated/Courses collections/<slug>-course.json`. Only safe HTML is accepted in written pieces (no script, link,
  image); plain fields refuse `<` / `>`.
- **Round trip:** all 9 sales pages and 4 of 5 collection pages made by hand were read back into answers files and
  rebuild **byte for byte** (a test re-checks every page on this PC). `truth-mirage-course.html` is the first one,
  older format — left as is.
- `npm run pipeline -- landing --code <n> [--kind collection]` builds from the answers.
- `skill/landing-page.SKILL.md` — what the earlier chats learned, written down: sources (Voiceflow, then the course
  file, then ask), invent nothing, the fields, only the v2 file, keep tokens low.
- Switch **Landing pages** (off by default) installs/removes the skill; `landingModel` (sonnet) and `landingEffort`
  (medium) beside it. The button runs `cmd /c start … claude --model sonnet --effort medium "/landing-page <code> <kind>"`
  in a new window, verbatim arguments, every part checked (4-digit code, allowlisted kind/model/effort, paths without
  quotes) — tested.
- The Zipify step lost the clone picker and "Make the find-and-replace list" (`author zipify` stays in the terminal);
  "Save to coaches.json" (YouTube link) and the live checks stay.

### Also fixed on the way
- **The Shopify commands exited 127 after a successful dry run with an image link** (Node on Windows, "Assertion
  failed: UV_HANDLE_CLOSING" when exiting while a download's connection is closing) — the dashboard would have shown
  a good preview as failed. They now wait a moment before exiting; proven 0 / 1 as expected.
- Canvas: a long step name is cut to fit its box (the tooltip has it whole).

### Not done — Muhammad's
- Switch **Landing pages** on and press **Generate with Claude Code** once, for a real author, and watch it.
- Create a real collection product once (step 8), and check it in Shopify.

### Added the same day — selling abroad ("188 restrictions")
- Shopify's Managed Markets blocked every dashboard-made product in every other country ("Unsupported regions 188 — Certain
  products can't be sold"). **Proven on Reinhard Klett's bundle, one change at a time:** category Educational Services +
  a description → still 188; category Print Books → still 188; **+ a weight (0.95 lb) and country of origin US → 0.**
  The unrestricted products match: REVEALED (ships: Print Books, weight, origin US) and "Coached by the Bible + Your
  Personal AI Coach" (does not ship: Educational Services).
- New bundles (step 4): Print Books, a standard description, the given weight or a paperback's 0.95 lb, origin US.
  New collection products (step 8, no shipping): Educational Services + a standard description (no coach promised).
- Existing products: `npm run author -- shopify-listings [--write]` (in coach-router) — mostly fills only what is
  missing; a product that ships but is filed under a service category is moved to Print Books; flags a $0 price.

### Added the same day — the sales page's Add to Cart is Zipify's Product block
- Muhammad switched the live pages (Freddy, Sue, Rob, Joe, Reinhard) from the plain button to `/cart/<variant>:1` to Zipify's
  own Product block set to the bundle. The check is now **"Add to Cart is this author's product button"**: done = a Product
  block with its own buy button (ADD TO CART / BUY NOW) on this author's bundle; a plain link only = an optional note
  (it still works); nothing for this bundle = wrong. "No Add to Cart points elsewhere" is unchanged, and the author's own
  course-collection product on the same page counts as theirs. The help, the step's "what you need" (the product to pick)
  and the terminal `author zipify` say so. Proven live: those five pages read the new check as done.

### Added 2026-10-13 — Inputs completes by tick or sign-off; Undo sign-off
- **Inputs** (step 0) is complete when the four basics are saved — or, if one is missing (e.g. Rick's coach label), when
  (1) every "where you stand" box is ticked (by the dashboard or by hand), or (2) Muhammad signs it off. The gap stays as a
  note ("done, with a note"). A sign-off is offered only while something is missing. Never asked of an author with all four saved.
  Wiring: `lib-live.mjs` passes `inputsTicked` / `inputsSigned` to the live checks (and into the saved reading's inputs, so a
  tick or sign-off re-reads that author); `lib-author.mjs` step-0 rows; new check "inputs confirmed" (help included).
- **Undo sign-off** button on the Onboard screen (it only existed in the Pipeline drawer, as "Remove sign-off" — renamed).
