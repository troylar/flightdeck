---
name: flightdeck-new-checklist
description: Write a new Flightdeck process checklist from notes or a talk
---

Reference: `../_flightdeck/map-format.md` and `../_flightdeck/good-checklists.md` (relative to this skill's folder). Read them before you start.

Write a new Flightdeck checklist for one process, saved as a draft that a person reviews and publishes in Flightdeck.

The process to write down: the user's request

You're working in a Flightdeck team folder. Read `AGENTS.md` in this folder first; it says what you may and may never write. The checklist format and the guide to good checklists are in the reference files above; follow both exactly.

If the folder has `step-types/` or `jira/workflows.json`, read them too: use the team's own step types where they fit, and only Jira statuses the workflow actually has (with `issueType:` when it has more than one type). Use tracks, `at:`/`due:`/`after:` times and `{run.process}` steps only where the source describes parallel work, a real time, or another process run inside this one. When one step creates a value later steps use (a release tag, a build number), list it in `context`, add `sets: <detail>` to that step and use `^<detail>` after it.

## Steps

1. **Find the sources.** If the request names files (a runbook, notes, a ticket export, a transcript), read them. Check `maps/drafts/` and `publications/` (list the files): if a checklist for this process already exists, stop and suggest `/flightdeck-edit-checklist` instead.
2. **Ask only what you can't find,** in one message with at most 5 short questions. Typical gaps:
   - Who runs it: one person (`runs: solo`) or a team? Which roles?
   - Where are the natural pause points (the moments people stop and check)?
   - Which steps cause real harm if skipped (the must-dos)?
   - What changes each run (ticket, commit, environment, sprint)? These become `context`.
   - Is evidence needed anywhere (a build number, a PR link)?
   If the person says "just draft it", draft it and put the open points under `## Questions for the owner`.
3. **Draft the checklist:**
   - Front matter: `process` (lowercase, dashes, permanent), `title`, `category`, `owner` (a person ID from `people.json`), `context`, `roles`, and `runs: solo` if it's a one-person routine.
   - Phases at pause points, each marked READ-DO or DO-CONFIRM, with **up to 9 steps**. Fewer is fine; never pad a phase.
   - Every phase, step and written gate gets a short, meaningful ID: `{#rebase}`, not `{#step-3}`.
   - The most specific step type for every step, with the fields that are stable. Leave out values that vary per run.
   - `require:` only on steps where evidence really matters.
   - `^detail` on steps that depend on a run detail; `@role` on steps one role owns.
   - A gate with `owner @role` and `approves:` where approval matters.
   - Explanations, links and gotchas in `>` notes. Reference screenshots only if they already exist in `images/`.
4. **Check it yourself** against the format and guide before saving: unique IDs, known types, choice values from the allowed list, roles and `^details` declared in the front matter, no step over about 12 words, no filler openings, no secrets.
5. **Save** with `flightdeck draft save <team folder> <process> --expect none --from <your file> --json`. It writes `maps/drafts/<process>.md` only if no draft is there and nobody has one open; otherwise your checklist is a proposal: it appears in the person's open editor if they have it open with nothing unsaved, or waits for them on the process page (say which in your report). Without the command, check again that the file doesn't exist yet; if it does, stop and report instead of overwriting. Never write `maps/drafts/` yourself when the command is available, and never write to `publications/`, `runs/`, `proposed/` or `presence/`.

## Report back

- The path you wrote, or that it waits as a proposal on the process page.
- A short outline: phases, number of steps, must-dos, gates.
- Any `## Questions for the owner` still open. The checklist can't be published until they're answered and removed.
- Next step for the person: open the process in Flightdeck, read the checks on its page, and publish.
