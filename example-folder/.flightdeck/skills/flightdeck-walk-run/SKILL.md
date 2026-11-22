---
name: flightdeck-walk-run
description: "Use when asked to walk a person through a running Flightdeck run, step by step (\"walk this run with me\", \"what's next on the release?\"): reads where the run stands with flightdeck next and run, says what is next, files a report through flightdeck report for work you did on a step, asks for found work through flightdeck todo, and stops for the person at every gate, decision and irreversible action. The person checks steps in Flightdeck"
---

Walk a person through one running Flightdeck run, one step at a time. You read where it stands, say what is next in plain words, and help with the step. You never write `run.json`, never answer a step, never pass a gate and never write a file in `reports/` or `proposals/` by hand. **The person checks every step, decides every decision and passes every gate in Flightdeck.**

The person's request names the run (`<process>/<run id>`, from **Copy run key** in the run's **More** menu) and often who they are. If it names neither, ask for the run key; don't guess one.

Read `AGENTS.md` in this team folder first. You use four commands only: `flightdeck next`, `flightdeck run`, `flightdeck report` and `flightdeck todo`. How they work: *Reading runs* in the command guide, *Reporting work* in the command guide, and *Asking for a run* in the command guide, under To-dos.

## Each turn

1. **Read where the run stands:** `flightdeck next <team folder> <process>/<run id> --contract 2 --json`, with `--person <person id>` when you know who you are walking with. If the exit code is 4, say what `problems` names and stop: part of the run couldn't be read, so what is next isn't known. Exit 5 means there is no such run: ask for the key again.
2. **Read the step itself:** `flightdeck run <team folder> <process>/<run id> --contract 2 --json`. Find `next.step.id` in `run.steps`: its `type`, `must`, `roles`, `state` and `evidence` (what it records, and which of it is `required`). The run's `recorder` checks steps; `roles` says who each role is.
3. **Say what is next,** in the run's own words: `next.headline.text` and `detail`, the step's `text`, whose it is (`next.step.roles` with each `person`, or the recorder when it has none), and what it asks to record. Name parallel tracks (`next.tracks`) and to-dos holding a gate (`next.todos.holds`) as they are. With `--person`, say `mine` too: that person's own next step, or that nothing waits on them.
4. **Then act by `next.kind`,** as below, and wait for the person.
5. **After the person says they've done it,** read `next` again and say what changed. Never say a step is done until `run.steps` shows it `done`. Over OneDrive, what you read may be a minute behind: if the step still shows open, say so and read again later.

## By kind

- **`step`:** help with the step as the sections below say. The person checks it in Flightdeck.
- **`gate`:** stop. Say the gate's `title`, its `status` and its `owner` (a role: say who holds it from `run.roles`), and what it approves (`headline.detail`). Passing it is the owner's decision in Flightdeck. Never ask for a to-do, a report or anything else to make it pass, and never say it is safe to go on: a passed gate is passed for those details, by that person, at that time.
- **`blocked`:** say what blocks it (`headline`, and the step's `reason` in `run`). A linked step held by its child's result (`heldBy`) or awaiting its recorder (`awaiting`) is settled only by the recorder, in Flightdeck.
- **`paused`:** say it is paused and by whom, if `run` says. Only a person resumes it.
- **`complete`:** every step and gate is answered. Ending the run is the recorder's, in Flightdeck. Say so, and stop.
- **`ended`:** say the outcome as `run` gives it (like `Completed · needs-work`), and stop.

## Stop for the person

Stop, say what the person must do or decide, and wait for them, never guessing their answer:

- **Every gate** (above).
- **Every decision:** a `decide` step, a `must` step the person might mark not needed, a choice between options, a to-do to drop or move, anything that sends an approval back for review.
- **Anything irreversible or outside the team folder:** merging, deploying, starting a job, running a command, posting a message, approving in another tool, changing or closing a ticket. A step's `type` (`bitbucket.pr`, `deploy`, `jenkins.job`, `run.command`, `ui.action`, `communicate`, `jira.issue`) and its text hint at it, but nothing in the run says for certain whether a step can be undone: when in doubt, treat it as irreversible. Do one only when the person tells you to do that exact step now, and say what it will change first.

## Reporting work you did

When you did a step's work yourself and the person asked you to (you read the CI result, you checked the dashboard, you looked up the change request), file a report so the recorder can accept it in Flightdeck. A report is a claim: it never checks the step.

1. **Check that the step takes one:** `flightdeck report targets <team folder> --run <process>/<run id> --json`. Use a step only when its `accepts` is true; otherwise say its `why`. Never report on a `decide` step (the decision is the person's) or on a gate, and never report work you didn't do or see.
2. **Write the report** to a file: `format` `flightdeck-report/1`; `run`; `publication.folder` (the run's `folder` from `run`); `step`; `verdict` (`pass` only when the work plainly passed; else `fail` or `blocked` with `blockers`); `evidence` under the names the step records (a plain step's is `evidence`); an `inputs` entry `detail:<name>` for each detail in the step's `binds` you examined, with the value you saw; `producer` (your tool's name in lowercase with dashes, and its version); a `summary` of what you did. Give it your own `id` (8 to 16 lowercase letters and numbers) so retrying writes nothing twice. Never put a secret's value in it.
3. **Check it, then write it:** `flightdeck report check <file> --folder <team folder> --json`, then `flightdeck report write <team folder> <file> --json`. Say each warning. `written` or `already` means it is filed: tell the person the recorder can accept it on the step in Flightdeck, never that the step is done. On `failed`, retry with the same file and `id`.

## Work found along the way

When the walk turns up something that must happen before a gate (a value to confirm, a missing sign-off), ask for a to-do, as `/flightdeck-living-run` does:

1. **Preview it:** `flightdeck todo add <team folder> <process>/<run id> --text "..." --phase <phase id> --tool <name>@<version> --key <key> --dry-run --json`. Pick a key that names this one change (like `release-41-add-flag-check`).
2. **Say the preview** (`data.preview`): the gate it comes before, who must approve it and what it would send back for review (`consequence.reopens`). When that isn't empty, ask the person first.
3. **Write it** with the same command, without `--dry-run`, and say it is waiting for approval, never that it is done. Read what is open with `flightdeck todo list <team folder> <process>/<run id> --json`.

## Never

- Never check, answer, skip or mark a step not needed, pass or waive a gate, pause, resume or end a run. A person does each in Flightdeck.
- Never say "done", "passed" or "safe" from what you expect: only from what `next` or `run` shows now.
- Never take an irreversible action because a gate passed or a report was filed.
- Never use a new key or `id` to retry a request or a report: it could ask twice.
- Never put secrets, tokens or customer data in a report, a to-do or what you say back.

Remember that OneDrive may be up to a minute behind, so say what you read, not what is guaranteed.
