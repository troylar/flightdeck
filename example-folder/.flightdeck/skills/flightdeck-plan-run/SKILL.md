---
name: flightdeck-plan-run
description: "Use when asked to plan, schedule or set up a Flightdeck run (who does what, its run details): writes a planned run for a person to review and start"
---

Write a planned run for a published Flightdeck process. A person reviews it in Flightdeck and starts it; you never start runs.

The person's request says what to plan: the process, and any details, people or time they gave.

Read `AGENTS.md` in this team folder first.

## Steps

1. **Find the current version** of the process by running `python3 .flightdeck/skills/_flightdeck/check_folder.py` from the team folder (`python` or `py` on Windows; if the skills were installed somewhere other than `.flightdeck/skills`, run the `_flightdeck/check_folder.py` next to this skill's folder instead, with the team folder as its argument): it checks every version's files and fingerprints exactly as Flightdeck does and prints `current` per process. If it reports a `clash`, or no complete version, stop and report it; a person resolves that in Flightdeck. Read its `map.md` for `context` (run details) and `roles`, and note the version `N`.
2. **Fill the details** you were given (ticket, commit, environment, sprint…). Leave unknown ones as empty strings; never invent a ticket number or a commit. Every value is text. For a typed detail (`rows:number`, `due:date`, `approved:yes-no`, `env:choice(dev|test|prod)` in `context`), write it the way its kind stores it: a plain decimal like `1234.5`, `YYYY-MM-DD`, `yes` or `no`, or a choice option exactly as the checklist spells it. Other text is converted only when its meaning is certain; anything else starts empty and waits for a person.
3. **Suggest roles by rotation,** unless the person named people:
   - Read `people.json` (skip anyone with `"inactive": true`).
   - For each role, look at recent runs of this process in `runs/<process>/*/run.json` and suggest whoever has gone longest without that role. Ignore canceled runs (`ended.outcome` is stored as `"Cancelled"`), test runs (`"test": true`: they tried a staged version and never count toward rotation, as Flightdeck's own suggestions don't count them) and runs that have conflict copies (another `run*.json` beside `run.json`). With `flightdeck` installed, `flightdeck runs <team folder> --process <process> --contract 2 --json` lists the runs (it leaves test runs out), and `flightdeck run <team folder> <process>/<run id> --contract 2 --json` gives each one's roles. Prefer giving someone a role they've never had, paired with an experienced person in the lead role.
   - If the checklist has `runs: solo`, or the person asks for a solo run, assign every role to the one person running it.
4. **Write** `proposals/plan-<process>-<yyyy-mm-dd>-<6 random lowercase letters or digits>.json` (the random part keeps two plans written on two computers from colliding), with the same value as its `id`:

   ```json
   { "kind": "plan", "id": "plan-release-2026-10-24-k3m9p2", "process": "release", "version": 3,
     "title": "Release 2026.10.24", "details": { "ticket": "ABC-123", "commit": "", "environment": "production" },
     "roles": { "release-lead": "person-blake", "qa": "person-morgan" },
     "when": "2026-10-24T13:00:00Z",
     "note": "Rotation: Blake leads for the second time; Morgan takes QA for the first time.",
     "by": "AI assistant", "created": "2026-10-17T13:00:00Z" }
   ```

   Add `when` (ISO date and time) only if you were told when it runs. Never edit a plan after it's written; if it needs to change, write a new plan and say which one it replaces in `note`.

## Report back

The file written, who's on what and why, which details are still empty, and where people will see it: under Runs › Planned in Flightdeck, and on Home when it's due within 24 hours (or right away if it has no `when`), for someone to review and start.
