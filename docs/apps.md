# Using Flightdeck from other apps

> **For:** anyone writing a script, bot or tool that works with a Flightdeck team folder, and AI assistants that edit checklists.
>
> **You'll get:** the commands, the exact JSON they print, what each exit code means, and the promises behind them.

Flightdeck is a checklist tool for people: a monthly backup check, a quarterly access review, onboarding a new hire, closing the month, a release. Other apps can work beside a run the way a teammate would: look at it, then let the people decide. Everything works offline, on the team folder itself, through the `flightdeck` command. There's no server and nothing to sign in to.

| An app can | With | Since | Changes the folder? |
|---|---|---|---|
| **Read** checklists, runs, what's waiting and on whom, and follow-ups as JSON | `flightdeck processes`, `process`, `runs`, `run`, `next`, `followups` | 1.18 | Never |
| **Ask for a run**: a planned run that a person reviews and starts in the app ([Asking for a run](#asking-for-a-run)) | `flightdeck plan request` | 1.20 | Writes one file in `proposals/` |
| **Report** the work it did on a step: a person accepts it (the step is checked with its evidence) or declines it ([Reporting work](#reporting-work)) | `flightdeck report` | 2.0 | Writes one file in `reports/` |
| **Read and save drafts** of checklists (AI assistants; contract `flightdeck-draft/1`, [at the end of this page](#writing-drafts-for-ai-assistants)) | `flightdeck draft` | 1.19 | Writes the draft or a proposal |

A report never checks a step by itself, and a request never starts a run by itself. A person always decides.

**On this page:** [What reading promises](#what-reading-promises) · [Commands](#commands) · [The envelope](#the-envelope) · [The data](#the-data) · [Contract 2](#contract-2-flightdeck-20) · [A walkthrough](#a-walkthrough) · [Asking for a run](#asking-for-a-run) · [Reporting work](#reporting-work) · [Writing drafts](#writing-drafts-for-ai-assistants) · [Registering a skill](#registering-a-skill-for-ai-assistants)

## What reading promises

- **It only reads.** The JSON commands never change a file in the team folder, not even the tidying the app does when it opens a run (removing a save receipt that lost nothing). They read through a view of the folder that refuses every change, and never through a link.
- **It reads now, with the app's own rules.** What's next, a gate's status and a step's evidence come from the same code the app runs, from this install's own `flightdeck.html`. Another computer may be a minute ahead while the shared folder syncs.
- **Every problem is named, file by file.** While it reads, the command keeps a list of problems: every folder or file that failed to list or read (including a screenshot whose bytes failed after it was opened), was too large, was a link, or was listed and then gone before it could be read or listed, and every file whose contents aren't in the format (a run, plan, decision, version or `people.json`). A file is never silently left out and a bad value is never replaced with a default. If the list has anything, the output names each file and why, `complete` is `false` and the exit code is 4. The data that could be read is still printed.
- **A passed gate is a record, not permission.** It means passed for those details, by that person, at that time. Nothing an app reads is permission to act.
- **Privacy:** People-directory email fields are omitted. People appear as an ID and a name. Titles, details, evidence and notes may contain anything people typed, emails included.

## Commands

Every command takes the team folder's path and `--json`. Without `--json` it exits 1 and says to add it.

| Command | `data` holds |
|---|---|
| `flightdeck processes <folder> --json` | Every process with its versions |
| `flightdeck process <folder> <process> [--version N \| --folder v3-… \| --stage stage-…] --json` | One version of a checklist: phases, steps, gates, run details, roles, step types, and the evidence each step can record. The latest usable version unless you name one; `--stage` (contract 2) reads a staged version. |
| `flightdeck runs <folder> [--process <id>] [--status running\|planned\|ended\|all] [--tests] --json` | Runs and planned runs (`all` unless you say); `--tests` (contract 2) lists test runs too |
| `flightdeck run <folder> <process>/<run id> --json` | One run in full: each step's state, who and when, its values and the evidence this run asks for, gates, follow-ups |
| `flightdeck next <folder> <process>/<run id> [--person <id>] --json` | What's waiting in the run and on whom; with `--person`, that person's own next step too |
| `flightdeck followups <folder> [--process <id>] [--status open\|all] --json` | Every follow-up and what became of it |

A run's key is `<process>/<run id>`, for example `backup-check/k3m9p2q8`. In the app, a run's **More** menu has **Copy run key**.

`--contract 1` asks for this contract by number. A number this copy doesn't have exits 1 and names the ones it has. Without `--contract`, you get contract 1 (`flightdeck-read/1`), exactly what Flightdeck 1.x printed. `--contract 2` (`flightdeck-read/2`) reads what Flightdeck 2.0 writes; see Contract 2 below.

### Exit codes

| Code | Means |
|---|---|
| `0` | Complete: everything in scope was read. |
| `4` | Partial: the data is printed, and `problems` names every file or folder that couldn't be read. `complete` is `false` exactly when the code is 4. |
| `1` | No data: the folder couldn't be read, the command was used wrongly, or the contract asked for isn't here. With `--json`, an error object is printed. |
| `5` | Not found: no such process, version or run. With `--json`, an error object is printed. |

## The envelope

Every successful command prints one object:

```json
{ "contract": "flightdeck-read/1", "app": "1.18.0", "readAt": "2026-10-24T13:42:05.000Z",
  "complete": false,
  "problems": [ { "path": "runs/backup-check/k3m9p2q8/run.json", "kind": "nofile", "why": "The run folder has no run.json." } ],
  "note": "Read from the team folder just now; another computer may be a minute ahead. A passed gate means passed for those details, by that person, at that time. People-directory email fields are omitted.",
  "data": { } }
```

| Field | What it is |
|---|---|
| `contract` | `flightdeck-read/1`. Adding a field keeps the version; removing a field or changing what one means is `flightdeck-read/2`. |
| `app` | The Flightdeck version that read the folder |
| `readAt` | When it read, in UTC |
| `complete` | `true` only when `problems` is empty |
| `problems` | One entry per file or folder: `path` (relative to the team folder; a folder ends in `/`), `kind` and `why` in plain words |
| `note` | The reminder above, the same every time |
| `data` | The command's own data, below |

An error object (exit 1 or 5) has `contract`, `app`, `error` and `problems`, and no data. `problems` lists everything the command met before it stopped, in the same form as above (a run that's "not found" because its folder is a link names the link there); it's empty when nothing was read, as for a usage error:

```json
{ "contract": "flightdeck-read/1", "app": "1.18.0", "error": { "kind": "not-found", "why": "There's no run backup-check/zzz in the team folder." }, "problems": [] }
```

`error.kind` is `failed` (the folder couldn't be read), `usage` (the command was used wrongly, including a flag without its value), `contract` (a contract this copy doesn't have) or `not-found`.

### Problem kinds

| Kind | Means |
|---|---|
| `unreadable` | A file or a part of the folder failed to read (a cloud placeholder that isn't downloaded yet, a permissions error). One version that can't be read is named on its own; the other versions are still listed. |
| `nofile` | A run folder without `run.json` (it may still be arriving, or it was deleted) |
| `malformed` | A run, plan, plan decision, follow-up decision or `people.json` that won't parse or isn't in the format (a plan decision other than accepted or declined, a plan detail that isn't text). It's left out of the data. A `people.json` like that leaves names `null`. A run file with anything the app would drop, cut short or replace when it reads it (a time it can't read, a gate without a state, a follow-up without text, a value that isn't text, a name it doesn't read) is named too, with where each one is (`gates.ready`, `followUps[0]`, `steps.tests.values.url`), and is still shown as the app shows it, without them. Beyond the cases it can name in words, the file is compared with what the app reads from it, field by field, and any other place they differ is named too; the only exceptions are documented defaults for values the file leaves out and two deliberate drops (who and when of an earlier "done differently", which only its note keeps, and a pause left on a run that has ended). A follow-up decision whose file isn't read as written (a note cut short, a link the app won't open) is named with its fields the same way. A `run.json` whose own process and ID don't match the folder it's in (copied into another run's folder), or whose process name is over the 60 characters Flightdeck reads, is named as belonging elsewhere and isn't read as that folder's run; the app does the same from 2.0.1, so each run counts once. |
| `newer` | A run, version or file from a newer Flightdeck, including a run whose own copy of its checklist or step types uses features this copy can't read. A run like that is named here and left out of the data. From 1.21 on, `why` names the Flightdeck it needs when the file or the format says ("Needs Flightdeck 2.0"); a plan or plan decision in a newer format (1.18 to 1.20 named these `malformed`) and a follow-up decision from a newer Flightdeck (1.18 to 1.20 read it as an ordinary one) are `newer` too. `flightdeck-read/1` reads exactly the folders it read in 1.18: files in `staged/`, `skill-registrations/` and `extensions/` are never read. |
| `unusable` | A version this copy can't use, with why. At a run's `run.json`: the run doesn't match its version (its checklist or version number differs from the version's record), so the app opens it read-only; the version itself is fine. |
| `conflict` | Conflict copies or lost saves beside a run, for a person to resolve in the app |
| `still-syncing` | A version whose files haven't all arrived |
| `link` | A link the command didn't follow |
| `skipped` | A file too large to read (over 16 MB). The bytes are counted as they're read, so a file that grows while it's read is refused too. |
| `vanished` | A file or folder that was listed and then gone before it could be read or listed itself (OneDrive replacing it, or someone deleting it). A folder gone like that is never read as empty, so a decided follow-up never looks open because its folder went missing mid-read. |

Each command reads only what its output depends on, and every problem it meets there is reported (nothing it read is left out of `problems`). A problem anywhere else, such as a link beside the process folder it reads, is not its problem and never makes it partial:

| Command | Reads |
|---|---|
| `processes`, `process` | `publications/` (for `process`, that process's versions) |
| `runs` | `runs/`, `proposals/`, `publications/` (whether a run's version can be used, and which version a plan starts on) and `people.json`; with `--process`, that process's runs and versions |
| `run`, `next` | That run's folder, its version (checked on its own, so a version that can't be read or used is named), its follow-up decisions and `people.json` |
| `followups` | `followups/`, `runs/` and `people.json` (every follow-up lives in its run's `run.json`, so a run that can't be read may hide some); with `--process`, that process's part, plus its versions and the plans, to tell whether the process exists |

## The data

Shared shapes: a **person** has `id` and `name` (`name` is `null` when `people.json` doesn't list the ID). **Timing** has `at`, `due` and `after`, each the checklist's text or `null`. **Evidence** is a list, each with `name`, `label`, `kind`, `required` and `options`: `name` is the key a value is recorded under, `kind` is `text`, `url`, `code`, `message`, `list` or `choice`, and `options` lists a choice's options (else empty). A plain step's proof (`evidence: link` or `note` in the checklist) is named `evidence`.

### processes

`{ "processes": [...] }`, by ID. Each process:

| Field | What it is |
|---|---|
| `id`, `title`, `category`, `group`, `tags`, `owner` | From the latest usable version's checklist (`group` and `tags` are lists; `owner` is a person's ID or `null`) |
| `latest` | `version` and `folder` of the latest usable version, or `null` |
| `versions` | Every version folder, newest first: `folder`, `version`, `publishedAt`, `publishedBy`, `usable`, `why` (when it isn't usable) and `clash` (two folders with the same version number) |

### process

| Field | What it is |
|---|---|
| `process` | `id`, `title`, `category`, `group`, `tags`, `owner`, as in `processes` |
| `version` | That version, as in `versions` |
| `usable` | Whether this copy can use it. When it can't, the lists below are empty and `problems` says why. |
| `evidenceFrom` | `publication`: the evidence here is what the version's step types record. What a particular run asks for (values filled in during the run, fields an issue tracker's transition requires) comes from `run`. |
| `context`, `roles` | The run details and roles the checklist names |
| `types` | The step types it uses: `id` and `label` |
| `phases` | Each phase: `id`, `title`, `mode` (`READ-DO`, `DO-CONFIRM` or empty), `tracks` (`id`, `title`, `roles`), `steps` and `gate` |

Each step: `id` (stable across versions; keep these in your app's settings), `text`, `type`, `must`, `planned`, `roles`, `binds` (run details it's tied to), `sets` (run details it sets), `fields` (the checklist's fields, as text), `track` (or `null`), `timing` and `evidence`. Each gate: `id`, `title`, `implicit` (a plain "confirm together"), `owner` (a role or `null`), `approves`, `binds`, `note` (the gate's note from the checklist, as written; `""` when it has none; added in 2.0, which shows gate notes for every version) and `timing`.

### runs

`{ "runs": [...], "planned": [...] }`. Runs are newest first. Each run:

| Field | What it is |
|---|---|
| `key`, `id`, `process`, `title`, `version`, `folder` | Which run, on which version |
| `state` | `running`, `completed`, `stopped` or `cancelled` |
| `paused` | Whether it's paused |
| `created` | When it started |
| `ended` | `outcome`, `at` and `by`, or `null` |
| `recorder` | The person who records it |
| `details` | The run's details (ticket, commit, environment, whatever the checklist names) |
| `progress` | `done` and `total`: steps answered |
| `headline` | Where the run is, as the app says it: `status` (`working`, `ready`, `stopped`, `paused`, `complete`), `text` and `detail` |
| `readOnly` | Why this copy can only show the run, or `null` |
| `marksComplete` | `true` when the run kept marks from its start. When it's `false` (a run started before 1.15), a step with no `marks` may still have been blocked or redone in an answer the run no longer holds: read it as unknown, not as none. |

Each planned run: `id`, `process`, `title`, `version`, `when`, `by`, `created`, `note`, `details`, `roles` (role to person ID), `status` (`pending`, `accepted`, `declined`, `conflicting` when two decisions disagree, including a plan started twice from two computers, `changed` when the plan was edited after a decision: final, since a decision on an earlier version still holds the plan and it never becomes `pending` again) `run` (the started run's key, once accepted), `copies` (how many files hold this plan: OneDrive keeps both when two computers write it while disconnected; copies that say the same thing are listed once), `copiesDiffer` (`true` when those copies say different things: each is listed, and the app starts neither until a person deletes one), `requestedBy` (`name` and `version` of the tool that asked for it with `flightdeck plan request`, by its own account, or `null` for a plan a person or an assistant wrote), `startsOn` (`version` and `folder` a person starting it now gets, as the app picks it, or `null` when the process has no usable version) and `versionMissing` (`true` when the plan names a version the folder doesn't have, so the app would start it on the latest instead). When any of the process's versions couldn't be read, both are `null`: unknown, never claimed missing. A `version` that isn't a version number (like `v3` or `1.5`) makes the plan `malformed`. `held` (added in 2.1.1) is `null`, or says why the app won't start, decline or switch a plan nothing has decided yet: a decision on it that can't be read (still arriving), that a newer Flightdeck made, or that isn't one this copy can read. Any file named for a decision on it (`<plan id>.status-…`) that's refused holds it, whatever it says it is, even when its format can't be read at all; a refused plan file holds no plan. It has `why` (the app's own words) and `files` (each `file` and the reason it holds the plan, as `kind`: `unreadable` (it can't be read, or is still arriving), `newer` (a newer Flightdeck made it) or `malformed` (it isn't in its format)). Each file is also named in `problems`, whose own `kind` can differ: a torn decision is `unreadable` in `held.files` while its `problems` entry may say `malformed`. Read the hold reason from `held.files`, not from `problems`. **Don't offer to start a plan whose `held` isn't `null`**, whatever its `status` and `startsOn` say: offer Start only for a `pending` plan with `held: null`. Contract 2 has the same `held`.

A plan made with Flightdeck 2.0 for one exact version (`flightdeck-plan/2`: `format` instead of `kind`, and `pin: { folder, version, mapHash, typesHash }` instead of `version`) and the decisions on it (`flightdeck-plan-status/2`, which adds `retargeted` with `to: { folder, version }`, a person's explicit "Start on v6 instead") are named as problems, `newer`, with contract 1: it shows only what Flightdeck 1.x reads. Such a plan never starts on anything but its own folder or the one a person switched it to; a missing folder, another folder with the same number, or two folders with that number make the app ask.

### run

`{ "run": {...} }`: everything a run has in `runs`, plus:

| Field | What it is |
|---|---|
| `roles` | Each `role` and its `person` |
| `steps` | Each step, in checklist order: `id`, `phase`, `text`, `type`, `must`, `roles`, `state` (`open`, `done`, `na`, `blocked`, `recheck`), `by`, `at`, `reason`, `values` (what was recorded), `differently` (`note`, `by`, `at`, when it was done differently), `marks` (every deviation it ever had, as How runs go counts them: its marks and the answers the run still holds, in the order `blocked`, `recheck`, `na`, `differently`; see `marksComplete`), `child` (`process` and `id` of a linked child run) and `evidence` (what this run asks for on it) |
| `gates` | Each gate: `id`, `phase`, `title`, `status` (`open`, `ready`, `passed`, `waived`, `failed`, `review`, `locked`), `by`, `at`, `reason`, `approved` (the details it approved) |
| `followUps` | The run's follow-ups, as in `followups` |

`run` is `null` when the run can't be read; `problems` says why.

### next

| Field | What it is |
|---|---|
| `run` | The run's key |
| `next` | What the run screen points at, the same for everyone: `kind` (`step`, `gate`, `blocked`, `complete`, `paused` or `ended`), `headline`, `phase` (`index`, `id`, `title`), `step` (`id`, `text`, `roles` with each role's `person`), `gate` (`id`, `title`, `status`, `owner`) and `tracks` (each parallel track's `id`, `title`, steps `left`, its next `step` and its `people`) |
| `person` | With `--person`, that person; else `null` |
| `mine` | With `--person`, that person's own next step (`phase` and `step`), or `null` when nothing is waiting on them |

### followups

`{ "followUps": [...] }`, oldest first. Each: `key` (`<process>/<run id>/<follow-up id>`), `process`, `run`, `runTitle`, `runEnded`, `id`, `text`, `owner`, `ticket`, `step`, `at`, `status` (`open`, `done`, `ticket`, `moved`, `wont`), `label` (the app's words), `tie` (two people decided at once; it stays open until someone decides again) and `decision`: `status`, `by`, `at`, `rev`, `ticket`, `link`, `to` (a run's key or `plan:<id>`), `reason` and `note`, or `null`.

## Contract 2 (Flightdeck 2.0)

`--contract 2` prints `"contract": "flightdeck-read/2"`, with the same commands, envelope, problem kinds and exit codes. What's different from contract 1:

- **2.0 versions and runs are data.** A version published with Flightdeck 2.0 (`preflight-publication/2`) and a run of one (`preflight-run/3`) are read, not named as `newer`. One that uses something this copy can't read is still `newer`.
- **Typed values.** In `runs` and `run`, a run's `details`, and in `run`, each step's `values`, are objects keyed by name. Each value has `type` (`text`, `number`, `yes-no`, `date`, `choice` or `link`), `text` (exactly what's stored), `value` (a string for a number, so it's never rounded; `true` or `false` for yes/no; the text for the rest; `null` when it's empty, still waiting for a person, or not valid), `valid` (`false` when the stored text isn't a value of its type; it's also a `malformed` problem naming its place) and `migration` (the latest migration record about it, or `null`).
- **Migrations.** When a typed value came from older text (a plan, a carried value, a report), the run keeps a record of what it was and what it became. Each record has `path` (like `details.due` or `steps.count.values.rows`), `at`, `from` (the text before), `source` (`plan`, `switch`, `carry`, `request` or `report`), `verdict` (`converted`, `ambiguous` or `invalid`), `result` (what it converted to, or `null`), `resolved` (`by`, `at` and `value` when a person filled it in, or `null`) and `open` (`true` while a person still has to fill it in).
- **`run`** adds `format`, `features` (what the run needs from Flightdeck, in order), `pins` (each linked step's pinned version: `process`, `version`, `folder`, `mapHash`, `typesHash`) and `migrations` (every record, archived ones first). Each step's `evidence` entry adds its `type`: how its values are checked and reported, the same `type` as each of its values. Evidence a 1.x step type records as a choice or a link (`kind` `choice` or `url`) is `text`: its values were never checked as typed values.
- **`runs`** adds `format` and `features` to each run, and each planned run's `format` and `pin` (`folder` and `version` of the exact version a 2.0 plan starts on, or `null`). A 2.0 plan never falls back to the latest version: when its version can't be used, `startsOn` is `null` and `versionMissing` is `true`.
- **`process`** adds `format`, `features` and `details` (each run detail's `name`, `type` and `options`), and each step's `evidence` entry adds `type`, `min`, `max` and `unit` (a number's limits, as text, or `null`).
- **Conditions (`only when`).** From Flightdeck 2.1, in `process`, each phase and each step adds `when`: its `only when` tests in their canonical spelling (`^risk is high`), `[]` when it has none. In `run`, each step adds `applies` (`true`, `false` when it's Not needed in this run, `null` when it can't tell yet) and `held` (why it's waiting, while `applies` is `null`; else `null`), and each gate adds `applies` (`false` when its phase is Not needed). A gate whose phase is Not needed has `status` `skipped`: it needs no pass, and it's never permission for anything. `applies` is read from the run's details as they are now, so it can change when a detail does.
- **Test runs.** From Flightdeck 2.1, a test run tries a staged version before it's the default, and is never counted as a real run. `runs` leaves test runs out unless you add `--tests`, and adds `testRunsLeftOut`: how many test runs matched but weren't listed. Each run in `runs` and `run` adds `test` (`true` for a test run) and `stage` (`{ "folder": "stage-..." }` for a test run, else `null`); a test run's `version` is the number its stage proposes, and its `folder` is the stage's. Each follow-up in `followups` and `run` adds `test`. `process <process> --stage stage-...` reads a staged version, with `stage` (`folder`, `proposed`, `stagedBy`, `stagedAt`; `null` for a version). `--tests` and `--stage` work with `--contract 2` only.

Contract 1's output doesn't change: it names a test run `newer`, as Flightdeck 1.x did.

## A walkthrough

The examples are ordinary team processes. None of them is special to Flightdeck.

1. **Learn the checklist once.** A script that helps with the monthly backup check runs `flightdeck process "$TEAM" backup-check --json` and keeps the step IDs it cares about (`restore-test`, say) and their evidence names in its own settings. Step IDs stay the same across versions.
2. **Find the run.** On the first of the month someone starts "Backup check · November" in the app. The script finds it with `flightdeck runs "$TEAM" --process backup-check --status running --json`, or uses the key someone copied with **Copy run key**.
3. **See what's waiting and on whom.** `flightdeck next "$TEAM" backup-check/k3m9p2q8 --json` says the restore test is next and who holds the role. A reminder bot for an access review can post that to the reviewer; an onboarding tracker can show the new hire's manager which step waits on them with `--person`.
4. **Show the record.** `flightdeck run … --json` gives every step's state, who checked it and when, and what was recorded. A dashboard of month-end tasks, or a deploy script that wants to show the release's gates, reads the same thing.
5. **Check follow-ups.** `flightdeck followups "$TEAM" --status open --json` lists what's still open after each run, with its owner.

Treat a partial result (exit 4) as partial: show what was read and say what wasn't. A tool that can't see the team folder hands this JSON to a person or an assistant who can.

## Asking for a run

An app can ask for a run the way a teammate would put one on the calendar: a script asks for the monthly backup check on the first of the month, a scheduler asks for the quarterly access review, an onboarding tool asks for a new hire's checklist, a deploy script asks for a release. The request shows in the app as a planned run. **A person starts it**, changes it or declines it, exactly as with any planned run. Nothing starts by itself, and the command never writes `run.json`.

```
flightdeck plan request <team folder> <request.json | -> --key <key> [--json] [--dry-run]
```

**For example**, on the first of each month a backup script writes this to `request.json` and runs `flightdeck plan request "$TEAM" request.json --key 2026-11`:

```json
{ "process": "backup-check", "title": "Backup check · November", "details": { "site": "main office" },
  "roles": { "checker": "person-casey" }, "note": "Monthly, on the first.",
  "producer": { "name": "backup-script", "version": "1.4.0" } }
```

Run it again (the script retried, or ran twice) and nothing changes: the request is already there. Use a new key for each run you want, such as the month or the ticket.

### The request

At most 16 KB of UTF-8 JSON, from a file or from standard input with `-`. Anything not listed here, at any level, is refused.

| Field | Required | What it is |
|---|---|---|
| `process` | yes | The process ID, like `backup-check` |
| `producer` | yes | `name`: your tool, lowercase letters, numbers and dashes, at most 30 (like `backup-script`); `version`: its version, like `1.4.0` |
| `version` | no | A version number to start on. Left out, Flightdeck picks the latest version it can use, and the request stays on that version |
| `title` | no | The run's name, at most 100 characters. Left out, the checklist's title |
| `details` | no | Run details by name, each text up to 120 characters. Names must be the checklist's run details |
| `roles` | no | Role to person ID (from `people.json`). Names must be the checklist's roles. A person who isn't active there is kept as asked, and the start form leaves that role for whoever starts the run |
| `when` | no | A date and time with its zone, like `2026-11-01T09:00:00Z`. The app lists planned runs by it and shows one on Home from 24 hours before |
| `note` | no | At most 250 characters, for the person who starts it |

Text can't hold line breaks or other control characters.

`--key` is lowercase letters, numbers, dots, dashes or underscores, at most 64 characters, starting with a letter or number (`2026-11`, `abc-123`, `q4.access-review`). The same tool and key always mean the same request.

### What it writes

One file, once: `proposals/req-<tool>-<hash>.json`, where `<hash>` is the first 24 hex characters of the SHA-256 of `["<tool>","<key>"]` (that JSON array, as UTF-8). The hash covers the tool and the key together, so two different pairs never share a name; the tool's name is there for people reading the folder. The file is an ordinary planned run with only the fields plans already have, so every copy of Flightdeck since 1.13 lists it and can start it:

```json
{ "kind": "plan", "id": "req-backup-script-…", "process": "backup-check", "version": 3, "title": "Backup check · November",
  "details": { "site": "main office" }, "roles": { "checker": "person-casey" },
  "note": "Requested by backup-script. Monthly, on the first.", "by": "backup-script 1.4.0 (a tool)", "created": "2026-11-01T06:00:00.000Z" }
```

The app shows it as "requested by backup-script, by its own account". **The name is a claim, not an identity:** anyone who can write to the team folder can write a file like this, so Flightdeck can't confirm which tool or person wrote it, and the start form says so.

### Asking again: the same key

Before it resolves anything, the command reads any request already under that name, including a copy OneDrive kept beside it (`req-…-LAPTOP.json`, `req-… (1).json`). It compares what this call asks for with what's there:

- **The same request** (exit 0, `already`): nothing is written. The original time and version stand, even if a newer version was published since.
- **Other details** (exit 1, `key-taken`): refused, naming the file and what differs. Nothing is written. Use another key for another request.

What's compared is the request as asked: the process, your tool's name, and `details`, `roles`, `when` and `note`, where leaving one out means none. `version` and `title` are compared only when you send them, because when you leave them out Flightdeck chose them the first time. Your tool's `version` is never compared. Key order, and the same time written another way, don't matter.

### The result

With `--json`, READ's envelope (`flightdeck-read/1`): `contract`, `app`, `readAt`, `complete`, `problems`, `note` and `data`, where `data` is `{ "request": {...} }` (one field, `request`):

| Field | What it is |
|---|---|
| `id` | The plan's ID, which is also its file name without `.json` |
| `file` | The file, relative to the team folder |
| `status` | `requested` (written now), `already` (it was there; nothing written), `would-request` (with `--dry-run`; nothing written) or `held` (nothing written, because something it depends on couldn't be read; `problems` says what) |
| `plan` | The plan as written, as it already was, or as it would be written; `null` when `held` |
| `leftEmpty` | Roles whose person isn't active in `people.json` now, for the person who starts it to fill (on a retry too) |
| `run` | When the request was already started, that run's key; else `null` |

Without `--json` it says the same in words.

| Code | Means |
|---|---|
| `0` | `requested`, `already` or `would-request` |
| `4` | `held`: something the request depends on couldn't be read (a copy of the request, one of the process's versions, `people.json`), so nothing was written. `complete` is `false`, and `problems` names each file. Try again once it can be read. |
| `1` | Refused, with an error object: `usage` (a missing or bad key, folder or file), `invalid` (the request isn't valid; every reason is named, including details and roles the checklist doesn't have), `key-taken` (the same key with other details) or `failed` (the folder couldn't be read or written, or a link was refused) |
| `5` | `not-found`: no such process, or no such version of it |

### What it reads and writes

It reads only `proposals/` (this request's own files and their decisions), the process's versions and `people.json`, and a problem anywhere else never holds it back. It writes one new file in `proposals/` and nothing else: never through a link, never outside the folder. The file is written to a temporary name first, flushed, then put in place in one step that fails if the name is already taken, so it never replaces a file and the final name never holds half a request. It's read back byte for byte. On a disk without hard links the final name is created exclusively and filled from the finished temporary file; if that's cut short (a full disk), the command removes the file it created. A retry never removes a file: a file under the request's name that isn't complete JSON (still arriving, or another request still writing it, or one cut short by a crash) is named (`malformed`, exit 4, `held`), and nothing is written until a person deals with it (docs/recovery.md, *A request file is incomplete*). Plans and plan decisions under the request's name are read with the same code `runs` uses, so they get the same problems: one not in the format is named (`malformed`, exit 4) and never counted, and while one is there and the request isn't, nothing is written (`held`). `--dry-run` only reads: it doesn't even make `proposals/` when it's missing.

### What it can't promise

- **Two computers that aren't syncing.** Creating the file exclusively stops a second request from replacing the first on one computer, but it doesn't stop two computers that can't see each other (OneDrive paused or offline) from both writing it. OneDrive then keeps both, one as `req-…-COMPUTER.json`. Flightdeck shows copies that say the same thing once ("This request arrived twice"). Copies that say different things are both listed, flagged, and can't be started until a person deletes the wrong one. Copies of the same request made by different versions of your tool count as the same.
- **A run starting exactly once.** A request is a plan, and a person starts it. Two people starting it from two computers before their files sync makes two runs, even from two different copies of it; Flightdeck then shows the plan's decisions as conflicting (`conflicting`) instead of hiding one. Check Runs before starting it again.
- **Who asked.** The tool's name is what the file says.
- **Older copies.** Flightdeck 1.13 to 1.19 list a request as an ordinary planned run ("planned by backup-script 1.4.0 (a tool)") and can start it. They show each OneDrive copy as its own planned run and don't flag a plan started twice, so with older copies still in use, delete a duplicate copy as soon as you see one (Folder health, from 1.15, reports it).

### A walkthrough, with a request

1. **Learn the checklist once** with `flightdeck process "$TEAM" backup-check --json`: its run details and roles, so the request uses the right names.
2. **Ask for the run** with `flightdeck plan request "$TEAM" request.json --key 2026-11`. Retry freely: the same key and request change nothing.
3. **A person starts it** in the app, from **Runs** or Home, and can change the title, details and roles first.
4. **Find the run** with `flightdeck runs "$TEAM" --process backup-check --status planned --json`: once started, the planned run's `status` is `accepted` and `run` is the run's key. `flightdeck plan request` with the same key says it too (`run`).

## Reporting work

A tool that did a step's work says so in a report: the backup script restored a sample, the access review export ran, the test gate went green. The report shows on the step in the app. **A person decides**: the run's recorder accepts it, and the step is checked with exactly the report's evidence, or declines it with a reason. A report is a claim: it never checks a step, passes a gate or changes `run.json` by itself, and nothing an app reads back is permission to act.

```
flightdeck report targets <team folder> [--process <process>] [--run <process>/<run id>] [--json]
flightdeck report check <report.json | -> [--folder <team folder>] [--json]
flightdeck report write <team folder> <report.json | -> [--json] [--dry-run] [--strict] [--unmatched-ok]
```

These print READ's envelope and exit codes under contract `flightdeck-read/2` (the six reading commands above stay `flightdeck-read/1`, which never reads reports).

**For example**, after the nightly restore test a backup script writes this to `report.json` and runs `flightdeck report write "$TEAM" report.json`:

```json
{ "format": "flightdeck-report/1", "run": "backup-check/k3m9p2q8", "publication": { "folder": "v3-k3m9p2q8" }, "step": "restore-test",
  "verdict": "pass", "evidence": { "evidence": "https://backup.example.com/restores/77" },
  "links": [ { "label": "Restore log", "url": "https://backup.example.com/restores/77/log" } ],
  "inputs": [ { "name": "backup set", "value": "nightly-2026-10-31", "source": "external" },
              { "name": "vault password", "source": "external", "secret": true } ],
  "producer": { "name": "backup-check", "version": "1.4.0" }, "summary": "Restored 3 files; checksums match." }
```

### The report

At most 64 KB of UTF-8 JSON, from a file or standard input with `-`. Anything not listed here, at any level, makes it a report Flightdeck can't use, naming the property.

| Field | Required | What it is |
|---|---|---|
| `format` | yes | `flightdeck-report/1` |
| `run` | yes | The run's key, `<process>/<run id>` |
| `publication` | yes | `folder`: the run's version folder (from `run --json`); `version`: its number, shown only |
| `step` | yes | The step's ID (from `report targets` or `process --json`) |
| `verdict` | yes | `pass`, `fail` or `blocked`. A `pass` has no blockers; `fail` and `blocked` name at least one. Only a `pass` can be accepted |
| `blockers` | no | What's wrong, up to 20 texts of 300 characters |
| `evidence` | no | Text by the step's evidence names (`evidence` on a plain step), up to 40, each up to 300 characters. Names the step doesn't record are warned about and never used |
| `links` | no | Up to 20 `{label, url}`; a url starts with `https://` or `http://` |
| `inputs` | no | What the tool examined, up to 40 `{name, value, source}`: `source` is `detail:<run detail>` (compared with the run) or `external`. A secret is `{name, source, secret: true}`, with no value: a report with a secret's value is refused |
| `producer` | yes | `name`: your tool, lowercase letters, numbers and dashes, at most 30; `version`: its version |
| `created` | no | When it ran, with its zone. `report write` fills it in when you leave it out |
| `id` | no | 8 to 16 lowercase letters and numbers. `report write` makes one when you leave it out |
| `supersedes` | no | The `id` of an earlier report from your tool on the same step that this one replaces |
| `summary` | no | Up to 500 characters |

The file is `reports/<process>/<run id>.<step>.<tool>.<id>.json`, written once. The run, step, tool and id in the name must be what's inside. Write a new report (a new `id`, with `supersedes`) instead of changing one: Flightdeck accepts a report by the SHA-256 of its exact bytes, so an edited report no longer matches its acceptance.

### Inputs and the run

`detail:` inputs are compared with the run's details when a person looks: matching, not matching (Accept is refused), or nothing to compare (`external` inputs only; a person can still accept, deliberately). A step tied to a detail (`^commit` in the checklist) goes back to re-check in every copy when that detail changes, so tie the steps your reports are about to the details they examined. `report check --folder` and `report write` warn when they aren't. Flightdeck compares inputs with the run's own details only: it can't see your other systems, so it can't tell whether something is still the latest or whether your tool really ran.

### targets

Running runs and their steps: `data` is `{ "runs": [...] }`, each with `key`, `title`, `folder`, `version`, `recorder`, `details` and `steps`. Each step has `id`, `phase`, `text`, `type`, `state`, `binds` (the details it's tied to), `evidence` (what it records, as in `run --json`), `accepts` (whether a person could accept a report on it) and `why` (why not, or `null`). A step that starts another process, or one that sets run details, takes no report.

### check and write

`report check` reads the report alone, or with `--folder` against its run too: the run exists, `publication.folder` is the run's version and the step is in it. `report write` does the same, then writes the file once and reads it back. `--dry-run` writes nothing; `--strict` refuses a report that has warnings; `--unmatched-ok` writes a report for a run that isn't in the folder yet (one still syncing). A report whose inputs don't match the run is still written: it's a record, and the app says it doesn't match.

`data` is `{ "report": {...} }` (one field, `report`):

| Field | What it is |
|---|---|
| `file` | Where it goes, relative to the team folder |
| `sha256` | The SHA-256 of the file's bytes; `null` when `held` |
| `status` | `valid` (check), `written`, `already` (exactly these bytes are already there; nothing written), `would-write` (`--dry-run`) or `held` (nothing written, because the run couldn't be read; `problems` says what) |
| `run`, `step`, `id`, `verdict`, `created` | As in the report (`id` and `created` as filled in) |
| `producer` | `name` and `version`, as the report says |
| `applies` | Whether its inputs match the run now: `yes`, `no` or `unknown`; `null` without a folder |
| `warnings` | Evidence the step doesn't record, inputs the step isn't tied to, a verdict that can't be accepted, an ended run |

| Code | Means |
|---|---|
| `0` | `valid`, `written`, `already` or `would-write` |
| `4` | `held`: the run couldn't be read, so nothing was written |
| `1` | Refused, with an error object: `usage`, `invalid` (every reason is named; a private key in the report is refused too), `id-taken` (another report is already under that name) or `failed` |
| `5` | `not-found`: no such run (`report write` with `--unmatched-ok` writes it anyway) |

### What it can't promise

- **Who wrote it.** The tool's name is what the file says. The app shows "by its own account".
- **Two computers that aren't syncing.** OneDrive keeps both copies of a report written twice. Copies with the same bytes are one report; copies that differ can't be accepted until a person deletes the wrong one (docs/recovery.md, *A report can't be accepted*).
- **Older copies.** Flightdeck 1.x never lists `reports/`. A step checked from an accepted report is an ordinary answer with a log line naming the report and its SHA-256, which every copy reads.

## Writing drafts (for AI assistants)

Contract `flightdeck-draft/1` (1.19). These commands **change the team folder**, unlike the reading commands above. They never write a draft that's open in a Flightdeck editor this computer can see: the change becomes a **proposal**. If that editor is the main editor for the draft and has nothing unsaved, and the proposal starts from the draft as it is, Flightdeck applies it there within a few seconds, highlighted, saves it, and one Undo takes it back. Otherwise a person reviews and applies it on the process page.

```
flightdeck draft read    <team folder> <process> [--session <id>] [--or-latest] --json
flightdeck draft save    <team folder> <process> --expect <rev|none> --from <file|-> [--base <file>] [--session <id>] [--label <name>] [--by <person id>] [--note "<text>"] [--after-earlier] --json
flightdeck draft propose <same as save>
```

**How to use them.** Read with `flightdeck draft read --json` and keep the text you read (`continueFrom.text`) in a file. Change it. Save with `flightdeck draft save --expect <continueFrom.rev> --from <your new text> --base <the file with the text you read> --session <session>`. If someone has the draft open, or it changed since you read it, your change is saved as a proposal; say so in your report. Pass the same `--session` to every command of one task, so your own pending proposals are found.

### draft read

Prints `{ contract, app, process, session, draft, openIn, mine, continueFrom, checks, copies, readAt, complete, problems }`:

| Field | Means |
|---|---|
| `contract` | `flightdeck-draft/1` |
| `app` | The Flightdeck version that answered |
| `process` | The process asked for |
| `session` | `--session`, or a new `s-<12 letters and digits>`. It links your proposals together; it's never a file's writer. |
| `draft` | `exists` (whether `maps/drafts/<process>.md` exists), its `path`, `rev` (the SHA-256 of its exact text, lowercase hex) and its `text` (null when it's over 1 MB, which is named in `problems`) |
| `openIn` | Editors this computer can see right now with the draft open: `{ by, device, seenAgo }` (`by` a people.json ID, `device` the computer and browser, `seenAgo` milliseconds since its last sign of life) |
| `mine` | This session's proposals for the process: `{ id, rev, status, text }`. `status` is `pending`, `replaced`, `invalid`, or what happened to it (`applied`, `applied-twice`, `declined`, `reopened`, `tried`, `maybe`, `decided-twice`, `unknown`) |
| `continueFrom` | The text to change next: `{ rev, kind, ref, text }`. Your newest pending proposal (`kind` `proposal`, `ref` its ID), else the draft (`draft`), else with `--or-latest` and no draft the latest published version (`version`, `ref` its folder), else nothing (`none`, empty text) |
| `checks` | `blockers` and `suggestions` for `continueFrom.text`, as the editor's Checks show them (without the team's people and step types) |
| `copies` | Other files in `maps/drafts/` whose `process:` says this process (OneDrive copies, for example) |
| `readAt` | When it read the folder |
| `complete`, `problems` | As for the reading commands: a proposal that can't be read yet (`malformed`), a file too big or that couldn't be read. `complete` is `false` and the exit code is 4 when `problems` has anything. |

Exit codes: `0` complete, `4` partial, `1` usage or error, `5` the process has no draft, no published version and no proposal.

### draft save and draft propose

`save` writes the draft directly only when **nobody has it open** (no editor this computer can see; a presence file it can't read, or a `presence/` it can't list, counts as open) **and** the draft is exactly the text you started from (compared byte for byte right before the write). Otherwise, and always with `propose`, it writes a proposal.

- **Checked first, nothing written if any fails (exit 1, `usage`):** the process ID; `--expect` (a SHA-256 or `none`); `--from` (a file, or `-` for standard input) holding at most 1 MB (1,048,576 bytes) of valid UTF-8 whose `process:` line says the process; `--base` the same way; `--label` (letters, numbers and dashes, up to 40); `--by` (an ID in `people.json`); `--note` (up to 200 characters).
- **Which text you started from (`--expect`):** this session's own pending proposal with that `rev` (see replacing, below); else the draft if its `rev` matches; else one of this session's proposals; else a published version's `map.md`; else `--base`, whose SHA-256 must match. `none` starts a new draft. None of these: exit 1, `missing-base` ("Pass the text you read with --base, or read the draft again.").
- **Replacing or following your own proposal:** when `--expect` is the `rev` of your session's own pending proposal P1 (as `continueFrom` gives it), the new proposal **replaces** P1 by default (`replaces: P1`) and starts from P1's own base, so it goes straight from the draft P1 started from. With `--after-earlier` it **follows** P1 instead (`after: P1`, starting from P1's text): it becomes applicable once P1 is applied. `link` in the output says which: `replaces`, `after` or null.
- **A proposal** is one new file, `proposed/<process>/<operation>.json`, created exclusively (never over another file), flushed and read back. It holds the full new text, the exact text it started from and the SHA-256 of both, so it's never lost, even if the draft changes meanwhile. Over 4 MB as a file: exit 1, `too-big`, nothing written.
- **A direct save** writes `maps/drafts/<process>.md` (through a temporary file and one rename) and one line of saved history in a new file of its own, `history/drafts/<process>/agent-<operation>.jsonl` (`source` `agent`; History says "Changed by your AI assistant"). If that line can't be written, the save still stands and `history` says why.

Prints `{ contract, app, process, session, operation, outcome, why, link, rev, file, ids, checks, warnings, history }`:

| Field | Means |
|---|---|
| `operation` | This command's own ID, `p-<time>-<10 random>`: the proposal's ID and file name, or the history file's |
| `outcome` | `written` (the draft) or `proposed` |
| `why` | For a proposal: `open` (someone has the draft open), `changed` (the draft isn't what you started from) or `asked` (`draft propose`); null when written |
| `link` | `replaces`, `after` or null |
| `rev` | The SHA-256 of the text you sent |
| `file` | What it wrote: `maps/drafts/<process>.md` or `proposed/<process>/<operation>.json` |
| `ids` | Step and phase IDs your change `added`, `removed` and `renamed` (each `{ from, to }`) |
| `checks` | `blockers` and `suggestions` for your text |
| `warnings` | Things a person should know, in words (removed IDs, for example) |
| `history` | For a direct save: `{ written }`, with `why` when it couldn't be written; null for a proposal |

Exit codes: `0` written or proposed; `1` usage, `missing-base`, `too-big` or `failed` (the folder couldn't be changed, a link was refused); the error object is `{ contract, app, error: { kind, why }, problems }`. Codes say what this computer's copy of the folder showed when the command ran.

**What it may write:** only `maps/drafts/<process>.md` (a direct save), `proposed/<process>/<operation>.json`, `history/drafts/<process>/agent-<operation>.jsonl`, and, when a direct save continued from your own pending proposal, one decision `proposed/<process>/<that proposal>.<operation>.<rev>.json` with `status` `replaced`, so it isn't offered again, never through a link and never outside the folder. It never writes or deletes anything in `presence/`, and never changes a proposal, attempt or decision once written.

**Known limits.** Who has a draft open is what this computer's copy of the folder shows: another computer's editor may arrive late (seconds to minutes over OneDrive), and a tab in the background may stop saying it's there. A shared folder has no atomic compare-and-swap, so a hand edit, an older copy of Flightdeck or a direct file write that lands between the final compare and the write can still be replaced, exactly as in 1.18. A proposal is never lost. Flightdeck 1.19 doesn't merge: a proposal applies only when it starts from the draft exactly as it is. "Within a few seconds" holds on one computer (the editor looks every 2 seconds); across computers it adds OneDrive's sync time, which has no bound. Two computers with the same draft open can each apply the same proposal once before their files sync (it then shows **Applied twice**); to take back an assistant's change in that case, use **Decline** on the process page rather than Undo in the editor.

## Registering a skill (for AI assistants)

Flightdeck 2.0 matches a skill to the exact version it was built from. Registrations live in `skill-registrations/<name>/`, one file per revision, and the command below is the only thing that writes them. Never write a file in `skill-registrations/` by hand.

```
flightdeck skill register <team folder> --from <registration.json | -> [--json]
```

The registration is a JSON object of at most 64 KB:

```json
{ "name": "release-notes", "version": "1.2.0", "location": "https://example.com/skills/release-notes",
  "implements": { "process": "release", "folder": "v4-abcd1234" },
  "steps": ["merge", "jenkins"], "description": "Writes the release notes." }
```

`implements.folder` is the published version folder the skill follows (`publications/<process>/<folder>/`). `steps` (step IDs) is optional: leave it out for the whole process. `description`, `group`, `tags` and `by` are optional too.

**What it checks first, writing nothing if any fails (exit 1):** the fields above; that the folder is a usable version of that process, the only one with its number ("Can't be matched: release v4-abcd1234 …" says which of these it isn't); that every step in `steps` is in that version; that the skill doesn't already have two registrations at the same revision (keep one, then register again); that every revision filed under the skill can be read here (one made with a newer Flightdeck, damaged or misnamed is resolved first: update Flightdeck, or remove that file), and listed: `skills/`, `skill-registrations/` and the skill's own folder must list (a permissions error or a link is refused, never read as empty), and a skill whose files are past the 500 registrations a copy reads is refused too; that no file speaks for the skill under another name (a `skills/<name>.json` that records another skill's name, or a revision whose recorded name or id isn't its folder's or file's: rename or fix it first); and that an existing `skills/<name>.json` is one this copy understands (a skill file of today's shape, or a pointer). A newer, damaged or unreadable `skills/<name>.json` is never replaced.

**What it writes:** one new file, `skill-registrations/<name>/<id>.<rev>.<window>.json` (`flightdeck-skill/2`), created once and never over another file, then read back with the same reader the app uses. The first registration of a name gets a new `id` (`sk-` and 8 letters or numbers) and revision 1; each later one keeps the `id` and adds 1 (`seen` says which revision it replaced). The exact version is recorded with its fingerprints (`mapHash`, `typesHash`). If the skill also has an older registration in `skills/<name>.json`, that file becomes a pointer, `{ "name", "implements": "moved", "movedTo", "id" }`, so older copies of Flightdeck refuse to match it instead of reading a version number.

Prints (with `--json`) `{ contract: "flightdeck-skill/1", app, registered: { path, name, version, id, rev, implements, sha }, tombstone }` (`tombstone`: the `skills/` file it replaced, or null), or `{ contract, app, error: { kind, why } }` with `kind` `usage`, `invalid` or `failed`. Exit codes: `0` registered; `1` anything else. Without `--json` it says the same in a sentence.

**How the app reads registrations.** The current registration of a skill is its highest revision. Two different files at that revision are **Needs review**; a revision this copy can't read (newer, damaged, misnamed), or a folder it can't list in full, holds the whole skill, so no lower revision is ever current past it; a registration beside an older `skills/<name>.json` of the same name is "Two registrations for <name>; keep one"; a pointer whose registration hasn't arrived yet waits. None of these, and no registration whose version is missing, replaced or unusable, is ever shown as current: each says it can't be matched, and why.
