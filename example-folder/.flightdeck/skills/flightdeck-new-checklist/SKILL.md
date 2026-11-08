---
name: flightdeck-new-checklist
description: "Use when asked to write, draft or create a new Flightdeck checklist for a process, from notes, a runbook, a ticket, an AI skill or a conversation: designs it with the owner, checks the library, and saves it as a draft for a person to review and publish"
---

Reference: `../_flightdeck/checklist-essentials.md`, `../_flightdeck/good-checklists.md` and `../_flightdeck/map-format.md` (relative to this skill's folder). Read the essentials and the guide first; read only the parts of `map-format.md` your checklist needs (a step type's fields, Jira searches, linked processes), when you need them.

Design a new Flightdeck checklist for one process with its owner, then write it as a draft that a person reviews and publishes in Flightdeck.

The person's request says which process to write down, and where its sources are.

You're working in a Flightdeck team folder. Read `AGENTS.md` in this folder first; it says what you may and may never write. The checklist format and the guide to good checklists are in the reference files above; follow both exactly.

**Which command to use.** Run `flightdeck version`. If it isn't installed, and the person allows npx, use `npx @troylar/flightdeck@<version>` in its place, with the `version` from `.flightdeck/installed.json`. If neither works, follow the "Without the command" routes below, and say in your report which checks didn't run.

## Steps

1. **Read the library.** Run `flightdeck library inspect <team folder> --json`. Note the checklists close to this one, the searches, gates and linked checklists it could reuse, the overlaps, and which step types the team already uses. Without the command, list `publications/` and `maps/drafts/` and read the titles, searches and gates of the checklists whose names look related. If a checklist for this process already exists, stop and suggest `/flightdeck-edit-checklist` instead.
2. **Find the sources.** If the request names files (a runbook, notes, a ticket export, a transcript, an AI skill), read them. When the source is an AI skill or a script, follow "When the source is an AI skill or a script" in the guide: its mechanics stay in the skill, and only what people must check becomes steps.
3. **Write the design brief** (see "Design before syntax" in the guide): purpose and outcome, who runs it, the pause points, the decisions and who makes them, what in the library it links to or reuses, and its shape (one checklist, several, or a parent with children). Name any work repeated per item and how the checklist handles it, since Flightdeck can't repeat a step for each item yet. Name any new step type you think it needs and why, against "When a step type earns its place" in the guide.
4. **Ask only what you can't find,** in one message with at most 5 short questions, together with the brief. Typical gaps:
   - Who runs it: one person (`runs: solo`) or a team? Which roles?
   - Where are the natural pause points (the moments people stop and check)?
   - Which steps cause real harm if skipped (the must-dos)?
   - What changes each run (ticket, commit, environment, sprint)? These become `context`.
   - Is evidence needed anywhere (a build number, a PR link)?
   Wait for the owner's yes on the brief before you draft. If the person says "just draft it", draft it and put the open points under `## Questions for the owner`.
5. **Draft the checklist** from the agreed brief:
   - Front matter: `process` (lowercase, dashes, permanent), `title`, `category`, `group` (its place in the team's hierarchy, like `Engineering / Releases`), `tags`, `owner` (a person ID from `people.json`), `backup` (optional: another person ID, who signs off only while the owner is away), `context`, `roles`, and `runs: solo` if it's a one-person routine. Never `format:` or `features:`.
   - Phases at pause points, each marked READ-DO or DO-CONFIRM, with **up to 9 steps**. Fewer is fine; never pad a phase.
   - Every phase, step and written gate gets a short, meaningful ID: `{#rebase}`, not `{#step-3}`.
   - The most specific step type for every step, with the fields that are stable. Leave out values that vary per run. Use the team's own step types where they fit, and only Jira statuses `jira/workflows.json` actually has (with `issueType:` when it has more than one type).
   - A verdict (READY or NOT READY, go or no-go) is a `{decide}` step; a phase that only needs "confirm and continue" gets no gate line and no step saying it's done.
   - A Jira search says what must be true (`results: none`, `results: at least 1`), with a scope search first. Write `^details` in JQL without quotes.
   - A part another checklist already covers is a `{run.process}` step linking to it, never a copy of its steps. When the parent must know the child's verdict, not just that it finished, give the child a `result:` set by its one `{decide}` step (`sets: <detail>=decision`) and the linking step `accepts:` (map-format.md, Module results; Flightdeck 3.0).
   - Work repeated for each item of a list that changes each run (environments to deploy to, documents to review, an onboarding cohort, services to health-check, the stories in a release) is a `{for.each}` step over a checklist with a result (see map-format.md, Loops): `items: item` for any list, `items: jira.issue` for Jira stories, and `noun:` to name the rows. Its list is kept with `flightdeck loop`, never by writing files in `proposals/`.
   - `require:` only on steps where evidence really matters; `^detail` on steps that depend on a run detail; `@role` on steps one role owns; a gate with `owner @role` and `approves:` where approval matters.
   - A value one step creates for later steps (a release tag) goes in `context`, with `sets: <detail>` on that step and `^<detail>` after it. Tracks, times and `only when` only where the source describes parallel work, a real time or a step some runs skip, and only when the team uses the Flightdeck version they need.
   - Explanations, links, gotchas and where the checklist came from in `>` notes. Reference screenshots only if they already exist in `images/`.
6. **Check it yourself** against the format and guide before saving: unique IDs, known types, choice values from the allowed list, roles and `^details` declared in the front matter, no step over about 12 words, no filler openings, no secrets.
7. **Save** with `flightdeck draft save <team folder> <process> --expect none --from <your file> --json`. It writes `maps/drafts/<process>.md` only if no draft is there and nobody has one open; otherwise your checklist is a proposal: it appears in the person's open editor if they have it open with nothing unsaved, or waits for them on the checklist's page (say which in your report). Without the command, check again that the file doesn't exist yet; if it does, stop and report instead of overwriting. Then read `checks.blockers` in its output and fix every blocker before you report the work as done (to save the fix, run `flightdeck draft read` with the same `--session`, then save as `/flightdeck-edit-checklist` does). They're the Publish dialog's checks; run `flightdeck draft check <team folder> <process> --from <your file> --json` for its whole verdict on your text (a proposal included), screenshots and `version:` pins included, and its `design.tips`. If `complete` is false, what `problems` names wasn't checked: say so. Without the command, run `check_folder.py --draft` as "Checking your work" in the guide says, and report its `notRun` list. Never change a valid use of a team step type to make a blocker go away; check the type exists and say Flightdeck's checks on the checklist's page have the final word. Never write `maps/drafts/` yourself when the command is available, and never write to `publications/`, `staged/`, `runs/`, `proposed/` or `presence/`.
8. **Propose realignment separately.** If the library showed overlap, a gap or a part worth sharing with other checklists, describe it in your report as a proposal for their owners: what, which checklists and step IDs, and why. Never change another checklist in this task.

## Report back

- The design brief as agreed, and what the library showed (related checklists, reuse, overlaps, and whether the read was complete).
- The path you wrote, or that it waits as a proposal on the checklist's page.
- A short outline: phases, number of steps, must-dos, gates, linked checklists.
- Any `## Questions for the owner` still open. The checklist can't be published until they're answered and removed.
- Which checks ran (`flightdeck draft check`, the offline checker, or "Flightdeck checks not run"), any blockers you couldn't clear and why, and the design tips you kept and why.
- Any realignment proposal, and any new step type you recommend (for `/flightdeck-new-step-type`, with the folder owner's yes).
- Next step for the person, in Flightdeck: open the draft, read the checks on its page, **Practice** it on the real run screen (nothing is recorded), then **Save draft** and **Publish v1…** at the top right, or **Stage for testing instead** in its dialog if the team wants to try it before it's the default.
