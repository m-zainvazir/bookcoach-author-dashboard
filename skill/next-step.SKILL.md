---
name: next-step
description: Use when the user asks where a Book Coach author is in onboarding, what to do next for an author or coach code (e.g. "next step for 1044", "what's left for Rick Meyer", "where is Freddy in the pipeline"), how to add a new author, or whether anything live has broken. Reads the live pipeline tracker and explains it in plain words. Tracks and guides only.
---

# Next step — the Book Coach pipeline, in plain words

Installed by the dashboard's **Guidance** switch (or `npm run pipeline -- config --guidance on`);
switching it off deletes this file. The tracker and dashboard live in `{{DASHBOARD}}`; the registry
and every command that writes live in the sibling `coach-router` folder.
Plan: `ghl-shopify subscription/plans/22-pipeline-dashboard.md`.

## What to do

1. Name the author. `--code` takes the code, the slug, the name or a unique part of it
   (`--code freddy`). If a name fits two authors the command says so — ask which one.
2. Run, in `{{DASHBOARD}}`:

   ```
   node pipeline.mjs next --code <code> --json
   ```

   For the whole picture: `node pipeline.mjs status --code <code>`. For anything live breaking
   (checklist steps 18-26): `node pipeline.mjs health`.
3. Tell the user, briefly, in plain words, in this order:
   - **where they are** — the step number and title, and its state (wrong / do this next /
     needs your confirmation)
   - **why** — the failing or missing checks (`next.fixes`)
   - **what to do** — `next.command` and `next.instructions`, with the author's values filled in
   - if the state is **needs your confirmation**: what to check by hand (`next.signoff`), and that
     they record it with the dashboard's **Sign off** button or
     `node pipeline.mjs signoff --code <code> --step <n> --note "…"`
4. **Adding a new author:** point them at the dashboard — `npm run dashboard` in `{{DASHBOARD}}`,
   then **+ Add author**. The wizard asks for every input one step at a time and runs each command
   with a preview first.

## Rules

- **Read-only by default.** `next`, `status`, `health` and `npm run author -- status` only read.
  Never run anything with `--write`, `npm run push`, `npm run onboard`, `verify-author`, or a
  `signoff` without the user saying so in this conversation.
- **The live systems are the truth, not the docs.** Every state is recomputed on each run; a
  sign-off never overrides a check that is wrong.
- Step numbers are the checklist's: `ghl-shopify subscription/plans/further-automation-v1.md`.
