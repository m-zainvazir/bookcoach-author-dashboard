# Plan 07 — who has access: every person, which author, trial or paid, days left

**Created:** 2026-11-05 · **Asked by:** Muhammad · **Status:** ✅ **BUILT 2026-11-05** — tests 609 (offline), one real read on the live data (3 rows: 1 gift, 2 staff, all on 1001; ~2 s), and screenshots of the Access tab and the grid column from a second dashboard on port 5191. See §9. Mock-ups (private): `claude.ai/artifact/GJwPWHv3ep2jJW6LNGQ9Wp`.
**Size:** small-medium. One reader, one endpoint, one view, tests. No writes anywhere.

## 0. Decided (2026-11-05)

| Question | Decision |
|---|---|
| Where | **A + C**: a new **Access** tab (the full list) **and** an "Access" count column in the Pipeline grid ("3 paid · 5 trial ›") that opens a side panel with that author's people |
| Look | **Layout 1 — one flat table**, with the "ending soon" strip (layout 4) on top |
| Columns | **Person · Coach # · Author name · Access · Days left · Since · GHL ↗** — the author is split into two columns, Coach # and Author name |
| Sorting | **Default: Days left, soonest first.** Every column sorts, both ways: click a header for ▲, again for ▼ (a third click goes back to the default). The chosen sort is remembered locally |
| Test and Staff rows | **Shown by default**, with their pills (Test in red). The filter chips can hide them |
| "Ending soon" | **5 days** by default, **changeable**: a small "Ending soon = [5] days" box on the Access tab, saved in the dashboard's local settings, so 3, 7 or anything else is one edit, no code change |
| Rows that never had access | Not in the list (see §2a) |

**Rules checked** (memory + plan 22 §0): $0 · **no Cloudflare load at all** — it reads only GHL (contacts search + subscriptions), never KV, never the Worker · read-only: it changes nothing in GHL, Shopify or Cloudflare · read on demand (a button), never polled · no secret in the browser · state is read from the live systems; the last reading is kept locally only so the page opens fast, with its time shown (like `readings.local.json`).

---

## 1. What the user gets

A list of **every person who can use a coach right now**, one row per *person × author*:

| Column | Example | Where it comes from |
|---|---|---|
| Person | reader@example.com | GHL contact email (name if set) |
| Coach # | 1001 | the coach tag on the contact → `coaches.json` (`ghlTag` → `code`) |
| Author name | Michael Stickler | the same entry's `displayName` |
| Access | **Paid** / **Trial** / **Gift** / **Staff** / **Test** / **Unknown** | §3 |
| Days left | 10 days (ends 15 Nov) | `coach_trial_ends` — trials and gifts only; paid shows "subscription" and sorts after every trial |
| Since | 5 Nov 2026 | `coach_trial_started`, or the contact's date added |
| Open | GHL ↗ | a link to the contact in GHL |

On top: per-author tiles (paid / trial / gift counts), then the **"Ending soon"** strip: trials and gifts ending within the set number of days (default 5, §0), each with a days-left bar.
Filters: author, access type, "ending soon". Search by email. Sort: §0.

**Grid column (option C):** the Pipeline grid gets an "Access" column per author ("3 paid · 5 trial ›", "nobody yet"). Clicking it opens the side panel (the plan 05 panel) with that author's rows, same pills and days left, plus "Open in the Access tab". The column and the tab use the **same one reading**. The grid never reads GHL by itself; it shows the last reading and its time.

## 2. Where the data comes from (all already read by Health today)

| What | Reader (coach-router `lib-readers.mjs`) | Cost |
|---|---|---|
| Who holds which coach tag | `census(coachTags + staffTag)` — one paginated GHL search (100 per page) | ~1 GHL call per 100 people |
| Who pays, for which author | `subscriptions()` — the Worker's own `ghlActiveSubscriptions`, so this list and the 15-minute reconcile can never disagree on "active" | a few GHL calls |
| Trial dates, source, coach | contact custom fields `coach_trial_started`, `coach_trial_ends`, `coach_trial_source`, `coach_code`, `coach_status` (already in the census result) | free — same call |

**The tag is what grants access** (the Worker removes it when a trial ends; the reconcile keeps it for payers). So "has access" = "holds the author's tag". Nothing else is needed for the list itself.

### 2a. People who bought on Shopify (question, 2026-11-05)

**Yes — once their trial has started, they are in the list.** Every Shopify buyer reaches GHL the same way: Shopify Flow → the Worker → the Worker tags the contact and writes the trial fields. The list reads that tag, so it does not matter how the trial started. `coach_trial_source` says which way:

| `coach_trial_source` | How the trial started |
|---|---|
| `shopify_flow_delivered` | the book was delivered (the delivery flow) |
| `shopify_flow_backstop` | **Flow A**, the timer: 21 days after *Order paid*, if nothing else started it |
| `shopify_flow_manual` | **Flow B**: someone tagged the order `delivered-manual` — this includes the step-14 test, "Give free access", **and** a real order tagged by hand |

**Not in the list: a buyer whose trial has not started yet** (paid, book still on its way, Flow A still waiting). They have no tag, so they have no access yet — correct for "who has access". If wanted later: a separate "Waiting to start" section from Shopify's paid bundle orders with no trial yet (the Health check H2 already reads those). Not in this plan unless asked.

### 2b. Shopify orders (for the Gift label only)

`shopifyOrders({ since })` — already in `lib-readers.mjs`, Shopify Admin API (free, no Cloudflare). Read for the last 30 days only (a trial is 10 days; under Shopify's 60-day limit). Used for one thing: telling a **gift** from a real buyer (§3).

## 3. How a row is labelled (the rules)

In this order — the first that matches wins:

1. **Test** — email contains `+verify-` (a step-14 test contact). Shown, flagged red: it should not be there (same as Health H7).
2. **Staff** — holds the staff tag.
3. **Paid** — an active subscription whose product is this author's `ghlProductId`.
4. **Gift** — a trial whose Shopify order (`shopify_order_number` on the contact) was **cancelled**. "Give free access" always cancels its $0 order; a real buyer's order is never cancelled while they keep a trial (Flow A's guard stops a cancelled order). **Not** "source = `shopify_flow_manual`" alone — that source also marks a real order someone tagged `delivered-manual` by hand, which would be mislabelled a gift. If the order cannot be read (older than 30 days, or Shopify down), the row shows **Trial** and the tab says the gift check was skipped.
5. **Trial** — holds the tag, not paying. Days left from `coach_trial_ends`.
6. **Unknown** — holds the tag, not paying, no trial dates. Flagged: access with no reason on record (worth a look).

### Known limit — one set of trial fields per contact
GHL keeps **one** `coach_trial_*` set per contact, not one per author. If a person has trials of **two** authors, the fields describe the latest one (`coach_code` says which).
- For the author that `coach_code` names: exact days left.
- For the other author: shown as **Trial — date on another author** (no number).
The exact per-author date lives only in the Worker's KV (`trial:<contact>:<code>`). Reading it would mean KV calls → **not done** (zero-Cloudflare rule). Today almost nobody has two trials; if that changes, revisit (ask first).

### Days left
`coach_trial_ends` is stored as text ("15 November 2026"); the Worker already parses it (`formatTrialEnd` / the H-checks' month parser) — reuse that, don't write a second parser. Shown as "10 days", "today", "ended — tag not removed yet" (the Worker sweeps hourly; older than a day = flag).

## 4. Where it lives — the options (**chosen: A + C**, §0)

Mock-ups of each are on the options page (artifact link in the chat).

| | Option | Good | Not so good |
|---|---|---|---|
| **A** | **New "Access" tab** in the top bar (Pipeline · Canvas · Health · Onboard · **Access**) | Room for the full table, filters and summary; obvious place to look | One more tab |
| **B** | **Inside the Health tab**, a "Who has access" section under the checks | Health already does this exact read — one button, both results | Health is about *problems*; a 200-row list buries the checks |
| **C** | **A column in the Pipeline grid** ("3 paid · 5 trial") + click → side panel with that author's people | Sits next to each author; reuses plan 05's side panel | Only one author at a time; no "everyone ending this week" view |
| **D** | **On the Onboard author page**, a "People" card | Right where you work on an author | Hidden behind picking an author; same one-author limit as C |

**Recommendation: A, plus C's grid column as a small extra** — the tab for the full list, the column so the numbers are visible at a glance. Both from the same one reading.

## 5. How it looks — the options (**chosen: 1, with 4 on top**, §0)

| | Layout | Best for |
|---|---|---|
| **1** | **One flat table**, person × author, sortable | Finding a person; exporting; "who ends soonest" |
| **2** | **Grouped by author** — a card per author with its people listed inside | "How is Michael's coach doing?" |
| **3** | **Grouped by person** — one row per person, a chip per author they have | People with several coaches |
| **4** | **"Ending soon" strip** on top of 1 or 2 — days-left bars for trials ending in the next 7 days | Daily follow-ups |

**Recommendation: 1 with 4 on top** (table + "ending soon" strip), and summary counts per author as small tiles.

## 6. Build steps (after the picks)

1. `lib-access.mjs` (dashboard) — pure function `accessRows({ census, subscriptions, orders, coaches, staffTag, fieldIds, now })` → rows + per-author summary. All the §3 rules live here. No I/O. Also `sortRows(rows, { column, dir })` with the default (Days left ▲; paid/staff/unknown after every dated row, then by Coach #).
2. Reader: reuse `makeReaders` from coach-router (`census`, `subscriptions`, `shopifyOrders`) — no KV, no Worker call.
3. `server.mjs` — `GET /api/access` (last reading) and `POST /api/access/refresh` (reads live, saves `access.local.json`, gitignored — it holds emails). The "ending soon" days live in the dashboard's local settings (`lib-settings.mjs`), default 5, any whole number 1–30.
4. `web/access.js` + CSS — the Access tab: tiles, ending-soon strip with its days box, filter chips, search, the table with sortable headers (▲/▼ shown on the active column).
5. `web/app.js` — the Pipeline grid's Access column + side panel, from the same reading.
6. Tests (`dashboard.test.mjs`): each §3 rule; gift = cancelled order, a hand-tagged real order stays Trial; two-trial contact; ended-but-tagged; test contact flagged; paid wins over trial; every column sorts both ways and the default is Days left ▲; the ending-soon box accepts 1–30 only; no KV call is ever made (the reader stub throws on `kvGet`); the browser never receives the GHL or Shopify token.
7. A real read on the live data; compare the counts with Health H9 and the GHL tag counts by hand.

## 7. Not in this plan (later, if wanted)

- Actions from the list (extend a trial, remove access, resend the welcome email) — these are writes; separate plan, preview + confirm like everything else.
- Revenue / MRR numbers.
- Exact per-author trial dates for two-trial people (needs KV — ask first).
- CSV export (easy add-on to layout 1).

## 8. Questions

All answered 2026-11-05 (§0). Still open, only if wanted: the "Waiting to start" section for Shopify buyers whose trial has not started (§2a).

## 9. As built (2026-11-05)

| File | What |
|---|---|
| `lib-access.mjs` | new — `accessView` (every §3 rule), `sortRows`, `endingSoon`, `daysLeftOf`, `ghlContactUrl`. Pure, no I/O |
| `lib-live.mjs` | `access({ savedOnly })` — census + subscriptions + 30 days of Shopify orders; kept as the `access` reading in `readings.local.json` (gitignored). No KV |
| `lib-readings.mjs` | `refreshDrops` takes `access`; a health refresh drops the access reading too (same contacts) |
| `lib-settings.mjs` | `accessSoonDays`, default 5, 1-30 |
| `server.mjs` | `GET /api/access` (`?saved=1` never reads live; `?refresh=1` reads again); `/access` page address; `/access.js` |
| `web/access.js` | new — the tab (tiles, ending-soon strip + days box, chips, author select, email search, sortable table) and the grid cell + side panel |
| `web/app.js`, `index.html`, `app.css` | the Access tab, its address, the grid column, "Refresh access" on that tab |

Behaviour: the grid shows the **last** reading (nothing live on page load). The Access tab reads live only the first time (nothing saved) or on "Read again" / "Refresh access". "Refresh…" with the health checks ticked also re-reads access. The sort is remembered in the browser (localStorage); the days box saves to `pipeline.local.json`.
Not done: the person's **name** (the GHL census reader returns email only; adding names means a change in coach-router's `lib-readers.mjs`).
