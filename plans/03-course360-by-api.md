# Plan 03 — step 5 "Course360" through HighLevel's Courses API

**Created:** 2026-10-13 · **Asked by:** Muhammad · **Status:** ✅ BUILT 2026-10-13 (§9). Not yet run for real — Freddy first, after Muhammad confirms the preview.

**Size: small–medium.** One coach-router command, one dashboard action, new step-5 checks, tests. $0, no KV,
no Worker change, nothing to deploy. Muhammad's part per author drops to **one click (Duplicate)** + a confirm.

---

## 1. What was found — read-only, 2026-10-13

The old note "no API for courses or Offers (`/courses/`, `/memberships/offers` 404)" is out of date. HighLevel's
Courses API (`Version: v3`, `?locationId=`, scopes `courses.readonly` / `courses.write`) answers with our Private
Integration once those two scopes were added (Muhammad, 2026-10-13; the other scopes re-set to what the code uses —
`author check` all ✓).

| Need | API | Endpoint |
|---|---|---|
| Course: list / get / create / update | ✅ | `GET/POST /courses/products`, `GET/PUT /courses/products/:id` |
| Modules ("categories") | ✅ | `GET/POST /courses/products/:id/categories` |
| Lessons: list / get / create / update | ✅ | `/courses/products/:id/lessons[/:lessonId]` — create needs `title` + `categoryId` |
| **The coach iframe** | ✅ | it is the lesson's `description` (HTML) — see §2 |
| Offer: list / get / create / update | ✅ | `/courses/offers[/:id]` — body `title`, `type: free`, `productIds: [course]`, **`visibility: published`** |
| **Offer Draft → Published** | ✅ | set at create (or update). The click we always forget is gone |
| Offer "not publicly listed" | ❌ | no such field in the API — cannot be set or read (§7 Q2) |
| Lesson **videos** | ❌ | invisible: `contentId` and `metaData.embedMediaId` are null on lessons that have videos |
| Duplicate a course | ❌ | no endpoint. Course Import (`/courses/courses-exporter/public/import`) takes a video *link* per lesson, but returns no ids and is unproven — not used |
| **Give a reader the Offer** | ✅ | `POST /courses/enrollments` `{contactId, offerId}` — could replace the grant workflow (step 11). §8, plan 04 |

## 2. What a course looks like now — read from Stickler (1001) and Freddy (1002)

The checklist says "ONE lesson". The live layout is **two modules, eight lessons** — standard for every author,
with videos (Muhammad, 2026-10-13):

```
Module 0  "Getting to know Book Coach AI"     comments hidden
  1: Welcome to Book Coach AI · 2: Take Your Coach With You · 3: Don't Just Search Your Book Coach ·
  4: Turn Learning Into Application with Your Book Coach · 5. Your Book Coach Gets Better When It Gets to Know You ·
  6. Put Your Book Coach to Work · 7. BookCoach Recap                         (video lessons, videos not readable)
Module 1  "Talk to your Book Coach AI below"  comments enabled
  "BookCoach AI"   description = the coach iframe:
  <p><iframe src="https://www.book-coach.ai/<slug>?cid={{contact.id}}&em={{contact.email}}" width="100%"
   height="800" allow="microphone" style="border:0px"></iframe></p><p></p>
```

Note the live iframe has a plain `&` (GHL's editor stores it decoded) — the check compares the decoded `src`.
Course title `BookCoach AI — <Author> — <Label>` (`withAuthor`), description `courseDescription(author)`.
Member link = `https://login.leadershipbookspublishers.com/courses/products/<courseId>` — exactly what step 6 saves
today (`courseLessonUrl`), so **step 6 fills itself**.

## 3. The design — you Duplicate, the command does the rest

Because the videos cannot be copied by the API, the course itself is made by GHL's own **Duplicate** (one click on a
master course; videos, modules and lessons come along). Everything after that is the command:

`npm run author -- course360 --code N [--course <id or link>] [--write]` (coach-router; dry run by default)

1. **Read everything first** (nothing written): the master course's modules/lessons, all courses, all Offers, the
   author's entry.
2. **Find this author's course**, in order: `--course` if given · the course already recorded (`courseId`, or the
   one in `courseLessonUrl`) · a course already titled `BookCoach AI — <Author> — …` · **the fresh duplicate**: a
   course whose modules + lesson titles equal the master's, that no author in `coaches.json` and no Offer uses.
   Exactly one → use it; none → "Duplicate the master first" (the help says how); several → list them, ask for
   `--course`. Never guesses between two.
3. **Check its shape** against the master: the two modules, the 7 + 1 lessons, the coach lesson present. Anything
   missing → refused, nothing written (fix in GHL or duplicate again).
4. **Plan the writes**, each only if needed (so a second run does nothing, and a run after a failure finishes the job):
   - course title + description → `PUT /courses/products/:id`
   - the coach lesson's iframe → this author's slug → `PUT …/lessons/:lessonId` (only `description`)
   - the Offer: none → `POST /courses/offers` `{ title: <course title>, type: free, amount 0, currency USD,
     visibility: published, productIds: [course] }`; one with this title but not linked / still draft → update it
     (Freddy's case today: his Offer is linked to no course); linked elsewhere, or two with this title → refused
   - save `courseId`, `courseOfferId`, `courseLessonUrl` to `coaches.json` (`author set` — backup + validation;
     local only, not in `KV_FIELDS`)
5. **Dry run** prints exactly that list, with the found course's title and how it was found. **`--write`** does them in
   that order and prints `✓ done` per item. On the first error it **stops**, prints what was done and what was not,
   and exits 1; the ids of anything created are printed and saved before the next write (`.created`), so nothing is
   ever half-made silently. Re-running finishes it.

Master course: `shared.config.courseMaster` (a course id), **Freddy's** (`a89deca1…`, Muhammad 2026-10-13). The
duplicate still holds Freddy's coach link — step 4 swaps it for `book-coach.ai/<this author's slug>`.

**The course picture** (Muhammad, 2026-10-13): optional, the same two boxes as the Shopify image — a file on this PC
or a link. The course keeps it as `posterImage` (a web address, as Sue's course does today). A **link** is used as
is (checked first: it must answer with a real picture). A **file** must first be put somewhere online: GHL's Media
library (`POST /medias/upload-file` — needs one more permission, "Edit Medias" / `medias.write`) — §7 Q1. Written
with the course update in step 4; a picture already there is replaced only when one is given.

**Never:** delete anything, touch another author's course or Offer, change lessons other than the coach lesson's
`description`, or print a token (output scrubbed as in every command).

## 4. The dashboard — step 5

- One new allowlisted action **`course360`** → `author.mjs course360 --code N [--course …]`, Preview (dry run) first,
  then the typed confirmation `course360 <code>`. Optional box: "Course link (only if it cannot find it)".
- Step 5's how-to becomes: ① GHL → Memberships → Courses → the master → ⋯ → **Duplicate** · ② press **Preview** ·
  ③ **Make it so** · ④ check the intro videos play (the one thing nobody can read).
- The step-6 box stays (for a hand-made course) but is normally already filled. The Draft → Published reminders
  (`STEP_REMINDERS`, `offerReminderText`) go: the command publishes. Step 11's "not in the list? publish it" stays as
  a fallback line.
- `steps.mjs`: Course360 `kind` manual → assisted, new instructions, `signoff` removed (if §7 Q2 says so).

## 5. The live checks — step 5 (lib-author, read live)

| Check | Done when | Else |
|---|---|---|
| course exists | `courseId` (or the course in `courseLessonUrl`) answers | FAIL "course not found" (Freddy today: his recorded course was deleted) / TODO none yet |
| course matches the master | same modules + lesson titles | WARN, naming what differs |
| coach lesson has this author's iframe | decoded `src` = `book-coach.ai/<slug>?cid=…&em=…` | FAIL — names the slug it has (a duplicate still pointing at Stickler) |
| Offer is Free, Published, and gives this course | `type free`, `visibility published`, `products` ∋ course | FAIL, saying which; "draft" names the click |
| ~~Offer is Free and unlisted~~ (MANUAL) | replaced by the row above; "unlisted" per §7 Q2 | |

Step 6 (lesson URL) keeps its check. Without `courses.readonly` the rows fall back to today's MANUAL one (as the
grant check does without `workflows.readonly`). `author check` gains a `courses.readonly` probe. Existing
"Offer is Free and unlisted" sign-offs (1001, 1002, 1004) are no longer read — no migration needed.

## 6. Tests and proof

- coach-router: the finder (recorded / title / fresh duplicate / none / several), the shape check, the planner
  (nothing to do · all to do · Freddy: Offer unlinked · Offer linked elsewhere → refused), write order and
  stop-on-first-error with a fake `ghl`, the iframe compare (`&` vs `&amp;`), the check rows, no token in output.
- dashboard: `course360` on the allowlist with its args, refused without a code / with a bad course id, the step-5
  buttons and help by key.
- Live, in order: dry run for Freddy (his course + unlinked Offer) → Muhammad confirms → `--write` → checks green.
  Then a new author end to end. `npm test` both folders, headless-Chrome screenshots of step 5.

## 7. Open questions — Muhammad

1. ~~Master course~~ — **Freddy's** (answered 2026-10-13). Open: a picture as a **file** needs `medias.write`;
   links work without it.
2. ~~"Not publicly listed"~~ — Muhammad does not know of such a setting (2026-10-13), so the check is **dropped**;
   the API has no such field.
3. **Freddy** — Muhammad finished his new course by hand (2026-10-13), but read live the same day: his Offer
   (`f0027b11`, the one his grant workflow gives) still gives **no course**, and `courseLessonUrl` still points at
   the deleted `0048a3ca`. Fix: link that SAME Offer to `a89deca1` (so the workflow and anyone already granted get
   the new course) + save the new link. By hand now, or the command's first real run.

## 8. Later — plan 04 (not in this plan): the grant workflow (step 11) without a workflow

`POST /courses/enrollments {contactId, offerId}` grants the Offer directly. The Worker already adds the coach tag;
it could enroll the reader in `courseOfferId` in the same moment, and the per-author grant workflow — whose trigger
we can neither read nor create — would go. To prove first: does GHL send its course invite (login) email on an
API enrollment? Costs one extra GHL call per order (no KV), but it is a Worker change + deploy, so its own plan.

## 9. As built — 2026-10-13

**Tests:** coach-router 1033 (+44), dashboard 437 (+7). `npm run check` clean in both.

- **`coach-router/lib-course360.mjs`** (new): names (`courseTitle`, `memberCourseUrl`), the iframe (`coachLessonHtml` —
  the live lessons' exact HTML with a plain `&`; `iframeSrc`/`iframeSlug`/`iframeIsFor` read `&amp;` the same), the shape
  (`courseShape`, `shapeDiff`, `coachLesson`), paging (`listAll` — the API pages by `cursor`, at most 50 a page),
  whose course (`courseOwner`, `findCourse`), the plan (`planOffer`, `planCourse360`) and `runWrites` (in order, stops at
  the first failure, returns the ids made). Master: `DEFAULT_COURSE_MASTER` = Freddy's `a89deca1…` (`--master` overrides).
- **`npm run author -- course360 --code N [--course <id|link>] [--image-file … | --image-url …] [--master <id>] [--write]`**
  in `author.mjs`. Reads all courses + Offers + the master's shape first; prints what is already right (`ok`), what it
  will do (`will`) and what it will save; refuses with nothing written on any problem. `--write`: the picture upload
  (if a file), then course → lesson → Offer, then `saveRegistry` (backup + seed validation) with whatever is known —
  even after a failure, so the next run finishes the job. The output says what is not done yet.
- **Picture:** a direct link is used as `posterImage` as is (checked first with `loadProductImage`); a file, or a Drive /
  Dropbox share link, is uploaded to GHL's Media library (`POST /medias/upload-file`, Version 2021-07-28) — **needs the
  "Edit Medias" (`medias.write`) permission, not granted; written to the documented API, not yet run.**
- **Record fields** `courseId`, `courseOfferId` (lib-author `RECORD_FIELDS`, validated; local only, not in `KV_FIELDS`).
- **Live checks** (`courseRows` in lib-author, reads via `ctx.ghl(…, { version: 'v3' })` — `lib-readers` gained the
  `version` option, still GET-only): course made (TODO) · course exists (FAIL when the saved one is gone — the old
  lesson-URL check alone still read 200 for a deleted course, Freddy) · course title (WARN) · coach lesson opens this
  author's coach · course matches the master (WARN; skipped for the master) · Offer is Free, Published and gives this
  course. No `courses.readonly` → one MANUAL row. `author check` probes `courses.readonly`.
- **`steps.mjs`**: Course360 `kind: 'assisted'`, new instructions + command, **no `signoff`**. Old sign-offs on step 5
  (1001, 1002, 1004) are left in the state file but cover nothing; the Onboard tab no longer shows a sign-off on a step
  with no MANUAL row (as the Pipeline tab already did).
- **Dashboard**: allowlisted action `course360` ("Make the course", preview + `course360 <code>`); step-5 boxes
  `courseLink`, `courseImageFile`, `courseImageUrl`; "what you need" shows the master to duplicate, the name, description
  and the lesson HTML; help rewritten in plain words (lib-help, plus row help for every new check); the Draft → Published
  reminders (`STEP_REMINDERS['Lesson URL']`, `offerReminderText`) removed; the grant workflow's "not in the list?" line now
  says to run Make the course again.
- **Proven live, read-only** (dry runs, CLI and the dashboard in headless Chrome): Freddy (1002) — only his Offer needs
  linking + the ids saved; Stickler (1001) — rename "Micheal" → "Michael" + description (his course has two Offers; the one
  titled for him is picked); Sue (1004) — refused, her course is the older one-module layout; Rob (1005) — "Duplicate the
  master first".

### Added the same day
- **Freddy fixed for real** (`course360 1002 --write`, after Muhammad confirmed the preview): his Offer gives the new course;
  courseId / courseOfferId / courseLessonUrl saved (backup `coaches.json.bak-20261013-0920-course360-1002`). Live: step 5 green,
  a second run "Nothing to do". Muhammad re-uploaded the missing videos of lessons 5–7 in the master (Freddy's).
- **"Get my activation code" said "not authorized" in GHL's admin preview** — not a fault: the Worker log (`wrangler tail`)
  showed no request at all; with no member, GHL fills no `{{contact.id}}`, so the page refuses before asking. A member
  sees it work (steps 14–15 test it).
- **Typed values no longer vanish** (Muhammad: a pasted path disappeared on Preview). `web/wizard.js` keeps every box's
  typed value per author (`W.typed`, sessionStorage) through every redraw, and marks what is not saved or used yet —
  under the box, a line above the boxes, ✎ in the step list. Cleared by a save, a saved draft, or a real run that
  used it (`W.forgetOnDone`); a Preview clears nothing. All steps, not only Course360. Proven in headless Chrome on
  Rick (1003): path kept after Preview, marked; the preview found his duplicate ("… – Clone").

- **The course picture is no longer set by the dashboard** (Rick, 1003). Uploaded through `/medias/upload-file` (Muhammad added
  "Edit Medias"), saved as `posterImage` = `https://assets.cdn.filesafe.space/<loc>/media/<id>.jpg` — the file opened fine
  (200, any origin), but GHL's course page showed it broken: it puts its own course-picture server in front of
  `posterImage` (Muhammad copied the address: `https://cdn.courses.apisystem.techhttps//assets.cdn.filesafe.space/…`). Every
  picture that shows is in GHL's course storage (`/memberships/…`, `storage.googleapis.com/revex-membership-production/…`,
  `cdn.courses.apisystem.tech/…`), which only the course's own screen uploads to — and that server does not have Media
  Storage files (404). So: `author course360` refuses `--image-file/--image-url`, the plan never sets `posterImage`, the
  step-5 picture boxes are gone, and a new live check **"course picture shows in GHL"** (`posterShows`) reads it: in GHL's
  storage → done; none → a note; anywhere else → wrong, with where to upload it. "Edit Medias" is no longer needed.
  Also tested (Muhammad agreed, one write): the same picture's Google storage address
  (`https://storage.googleapis.com/msgsndr/<loc>/media/<id>.jpg`, opens 200) as Rick's `posterImage` — **still broken** in
  GHL. Only GHL's own course storage shows. Decided: the course picture is added by hand on the course's Edit screen.
- A failed job now says **"Why it stopped:"** at the top of its output, and the output opens scrolled to the end.

### Not done — Muhammad's
- Confirm Freddy's preview, then run it for real (`course360 1002`).
- First new author: Duplicate → Make the course → check the videos play.
- Optional: "Edit Medias" permission, only if course pictures will come from files.
