---
name: flightdeck-review-checklist
description: Review a Flightdeck checklist for format errors and quality (read-only)
---

Read-only: don't create, edit or delete files, and don't run commands.

Reference: `../_flightdeck/map-format.md` and `../_flightdeck/good-checklists.md` (relative to this skill's folder). Read them before you start.

Review a Flightdeck checklist and report what to fix. **Do not change any file.**

Checklist to review (a process ID, a path, or "all"): the user's request

Read `AGENTS.md` in this team folder, then the draft from `maps/drafts/` (for "all", every `.md` there). The checklist format and the guide to good checklists are in the reference files above.

This is a careful manual review. **Flightdeck's own checks on the process page are the authority**: if they disagree with you, they win.

## Check, in this order

1. **Blocks publishing** (Flightdeck will refuse it):
   - missing `process` or `title`; `process` not lowercase-and-dashes
   - a phase, step or written gate without an `{#id}`, or an ID used twice (including the automatic `<phase>-confirm` gate IDs)
   - a step with no type or an unknown type; a field the type doesn't have; a choice value outside its list (`action:`, `evidence:`, `runs:` must be `solo` or `team`); `require:` naming evidence the type doesn't record; `options:` with fewer than two choices
   - a phase with no steps
   - `expect:` not a duration like `20m` or `1h30m`; `deadline:` not `external` or a duration
   - a screenshot path outside `images/`, or one that isn't in the folder
   - `@role` not listed in `roles`; `^detail` not listed in `context`
   - a track (`### Track:`) outside a phase, after its gate, with no steps, or naming an unknown role
   - `at:` or `due:` not a time like `15:00`; `after:` not a duration
   - `sets:` naming a detail that isn't in `context`
   - a `{run.process}` step without `process:`, running its own process, or carrying a detail it doesn't have
   - with `jira/workflows.json` present: a transition to a status the issue type doesn't have or no transition reaches
   - a step type that isn't built in and has no valid `step-types/<id>.json`
   - a `## Questions…` section still present; a line Flightdeck can't parse
2. **Quality** (it publishes, but people will stumble):
   - a phase over 9 steps; a step over about 12 words; filler openings ("Make sure…")
   - too many must-dos, or a dangerous step that isn't one
   - a generic `{ui.action}` where a specific type fits (Jenkins, Bitbucket, Jira)
   - a step that depends on a commit or environment without `^commit` or `^environment`
   - a gate that approves something important without `owner` or `approves:`
   - a one-person routine without `runs: solo`, or team wording in a solo checklist
   - tracks for work that is really one after another; times on steps that have no real clock
   - a `{run.process}` that names a process with no published version yet (it publishes, but can't start the child)
   - secrets, tokens, customer data or real credentials anywhere
3. **Tips:** usual fields left out (fine if the value varies per run), missing `>` notes on tricky steps.

## Report

For each checklist, a table: **Level** (Blocks / Fix / Tip), **Where** (line and ID), **What**, **Suggested fix** (the exact replacement line when you can). End with a one-line verdict: "Ready to publish", "Publishable, with fixes worth making", or "Won't publish yet". Suggest `/flightdeck-edit-checklist` to apply the fixes.
