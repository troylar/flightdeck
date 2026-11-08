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
| **Check a draft** as the Publish dialog does ([draft check](#draft-check)), with design tips (3.0) | `flightdeck draft check` | 2.13 | Never |
| **Look across the library**: every checklist normalized, what links to what, and what looks alike ([library inspect](#library-inspect)) | `flightdeck library inspect` | 3.0 | Never |
| **Keep a loop's scope**: read a release's stories and their results, and ask for stories to be added, removed, restored, excused or reviewed ([Loops](#loops)) | `flightdeck loop` | 3.0 | Writes one file in `proposals/` (`read` never) |
| **Register a skill** against the exact version it was built from (AI assistants, [Registering a skill](#registering-a-skill-for-ai-assistants)) | `flightdeck skill register` | 2.0 | Writes one file in `skill-registrations/`, and may turn `skills/<name>.json` into a pointer |
| **Make an evidence pack** of one run, or of the runs started on some days ([Evidence packs](evidence.md)) | `flightdeck export` | 1.17 | Never: the pack goes outside the folder |

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
{ "contract": "flightdeck-read/1", "app": "2.6.1", "readAt": "2026-10-24T13:42:05.000Z",
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
{ "contract": "flightdeck-read/1", "app": "2.6.1", "error": { "kind": "not-found", "why": "There's no run backup-check/zzz in the team folder." }, "problems": [] }
```

`error.kind` is `failed` (the folder couldn't be read), `usage` (the command was used wrongly, including a flag without its value), `contract` (a contract this copy doesn't have) or `not-found`.

### Problem kinds

| Kind | Means |
|---|---|
| `unreadable` | A file or a part of the folder failed to read (a cloud placeholder that isn't downloaded yet, a permissions error). One version that can't be read is named on its own; the other versions are still listed. |
| `nofile` | A run folder without `run.json` (it may still be arriving, or it was deleted) |
| `malformed` | A run, plan, plan decision, follow-up decision or `people.json` that won't parse or isn't in the format. What's left out and what's still shown: [`malformed` in detail](#malformed-in-detail), below. |
| `newer` | A run, version or file from a newer Flightdeck, including a run whose own copy of its checklist or step types uses features this copy can't read. A run like that is named here and left out of the data. More in [`newer` in detail](#newer-in-detail), below. |
| `unusable` | A version this copy can't use, with why. At a run's `run.json`: the run doesn't match its version (its checklist or version number differs from the version's record), so the app opens it read-only; the version itself is fine. |
| `conflict` | Conflict copies or lost saves beside a run, for a person to resolve in the app |
| `still-syncing` | A version whose files haven't all arrived |
| `link` | A link the command didn't follow |
| `skipped` | A file too large to read (over 16 MB). The bytes are counted as they're read, so a file that grows while it's read is refused too. |
| `vanished` | A file or folder that was listed and then gone before it could be read or listed itself (OneDrive replacing it, or someone deleting it). A folder gone like that is never read as empty, so a decided follow-up never looks open because its folder went missing mid-read. |
| `child-mark` | From 2.16, at a parent run's `run.json`: a linked step recorded as done whose child run says Completed but doesn't stand as read (one of its Jira searches was reopened when read, or a gate there doesn't pass). `why` names the step, the child run, and what to do: answer the child's reopened step again with Done, or, when the child's record can't be repaired, start a new run. The parent's answer is left as recorded and is still in the data. |

#### `malformed` in detail

- **What it covers:** a run, plan, plan decision, follow-up decision or `people.json` that won't parse or isn't in the format (a plan decision other than accepted or declined, a plan detail that isn't text). It's left out of the data. A `people.json` like that leaves names `null`.
- **A run file the app would change when it reads it:** anything the app would drop, cut short or replace (a time it can't read, a gate without a state, a follow-up without text, a value that isn't text, a name it doesn't read) is named too, with where each one is (`gates.ready`, `followUps[0]`, `steps.tests.values.url`). The run is still shown as the app shows it, without them.
- **Everything else that differs:** beyond the cases it can name in words, the file is compared with what the app reads from it, field by field, and any other place they differ is named too. The only exceptions are documented defaults for values the file leaves out, and two deliberate drops: who and when of an earlier "done differently" (only its note keeps them), and a pause left on a run that has ended.
- **A follow-up decision** whose file isn't read as written (a note cut short, a link the app won't open) is named with its fields the same way.
- **A run in the wrong folder:** a `run.json` whose own process and ID don't match the folder it's in (copied into another run's folder), or whose process name is over the 60 characters Flightdeck reads, is named as belonging elsewhere and isn't read as that folder's run. The app does the same from 2.0.1, so each run counts once.

#### `newer` in detail

- **Which Flightdeck it needs:** from 1.21 on, `why` names the Flightdeck it needs when the file or the format says ("Needs Flightdeck 2.0").
- **Plans and decisions:** a plan or plan decision in a newer format (1.18 to 1.20 named these `malformed`) and a follow-up decision from a newer Flightdeck (1.18 to 1.20 read it as an ordinary one) are `newer` too.
- **Folders contract 1 never reads:** `flightdeck-read/1` reads exactly the folders it read in 1.18, so files in `staged/`, `skill-registrations/` and `extensions/` are never read.

Each command reads only what its output depends on, and every problem it meets there is reported (nothing it read is left out of `problems`). A problem anywhere else, such as a link beside the process folder it reads, is not its problem and never makes it partial:

| Command | Reads |
|---|---|
| `processes`, `process` | `publications/` (for `process`, that process's versions) |
| `runs` | `runs/`, `proposals/`, `publications/` (whether a run's version can be used, and which version a plan starts on) and `people.json`; with `--process`, that process's runs and versions |
| `run`, `next` | That run's folder, its version (checked on its own, so a version that can't be read or used is named), its follow-up decisions and `people.json`; with contract 2, also the run folder and version of each linked run a step that accepts results links to (3.0) |
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
| `types` | The step types it uses: `id` and `label`. A pull request is `github.pr` or `bitbucket.pr`, as the checklist says (see below) |
| `phases` | Each phase: `id`, `title`, `mode` (`READ-DO`, `DO-CONFIRM` or empty), `tracks` (`id`, `title`, `roles`), `steps` and `gate` |

Each step: `id` (stable across versions; keep these in your app's settings), `text`, `type`, `must`, `planned`, `roles`, `binds` (run details it's tied to), `sets` (run details it sets), `fields` (the checklist's fields, as text), `track` (or `null`), `timing` and `evidence`. Each gate: `id`, `title`, `implicit` (a plain "confirm together"), `owner` (a role or `null`), `approves`, `binds`, `note` (the gate's note from the checklist, as written; `""` when it has none; added in 2.0, which shows gate notes for every version) and `timing`.

**Pull requests.** Since 2.6 the editor shows GitHub's and Bitbucket's pull requests as one **Pull request** step, whose first question is **Where is the pull request?** The checklist, the reading commands and reports keep the two types: a step's `type` is `github.pr` or `bitbucket.pr`, and `types` lists whichever the version uses. The `approve` action, the `pull` field and the `checks` record exist only on `github.pr`.

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
- **`process`** adds `format`, `features` and `details` (each run detail's `name`, `type` and `options`, and from 2.16 `pattern` on a detail that must match one: the pattern as the checklist writes it, inside `pattern(...)`; other details have no `pattern` key), and each step's `evidence` entry adds `type`, `min`, `max` and `unit` (a number's limits, as text, or `null`).
- **Conditions (`only when`).** From Flightdeck 2.1, in `process`, each phase and each step adds `when`: its `only when` tests in their canonical spelling (`^risk is high`), `[]` when it has none. In `run`, each step adds `applies` (`true`, `false` when it's Not needed in this run, `null` when it can't tell yet) and `held` (why it's waiting, while `applies` is `null`; else `null`), and each gate adds `applies` (`false` when its phase is Not needed). A gate whose phase is Not needed has `status` `skipped`: it needs no pass, and it's never permission for anything. `applies` is read from the run's details as they are now, so it can change when a detail does.
- **Test runs.** From Flightdeck 2.1, a test run tries a staged version before it's the default, and is never counted as a real run. `runs` leaves test runs out unless you add `--tests`, and adds `testRunsLeftOut`: how many test runs matched but weren't listed. Each run in `runs` and `run` adds `test` (`true` for a test run) and `stage` (`{ "folder": "stage-..." }` for a test run, else `null`); a test run's `version` is the number its stage proposes, and its `folder` is the stage's. Each follow-up in `followups` and `run` adds `test`. `process <process> --stage stage-...` reads a staged version, with `stage` (`folder`, `proposed`, `stagedBy`, `stagedAt`; `null` for a version). `--tests` and `--stage` work with `--contract 2` only.

- **Module results.** From Flightdeck 3.0, a checklist can return one result (its `result:` detail, set by one decision), and a linked step can accept some of its child's results ([Module results](map-format.md#module-results)). These keys appear only on a checklist, run or step that uses results; everything else reads exactly as before:
  - `process` adds `result` (`name`, `options` and `step`, the decision that sets it); each linked step that accepts or imports a result adds `accepts` (the results it accepts) and `imports` (the detail it copies the result into, or `null`).
  - `runs` and `run` add `result` (`name` and `value`, `""` until the decision is recorded) and `outcome` (how it ended in words, `"Completed · needs-work"`, or `null` while it runs) to a run of a checklist with a result.
  - In `run`, each linked step that accepts or returned a result adds `accepts`, `result` (what its child returned, or `null`) and `heldBy` (`{ "process", "id", "result", "reason" }` while it's held because its child returned a result it doesn't accept, else `null`). `next` adds the same `heldBy` to its step.
  - In `run` and `next`, those steps also add `awaiting` (`{ "process", "id", "result", "reason" }`, else `null`): the linked run ended, or was reopened or corrected after the step counted it, and only the parent run's recorder settles the step, in Flightdeck. The command reads the linked run and never writes, so the step still shows its last settled state; `awaiting` says what will change, and `next` (its `next` and `mine`) names that step instead of any work further on; a paused run stays `paused`, and unfinished work before that step keeps its place. A linked run that isn't in the folder is a `nofile` problem at its `run.json`, so the output is partial. An ended run is never settled again, so it has no `awaiting`: `run` adds `resultsChanged` instead to a run that uses results, one entry per step whose linked run changed after this run ended (`step`, `process`, `id`, `result`, `reason`, starting "A linked run's result changed after this run ended"), `[]` when none did.
  A held step is `blocked` with that reason; it isn't a failed child, and a new run replaces it. `accepts` lists each value as written, split only at commas.

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

It reads only `proposals/` (this request's own files and their decisions), the process's versions and `people.json`, and a problem anywhere else never holds it back. It writes one new file in `proposals/` and nothing else: never through a link, never outside the folder. The file is written to a temporary name first, flushed, then put in place in one step that fails if the name is already taken, so it never replaces a file and the final name never holds half a request. It's read back byte for byte. On a disk without hard links the final name is created exclusively and filled from the finished temporary file; if that's cut short (a full disk), the command removes the file it created. A retry never removes a file: a file under the request's name that isn't complete JSON (still arriving, or another request still writing it, or one cut short by a crash) is named (`malformed`, exit 4, `held`), and nothing is written until a person deals with it (see [A request file is incomplete](recovery.md#a-request-file-is-incomplete)). Plans and plan decisions under the request's name are read with the same code `runs` uses, so they get the same problems: one not in the format is named (`malformed`, exit 4) and never counted, and while one is there and the request isn't, nothing is written (`held`). `--dry-run` only reads: it doesn't even make `proposals/` when it's missing.

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

Running runs and their steps: `data` is `{ "runs": [...] }`, each with `key`, `title`, `folder`, `version`, `recorder`, `details` and `steps`. Each step has `id`, `phase`, `text`, `type`, `state`, `binds` (the details it's tied to), `evidence` (what it records, as in `run --json`), `accepts` (whether a person could accept a report on it) and `why` (why not, or `null`). A step that starts another process takes no report. A step that sets run details takes one since Flightdeck 2.16: the report's value for the detail (evidence under the name `targets` lists, `rd-<detail>-<hash>`) is checked as a typed value would be, the person sees "Sets tag to …" or "Replaces …", and it can't name that detail as a `detail:` input. Older copies refuse such a report, which is safe.

### Jira searches

A `{jira.search}` step (2.16) also has `search`, in `report targets`, `run --json` and `next`, resolved from the run's details and the Jira address it copied when it started. `process --json` has the template fields only (the first six below). Other steps have no `search` key.

| Field | What it holds |
|---|---|
| `query` | The step's JQL as the checklist writes it, with `^detail` placeholders; `null` for a saved filter |
| `filter` | The saved filter's number, as text; `null` for a query |
| `results` | The rule the results must meet: `none`, `any`, `exactly N`, `at least N` or `at most N` (`any` when the checklist says nothing) |
| `what` | What the search finds, in the checklist's words; `""` when it says nothing |
| `site` | The team value holding the Jira address, like `jira-base-url`; `null` when the step's `site:` isn't one |
| `uses` | The run details the query uses, in order of first use; `[]` for a filter |
| `jql` | The query with the run's details filled in, each quoted; `null` until `ready` |
| `link` | The Jira search address; `null` until `ready`, with no Jira address, or over 8,000 characters |
| `searchId` | The current search's identity, to copy into a report's evidence; `null` when the run's record of a detail or of the step's recovery is damaged |
| `ready` | `true` when the search can be run now |
| `why` | Why it can't (a detail it waits for, a damaged record); `null` when `ready` |

The report carries the results as evidence: `searchId` (copied from `report targets`, never computed), `count` (an exact total), `keys` when the count breaks the rule and isn't 0, and optionally `resultsLink` and `ranAt`. The JQL and the link are never sent. Accepting it is checked against the run at that moment:

- No `searchId`, or one for an earlier search (a detail it used changed, even back to its old value, or the run was recovered from a copy): refused.
- A `pass` must meet the step's rule.
- A `fail` or `blocked` report for the current search can't be accepted, but **Block with these** blocks the step with its results and declines the report with "Blocked with its results".

`report check --folder` and `report write` warn about each of these; `--strict` refuses.

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
- **Two computers that aren't syncing.** OneDrive keeps both copies of a report written twice. Copies with the same bytes are one report; copies that differ can't be accepted until a person deletes the wrong one (see [A report can't be accepted](recovery.md#a-report-cant-be-accepted)).
- **Older copies.** Flightdeck 1.x never lists `reports/`. A step checked from an accepted report is an ordinary answer with a log line naming the report and its SHA-256, which every copy reads.

## Writing drafts (for AI assistants)

Contract `flightdeck-draft/1` (1.19). These commands **change the team folder**, unlike the reading commands above. They never write a draft that's open in a Flightdeck editor this computer can see: the change becomes a **proposal**. If that editor is the main editor for the draft and has nothing unsaved, and the proposal starts from the draft as it is, Flightdeck applies it there within a few seconds, highlighted, saves it, and one Undo takes it back. Otherwise a person reviews and applies it on the process page.

```
flightdeck draft read    <team folder> <process> [--session <id>] [--or-latest] --json
flightdeck draft save    <team folder> <process> --expect <rev|none> --from <file|-> [--base <file>] [--session <id>] [--label <name>] [--by <person id>] [--note "<text>"] [--after-earlier] --json
flightdeck draft propose <same as save>
flightdeck draft check   <team folder> <process> [--from <file|->] --json
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
| `checks` | `blockers` and `suggestions` for `continueFrom.text`, as the editor's Checks and the Publish dialog show them: checked against what the app loads (people, step types, Jira workflows, every published version, the team values the text names), as `draft check` does. A part that couldn't be read is named in `problems` and left unchecked, never turned into a finding. |
| `copies` | Other files in `maps/drafts/` whose `process:` says this process (OneDrive copies, for example) |
| `readAt` | When it read the folder |
| `complete`, `problems` | As for the reading commands: a proposal that can't be read yet (`malformed`), a file too big or that couldn't be read. `complete` is `false` and the exit code is 4 when `problems` has anything. |

Exit codes: `0` complete, `4` partial, `1` usage or error, `5` the process has no draft, no published version and no proposal.

### draft check

`flightdeck draft check <team folder> <process> [--from <file|->] --json` (2.13) gives the verdict the Publish dialog gives for the draft in `maps/drafts/<process>.md`, or for the text in `--from` (at most 1 MB of UTF-8, its `process:` line saying the process). It only reads, and prints contract `flightdeck-read/2`: the envelope above, with `data`:

| Field | Means |
|---|---|
| `process` | The process asked for |
| `from` | What was checked: `kind` `draft` (`ref` its path) or `file` (`ref` null), and `rev`, the SHA-256 of the text |
| `checks` | `blockers` and `suggestions`, word for word and in order as the process page's checks show them; and (3.0) `blockerSteps` and `suggestionSteps`, one entry per finding in the same order: the step it names in this checklist, `{ id, excerpt }` (`id` null for a step without one, `excerpt` its text cut at a word with … when cut), or null. A finding's words name a step by the first 40 characters of its text, as every copy since 1.x has; read the step from these fields, never from the words. `draft read` and `draft save` give the same `checks`. |
| `publish` | `ok`, and `blockers`: what Publish would stop at, in its order (the checks' blockers, then `version:` pins that don't resolve, then screenshots not in the folder). Who publishes and the change note are left out: only a person gives them. |

It reads what the app reads, through the app's own readers and checks (`PF.publish.checkOptions`, `checkContext` and `publishCheck`, which the app's screens share): `people.json`, `step-types/`, `jira/workflows.json`, every process's published versions (which processes are published, the children linked steps start, the published parents that start this one) and, for a text that passes one, `team-values.json`. A part that couldn't be read, or that a newer Flightdeck wrote, is named in `problems` (`complete` false, exit 4) and left unchecked: it never becomes an unknown type, a missing owner, an unpublished process or a false Jira suggestion. A linked step whose child has a version that can't be read isn't checked against an older one, a `version:` pin to it isn't checked, and a screenshot whose bytes can't be read is never called missing. Every problem the read meets decides this, whatever its kind (a failed read, a newer file, a link, a file that vanished while it was read, a file too big): a team step type whose file is one of them is never an unknown type and its fields aren't scanned for references. What a reader leaves out over its limit is named from that reader's own read (`skipped`) and left unchecked: each file past the first 100 in `step-types/`, and the issue types past the first 50 in `jira/workflows.json` (then no Jira step is checked). A version that can't be read leaves the others checked: an older one only leaves a `version:` pin to it unchecked, while one numbered at or above the latest that reads makes the latest unknown. Only what the text uses counts: a problem with `people.json` when it names no owner or backup, with `team-values.json` when it passes no `team:` value, with Jira workflows when it has no Jira step, or with a team step type it doesn't use leaves the answer complete. A draft that can't be read, or that was gone when it was opened, is never checked as empty text and never "no draft": `draft check` exits 1 naming it, and `draft read` gives empty `checks` with `complete` false. A failure that stops the whole read still names every problem met before it.

**Changed message** (3.0). A draft whose `{jira.search}` steps have no Jira address in Team values gets one blocker per address, with how many searches need it and their step IDs (as in `7 Jira searches need the team's Jira address…`), where 2.x gave one blocker per step. A tool that counted those blockers, or matched the per-step words, needs the new words. Every other finding's words are as 2.x gave them.

**Module results** (3.0). The checks add the result blockers listed in [What stops a checklist from publishing](map-format.md#what-stops-a-checklist-from-publishing) (a `result:` that isn't a choice, no decision or several setting it, options that don't match, `accepts:` the child can't return), and a suggestion for a linked step whose child returns a result but which has no `accepts:`.

**Design tips** (3.0). `design` holds advice on the draft's shape (`tips`, and `library` on what was read for them), the list the checklist's page and the editor's Checks show under **Design tips**. A tip never stops publishing and never appears in `checks` or `publish`.

| Field | Means |
|---|---|
| `design.tips` | Each tip: `id` (what kind, below), `at` (`step`, `gate` or `checklist`), `ref` (the step's or gate's ID, or null) and `text` (the app's words) |
| `design.library` | `complete` (whether every published checklist was read for the tips that compare with them) and `note` (in words). When it's `false`, a `library-unread` tip says so: a search or gate shared with a checklist that couldn't be read isn't named. |

The tips, by `id`: `results-any` (a search with an explicit `results: any` whose wording reads like a readiness check), `whole-set` (one `{confirm}` over a whole collection: "each …", "every …", "all stories …"; Flightdeck can't repeat a step for each item yet, so it suggests one result per item), `verdict` (READY, NOT READY, go/no-go or approval wording on a step that isn't a `{decide}`: a run would record only that it was checked), `solo-roles` (`runs: solo` with more than one role at work), `unused-role` and `unused-detail` (declared but never used), `duplicate` (a search or gate a published checklist already has, named with its step) and `library-unread`.

Exit codes: `0` complete, `4` partial, `5` no draft (pass `--from`), `1` usage, or a draft that couldn't be read (named in `problems`). The schema is `SCHEMA2.draftCheck` in `src/core/appjson.js`.

### library inspect

`flightdeck library inspect <team folder> [--process <id>] --json` (3.0) reads every checklist in the folder into one shape, so an assistant designing or changing a checklist can see what already exists before it writes. It only reads, and prints contract `flightdeck-read/2`: the envelope above, with `data` built by `PF.library.inspect`, the same code as a checklist's **Used by and similar** panel and the **Which checklists** list on Step types.

| Field | Means |
|---|---|
| `checklists` | Each process's latest usable version (`source` `publication`, with `version` and `folder`) and its draft when the draft differs (`source` `draft`, `version` and `folder` null). Each has `process`, `title`, `owner`, `runs` (`solo` or `team`), `context` (each `name` and `type`), `roles`, `steps` (`id`, `phase`, `type`, `text`, `must`, `roles`, `fields`), `searches` (`step`, `query`, `filter`, `normalized`, `results`, `site`), `gates` (`id`, `phase`, `title`, `implicit`, `owner`, `approves`, `pattern`), `sets` (`step`, `names`), `children` (each linked step's `step`, `process`, `version` pin or null for the latest, `pass` entries and `carry` names), `types` (built-in step types used), `teamTypes` (team step types used), `unknownTypes` (types neither built in nor read from `step-types/`, such as a file that can't be read or one past the first 100) and `skills` (`name`, `implements`, `steps` or null for the whole checklist, `status`) |
| `usedBy` | Every link: `process` (the checklist linked to) and `by` (`process`, `source`, `step`, `version` pinned or null) |
| `overlaps` | Candidates that look alike across two or more checklists: `kind` (`search`, `step` or `gate`), `reason` (`same normalized JQL`, `same saved filter`, `same type and fields`, `same gate approves pattern`), `key` (what matched) and `items` (`process`, `source`, `id`). A candidate is never a verdict: two searches can match and still differ in scope, owner or authority. A draft and its own publication are one checklist, never an overlap. |
| `stepTypes` | Each type in use: `id`, `team` (a team type) and `usedBy` (`process`, `source`, `steps`) |
| `completeness` | `complete`, `unread` (each part that couldn't be read: `process` when known, `path`, `why`) and `note`. When anything couldn't be read, a link to it or an overlap with it can't be ruled out: an empty `overlaps` then means only "none among what was read". |

**Normalized.** `normalized` is the query as Jira reads it: words lower-cased, quoted values kept as written, every run detail one placeholder (`^version` and `^fix_version` are both `^?`), `ORDER BY` left out; null for a filter or a query that doesn't lex. `pattern` is a gate's `approves:` the same way (case, spacing and emphasis don't count). A step's fields are compared without the ones that say when or how strictly (`at`, `due`, `after`, `expect`, `deadline`, `require`, `evidence`, `sets`); a step with no other field is never a candidate.

With `--process`, `checklists` holds only that process's, `usedBy` the links to and from it, `overlaps` those it's in and `stepTypes` the types it uses; `completeness` is the whole folder's. It reads `publications/`, `maps/drafts/`, `step-types/`, `skills/` and `skill-registrations/`, as the app does (a skill registered in `skill-registrations/` is listed under its checklist's `skills`). A draft with a line it doesn't understand is read as far as it goes and named in `problems` (`malformed`) and in `completeness.unread`, a skill registration that can't be read, a step-type file that can't be used, comes from a newer Flightdeck or is past the first 100 (`skipped`), and versions numbered alike at the top of a process (`conflict`, which leaves that checklist out) are named in `problems` too: each makes the answer partial. Exit codes: `0` complete, `4` partial (`problems` names each file), `5` no such process (with `--process`), `1` usage or a folder that couldn't be read. The schema is `SCHEMA2.library` in `src/core/appjson.js`.

### draft save and draft propose

`save` writes the draft directly only when **nobody has it open** (no editor this computer can see; a presence file it can't read, or a `presence/` it can't list, counts as open) **and** the draft is exactly the text you started from (compared byte for byte right before the write). Otherwise, and always with `propose`, it writes a proposal.

- **Checked first, nothing written if any fails (exit 1, `usage`):** the process ID; `--expect` (a SHA-256 or `none`); `--from` (a file, or `-` for standard input) holding at most 1 MB (1,048,576 bytes) of valid UTF-8 whose `process:` line says the process; `--base` the same way; `--label` (letters, numbers and dashes, up to 40); `--by` (an ID in `people.json`); `--note` (up to 200 characters).
- **Which text you started from (`--expect`):** this session's own pending proposal with that `rev` (see replacing, below); else the draft if its `rev` matches; else one of this session's proposals; else a published version's `map.md`; else `--base`, whose SHA-256 must match. `none` starts a new draft. None of these: exit 1, `missing-base` ("Pass the text you read with --base, or read the draft again.").
- **Replacing or following your own proposal:** when `--expect` is the `rev` of your session's own pending proposal P1 (as `continueFrom` gives it), the new proposal **replaces** P1 by default (`replaces: P1`) and starts from P1's own base, so it goes straight from the draft P1 started from. With `--after-earlier` it **follows** P1 instead (`after: P1`, starting from P1's text): it becomes applicable once P1 is applied. `link` in the output says which: `replaces`, `after` or null.
- **A proposal** is one new file, `proposed/<process>/<operation>.json`, created exclusively (never over another file), flushed and read back. It holds the full new text, the exact text it started from and the SHA-256 of both, so it's never lost, even if the draft changes meanwhile. Over 4 MB as a file: exit 1, `too-big`, nothing written.
- **A direct save** writes `maps/drafts/<process>.md` (through a temporary file and one rename) and one line of saved history in a new file of its own, `history/drafts/<process>/agent-<operation>.jsonl` (`source` `agent`; History says "Changed by your AI assistant"). If that line can't be written, the save still stands and `history` says why.

Prints `{ contract, app, process, session, operation, outcome, why, link, rev, file, ids, checks, warnings, history, complete, problems }`:

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
| `complete`, `problems` | (2.13) What couldn't be read for this save or for its `checks`, as `draft read` names it. When `complete` is `false`, the parts `problems` names weren't checked; the exit code is still `0` for a save that was written or proposed. |

Exit codes: `0` written or proposed; `1` usage, `missing-base`, `too-big` or `failed` (the folder couldn't be changed, a link was refused); the error object is `{ contract, app, error: { kind, why }, problems }`. Codes say what this computer's copy of the folder showed when the command ran.

**What it may write:** only `maps/drafts/<process>.md` (a direct save), `proposed/<process>/<operation>.json`, `history/drafts/<process>/agent-<operation>.jsonl`, and, when a direct save continued from your own pending proposal, one decision `proposed/<process>/<that proposal>.<operation>.<rev>.json` with `status` `replaced`, so it isn't offered again, never through a link and never outside the folder. It never writes or deletes anything in `presence/`, and never changes a proposal, attempt or decision once written.

**Known limits.** Who has a draft open is what this computer's copy of the folder shows: another computer's editor may arrive late (seconds to minutes over OneDrive), and a tab in the background may stop saying it's there. A shared folder has no atomic compare-and-swap, so a hand edit, an older copy of Flightdeck or a direct file write that lands between the final compare and the write can still be replaced, exactly as in 1.18. A proposal is never lost. Flightdeck 1.19 doesn't merge: a proposal applies only when it starts from the draft exactly as it is. "Within a few seconds" holds on one computer (the editor looks every 2 seconds); across computers it adds OneDrive's sync time, which has no bound. Two computers with the same draft open can each apply the same proposal once before their files sync (it then shows **Applied twice**); to take back an assistant's change in that case, use **Decline** on the process page rather than Undo in the editor.

## Loops

A `{for.each}` step (3.0) starts one linked run of a child checklist for each item in a list, such as every story in a release. The list lives in the folder as scope records in `proposals/`: requests (from a tool or a person) and decisions on them. `flightdeck loop` reads a loop and asks for changes to its list. It never starts a run and never writes `run.json`: the parent run's recorder sees each change the next time Flightdeck reads the folder, and people start the assessments themselves.

```
flightdeck loop read    <team folder> <process>/<run> <loop step> --json
flightdeck loop sync    <team folder> <process>/<run> <loop step> --from <observation.json | -> --tool <name>@<version> --key <key> [--dry-run] [--json]
flightdeck loop add     <team folder> <process>/<run> <loop step> --keys ABC-101,ABC-102 --tool <name>@<version> --key <key> [--dry-run] [--json]
flightdeck loop exclude <same> --item ABC-107 --reason <why> --tool ... --key ...
flightdeck loop restore <same> --item ABC-107 [--reason <why>] --tool ... --key ...
flightdeck loop exception <same> --item ABC-104 --reason <why> --approver <person id> [--as <person id>] --tool ... --key ...
flightdeck loop withdraw <same> --item ABC-104 --tool ... --key ...
flightdeck loop owner   <same> --item ABC-104 --owner <person id, or ""> --tool ... --key ...
flightdeck loop choose  <same> --item ABC-104 --run <run id> --tool ... --key ...   (which of its competing runs counts)
flightdeck loop plan    <same> --item ABC-104 --record <request id> --tool ... --key ...   (which of two plans made at once stands)
flightdeck loop review  <same> --accept ABC-103,ABC-107 | --keep ABC-103 --as <person id> [--reason <why>] --tool ... --key ...
```

Every command prints `flightdeck-read/2` (with `--json`) or plain words. `--dry-run` previews and writes nothing. The same `--tool` and `--key` always mean the same request: a retry writes nothing and says `already`; the same key with other content is refused (`key-taken`), naming the changed fields.

### The CLI asks; the recorder applies

`flightdeck` never writes `run.json`. Starting a story's run, approving the loop and sending the approval back change the run, so the CLI files them as requests in `proposals/`, and the recorder's window carries them out with the same checks as its buttons:

```
flightdeck loop start      <same> --item ABC-101 --as <person id> --tool ... --key ... [--dry-run]
flightdeck loop start-all  <same> --as <person id> --tool ... --key ... [--dry-run]
flightdeck loop approve    <same> --as <person id> --tool ... --key ... [--dry-run]
flightdeck loop send-back  <same> --as <person id> [--reason <why>] --tool ... --key ... [--dry-run]
flightdeck loop resolve    <same> --record <request id> --outcome applied|refused --as <person id> --tool ... --key ... [--dry-run]
```

`--dry-run` prints the plain-text preview: which story runs would start and which are skipped and why (already started, approved without a run, removed, waiting on a removal decision, a missing input), or the roll-up an approval would record. `start-all` lists exactly the runs the app's **Start all under my recording…** would start. Without `--dry-run` the request is filed (`requested`); no run starts and nothing is approved until the recorder's window applies it.

The recorder's window applies each request once and writes `<request>.status-<writer>-<rev>.json` with `op` `applied` or `refused` and the reason in plain words (for example "It can't be approved yet: 2 in scope · 1 not started."). `loop read` lists them under `requests`, each `pending`, `applied` or `refused`, and the run screen shows the latest 10, waiting, applied or refused with why.

A request asks for one kind of action. `--as` must be a person in `people.json`, not inactive, who is the run's recorder, holds one of the loop step's roles, or (to start a story) owns it; otherwise it is refused with why, here and in the recorder's window. A retry with the same `--tool` and `--key` is judged on what was first asked: the same request says `already`, even after it was carried out; another action, person, reason or story list under the key is `key-taken`. A start request is refused while the loop step can't start runs, as the buttons are. `loop choose` is bound to the story's attempt and the competing runs it saw: if another run arrives for that attempt, or two people chose different runs without seeing each other, approval waits and the run screen shows it as a change until someone chooses again. `loop start` refuses a story named twice in `--item` before anything is filed. A request that saw a scope record this computer can't read yet is listed as `held` and isn't carried out until that record arrives; an outcome recorded two ways at once is listed as `review` and isn't carried out again. `loop resolve --record <request id> --outcome applied|refused` asks the recorder to record what happened; it is refused unless the outcome was recorded both ways and the effect agrees (a run it started, or the approval or send-back naming it), and the action is never done again. `loop plan --item ABC-101 --record <request id>` keeps one of two plans made at once for a story's attempt (`loop read` lists them under `planConflict`).

An approval whose snapshot no longer matches the loop's roll-up doesn't count, in every window and in `flightdeck run` and `next`, before any save lands; the recorder's window then sends it back for review and saves that.

### The observation

`sync` takes what the tool read from the source, whole, never a summary:

```json
{ "source": { "system": "jira", "site": "https://jira.example.com" }, "generation": "2026-11-07-0942", "query": "fixVersion = 4.1",
  "observedAt": "2026-11-07T09:42:00Z", "items": [{ "id": "10042", "key": "ABC-101", "title": "Checkout with saved cards" }],
  "reported": 11, "fetched": 11, "complete": true, "errors": [] }
```

`id` is the issue's stable id and `key` its key. `complete` says every page was read; Flightdeck treats it as complete only when `fetched` equals `reported`, the items add up and `errors` is empty. "Complete" means the account's search read everything it reported, not that Jira holds nothing else. A complete observation that lacks an item in scope proposes its removal, for a person to review; an incomplete one only adds. Absence is never removal. An observation holds at most 500 items; more is refused, never cut.

### What it writes

`proposals/req-<tool>-<24 hex>.json`, `flightdeck-plan/3` with the `loops` feature: the loop it's for, the records it saw (`seen`), the observation, the changes, and one planned child per new story (the inputs the loop's `pass:` fills, and the attempt). `review` writes `proposals/<request>.status-<tool>-<8 hex>.json`, `flightdeck-plan-status/3`: a person's decision (`--as`, recorded on their behalf by the tool) to remove the stories (`accept`) or keep them. Each file is written once and read back. Every copy before 3.0 calls these files newer and never offers one as a plan.

### The result

`data.status` is `would-request` (a preview), `requested`, `already` or `held` (something it depends on couldn't be read; nothing was written). `data.preview` is the summary in plain words, the one an assistant can repeat:

```text
Release 4.1 — preview only; no files written.

Would add 3 stories and request review of 2 removals.
One proposed removal has an assessment in progress.
2 new assessments are ready to start; 1 needs environment.
No runs would start.
The scope change would require approval review.

Jira observation: 11 of 11 reported matches read; pagination complete.
Team-folder read: complete.
```

With the stories below it. The JSON carries the same: `added`, `proposed` (with `open`, `recorder`, `answered` and `total` for an assessment in progress), `excluded`, `restored`, `children` (`inputs`, `missing`), `impact` (`review`, `reasons`), `observation`, `runsStarted` (always 0) and `membershipVisible` (always false: the table shows the change once Flightdeck reads the folder). Keep these apart: a preview, a request written, membership visible, a run started.

`read` gives `summary` ("11 in scope · 9 cleared by validation · 1 approved without a run · 1 needs work"), `counts`, `ok`, `blockers` (each with `key`, `kind`, `run` and `text`), `items` (scope `state`, `status`, `result`, `run`, `recorder`, `owner`, `exception`, `review`, `mismatch`), `pending` removals, `held` records, the last `observation`, the `approval` and every change since it (`changes`, `review`), and, after the run ended, `late`.

### Errors

| Situation | What it says |
|---|---|
| The source is incomplete | The preview adds what it found and says missing stories can't be proposed for removal. Retry the search. |
| A scope record this computer can't read yet | `held`: "This loop has a scope record this computer can't read yet. Nothing written. Check folder availability, then retry." |
| The same key, the same request | `already`: "Already requested. Nothing written.", with the loop's state now. |
| The same key, another request | `key-taken`: "This key already names a different request. Changed fields: …. Read that request before choosing a new key." |
| A story's child is missing an input | The preview names it: "1 needs environment". Its scope change is valid; its assessment can't start yet. |
| The write can't be confirmed | `failed`: "Could not confirm whether the request was saved. Retry with the same key." Never a new key: that could ask twice. |

## Writing step types (for AI assistants)

Contract `flightdeck-write/1` (2.14) for `type save`; `type list` and `type read` print `flightdeck-read/2`. `type save` **changes the team folder**: it writes `step-types/<id>.json` and one history line, `history/step-types/<id>/agent-<operation>.jsonl`, and nothing else, never through a link and never outside the folder.

```
flightdeck type list <team folder> --json
flightdeck type read <team folder> <id> --json
flightdeck type save <team folder> <id> --expect <rev|none> --from <file|-> [--asked-by <person id>] [--note "<text>"] [--dry-run] --json
```

**How to use them.** `type read` the type and keep `rev`. Save with `--expect <rev>`, or `--expect none` exactly when `type read` said `missing`. `type save` compares the exact bytes you read (the SHA-256 of the file, byte for byte: a byte-order mark or line endings that changed count as a change), writes a complete temporary file beside the target, checks the folder allows hard links, compares again, then makes one link (a new type, which never replaces a file) or one rename (a change), and reads the file back. That's the same guarantee as Flightdeck's own saves, no stronger. Like two Flightdeck windows in different browsers, two saves at the same instant can replace one another without either being told. The history line is a record of who changed what, not a way to get a save back.

### type read and type list

`type read` gives `data` `{ type }`:

| Field | Means |
|---|---|
| `id`, `path` | The type asked for, and `step-types/<id>.json` |
| `state` | `ok`; `missing` (not there, or no `step-types/` folder, and nothing said it was there); `malformed` (not UTF-8, not JSON, not an object, fails Flightdeck's checks, or the file name isn't the ID); `newer` (a newer Flightdeck wrote it); `unreadable` (including when `step-types/` couldn't be listed and the file wasn't found: "Whether this type exists is unknown"); `oversized` (over 1 MB); `vanished` (listed and then gone, or changed twice, while it was read); `link` (a link or a folder at the path) |
| `rev` | The SHA-256 of the file's exact bytes; `none` only for `missing`; null when it couldn't be read |
| `bytes`, `bom`, `lineEndings`, `utf8` | Its size, whether it starts with a byte-order mark, `lf`, `crlf`, `mixed` or `none`, and whether it's valid UTF-8 |
| `text`, `def` | The text as Flightdeck decodes it, and the definition when the JSON is an object (null otherwise, and for `newer`) |
| `errors`, `needs` | Why it isn't `ok`, and for `newer` the version it needs |
| `position`, `selected`, `usable` | Its place among the regular `.json` files in `step-types/` in the order Flightdeck reads them (by name, capitals first); `selected` when it's within the first 100, which is all Flightdeck reads; `usable` when Flightdeck loads it as a type. A file the command calls `malformed` can still be `usable` (an invalid byte Flightdeck decodes, for example). Folders and links take no place: null. |

`type list` gives `data` `{ types, limit, count }`: one row per `.json` entry in `step-types/`, files first in load order, then folders and links. Each row is `{ file, id, state, rev, kind, position, selected, usable, copyOf, errors }`: `kind` is `file`, `folder` or `link`; `copyOf` names the type file it's a copy of (`x-LAPTOP.json`, `x (1).json`, `X.json`), even when that file isn't there. `limit` is 100 and `count` the number of regular `.json` files. Exit codes: `0` complete, `4` partial (`problems` names each file that isn't `ok`), `1` usage or a folder that can't be read. The schemas are `SCHEMA2.stepType` and `SCHEMA2.stepTypes` in `src/core/appjson.js`.

### type save

- **Checked first, nothing read or written if any fails:** the ID; `--expect` (64 lowercase hex characters, or exactly `none`); each value flag said once; `--from` (a regular file, or `-` for standard input; never more than 256 KB plus one byte is read, so a bigger input is refused without being read in full, and a folder, FIFO or device is refused) holding at most 256 KB of UTF-8 (a leading byte-order mark is dropped), one JSON object whose `id` is the ID, no key twice in one object, no `__proto__`, `constructor` or `prototype` key anywhere, passing Flightdeck's own step-type checks word for word, and no `format` or `features` unless it records 2.0 evidence; `--asked-by` (1 to 80 characters, no control characters); `--note` (up to 200). A save that's refused or fails before its commit leaves the folder as it was: a `step-types/` it made for the save is removed again.
- **What it writes** is exactly what Flightdeck's editor writes for that definition: two-space JSON, UTF-8 without a byte-order mark, LF. Key order is yours.
- **Refused, whatever `--expect` says:** a copy beside the type (`copies`: a person decides which to keep), a file a newer Flightdeck made (`newer`).
- **Warnings, never refusals:** keys Flightdeck's editor would drop on its next save; fields or evidence the change removes while a draft step still names them; past the 100-file limit; a 2.0 type without the `typed-evidence` marker; what the history line leaves out.

Prints `{ contract, app, command, path, operation, outcome, written, rev, back, load, existing, appLoads, checks, askedBy, history, cleanup, error, words, readAt, complete, problems }`:

| Field | Means |
|---|---|
| `operation` | This command's own ID, `p-<time>-<10 random>`, also the history file's name |
| `outcome` | `done`, `same` (it already says exactly this), `checked` (`--dry-run`), `refused`, `failed`, `held`, `partial`, `replaced`, `unverified` or `unsure` |
| `written` | `true` when this command's link or rename returned, `false` when nothing was changed, `null` when it may or may not have been (`unsure`). It's the field that tells "written, read-back failed" from "nothing changed". |
| `rev` | `expected` (your `--expect`), `before` (what it found), `after` (what it tried to write) and `now` (what it read back whole, or null) |
| `back` | The read-back: `same`, `other` (another change replaced it), `missing` (removed), `unreadable`, `unstable` (it changed while being read back), or null when nothing was written |
| `load` | `{ position, limit, selected, from }`: where the type sits among the files Flightdeck reads, as of the save (`from` `C`) or, for `--dry-run`, if it were saved (`R1`) |
| `existing`, `appLoads` | What was there (`missing`, `ok`, `malformed` or `newer`) and whether Flightdeck loads it; they pick the person's route when the command can't save (the step-type skill has the table) |
| `checks` | `errors` (why the definition isn't valid), `warnings`, and `omitted` (`before`, `after`): why the history line leaves out a definition (`invalid`, `cap`, `cleaned`, `fallback`, or null) |
| `askedBy` | `{ id, name }` from `people.json`, or null |
| `history` | `{ path, written, why }` when a line was attempted (only after a write); `written` can be null when its link's result is unknown |
| `cleanup` | `{ leftover, why }`: temporary files it couldn't remove (safe to delete), or null |
| `error` | `{ kind, why }`: `changed`, `copies`, `newer`, `invalid`, `not-allowed`, `no-links`, `usage`, `failed`, `link-check`, `held`, `history`, `cleanup`, `replaced`, `unverified` or `unsure`; null for `done`, `same` and `checked` |
| `words` | One plain sentence saying what happened, for the person |
| `complete`, `problems` | Everything this save or its checks met that wasn't clean, from any source (a read that failed, contents rejected, a newer file, a link, a file over the limit): the target (a malformed file this save repairs and a newer one it refuses included), `step-types/`, `people.json` (and the team folder's listing it's looked up in), the drafts read for removed fields (checked against what Flightdeck loads now, so a repair warns too: "Draft release, step approved still uses system, which this change removes. Update that step before calling the change complete."), and the type's history (a line it rejects names its file). What reading drops or changes is named too: bad bytes read as replacement characters, `people.json` entries without a text ID and name, names cut to 60 characters, and a file that replaced this save after its commit but couldn't be read (the outcome stays `replaced`). If the target or `people.json` won't close after it's read, before the commit, the save fails (exit 1). `complete` is `true` only when none of them reported or dropped anything. When `complete` is `false`, a check didn't finish, and `checks.warnings` says which (for example "Couldn't check drafts in maps/drafts/. Check them for uses of the removed fields before calling this change complete."). The exit code still follows `outcome`. Handle both before calling a change complete. |

A `held` save names the next step from the failure: access denied ("Ask the folder owner to check your access"), a file too big to compare ("Ask a person to look at it in Flightdeck"), or a file that changed or vanished as it was read ("Try again once it has synced"). A definition the checks can't read at all (a name that's an object, say) is `refused`, `invalid`, like any other invalid definition.

Exit codes: `0` `done`, `same` or `checked`; `1` `refused` or `failed` (nothing was changed); `4` `held`, `partial`, `replaced`, `unverified` or `unsure` (read the type again before you build on it). The schema is `WRITE1` in `src/core/appjson.js`.

**Known limits.** The final compare and the rename can't be one step on any shared folder: a save whose write and read-back both land between them is replaced, and neither side is told, as between two Flightdeck windows in different browsers today. A copy that appears after the final listing isn't refused; the next save is. An in-place edit that keeps the size and lands within the folder's timestamp granularity can go unseen. Flightdeck 1.10 to 2.0.1 compare a step type by a short fingerprint only, so an old editor can save over a newer type.

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

`implements.folder` is the published version folder the skill follows (`publications/<process>/<folder>/`). `steps` (step IDs) is optional: leave it out for the whole checklist. `description`, `group`, `tags` and `by` are optional too.

**What it checks first, writing nothing if any fails (exit 1):** the fields above; that the folder is a usable version of that process, the only one with its number ("Can't be matched: release v4-abcd1234 …" says which of these it isn't); that every step in `steps` is in that version; that the skill doesn't already have two registrations at the same revision (keep one, then register again); that every revision filed under the skill can be read here (one made with a newer Flightdeck, damaged or misnamed is resolved first: update Flightdeck, or remove that file), and listed: `skills/`, `skill-registrations/` and the skill's own folder must list (a permissions error or a link is refused, never read as empty), and a skill whose files are past the 500 registrations a copy reads is refused too; that no file speaks for the skill under another name (a `skills/<name>.json` that records another skill's name, or a revision whose recorded name or id isn't its folder's or file's: rename or fix it first); and that an existing `skills/<name>.json` is one this copy understands (a skill file of today's shape, or a pointer). A newer, damaged or unreadable `skills/<name>.json` is never replaced.

**What it writes:** one new file, `skill-registrations/<name>/<id>.<rev>.<window>.json` (`flightdeck-skill/2`), created once and never over another file, then read back with the same reader the app uses. The first registration of a name gets a new `id` (`sk-` and 8 letters or numbers) and revision 1; each later one keeps the `id` and adds 1 (`seen` says which revision it replaced). The exact version is recorded with its fingerprints (`mapHash`, `typesHash`). If the skill also has an older registration in `skills/<name>.json`, that file becomes a pointer, `{ "name", "implements": "moved", "movedTo", "id" }`, so older copies of Flightdeck refuse to match it instead of reading a version number.

Prints (with `--json`) `{ contract: "flightdeck-skill/1", app, registered: { path, name, version, id, rev, implements, sha }, tombstone }` (`tombstone`: the `skills/` file it replaced, or null), or `{ contract, app, error: { kind, why } }` with `kind` `usage`, `invalid` or `failed`. Exit codes: `0` registered; `1` anything else. Without `--json` it says the same in a sentence.

**How the app reads registrations.** The current registration of a skill is its highest revision. Two different files at that revision are **Needs review**; a revision this copy can't read (newer, damaged, misnamed), or a folder it can't list in full, holds the whole skill, so no lower revision is ever current past it; a registration beside an older `skills/<name>.json` of the same name is "Two registrations for <name>; keep one"; a pointer whose registration hasn't arrived yet waits. None of these, and no registration whose version is missing, replaced or unusable, is ever shown as current: each says it can't be matched, and why.
