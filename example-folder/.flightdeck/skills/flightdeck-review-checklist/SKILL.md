---
name: flightdeck-review-checklist
description: "Use when asked to review, check or proofread a Flightdeck checklist (or all of them) before it's published: reports format errors and quality problems, read-only"
---

Read-only: don't create, edit or delete files. The only command you may run is `flightdeck draft read`, below, which only reads.

Reference: `../_flightdeck/map-format.md` and `../_flightdeck/good-checklists.md` (relative to this skill's folder). Read them before you start.

Review a Flightdeck checklist and report what to fix. **Do not change any file.**

The person's request names the checklist to review: a process ID, a path, or "all".

Read `AGENTS.md` in this team folder, then the draft from `maps/drafts/` (for "all", every `.md` there). The checklist format and the guide to good checklists are in the reference files above.

This is a careful manual review. **Flightdeck's own checks on the checklist's page are the authority**: if they disagree with you, they win.

When `flightdeck` is installed, also run `flightdeck draft read <team folder> <process> --json` for each draft (add `--or-latest` to review the published version when there's no draft) and read `checks.blockers` and `checks.suggestions`: they come from Flightdeck's own checker. They're incomplete: the command doesn't load the team's people, step types, Jira workflows or other processes, so a step using one of the team's types in `step-types/` shows as an unknown type, Jira transitions aren't checked, and every linked process and owner is reported as missing. Check those yourself against `step-types/`, `jira/workflows.json`, `publications/` and `people.json`, and never call valid use of a team step type an error. Screenshots in the folder and `version:` pins are checked only when someone publishes.

## Check, in this order

1. **Blocks publishing** (Flightdeck will refuse it; the full list is *What stops a checklist from publishing* in the checklist format):
   - front matter: missing `process` or `title`; `process` not lowercase letters, numbers and dashes; a line that isn't `key: value`; a `format:` or `features:` line that doesn't fit what the checklist uses (Flightdeck writes neither, so recommend removing any); `runs:` other than `solo` or `team`
   - `context`: more than 40 run details; a name that isn't letters, numbers, dashes or underscores up to 60 characters; a name Flightdeck keeps for itself (`constructor`, `__proto__`), for roles too; `name:text`, an unknown kind, a name listed twice with a kind, or a `choice` with fewer than 2 or more than 20 options, an option over 40 characters or holding `, | ( ) :`, or options that differ only in capitals
   - no phases; a phase with no steps; a step, track or gate outside a phase or after its phase's gate; a second gate on a phase; a gate option other than `owner @role`
   - a phase, track, step or written gate without an `{#id}`, an ID over 60 characters, or an ID used twice (including the automatic `<phase>-confirm` gate IDs)
   - a step with no type or an unknown type (a team type with no valid `step-types/<id>.json`); a field the type doesn't have (`pull:`, `action: approve` or `require: checks` on `{bitbucket.pr}`, say); a choice value outside its list (`action:`, `evidence:`); `require:` naming evidence the type doesn't record; `options:` with fewer than two choices
   - `expect:` not a duration like `20m` or `1h30m`; `deadline:` not `external` or a duration; `at:` or `due:` not a time like `15:00`; `after:` not a duration; more than one of `at:`, `due:` and `after:` on a step or gate
   - `@role` (on a step, track or gate owner) not listed in `roles`; `^detail` in a step's text or a gate's `approves:` not listed in `context`
   - a track with no name or no steps, or naming an unknown role; a note under a track heading
   - `sets:` naming a detail that isn't in `context`; two `sets:` names too alike to tell apart
   - a `{run.process}` step running its own process, carrying a detail that isn't in `context`, or both carrying and setting the same detail; a `version:` that isn't a whole number, or names a version that isn't there, is published twice or can't be used
   - a `skillVersion:` that isn't a version like `1.2.0`, or one on a step without `skill:`
   - with `jira/workflows.json` present: a transition to a status the issue type doesn't have or no transition reaches, or a workflow file that can't be read
   - a screenshot path outside `images/` or with characters other than letters, numbers, `_`, `-`, `.` and `/`, or one that isn't in the folder
   - `only when`: a line that can't be read; one testing a detail not in `context`; `is`, `is not`, `is one of`, `is at least` or `is at most` on a plain-text detail (only `is set` and `is not set` work there), or a test the detail's kind doesn't allow; more than 4 on one step or phase; one on a gate or a track; one testing a detail set (`sets:`) in the same phase or a later one
   - a `## Questions…` section still present; a line Flightdeck can't parse
2. **Quality** (it publishes, but people will stumble):
   - a phase over 9 steps; a step over about 12 words; filler openings ("Make sure…")
   - too many must-dos, or a dangerous step that isn't one
   - a generic `{ui.action}` where a specific type fits (Jenkins, Bitbucket, Jira)
   - a step that depends on a commit or environment without `^commit` or `^environment`
   - a gate that approves something important without `owner` or `approves:`
   - a one-person routine without `runs: solo`, or team wording in a solo checklist
   - tracks for work that is really one after another; times on steps that have no real clock
   - a `{run.process}` without `process:` (only a tip: it publishes, but the recorder has to fill in which process to start), or one that names a process with no published version yet (it publishes, but can't start the child)
   - secrets, tokens, customer data or real credentials anywhere
3. **Tips:** usual fields left out (fine if the value varies per run), missing `>` notes on tricky steps.

## Report

For each checklist, a table: **Level** (Blocks / Fix / Tip), **Where** (line and ID), **What**, **Replacement** (the exact replacement line when you can). End with a one-line verdict: "Ready to publish", "Publishable, with fixes worth making", or "Won't publish yet". Suggest `/flightdeck-edit-checklist` to apply the fixes. When it's ready, the person's next step is in Flightdeck: **Practice** the draft on the real run screen (nothing is recorded), then **Review & publish**, or stage it for a test run first.
