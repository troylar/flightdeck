---
name: flightdeck-plan-run
description: Plan a Flightdeck run (who does what, run details) for a person to start
---

Write a planned run for a published Flightdeck process. A person reviews it in Flightdeck and starts it; you never start runs.

What to plan: the user's request

Read `AGENTS.md` in this team folder first.

## Steps

1. **Find the current version** of the process: the **current** version, found by running `python .flightdeck/skills/_flightdeck/check_folder.py` from the team folder (if the skills were installed somewhere other than `.flightdeck/skills`, run the `_flightdeck/check_folder.py` next to this skill's folder instead, with the team folder as its argument): it checks every version's files and fingerprints exactly as Flightdeck does and prints `current` per process. If it reports a `clash`, or no complete version, stop and report it; a person resolves that in Flightdeck. Read its `map.md` for `context` (run details) and `roles`, and note the version `N`.
2. **Fill the details** you were given (ticket, commit, environment, sprint…). Leave unknown ones as empty strings; never invent a ticket number or a commit.
3. **Suggest roles by rotation,** unless the person named people:
   - Read `people.json` (skip anyone with `"inactive": true`).
   - For each role, look at recent runs of this process in `runs/<process>/*/run.json` and suggest whoever has gone longest without that role. Ignore cancelled runs and runs that have conflict copies (another `run*.json` beside `run.json`). Prefer giving someone a role they've never had, paired with an experienced person in the lead role.
   - If the checklist has `runs: solo`, or the person asks for a solo run, assign every role to the one person running it.
4. **Write** `proposals/plan-<process>-<yyyy-mm-dd>-<6 random lowercase letters or digits>.json` (the random part keeps two plans written on two computers from colliding), with the same value as its `id`:

   ```json
   { "kind": "plan", "id": "plan-release-2026-10-24-k3m9p2", "process": "release", "version": 3,
     "title": "Release 2026.10.24", "details": { "ticket": "ABC-123", "commit": "", "environment": "production" },
     "roles": { "release-lead": "person-blake", "qa": "person-morgan" },
     "note": "Rotation: Blake leads for the second time; Morgan takes QA for the first time.",
     "by": "AI assistant", "created": "2026-10-17T13:00:00Z" }
   ```

   Never edit a plan after it's written; if it needs to change, write a new plan and say which one it replaces in `note`.

## Report back

The file written, who's on what and why, which details are still empty, and that the plan now shows on Flightdeck's Home for someone to review and start.
