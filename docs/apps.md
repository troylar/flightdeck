# Using Flightdeck from other apps

Flightdeck is a checklist tool for people: a monthly backup check, a quarterly access review, onboarding a new hire, closing the month, a release. Other apps can work beside a run the way a teammate would: look at it, then let the people decide. Since 1.18 an app can **read** checklists, runs, what's waiting and on whom, and follow-ups as JSON, through the `flightdeck` command. It works offline, on the team folder itself. There's no server and nothing to sign in to.

Since 1.20 an app can also **ask for a run** with `flightdeck plan request`: it writes a planned run that a person reviews and starts in the app (see *Asking for a run*, below). Reporting work a tool did is planned for a later release; until then a person checks every step. Since 1.19, AI assistants can also read and save **drafts** of checklists with `flightdeck draft` (contract `flightdeck-draft/1`, at the end of this page). `plan request` and the draft commands change the team folder; the reading commands never do.

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

Each planned run: `id`, `process`, `title`, `version`, `when`, `by`, `created`, `note`, `details`, `roles` (role to person ID), `status` (`pending`, `accepted`, `declined`, `conflicting` when two decisions disagree, including a plan started twice from two computers, `changed` when the plan was edited after a decision) `run` (the started run's key, once accepted), `copies` (how many files hold this plan: OneDrive keeps both when two computers write it while disconnected; copies that say the same thing are listed once), `copiesDiffer` (`true` when those copies say different things: each is listed, and the app starts neither until a person deletes one), `requestedBy` (`name` and `version` of the tool that asked for it with `flightdeck plan request`, by its own account, or `null` for a plan a person or an assistant wrote), `startsOn` (`version` and `folder` a person starting it now gets, as the app picks it, or `null` when the process has no usable version) and `versionMissing` (`true` when the plan names a version the folder doesn't have, so the app would start it on the latest instead). When any of the process's versions couldn't be read, both are `null`: unknown, never claimed missing. A `version` that isn't a version number (like `v3` or `1.5`) makes the plan `malformed`.

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
