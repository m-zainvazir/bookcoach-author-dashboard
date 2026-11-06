# Plan 06 — prototype coach pages, made from the dashboard (steps 0-2 only, no coach number)

**Created:** 2026-11-02 · **Asked by:** Muhammad · **Status:** 🔧 BUILT 2026-11-03 (Option 2, "go" given), **not yet used for real** — 564 offline tests pass; a page built from the real template and key into a temporary folder had no syntax errors, no coach code and no Worker address. Still to do: open a built page in a browser against a draft Voiceflow version (§9 step 5). See §12.
**Rule added 2026-11-03 (Muhammad): every new file and every backup for prototypes lives ONLY in `All Coaches (Demo)`. Nowhere else.**
**Size:** small-medium. About 1 session of code + tests. No Worker deploy, no live system touched.
**Mock-ups (private):** see §4 — two ways to show the screen.

**Rules checked** (memory + plan 22 §0): **$0 · no Cloudflare, no Twilio, no GHL, no Shopify, no coaches.json, no coach code** (asked for) · no secret in the browser · the new part is a switch of *screen*, not a feature that is on or off, so nothing is "default off" · the existing "Final BookCoachAI" path stays exactly as it is.

---

## 1. In easy words

Today "+ Add author" only knows one thing: a real author with a number, who goes through all the steps (GHL, Shopify, the Worker…).
You also need a quick, throw-away **demo coach** to show someone: just a page you paste somewhere, that talks to Voiceflow. No number, no steps after the page.

So the Add author screen gets a **new box at the top: "What are you making?"** with two choices:

| Choice | What happens |
|---|---|
| **Final BookCoachAI** | everything as today (coach code, steps 0-25) |
| **Prototype Coach** | no coach code. Three small screens: **who the author is** (step 0), **the Voiceflow coach** (step 1), **the coach page** (step 2). Then you press **Copy the page**, and paste it. A file is also saved in `All Coaches (Demo)` |

The box **remembers your last choice**, so if you made a prototype last time, it opens on Prototype.

## 2. Decisions (Muhammad, 2026-11-02)

1. **Page design:** the **current coach page** in *direct* mode (talks straight to Voiceflow). Not the old demo format. One page to maintain, looks like the final one.
2. **Saved prototypes:** a **"Prototype coaches" list**, each with *Edit again*, *Copy the page*, *Show in folder*. Answers kept in a small local file so you can change and rebuild.
3. **The Voiceflow key goes inside the page** (like the four demo files today). Anyone who views the page source can read it. The file stays on this computer, gitignored, and the key only goes to the clipboard on this PC, never to the browser.

**My defaults — tell me if any is wrong**

| Point | Default |
|---|---|
| File name | `All Coaches (Demo)\<Author-Name>-demo`, e.g. `Tara-Hayes-demo` (your four old demos use the first name only; those stay as they are) |
| Same author twice | the same name opens the saved prototype to edit; to make a second one, the screen offers "make another" (`tara-hayes-2`) |
| Rebuild | the page file is replaced; the version it replaces is kept as `….bak-<date>`, as for final pages |
| Remembered choice | ~~`pipeline.local.json`~~ **changed 2026-11-03:** kept in this browser (`localStorage`), so no file is written anywhere for it (per the demo-folder-only rule). Another browser starts on Final BookCoachAI |
| Page label | the page's small tag says "Type or Talk" as today; nothing says "prototype" unless you ask |

## 3. What a prototype asks, step by step

| Step | Asks | Needed? |
|---|---|---|
| **0 — who** | author name, book title, initials (optional; taken from the name) | name + book title required |
| **1 — Voiceflow coach** | the **version ID** (24 characters). The project ID is not needed here. The key is read from `coaches.json` (`shared.vfApiKey`), it is not typed | version ID required |
| **2 — the coach page** | the same form as a final author: line under the name, photo link, author website, book buttons, course buttons, browser tab title, and the toggles "Buy the Book", "Buy the Course", "Meet the Author" | all optional |
| *(not shown)* | the "Get my activation code" button (it needs the Worker, so it is **off**), "How the page connects" (fixed to *direct*), "Put the key in the page" (fixed to *yes*) | — |

No coach code, no step 3 onwards, no preview/confirm dialog (nothing live is changed: the only write is the page file in `All Coaches (Demo)` and the small local answers file).

## 4. How it could look — pick one

Both start the same way: **Add a new author** gets a dropdown, *Final BookCoachAI* or *Prototype Coach*, remembered. Choosing Prototype swaps the rest of the card and adds a *Prototype coaches* list below.

- **Option 1 — the same step-by-step wizard, with 3 steps.** Looks and feels like Add author today (Previous / Next, a step list), but the list stops at step 2. Familiar, one thing at a time.
- **Option 2 — one single page.** All three parts on one scrolling form with one button, **Build the page**, and **Copy** appears right after. Fastest for a quick demo.

## 5. What the page file contains

The same `templates/coach-page.template.html`, with its `CONFIG` filled by a prototype builder: author name, book title (or the line you typed), photo, initials, links, `CONNECTION: "direct"`, `VF_VERSION_ID`, `VF_API_KEY`, `showActivation: false`, and **no coach code and no Worker address**. In direct mode the page never calls the Worker. (The template only uses `COACH_CODE` / `WORKER_URL` on its Worker paths, and removes the activation box when `showActivation` is off; the build test checks this on the finished page.)

## 6. Where things are kept

| What | Where |
|---|---|
| the finished page | `..\All Coaches (Demo)\<Author-Name>-demo` (+ `.bak-<date>` of the one it replaces) |
| the answers (no key) | `..\All Coaches (Demo)\_prototypes.json` (**changed 2026-11-03:** it was going to be in the dashboard folder) |
| last choice | the browser (`localStorage`), no file |
| nothing else | not `coaches.json`, not `drafts.local.json`, not `pipeline.local.json`, not KV, not GHL. Only a prototype's own files are ever written, and all of them are in `All Coaches (Demo)` |

## 7. What changes in the code

| File | Change |
|---|---|
| `lib-prototypes.mjs` (new) | the prototype list (read/save/delete), validation (name, book title, version ID), `buildPrototypePage()` — fills the template, refuses if any credential other than the one Voiceflow key would land in the page, writes the file + backup |
| `lib-pages.mjs` | `coachPageConfig` gets a "prototype" mode that leaves out the coach code and Worker address (the final path is untouched); exports what the prototype form reuses |
| `lib-settings.mjs` | new setting `addMode` (`final` default, or `prototype`), validated like the others |
| `server.mjs` | `GET /api/prototypes`, `POST /api/prototypes` (save answers + build), `POST /api/prototypes/open` (copy to clipboard, show in folder — on this PC, like final pages), `POST /api/prototypes/delete`. No job runner, no allowlisted command: nothing here starts a process except `clip.exe` / Explorer as the final page does today |
| `web/wizard.js`, `web/prototype.js` (new), `app.css`, `index.html` | the dropdown, the prototype screens (Option 1 or 2), the list |
| `package.json` | add the new files to `check` |
| README + plan 22 note | document it |

## 8. Safety

- **No new reach.** The prototype code never calls GHL, Shopify, Cloudflare or Twilio, and never writes `coaches.json`. A test fails if `lib-prototypes.mjs` imports any of those readers.
- **The key** is read on this PC, written into the page file, and goes to the browser never. A response that would contain it is refused (the server's existing check). The file is gitignored (the folder `All Coaches (Demo)` must be too — checked in step 1).
- **File names** are made from the name by the same slug rule as final pages, so a name can never point outside `All Coaches (Demo)`.
- An existing page is **never overwritten without a backup**.

## 9. Work, in order

1. **Read-only first.** Is `All Coaches (Demo)` gitignored? (git shows it as untracked today.) Does a finished page in direct mode make any Worker request when opened (read the template's boot code, then check the network list once in a browser)? Report before building.
2. `lib-prototypes.mjs` + `coachPageConfig` prototype mode + tests (§10).
3. Settings + server routes + tests.
4. The screen (the option you pick), the list, Edit again / Copy / Show in folder.
5. Build one real prototype from a draft Voiceflow version and open the page: it must answer.
6. README, plan 22 note, memory.

## 10. Tests (no network)

- The three required answers; a bad version ID; a name that would make an unsafe file name.
- The built page: `CONNECTION: "direct"`, the version ID, **no coach code, no Worker address, activation off**, the key present exactly once, and no other credential.
- Rebuild keeps a backup; a second prototype with the same name gets a new id, never overwrites.
- The remembered choice: default `final`; saved; an unknown value refused.
- The list and endpoints never return the key; the import guard in §8.
- The final path is unchanged: a final page built before and after this plan is byte-identical.

## 11. Not in this plan (parked)

- Turning a prototype into a real author later (it would need a coach number and steps 3-25).
- An expiry date inside a prototype (your "Trial Expired" paste-over page covers this by hand today).
- Editing your four old demo files (Tara, Bob, Chennae, Stephanie): they are in the old format and are left alone.

---

## 12. What was built, and what differs from the plan above (2026-11-03)

| File | What |
|---|---|
| `lib-prototypes.mjs` (new) | answers, validation (reuses the final coach page's own rules), the prototype `CONFIG` (direct, no coach code, no Worker address, activation off), build into `All Coaches (Demo)` with a `.bak-<date>` beside it, the list, Remove, safe paths |
| `server.mjs` | `GET/POST /api/prototypes`, `POST /api/prototypes/open` (copy / folder, on this PC), `POST /api/prototypes/forget` |
| `web/prototype.js` (new), `web/wizard.js`, `web/app.js`, `index.html`, `app.css` | the "What are you making?" dropdown and the single-page form (Option 2), the Prototype coaches list |
| `../.gitignore` | `/All Coaches (Demo)/` — the pages hold the Voiceflow key and the folder was **not** ignored before |
| `package.json`, tests | 38 new tests (564 in all) |

**Differences from §7**
- `lib-pages.mjs` and `lib-settings.mjs` are **not changed**: the prototype builds its own `CONFIG` (so the final path cannot be affected), and the remembered choice needs no setting.
- A new prototype with a name that already exists is refused ("Edit again" or tick "Make another"), so one is never replaced by accident.
- **Remove** takes a prototype off the list only. Its page and backups stay in the folder; delete them in Explorer if you want them gone.
- Your four old demo files and `Trial Expired` are not listed and not touched.

**Changes after the first look (2026-11-03, Muhammad)**
- The page is now **stripped** (`stripForPrototype` in `lib-prototypes.mjs`): no coach-router (Worker) code, no GHL lesson member/session code, no phone-activation box or its script (so no `workers.dev` address anywhere). It only talks to Voiceflow. The final page template is unchanged. If the template changes shape so a cut cannot be found, the build is refused.
- The text under the photo ("This prototype is text + voice-in only. A future version can add a live speaking video avatar…") is shown on prototypes (it is a comment in the final page).
- Form: the three buttons ("Buy the Book", "Buy the Course", "Meet the Author") start **unticked**; website, book buttons, course buttons and tab title sit in a closed **"More page options"** dropdown (it opens by itself if one of them has a problem).
- 569 tests.
- **2026-11-05:** no photo link → the author's initials sit in the ring and the ring turns slowly, as in the old Tara-demo (off for "reduce motion"). With a photo nothing turns. Prototype only; the final page is unchanged.

**Still to do**
1. Look at the screen in a browser (no browser was available while building): the dropdown, the form, Build, Copy, Edit again, Make another, light and dark.
2. Build one real prototype with a draft Voiceflow version, paste it into a GHL Custom Code element and talk to it. The Network tab should show calls to `general-runtime.voiceflow.com` and none to `workers.dev`.
3. Windows Copy (`clip.exe`) and Show in folder are the same code as the final page's, but not yet pressed for a prototype.
