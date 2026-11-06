# Plan 05 — edit an author's number and details, and delete an author, from the dashboard

**Created:** 2026-11-02 · **Asked by:** Muhammad · **Status:** 🔧 BUILT 2026-11-02, **not yet run for real** — code, tests (526, offline) and a smoke test against the real dashboard (read-only endpoints, dry runs, refusals) are done. Still to do: §6 step 6, the real runs on a **throw-away author**. See §10.
**Size:** medium-large. Two sessions of code + tests; one Worker-side check; one real renumber and one real delete on a throw-away author before any real one.
**Chosen from mock-ups:** edit = **Option A** (⋯ menu on each grid row + side panel); after a delete = **Option Q** (grey rows stay in the grid until the manual clean-up is finished).
Mock-ups (private): edit options `claude.ai/artifact/LeuzPmUtnfGVgfXE7rhcjj`, after-delete options `claude.ai/artifact/Dv4L8s6dCAvEsLEwuhcutw`.

**Rules checked** (memory + plan 22 §0): $0 · **no extra Cloudflare load** (the dashboard never polls; Cloudflare is touched only by the one-off number change or delete, with a handful of KV writes) · nothing optional is on by default · no secret in the browser · **every write shows a Preview (dry run), then asks you to confirm** · only commands in `lib-actions.mjs` can run, never through a shell · state is read from the live systems, never remembered (plan 22 rule 3).

---

## 1. What the user gets

A **⋯** button at the end of each row in the Pipeline grid:

| Menu item | What it opens |
|---|---|
| Open in Onboard | as today |
| **Edit number…** | side panel: the new number, a live "what will change" list, **Apply to all systems** |
| **Edit details…** | side panel with the Onboard step 2 form (name, book title, coach label, line under the name, photo, links, the four button toggles). Saves with `author set`; rebuilds the coach page if a page field changed |
| **Delete author…** | side panel: what is removed, how many paying subscribers it affects, leave-or-archive choices, type the number to confirm |

### Edit number vs Edit details — why two items

| | Edit number | Edit details |
|---|---|---|
| Changes | the four-digit number only | everything else about the author |
| Reaches | registry, Worker, secret, subscribers, dashboard files, coach page | `coaches.json` (+ coach page rebuild) |
| Risk | high → dry-run impact list, typed confirm | low → saves with a backup, like step 2 today |
| Exists today | partly (`renumber-coaches.mjs`) | yes (`author set`, step 2 form) |

## 2. Edit number — what runs, in this order

The old number is **never dropped**: it is kept in `formerCodes` and the Worker already finds a coach by either (since 2026-10-02). That is what makes it safe for coach pages, SMS sessions, trial records and tokens already out there.

| # | Where | What | How |
|---|---|---|---|
| 1 | `coaches.json` | `code` → new; old into `formerCodes` | `renumber-coaches.mjs --map old=new --write` (backed up, seed-validated, restored on refusal) |
| 2 | dashboard files | sign-offs and test results move (`onboarding-state.local.json`); the same for any dashboard file keyed by code (see §6 step 1) | same script, extended |
| 3 | Cloudflare Worker | `coach:<new>` in KV, secret `VF_KEY_<new>` | `npm run push` (secrets first, then seed) |
| 4 | Cloudflare Worker | old `coach:<old>` entry removed, only once `coach:<new>` is live | `renumber-coaches.mjs --prune-kv --write` |
| 5 | subscribers | leases and entitlement map rewritten with the new number now, not in 15 minutes | `npm run subs:sync` |
| 6 | GHL contacts | the `coach_code` field is rewritten by the Worker's own subscriber sync — **no separate step** | automatic, at the next sync |
| 7 | coach page | rebuilt with the new number into `../All Coaches/` (old file kept as `.bak`) | `page --code <new>`; **you paste it into GHL** (the old page keeps working meanwhile) |

Rules the panel enforces before Apply: four digits; not a current number; **not a former number** of a live author (it would hijack their old links). A number that belonged to a **deleted** author is allowed, with the warning in §3 shown before you confirm. One author at a time; swaps need two rounds (v1).
Failure in the middle: steps 1–2 are all-or-nothing (backup restored). If a later step fails the panel says which and offers **Retry from here**; nothing is half-hidden, because every step re-reads the live state.

## 3. Delete author — what runs

**Removed by the dashboard (automatic):**

| Where | What |
|---|---|
| `coaches.json` | the entry (backup `coaches.json.bak-<stamp>-delete-<code>`) |
| Cloudflare Worker | KV `coach:<code>` deleted, secret `VF_KEY_<code>` deleted |
| dashboard | grid row, saved reading, drafts, page settings, sign-offs (moved into the delete record, §4) |
| subscribers | next sync stops offering this coach; **the panel shows the count first** and warns if > 0 |

**Reusing a deleted number (decided 2026-11-02: allowed, with a warning).** A deleted number goes on a "used before" list. Giving it to a new author, or renaming an author to it, is **not blocked**, but the panel shows a warning first and needs a second tick: *"1004 belonged to Test Author (deleted 2 days ago). Old sessions, trial records and contacts may still carry 1004 and could show the new coach to the wrong people. Continue?"* The warning also says whether that author's clean-up is still open, and how many contacts the last check saw holding the old tag.

**Not deleted by the dashboard — listed as a leftover** (the leave-or-archive choice per item is recorded; the dashboard has no safe API for the destructive ones):

| Leftover | Checked live by | How it is removed (shown in the panel) |
|---|---|---|
| Shopify bundle product | product id still resolves | Shopify admin → Products → search → Archive/Delete |
| Shopify collection bundle (step 8, if made) | product id still resolves | same |
| GHL coach tag | tag name still in the location's tags; shows how many contacts hold it | GHL → Settings → Tags → delete |
| GHL grant workflow (older authors) | workflow with the author's name still listed | GHL → Automation → Workflows → delete |
| Course360 course + Free Offer | course id still resolves (Courses API) | GHL → Memberships → Courses → ⋯ → Delete |
| Coach page in GHL | **cannot be checked** → sign-off | GHL → Sites → delete or unpublish |
| Zipify sales + collection pages | **cannot be checked** → sign-off | Shopify admin → Zipify Pages → delete |
| Voiceflow coach project | **cannot be checked** → sign-off (optional: keep for records) | Voiceflow → project → archive |

## 4. After the delete — Option Q

The author stays in the grid as a **grey row** (`deleted · clean-up open`, pill `2 of 5 left`), below the live authors. Clicking it opens the side panel with the leftover list, each with **How?** (the exact clicks) and a state:

- **still there** — a live check found it · **gone ✓** — a live check found it removed (turns on its own at the next check) · **signed off** — you confirmed it by hand (only for the "cannot be checked" items; a check never overrides a sign-off the other way: a thing that comes back is shown **still there** again, plan 22's FAIL-beats-sign-off rule).
- **Check again** (per author, and "Check all" above the grid) reads only the listed items — nothing runs by itself, so no load. The grey row also refreshes whenever the grid does.
- When every item is gone or signed off, the row leaves the grid and a line "Finished: Test Author 1004" stays under it for 30 days.
- Where it lives: new gitignored file **`deleted-authors.local.json`** = `{ code, name, deletedAt, snapshot (the removed entry, with the ids the checks need), choices, items[{id, state, signedAt, note}] }`. The snapshot holds credentials-adjacent data, so it never leaves this computer and is blanked out of every screen (`redact`).
- **Undo** (while the row is grey, within 30 days): restores the entry from the snapshot, `npm run push`, and removes the number from the "used before" list. It cannot bring back things already deleted by hand in GHL/Shopify — the panel says which, before you confirm.

## 5. What changes in the code

| File | Change |
|---|---|
| `../coach-router/delete-author.mjs` (new) | dry-run by default; `--write` removes the entry via `saveRegistry`, deletes `coach:<code>` and `VF_KEY_<code>` with `wrangler`, writes the delete record, adds the number to the "used before" list. Refuses an author that is not in `coaches.json` |
| `../coach-router/renumber-coaches.mjs` | also moves the dashboard files keyed by code; refuses a former or retired number; one-pair mode used by the panel |
| `../coach-router/lib-registry.mjs` | "used before" list read/write helper (who had the number, when deleted) |
| `lib-actions.mjs` | three new actions on the allowlist: `renumber` (steps 1–5 above, as ordered job steps), `delete`, `undo-delete`; confirm phrases `renumber 1004`, `delete 1004` |
| `lib-deleted.mjs` (new) | the leftover list per author, the live checks (reuse `lib-readers`: tag, product, course, workflow), the item states |
| `lib-pipeline.mjs` / `server.mjs` | grid also returns the grey rows; `GET /api/deleted`, `POST /api/deleted/<code>/check`, `/signoff` |
| `web/app.js`, `app.css` | ⋯ menu, the two panels, grey rows, leftover list |
| `lib-help.mjs` | plain-words help for each leftover's "How?" |
| `dashboard.test.mjs` | tests, no network (§7) |
| README + plan 22 note | document the feature |

## 6. Work, in order

1. **Read-only first.** (a) Does `seed-coaches.mjs` accept an entry going missing, and does it ever delete KV keys? (b) What does the Worker do with a lease/entitlement for a code that no longer exists — and do subscribers of a deleted coach need an explicit step? (c) `grep` every dashboard file keyed by code (`readings.local.json`, `page-settings.local.json`, `drafts.local.json`, `pipeline-alerts…`, `All Coaches/`, `generated/`) — the list in §2 step 2 and §3 comes from this. (d) Which ids does each entry hold for the leftover checks (`shopifyProductId`, collection id, `courseId`, `courseOfferId`, `ghlTag`, grant workflow name). Report what was found before building.
2. `delete-author.mjs` + the renumber extensions, with tests; try them on a **throw-away author** created with the wizard (never a real one).
3. `lib-actions.mjs` actions + confirm phrases; tests for the allowlist and for every refusal in §2.
4. Edit-number panel (A), then Edit-details panel (reuses the step 2 form), then Delete panel.
5. `lib-deleted.mjs`, the live checks, grey rows, the leftover panel, Check again, sign-off, Finished, Undo.
6. **Real runs, in this order:** renumber the throw-away author; delete it; clean up its leftovers by hand following the panel's own "How?" and watch the items turn gone; Undo on a second throw-away. Then your real renumbers/deletes.
7. README, plan 22 note, memory entry. Tracker: this is a dashboard feature, not an author step.

## 7. Tests (no network)

- Number rules: bad format, current, former, retired, same as now.
- `renumber` plan: order of steps; backup restored when seed refuses; dashboard files moved; old entry pruned only when the new one is live.
- `delete`: dry run writes nothing; confirm phrase required; entry, KV key, secret, row gone; number added to the "used before" list; leftover list built from the snapshot; subscriber warning when count > 0 (a warning only, it never blocks); reusing a used-before number shows the warning and needs the extra tick.
- Leftover states: still there → gone (mock check), a sign-off only for uncheckable items, a "gone" item that reappears reads still there, all done → row leaves, Finished kept 30 days.
- Undo: restores the entry; refuses after 30 days; names what cannot come back.
- Redaction: no credential in any panel text or job output.

## 8. Decisions I need from Muhammad before building

1. **Delete defaults for GHL/Shopify** — ✅ decided 2026-11-02: **leave them alone** and list them as leftovers (nothing destructive by surprise).
2. **Undo window** — ✅ decided 2026-11-02: 30 days.
3. **Subscribers of a deleted coach** — ✅ decided 2026-11-02: **warn only**, never refuse.
4. **Reusing a deleted number** — ✅ decided 2026-11-02: **allowed, with a warning** shown before confirming (§3).

## 9. Not in this plan

Swapping two authors' numbers in one go · editing several authors at once (Option B) · deleting things in GHL, Shopify or Zipify automatically.

---

## 10. What step 1 found, what was built, what is still open (2026-11-02)

**Found (read-only, step 1)**
- `seed-coaches.mjs` only **writes** KV; it never deletes. So a delete removes `coach:<code>` and `VF_KEY_<code>` itself (`delete-author.mjs`, with `wrangler`).
- The Worker takes entitlement from each registry coach's `ghlTag`. A coach that leaves the registry stops being offered; the Worker already says "the coach left the registry — nothing to revoke". A session for a missing coach is treated as no session, not an error.
- The **mass-revoke guard** (`REVOKE_GUARD_*`, `coach-router.worker.js`) refuses a reconcile that would revoke most subscribers in one run. A delete that hits most subscribers would be refused by "Update subscribers now" unless forced; their leases still end on their own within 48 h. The panel only warns (decision 3).
- The GHL `coach_code` field is rewritten by the Worker's own subscriber sync (`coach-router.worker.js` ~3488), so a renumber has **no separate contact step**. (The first version of this plan, and the mock-up, said it updates contacts directly: corrected.)
- Dashboard files keyed by number: `onboarding-state.local.json` (sign-offs, test results), `page-settings.local.json`, `readings.local.json` (`author:<code>`), `drafts.local.json`. Handled: state by the commands, page settings by `followNumber`, readings by `pipeline.refresh`/`authors()`.
- **A number must not inherit a deleted author's state.** A reused number would otherwise start with the old author's sign-offs and page settings, so a delete sets both aside.

**Built**
| File | What |
|---|---|
| `../coach-router/lib-deleted.mjs` (new) | the delete record, the leftover list, states (todo / gone / signed), live checks, 30-day undo, pruning |
| `../coach-router/delete-author.mjs` (new) | delete / undo; resumable if the Worker cleanup stops half way |
| `../coach-router/renumber-coaches.mjs` | a number a deleted author had needs `--accept-reuse` |
| `lib-manage.mjs` (new) | number rules, "what will change" lists, clean-up view / check / sign-off, page-settings follow the number |
| `lib-actions.mjs` | `renumber`, `delete`, `undo-delete`, `sync-subscribers` on the allowlist (all dry first, typed confirm) |
| `lib-live.mjs`, `server.mjs` | `pipeline.ctx()`, deleted authors' keys count as secrets, 4 endpoints, after-job hooks |
| `lib-wizard.mjs`, `web/wizard.js` | Add author never suggests a deleted number; typing one asks first |
| `web/manage.js` (new), `app.js`, `app.css`, `index.html` | ⋯ menu, Edit number / Edit details / Delete panels, grey rows, clean-up panel |

**Differences from the plan above**
- "Update subscribers now" is its **own action** (`sync-subscribers`, dry first), offered after a renumber or delete, not a last step inside them: a refused sync must not make a finished delete read as failed.
- "Edit details…" offers the two **existing** forms (Inputs: name, book title, label; Coach page) instead of a third copy.
- After 30 days the undo snapshot loses the Voiceflow key but **keeps the ids** (the live checks need them); a finished record collapses to a stub that still remembers its numbers.
- The subscriber count is "contacts holding the coach tag" (trial and paying), one capped search. It is a warning, not a figure to trust to the digit.

**Not verified yet — do before a real author**
1. `wrangler secret delete` has no `--force`; the script answers its prompt through stdin. Unproven until a real run. If it hangs or fails the script stops and says which step; run it again, it resumes.
2. The browser UI has not been seen by a person (no browser was available while building): look at the ⋯ menu, both panels, the grey row and the clean-up panel in light and dark.
3. A real renumber and delete on a throw-away author (create one with Add author, take it to step 3 so it has a KV entry and a secret).
4. Whether the GHL token can read tags (`locations/tags.readonly`). Without it the tag item reads "cannot check" and you sign it off by hand: nothing breaks.
