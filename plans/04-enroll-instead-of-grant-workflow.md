# Plan 04 — give the course by API, so step 11 (the grant workflow) is not needed

**Created:** 2026-10-13 · **Asked by:** Muhammad · **Status:** 📋 PLANNED — nothing built. Needs Muhammad's "go".
**Size:** medium-small. ~1 session of code + tests; one Worker deploy; one real $0 test order. Saves ~5 min per author and one trap.

**Rules checked** (memory + plan 22 §0): $0 · no extra Cloudflare load (no KV list, no KV write; one extra GHL call per grant) ·
optional = a switch, **default OFF**, and OFF really means "as before" · no secret in the browser · preview + confirm for every
write · the customer path is touched only with its own test (this plan touches it).

---

## 1. What step 11 does today, and what replaces it

| Today | After |
|---|---|
| Per author, by hand in GHL: workflow `Book Coach — Grant Course (<Author>)`, trigger *Contact Tag added = <coach tag>*, action *Grant Offer*, **Published before the first order** (its tag trigger only sees tags added after publishing). GHL cannot create workflows through its API (only `workflows.readonly`) | The **Worker** gives the course itself, in the same moment it adds the coach tag: `POST /courses/enrollments` `{ contactId, offerId }` (HighLevel Courses API, scope `courses.write`, header `Version: v3`). No workflow, no trigger, no publish-first trap |

Facts from the docs (2026-10-13): *Enroll Contact* "grant[s] a contact access to a membership offer … Returns **200 when already enrolled**
and 201 when newly attached"; it is not counted in Net Revenue paid filters; *Revoke Enrollment* exists. Plan 03 already gives every
author a **Free, Published Offer** and records `courseOfferId` (Freddy, Rick so far).

## 2. Where the Worker would enroll — the two places it already adds the coach tag

| Path | Code | Change |
|---|---|---|
| A reader's order (trial) | `grantTrialsForOrder` (`coach-router.worker.js`, after the `PUT /contacts/<id>` with the tags) | after the tag is written, for each granted coach with `courseOfferId`: enroll |
| A paying subscriber | `applySubscriptionTags` (every 15 min; its `ghlAddTags` + `coach_status active`) | same |

Both are already idempotent (a held tag / existing `trial:` record is skipped), and enrolling twice is harmless (200). So no new KV record,
no new cron, **no KV list/write** — one extra GHL call per new grant.

**Never fatal.** If the enroll call fails, the reader still gets the coach and the tag (the Worker must not lose a paying customer over a
course). The failure is logged (`[enroll] FAILED …`) and shown on the Health tab; the next 15-minute subscriber pass retries for
subscribers, and an order's enroll can be retried by `npm run … enroll-missing` (see §5).

## 3. The switch (default OFF) — and what it means for the authors you already have

- New KV config key `enrollApi` (`"on"` / `"off"`, default **`"off"`**), next to `myCoaches` in `lib-config.mjs` CONFIG_DEFAULTS and
  validated like it. OFF = the Worker behaves exactly as today.
- New registry field `courseOfferId` becomes a pushed field (`KV_FIELDS`), so the Worker knows which Offer to give. (`courseId`,
  `courseLessonUrl` stay as they are.)
- **Existing authors are not touched.** Their grant workflows keep working. An author is enrolled by the Worker only if (a) the switch is
  ON **and** (b) the author has `courseOfferId` pushed. Authors without it (Sue, Rob, Doug, Cié, Warwick, Joe, Chuck, Reinhard, Stickler —
  everyone except Freddy and Rick) continue through their workflow until someone runs `npm run author -- course360 --code N --write`
  for them (plan 03) and `npm run push`. Nothing forces that.
- Workflow + enrollment together are safe (the second grant returns "already enrolled"), so an author can be moved over gradually, and the
  old workflow retired by hand whenever you like — or kept as a belt-and-braces backup.

## 4. What changes in the dashboard

| Where | Change |
|---|---|
| `steps.mjs` step **Grant workflow** | becomes `optional: true` for an author whose `courseOfferId` is pushed and the switch is on (reads OPTIONAL like step 8); otherwise unchanged. Its help says which mode the author is in |
| `lib-author.mjs` | new row on step 11: "the Worker gives the course (enrollApi on, courseOfferId pushed)" — read from `/health` config + KV; the old workflow rows stay for authors without it |
| Step 14 End-to-end test | `verify-author` already proves both tags and ten fields; add: the test contact is **enrolled** in the Offer (read `GET` enrollments for the product) — so the course really arrives |
| Health | new check: a coach-tag holder not enrolled in their author's Offer (only for enrolled-mode authors) |
| Switch | `enrollApi` in the Pipeline tab's switches (writes KV config via the existing `author config` path, like `myCoaches`) |

## 5. Work, in order

1. **Read-only first.** Confirm the Worker's GHL token has `courses.write` (it is the same Private Integration as `coaches.json
   shared.ghlApiToken` — verify; if the Worker holds a different token, say so and ask Muhammad before anything). Read the *Create
   Enrollment* page for the exact body/response, and test `GET` enrollments for Freddy's course with the real token.
2. Worker: `enrollContact(env, contactId, offerId)` (one `ghlRequest`, 200/201 = ok), called from the two places in §2, behind
   `cfg.enrollApi === 'on'` and `coach.courseOfferId`. Never throws into the grant path. Tests in `verify.test.mjs` (mock GHL): OFF →
   no call; ON + offer → one call per granted coach; 200 and 201 both fine; failure → grant still completes + logged; no offer → no
   call; two coaches in one order → two calls.
3. `lib-config.mjs`: `courseOfferId` into `KV_FIELDS`; `enrollApi` default + validation; seed/registry tests.
4. Dashboard: the §4 rows, help, the switch, tests; README + plan 22 note.
5. **Deploy** (Muhammad says go), then a **real $0 order** for Freddy (`verify-author --shopify-order`), with `enrollApi` ON: check the test
   contact is enrolled and the course opens from the welcome email. Then switch ON for good, author by author as they get `courseOfferId`.
6. Rollback = switch OFF (a KV config push, no redeploy), exactly like `entitlementMode`.

## 6. Risks, said plainly

| Risk | Handling |
|---|---|
| It touches the paying-customer path (`grantTrialsForOrder`, `applySubscriptionTags`) | OFF by default; never fatal; own tests; a real $0 order before ON |
| A reader's access to the course after the trial ends | Today the workflow only **grants**; nothing here revokes either. The course page is a coach iframe that the Worker gates by entitlement, so an old enrollment opens a page that says "not entitled". **Verify this on a real expired contact** before relying on it; if not, add Revoke (the API has it) to the sweep |
| Enrollments are "public_api" source, excluded from Net Revenue paid filters | Cosmetic for reporting; the $59 revenue is recorded by the funnel/Shopify, not by the Offer |
| HighLevel changes the API | The call is isolated in one function; the workflow can be turned back on |

## 7. Is it worth it? — Muhammad's call

- **Gain:** step 11 per author (~5 min, one sign-off, the "publish before the first order" trap) goes away; one less thing to forget.
- **Cost:** ~1 session now, a Worker deploy, a $0 test order, one more switch to know about.
- **Verdict (Claude's):** moderate — worth doing when more authors are coming; not urgent for the 11 you have. Doing step 5 (plan 03) for
  an author is the prerequisite either way.

## 8. Not in this plan

Step 10 (funnel page) — HighLevel's API cannot create or copy funnels or edit a page's order form (read-only funnel endpoints plus
redirects), so it stays manual and checked. Plan 02 (the collection's three months) is separate.
