---
name: flightdeck-new-checklist
description: "Use when asked to write, draft or create a new Flightdeck checklist for a process, from notes, a runbook, a ticket or a conversation: saves it as a draft for a person to review and publish"
---

Reference: `../_flightdeck/map-format.md` and `../_flightdeck/good-checklists.md` (relative to this skill's folder). Read them before you start.

Write a new Flightdeck checklist for one process, saved as a draft that a person reviews and publishes in Flightdeck.

The person's request says which process to write down, and where its sources are.

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
   - Front matter: `process` (lowercase, dashes, permanent), `title`, `category`, `group` (its place in the team's hierarchy, like `Engineering / Releases`), `tags`, `owner` (a person ID from `people.json`), `backup` (optional: another person ID, who signs off only while the owner is away), `context`, `roles`, and `runs: solo` if it's a one-person routine. Never `format:` or `features:`.
   - A step or phase only some runs need gets `only when` (Flightdeck 2.1). Comparing a value (`only when ^risk is high`) needs a typed detail in `context` (`risk:choice(low|high)`, Flightdeck 2.0); a plain detail can only be tested with `is set` or `is not set`. Use typed details and `only when` only when the team uses those versions.
   - Phases at pause points, each marked READ-DO or DO-CONFIRM, with **up to 9 steps**. Fewer is fine; never pad a phase.
   - Every phase, step and written gate gets a short, meaningful ID: `{#rebase}`, not `{#step-3}`.
   - The most specific step type for every step, with the fields that are stable. Leave out values that vary per run.
   - `require:` only on steps where evidence really matters.
   - `^detail` on steps that depend on a run detail; `@role` on steps one role owns.
   - A gate with `owner @role` and `approves:` where approval matters.
   - Explanations, links and gotchas in `>` notes. Reference screenshots only if they already exist in `images/`.
4. **Check it yourself** against the format and guide before saving: unique IDs, known types, choice values from the allowed list, roles and `^details` declared in the front matter, no step over about 12 words, no filler openings, no secrets.
5. **Save** with `flightdeck draft save <team folder> <process> --expect none --from <your file> --json`. It writes `maps/drafts/<process>.md` only if no draft is there and nobody has one open; otherwise your checklist is a proposal: it appears in the person's open editor if they have it open with nothing unsaved, or waits for them on the checklist's page (say which in your report). Without the command, check again that the file doesn't exist yet; if it does, stop and report instead of overwriting. Then read `checks.blockers` in its output and fix every blocker before you report the work as done (to save the fix, run `flightdeck draft read` with the same `--session`, then save as `/flightdeck-edit-checklist` does). These checks don't know the team's people, step types, Jira workflows or other processes: a step using a type from `step-types/` shows as unknown, which isn't a reason to change it; check the type exists and say Flightdeck's checks on the checklist's page have the final word. Never write `maps/drafts/` yourself when the command is available, and never write to `publications/`, `staged/`, `runs/`, `proposed/` or `presence/`.

## Report back

- The path you wrote, or that it waits as a proposal on the checklist's page.
- A short outline: phases, number of steps, must-dos, gates.
- Any `## Questions for the owner` still open. The checklist can't be published until they're answered and removed.
- Any blockers from `checks.blockers` you couldn't clear, and why (a team step type the command doesn't know, say).
- Next step for the person, in Flightdeck: open the draft, read the checks on its page, **Practice** it on the real run screen (nothing is recorded), then **Save draft** and **Review & publish**, or stage it for a test run first if the team wants to try it before it's the default.
