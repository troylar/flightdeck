# Using Flightdeck from other apps

Flightdeck is a checklist tool for people: a monthly backup check, a quarterly access review, onboarding a new hire, closing the month, a release. Other apps can work beside a run the way a teammate would: look at it, then let the people decide. Since 1.18 an app can **read** checklists, runs, what's waiting and on whom, and follow-ups as JSON, through the `flightdeck` command. It works offline, on the team folder itself. There's no server and nothing to sign in to.

Reading is the only thing an app can do so far. Asking for a run and reporting work a tool did are planned for later 1.18 slices; until then a person starts every run and checks every step.

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
| `flightdeck process <folder> <process> [--version N \| --folder v3-…] --json` | One version of a checklist: phases, steps, gates, run details, roles, step types, and the evidence each step can record. The latest usable version unless you name one. |
| `flightdeck runs <folder> [--process <id>] [--status running\|planned\|ended\|all] --json` | Runs and planned runs (`all` unless you say) |
| `flightdeck run <folder> <process>/<run id> --json` | One run in full: each step's state, who and when, its values and the evidence this run asks for, gates, follow-ups |
| `flightdeck next <folder> <process>/<run id> [--person <id>] --json` | What's waiting in the run and on whom; with `--person`, that person's own next step too |
| `flightdeck followups <folder> [--process <id>] [--status open\|all] --json` | Every follow-up and what became of it |

A run's key is `<process>/<run id>`, for example `backup-check/k3m9p2q8`. In the app, a run's **More** menu has **Copy run key**.

`--contract 1` asks for this contract by number. A number this copy doesn't have exits 1 and names the ones it has.

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
| `malformed` | A run, plan, plan decision, follow-up decision or `people.json` that won't parse or isn't in the format (a plan decision other than accepted or declined, a plan detail that isn't text). It's left out of the data. A `people.json` like that leaves names `null`. A run file with anything the app would drop, cut short or replace when it reads it (a time it can't read, a gate without a state, a follow-up without text, a value that isn't text, a name it doesn't read) is named too, with where each one is (`gates.ready`, `followUps[0]`, `steps.tests.values.url`), and is still shown as the app shows it, without them. Beyond the cases it can name in words, the file is compared with what the app reads from it, field by field, and any other place they differ is named too; the only exceptions are documented defaults for values the file leaves out and two deliberate drops (who and when of an earlier "done differently", which only its note keeps, and a pause left on a run that has ended). A follow-up decision whose file isn't read as written (a note cut short, a link the app won't open) is named with its fields the same way. A `run.json` whose own process and ID don't match the folder it's in (copied into another run's folder) is named as belonging elsewhere and isn't read as that folder's run. |
| `newer` | A run, version or file from a newer Flightdeck, including a run whose own copy of its checklist or step types uses features this copy can't read. A run like that is named here and left out of the data. |
| `unusable` | A version this copy can't use, with why |
| `conflict` | Conflict copies or lost saves beside a run, for a person to resolve in the app |
| `still-syncing` | A version whose files haven't all arrived |
| `link` | A link the command didn't follow |
| `skipped` | A file too large to read (over 16 MB). The bytes are counted as they're read, so a file that grows while it's read is refused too. |
| `vanished` | A file or folder that was listed and then gone before it could be read or listed itself (OneDrive replacing it, or someone deleting it). A folder gone like that is never read as empty, so a decided follow-up never looks open because its folder went missing mid-read. |

Each command reads only what its output depends on, and every problem it meets there is reported (nothing it read is left out of `problems`):

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

Each step: `id` (stable across versions; keep these in your app's settings), `text`, `type`, `must`, `planned`, `roles`, `binds` (run details it's tied to), `sets` (run details it sets), `fields` (the checklist's fields, as text), `track` (or `null`), `timing` and `evidence`. Each gate: `id`, `title`, `implicit` (a plain "confirm together"), `owner` (a role or `null`), `approves`, `binds` and `timing`.

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

Each planned run: `id`, `process`, `title`, `version`, `when`, `by`, `created`, `note`, `details`, `roles` (role to person ID), `status` (`pending`, `accepted`, `declined`, `conflicting` when two decisions disagree, `changed` when the plan was edited after a decision) `run` (the started run's key, once accepted), `startsOn` (`version` and `folder` a person starting it now gets, as the app picks it, or `null` when the process has no usable version) and `versionMissing` (`true` when the plan names a version the folder doesn't have, so the app would start it on the latest instead). When any of the process's versions couldn't be read, both are `null`: unknown, never claimed missing. A `version` that isn't a version number (like `v3` or `1.5`) makes the plan `malformed`.

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

## A walkthrough

The examples are ordinary team processes. None of them is special to Flightdeck.

1. **Learn the checklist once.** A script that helps with the monthly backup check runs `flightdeck process "$TEAM" backup-check --json` and keeps the step IDs it cares about (`restore-test`, say) and their evidence names in its own settings. Step IDs stay the same across versions.
2. **Find the run.** On the first of the month someone starts "Backup check · November" in the app. The script finds it with `flightdeck runs "$TEAM" --process backup-check --status running --json`, or uses the key someone copied with **Copy run key**.
3. **See what's waiting and on whom.** `flightdeck next "$TEAM" backup-check/k3m9p2q8 --json` says the restore test is next and who holds the role. A reminder bot for an access review can post that to the reviewer; an onboarding tracker can show the new hire's manager which step waits on them with `--person`.
4. **Show the record.** `flightdeck run … --json` gives every step's state, who checked it and when, and what was recorded. A dashboard of month-end tasks, or a deploy script that wants to show the release's gates, reads the same thing.
5. **Check follow-ups.** `flightdeck followups "$TEAM" --status open --json` lists what's still open after each run, with its owner.

Treat a partial result (exit 4) as partial: show what was read and say what wasn't. A tool that can't see the team folder hands this JSON to a person or an assistant who can.
