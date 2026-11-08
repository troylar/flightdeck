# Writing a checklist people will actually use

Flightdeck checklists follow *The Checklist Manifesto* (Atul Gawande). A checklist doesn't teach a job; it catches the steps that skilled people skip when they're busy, tired or interrupted.

## Design before syntax

A checklist is a design, not a transcription. Before you write a line of the format, agree a short design brief with the checklist's owner:

- **Purpose and outcome:** what the checklist proves when it's done, and for whom.
- **Who runs it:** one person or a team, and the roles.
- **Pause points:** where people stop and check. Each becomes a phase, and its gate.
- **Decisions:** which calls need a person's verdict (READY or NOT READY, go or no-go), and who makes them.
- **What already exists:** the checklists, searches, gates and step types in the library this one should link to, reuse or stay clear of (see *Look across the library*).
- **The shape:** one checklist, several, or a parent that links to children (see *One checklist or several*).

Get the owner's yes on the brief before you draft. If the person says "just draft it", draft it and put the open points of the brief under `## Questions for the owner`.

## Look across the library

Every new checklist and every change starts by reading what the team already runs: `flightdeck library inspect <team folder> --json` (`--process <id>` for one checklist and what touches it). It lists each checklist's steps, searches and gates, which checklists link to which (`usedBy`), what looks alike (`overlaps`, each with a `reason`) and which checklists use each step type.

- An overlap is a reason to look, never proof. Two searches with the same JQL can differ in scope, owner or authority. Say what you found and what you think it means.
- **Never change another checklist as part of this work.** If the library shows overlap, a gap or a better shared piece, write it up separately as a realignment proposal: what, where (process and step IDs), why, and who owns it. Change another checklist only after its owner says yes, as its own piece of work.
- If `completeness.complete` is false, some checklists couldn't be read: say so, and don't claim there's no overlap.

## One checklist or several

- **Keep one checklist** when one person or team runs it start to finish, at one time, with one outcome.
- **Split** when parts run at different times, by different teams, or are useful on their own. Each part becomes its own checklist.
- **Nest** (a `{run.process}` step in a parent) when a part is several steps with its own result that the parent depends on, or when two or more checklists need the same part. Link to it; never copy another checklist's steps in.
- **A note, not a checklist,** when it's guidance: how to read a dashboard, what a field means.

## When the source is an AI skill or a script

A skill or script says how a tool does the work. A checklist says what people must be able to check. Don't copy one into the other.

- **Mechanics stay in the source:** API calls, pagination, retries, parsing, how a tool reads Jira. They don't become steps.
- **Consequences become checkpoints:** what the tool's result means for the people running the checklist ("the release has no open blockers"), the evidence they keep, and the decision they make on it.
- **A `{run.skill}` step means "run this skill now".** Its `skill:` and `skillVersion:` say which skill to run, never where the checklist came from. Say where it came from in a `>` note.

## Work repeated per item

Some work repeats for each item in a set: each environment to deploy to, each document to review, each person in an onboarding cohort, each service to health-check, each story in a release.

- **A fixed, short set** (three environments): one step per item.
- **A set that changes each run** (Flightdeck 3.0): a `{for.each}` step over a checklist that returns a result, with `items: item` for a list kept by hand or synced by one tool (`source:`), or `from:` naming the `{jira.search}` that finds a set of Jira stories. Each item gets its own run, and the step is approved only when every item is cleared or approved without a run. See map-format.md, Loops.

Never write "every environment is ready" as one `{confirm}`: nobody can tell which items were looked at.

## What makes a good checklist

- **Pause points, not procedures.** Each phase ends where people naturally stop: before a merge, before production, after the deploy. That's where the gate goes.
- **Short phases.** At most 9 steps; fewer is fine, and never pad one. Past 9, split at a natural stopping point.
- **One line per step,** about 12 words or fewer, naming an action or a state to confirm: "Rollback commit written in the release ticket". Explanations go in a `>` note under the step.
- **No filler.** Never start a step with "Make sure", "Ensure", "Don't forget" or "Remember to".
- **Must-dos are rare.** Mark `[!]` only where skipping the step causes real harm (a broken release, lost data, a missed approval). If everything is a must-do, nothing is.
- **READ-DO or DO-CONFIRM, on purpose.** READ-DO: read a step, then do it (unfamiliar or risky work, like a deploy). DO-CONFIRM: experienced people work from memory, then stop and confirm (routine prep).
- **The most specific step type.** A Jenkins job is `{jenkins.job}`, a pull request is `{bitbucket.pr}` or `{github.pr}`, a Jira change is `{jira.issue}`, what a Jira search must find is `{jira.search}` (one rule per search, starting with a scope search: `results: at least 1`), starting or closing a sprint is `{jira.sprint}`, a deploy is `{deploy}`, watching a dashboard afterward is `{verify.health}`, and a number worth keeping is `{measure}`. Use `{ui.action}` only for tools without their own type.
- **A verdict is a `{decide}` step.** READY or NOT READY, go or no-go: a `{confirm}` records only that someone looked, not which way it went.
- **A search says what must be true.** `results: none` for "no open blockers", `results: at least 1` for a scope search. `results: any` passes whatever the search finds, so use it only to collect facts. Write a run detail in JQL without quotes (`fixVersion = ^version`): Flightdeck quotes the value itself.
- **Fields describe; they don't have to be complete.** Fill in what's stable (the job name, the repo, the Jira action). Leave out what changes each run; people fill it in during the run.
- **Evidence only where it matters.** `require: build` on a production deploy, `require: all` on a merge to master. Most steps need none, so they check in one click.
- **Tie steps to what they depend on.** If a step is only valid for one commit or environment, add `^commit` or `^environment`. If that detail changes mid-run, the step comes back for a re-check, and so does any gate that approved it.
- **Solo checklists say so.** A developer's or product owner's routine gets `runs: solo`, one role or none, and no "together" steps.

## When a step type earns its place

Check the built-in types and the team's `step-types/` first (`flightdeck type list`). A new team type earns its place only when it changes what a step records or checks (its fields, its evidence or its validation) and either two or more checklists need it, or the evidence is more structured than a `{confirm}` with a note can hold. Never make a type for one search or one report. A new type needs the folder owner's yes, through `/flightdeck-new-step-type`; propose retiring a type no checklist uses.

## What a gate is for

A gate is the moment someone with authority says "this phase is done, for these details". Give it an `owner @role` when one person must approve. Give it an `approves:` line naming exactly what's being approved: "deploy of `^commit` to ^environment". Leave a phase without a written gate when "confirm and continue" is enough: Flightdeck adds that gate itself, so never write a step that only says the phase is done.

## Checking your work

Run the checks before you report, and say which ran:

1. `flightdeck draft check <team folder> <process> --from <file> --json`: the Publish dialog's verdict, and its design tips.
2. If `flightdeck` isn't installed, `npx @troylar/flightdeck@<version> draft check …`, where `<version>` is the `version` in `.flightdeck/installed.json` (only if the person allows npx).
3. Otherwise `python3 .flightdeck/skills/_flightdeck/check_folder.py <team folder> --draft <file>`: some of the checks, offline. Report its `notRun` list.
4. If none of these can run, say "Flightdeck checks not run" in your report. Never call a checklist ready to publish without them.

Design tips are advice. Fix the ones that point at a real problem; say why you kept the others.

## Honesty rules

- Every step must come from a source: a runbook, notes, a ticket, or the person you're talking to. Never invent a step to make a phase look complete.
- If something is unclear, write it under `## Questions for the owner` instead of guessing. Flightdeck won't publish a checklist until the questions are answered and removed.
- Never put secrets, tokens, passwords, customer data or internal credentials in a checklist, a command or a screenshot.
