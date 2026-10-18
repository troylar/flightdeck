---
name: flightdeck-status
description: "Summarize the team folder: checklists, drafts, runs, plans, problems (read-only)"
---

Read-only: don't create, edit or delete files. The only command you may run is the folder check below.

Give a short status of this Flightdeck team folder. **Do not change any file.**

Focus, if any: the user's request

Read `AGENTS.md` first. Then run, from the team folder, the **only** command this skill may run:

    python .flightdeck/skills/_flightdeck/check_folder.py

If the skills were installed somewhere other than `.flightdeck/skills`, run the `_flightdeck/check_folder.py` next to this skill's folder instead, with the team folder as its argument.

It prints, as JSON and exactly as Flightdeck judges them: every published version's status, the current version and any clash per process, each plan's status (pending, decided or ambiguous), runs with conflict copies or many leftover save receipts, and problems in the team's `step-types/` and `jira/workflows.json` files. Use it for sections 1, 2 and 4. Look through the rest by listing and reading files.

## Report, in this order

1. **Needs a person now:**
   - conflict copies: any `runs/*/*/run*.json` other than `run.json` (two versions of one run)
   - version clashes: two complete publications with the same `v<N>` for one process
   - publications still syncing or damaged: a version folder missing `map.md`, `types.json` or `publication.json`, or missing a screenshot listed under `images` in `publication.json`
   - unusable publications: versions the checker reports as `unusable` (written by a newer Flightdeck, or edited with syntax or step types it doesn't know), with its reason; Flightdeck won't run them
   - drafts that won't publish: a `## Questions…` section, missing IDs or types
   - broken team files from the checker's `teamFiles` (a step type whose file name doesn't match its id, unreadable JSON, a workflow without statuses)
2. **Checklists:** one row per process: newest published version, publisher and date (from `publication.json`), whether the draft has unpublished changes (compare the draft with the newest `map.md`), and the last run date.
3. **Runs:** running now (title, recorder, current phase if you can tell), and ended in the last 14 days with their outcome and any follow-ups.
4. **Plans** in `proposals/`: pending ones (no `<plan id>.status-*.json`), decided ones, and **ambiguous** ones to report rather than judge: a plan file changed after its decision was written, or more than one decision for the same plan. Flightdeck treats a decision as applying only to the exact plan content it was made on.
5. **Skills** in `skills/` that implement an older version than the newest publication (`implements: <process>@v<N>`).

Keep it scannable: short tables, nothing about processes with nothing to report. End with up to three suggested next actions, each naming the skill to use (`/flightdeck-edit-checklist`, `/flightdeck-learn-from-runs`, `/flightdeck-plan-run`).

Remember that OneDrive may be up to a minute behind, so say what you read, not what is guaranteed.
