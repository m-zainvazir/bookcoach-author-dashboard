# Plan 02 — the Collection Bundle gives three months of the coach

**Created:** 2026-10-12 · **Asked by:** Muhammad · **Status:** 📋 FOR LATER — not started. Plan 01 (step 8) creates
the product first; this makes buying it give coach access.

**Size: medium.** About one working session of code and tests; about an hour of Muhammad's time in GHL (one
workflow, three emails, drafted for him); one real $0 test order; one Worker deploy (§5).

---

## 1. What happens today, if a collection order is tagged `delivered-manual`: **nothing**

| Link in the chain | What it does with a collection order |
|---|---|
| Flow B (`delivered-manual` → Run workflow) | Fires and forwards the order to the Worker (plan 20 §4.3: every order goes, the registry decides) |
| Worker `POST /shopify/order` | Looks for an author whose **`shopifyProductId`** is in the order (`coachesForProductIds`). The collection product is nobody's → `matched: 0`, "no coach product", **nothing granted** |
| Flow A (21-day timer) | The same: forwards, matched 0 |

So the product is safe to sell before this plan is built. It just gives no coach access.

## 2. Why "match it like the bundle" would be wrong

The bundle's path is the **10-day trial**: the Worker adds the coach tag **and `TRIAL_STARTED_TAG`**, which starts
GHL's `Book Coach — Delivery → Trial Start` workflow: the $59 offer email on day 7, a reminder on day 9, and on
day 10 the tag is removed and `coach_status` set to `expired`. Three paid months would end after ten days, with
sales emails about something the reader already bought.

## 3. Decided — Muhammad, 2026-10-12

| # | Question | Answer |
|---|---|---|
| a | When do the 3 months start? | **When the order is tagged `delivered-manual`** (and Run workflow — Flow B, as for the bundle). Not sure yet about anything automatic |
| b | What happens when they end? | **An email offering the $59 monthly plan** |
| c | Someone who already pays $59 a month buys the collection? | **Later** — §6 |

⚠ **One thing to know about (a):** for the bundle, if nobody tags the order, Flow A starts the trial by itself
after 21 days. The Worker can tell the two apart (each Flow sends its own `source`), so for the collection either
works. **Default: tag only** — exactly what was asked; a forgotten tag means no access until someone tags it.
Turning the day-21 backstop on later is one setting.

## 4. The design

| Piece | Change |
|---|---|
| `coaches.json` → KV | `collectionProductId` pushed with the author (plan 01 keeps it local until this plan) |
| Worker — matching | `coachesForProductIds` also matches `collectionProductId`, marked as a **collection** match; a manual-tag order only (§3a) |
| Worker — the grant | The same contact upsert, the coach tag (so the Course360 grant workflow gives the course, as today), and **`coach-collection-started`** instead of `TRIAL_STARTED_TAG`. Access for **90 days** (`collectionDays`, default 90) |
| Worker — the record | Kept in the **existing** `trial:<contact>:<code>` record with `kind: "collection"` and its own end date, so the cron's existing sweep ends it. 🚨 A new key prefix would cost another KV list every 15 minutes (~96 a day of the 1,000 free) — not allowed |
| Worker — overlaps | Already on a trial for that coach → the end date becomes 90 days from now (never shorter), and the trial's day-7/9/10 emails must stop: `coach_status` moves off `trial`, which the trial workflow's three gates check, so they end quietly. Already holding the tag with no record → treated like §6 |
| GHL | A new workflow, **`Book Coach — Collection (3 months)`**, triggered by `coach-collection-started`: a welcome email now; the $59 offer about a week before the end; on day 90 tag removed, `expired`, and the "your 3 months are over — keep your coach for $59 a month" email. **Built by hand** (GHL has no API for workflows); the three email texts drafted here |
| Health | H4 reads the collection end date like a trial's; H5 counts a collection grant as a known reason; H6 accepts the new status |
| Dashboard | Step 8 says "gives 3 months of the coach — tag the order `delivered-manual`, then Run workflow"; the after-launch rows show collection grants |
| Tests | the order → 90 days, never the trial path; Flow A's backstop ignored for collection (§3a); bundle + collection in one order → one grant, 90 days; the expiry; no new KV prefix |

## 5. How much work — honestly

| Part | Who | Size |
|---|---|---|
| Worker matching, grant, overlaps, sweep | Claude | **The main piece** — most of the session; careful, because it is the paying-customer path |
| Seed / registry / health checks / dashboard text | Claude | small |
| Tests | Claude | medium — every case in §4's last row |
| GHL workflow + 3 emails | Muhammad (texts drafted) | about an hour, by hand |
| Deploy the Worker | Muhammad says go | minutes; rolled back the same way if needed |
| One real $0 collection order, tagged, Run workflow | together | ~15 minutes, then watch day-0 email + tag + course |

**Not big, but not small either.** The risk is not the amount of code — it is that a mistake here shows to a
paying reader. That is why it ends with a real order, as every author does (step 14).

## 6. Later — someone who already pays $59 a month (decision c)

| Option | Size |
|---|---|
| **Nothing changes** — they keep their subscription, the purchase only adds the book and course | **small** — one rule and a test |
| **Three months free** — pause or move their next $59 charge | **big** — it means changing a GHL subscription's billing through its API, which nothing in this project does yet; needs its own research and test |

Until decided, the safe default when §4 is built: **nothing changes** for an active subscriber (the grant is
skipped, logged, and shown on the Health tab so a person can decide).
