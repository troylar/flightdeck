---
name: flightdeck-status
description: "Use when asked how things stand in a Flightdeck team folder (what needs attention, what's running, what's planned, which checklists or skills are out of date): a short read-only status"
---

Read-only: don't create, edit or delete files. The only commands you may run are the folder check below and, when `flightdeck` is installed, its read-only JSON commands named below.

Give a short status of this Flightdeck team folder. **Do not change any file.**

If the person's request names a focus (a process, runs, plans, skills), report on that; otherwise report on the whole folder.

Read `AGENTS.md` first. Then run, from the team folder:

    python3 .flightdeck/skills/_flightdeck/check_folder.py

(`python` or `py` on Windows.) If the skills were installed somewhere other than `.flightdeck/skills`, run the `_flightdeck/check_folder.py` next to this skill's folder instead, with the team folder as its argument.

It prints, as JSON and exactly as Flightdeck judges them: every published version's status, the current version and any clash per process (`publications`), each plan's status (`plans`: pending, decided or ambiguous; `refused` and `unreadablePlans`), runs with conflict copies (`conflicts`) or many leftover save receipts (`receipts`), problems in the team's `step-types/` and `jira/workflows.json` files (`teamFiles`), and every registered skill as Flightdeck matches it (`skills`). Use it for sections 1, 2, 4 and 5.

When `flightdeck` is installed, use its read-only commands for runs and follow-ups instead of rebuilding them by hand: `flightdeck runs <team folder> --contract 2 --tests --json` (each run's state, outcome and whether it's a test run), `flightdeck followups <team folder> --status open --contract 2 --json`, and `flightdeck next <team folder> <process>/<run id> --contract 2 --json` for what a running run waits on. They change nothing. Exit 4 means part of the folder couldn't be read: say what `problems` names. Without the command, look through the rest by listing and reading files.

## Report, in this order

1. **Needs a person now:**
   - conflict copies: any `runs/*/*/run*.json` other than `run.json` (two versions of one run)
   - version clashes: two complete publications with the same `v<N>` for one process
   - publications still syncing or damaged: a version folder missing `map.md`, `types.json` or `publication.json`, or missing a screenshot listed under `images` in `publication.json`
   - unusable publications: versions the checker reports as `unusable` (written by a newer Flightdeck, or edited with syntax or step types it doesn't know), with its reason; Flightdeck won't run them
   - drafts that won't publish: a `## Questions…` section, missing IDs or types
   - broken team files from the checker's `teamFiles` (a step type whose file name doesn't match its id, unreadable JSON, a workflow without statuses)
   - skills the checker lists as `unmatched`, with their `why`
2. **Checklists:** one row per process: newest published version, publisher and date (from `publication.json`), whether the draft has unpublished changes (compare the draft with the newest `map.md`), the last run date, and corrections in its runs (notes with `"kind": "correction"`) that have no decision yet in `corrections/<process>/` (the process page in Flightdeck has the exact grouped count). Name any **open stage**: a `staged/<process>/stage-<id>/` with a `publication.json` that no publication's `stagedFrom` names and whose latest decision in `staged/<process>/decisions/` isn't `retired`. Report it as "staged for test runs, not the default yet", never as a published version.
3. **Runs:** running now (title, recorder, current phase if you can tell), and ended in the last 14 days with their outcome and any open follow-ups. Label every test run (`"test": true`) as a test run of a staged version, and leave test runs out of any counts; still list their open follow-ups.
4. **Plans** in `proposals/`: pending ones (no `<plan id>.status-*.json`), decided ones, and **ambiguous** ones to report rather than judge: a plan file changed after its decision was written, or decisions on the same plan that disagree. A decision on an earlier version of a plan still holds it: Flightdeck won't start it again, and the way to run it again is a new plan. So does a decision on it that can't be read (still arriving) or that Flightdeck refuses (made with a newer Flightdeck, or not in its format): the plan is ambiguous, and its `why` says, in Flightdeck's words, which file to fix or delete. `refused` names every file in `proposals/` Flightdeck refuses, with its reason; a plan listed there (a newer one, or a `flightdeck-plan/2` not in its format) is never a plan to start, so report it, never as pending. A plan with `runMissing` was started, but its run isn't in the folder: it may still be syncing; if it never arrives, a new plan runs it again (never delete the decision). When copies of a plan differ and name different processes, `runMissing` checks only the first copy's process (the file under the plan's own name); the plan is ambiguous either way. `unreadablePlans` lists files in `proposals/` that aren't complete JSON; one marked `unnamed` has a name that doesn't say which plan it's for, so report it: restore it from a backup, or delete it if it's a stray copy.
5. **Skills:** from the checker's `skills`, each `current` skill that was built from an older version than the process's current one. For `source: "registration"`, read its `file` in `skill-registrations/<name>/`: `implements.folder` is the exact version it was built from. For `source: "legacy"`, read `skills/<name>.json`: `implements` is `<process>@<N>`. Compare that with the process's current version from `publications`.

Keep it scannable: short tables, nothing about processes with nothing to report. End with up to three suggested next actions, each naming the skill to use (`/flightdeck-edit-checklist`, `/flightdeck-learn-from-runs`, `/flightdeck-plan-run`, `/flightdeck-skill-brief`).

Remember that OneDrive may be up to a minute behind, so say what you read, not what is guaranteed.
