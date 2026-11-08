# Command guide

Nothing here allows you to write a file `AGENTS.md` tells you not to. Each section below is how to do the work of the section with the same name in `AGENTS.md`, which says what to do and what never to do.

## Reading runs

### Through the command

`flightdeck runs <team folder> --contract 2 --json` (with `--process <id>` and `--status running|planned|ended|all`), `flightdeck run <team folder> <process>/<run id> --contract 2 --json`, `flightdeck next <team folder> <process>/<run id> --contract 2 --json` (what's waiting, and on whom), `flightdeck followups <team folder> --contract 2 --json` (with `--status open|all`), `flightdeck processes <team folder> --contract 2 --json` and `flightdeck process <team folder> <process> --contract 2 --json` read the folder exactly as Flightdeck does and never change it.

With contract 2, `runs` leaves test runs out (it says how many in `testRunsLeftOut`) unless you add `--tests`, and `process … --stage stage-<id>` reads a staged version; both work only with `--contract 2`. An older install that has only contract 1 says so (exit 1); then read the files.

Exit code 0 is complete, 4 partial (`problems` names what couldn't be read), 1 no data, 5 no such process, version or run. The fields are in docs/apps.md of the Flightdeck repository. Without the command, read the files as this section describes.

### Run files

Each run is `runs/<process>/<id>/run.json` plus `notes-*.jsonl` files. A step's answer is in `steps.<stepId>.s` (`done`, `na`, `blocked`, `recheck`, or `open`: evidence was filled in before anyone checked it), with any recorded evidence in `steps.<stepId>.values`; values filled in during the run are in `fields.<stepId>`. Gates are in `gates.<gateId>.s` (`passed`, `waived`, `failed`, `review`). A passed gate also lists what it `approved` (for example the commit).

A step that was never needed has no answer; one answered before a detail changed may keep that answer as `recheck`, and its phase's gate may keep a record as `review`, while the step reads as Not needed.

Follow-ups are in `followUps`; notes with `"kind": "correction"` are corrections to the checklist (see *Corrections* in `AGENTS.md`); older notes with `"kind": "fix"` (suggested fixes) or `"kind": "map"` describe a problem in their `text`. A step done differently has `steps.<stepId>.differently` (`note` is what happened, with `by` and `at`).

- **Older history** that no longer fits in `run.json` is in `history-*.jsonl`, one JSON object per line.
- **Practice:** practicing a draft in Flightdeck writes nothing to the folder, so there's nothing to read.
- **Linked runs and the corrections a publication lists:** *Run files* in the file formats.

### Test runs

A test run has `"test": true` (see *Reading runs* in `AGENTS.md`).

- Its `folder` and `stage.folder` are a `stage-<id>` under `staged/<process>/`, not a `publications/` folder.
- When a staged version is made the default, its `publication.json` has `stagedFrom`, and its stage's sign-off and finished clean test runs can count toward that version's readiness for a skill (the Ready for a skill? panel says which).

### Publications

**Publications:** read a process's latest complete version from `publications/<process>/v<N>-<id>/`. Its reference screenshots are copied into the same folder.

## Editing drafts

### Read, then save

Read with `flightdeck draft read <team folder> <process> --or-latest --json` and keep `session`, `continueFrom.rev` and `continueFrom.text` (save the text to a file: it's what you started from; with `--or-latest` and no draft, it's the latest published version).

Save with `flightdeck draft save <team folder> <process> --session <session> --expect <continueFrom.rev> --from <file with your new text> --base <file with the text you read> --json`, or `--expect none` for a new checklist.

`flightdeck draft propose` takes the same options as `flightdeck draft save`, and always saves your change as a proposal.

If the person has the draft open in Flightdeck's main editor with nothing unsaved and your proposal starts from the draft as it is, it appears in their editor within a few seconds (OneDrive adds its own delay when they're on another computer), highlighted, saved for them, with one Undo to take it back. Otherwise it waits for them to review and apply it on the process page.

- Saving again from your own pending proposal replaces it; add `--after-earlier` only when your new change must come after the earlier one rather than replace it.
- `--from -` reads the new text from standard input. A draft is at most 1 MB of UTF-8, and its `process:` line must name the process.

### Checks

`draft read` returns `checks` for the text you continue from, and `draft save` and `draft propose` return them for the text you saved: `blockers` (would stop publishing) and `suggestions`. They load what the Publish dialog loads: people, step types, Jira workflows, published versions and team values.

`flightdeck draft check <team folder> <process> [--from <file>] --json` gives the Publish dialog's verdict (`flightdeck-read/2`), and its `publish.blockers` also cover screenshots and `version:` pins. Its `design.tips` are the design tips the checklist's page shows: advice, never a reason it can't publish.

### The library

`flightdeck library inspect <team folder> [--process <id>] --json` (Flightdeck 3.0) reads every checklist into one shape: `checklists`, `usedBy` (which checklists link to which), `overlaps` (searches, steps and gates that look alike, with a `reason`) and `stepTypes` (which checklists use each type). Reading it changes nothing. An overlap is a reason to look, never proof two checklists do the same job. If `completeness.complete` is false, what `completeness.unread` names wasn't read: say so.

### Exit codes

Exit 0 means written or proposed (the JSON's `outcome` says which; for `draft read`, a complete read), 4 read but partial (`problems` names what couldn't be read), 1 a problem it names (`usage`, `missing-base`: pass `--base`, or read again; `too-big`; `failed`), 5 no such process. The contract is `flightdeck-draft/1`, in docs/apps.md of the Flightdeck repository.

## Reporting work

Three commands, in the order a report needs them:

`flightdeck report targets <team folder> --run <process>/<id>` lists the step IDs and the evidence each records; `flightdeck report check <report.json> --folder <team folder>` checks a report without writing; `flightdeck report write <team folder> <report.json>` writes it once.

The report's fields are in docs/apps.md of the Flightdeck repository.

### Reporting a Jira search

- Copy `search.jql` and `search.searchId` from `report targets` exactly as given. If `ready` is false, don't search: say why, and stop.
- Report an **exact total** from a search that finished: go through every page, or use a total the API documents as exact. Never use a page's length or an approximate count.
- If a search errors, times out, stops partway or gives an uncertain total, report `blocked` and name the problem. Never report 0.
- Record who you searched as in an `external` input. Never include a credential.
- When the rule is broken, use `fail` with the keys. Never `pass` to get it accepted.
- The scope search catches an empty or misspelled release. It doesn't prove the account sees every issue it should: Jira shows each account only what that account may see.

## Skills built from processes

A skill can live anywhere (a repo, a shared folder, a local path). `location` is its source path or link.

### A version published with Flightdeck 2.0

Save the registration to a file outside the team folder, as *Skills built from processes* in `AGENTS.md` says. Then run `flightdeck skill register <team folder> --from <that file> --json`. It writes a new revision in `skill-registrations/<name>/`, and if `skills/<name>.json` exists it replaces it with a pointer (`"implements": "moved"`).

### Every registration

- `implements` is the exact published version the skill follows: the version folder for a 2.0 registration, `<process>@<N>` for a file in `skills/`. Leave `steps` out when it covers the whole process; one process can have many skills.
- On an update, bump the skill's own `version` and register it again against the new version, by the new version's format: the command for a 2.0 version, otherwise `implements` in `skills/<name>.json`.
- Use `/flightdeck-skill-brief <process or skill>` to get the brief.

## Planning a run

A plan, as `proposals/<id>.json`:

```json
{ "kind": "plan", "id": "plan-release-2026-10-24-k3m9p2", "process": "release", "version": 3,
  "title": "Release 2026.10.24", "details": { "ticket": "ABC-123", "environment": "production" },
  "roles": { "release-lead": "person-blake", "qa": "person-morgan" },
  "when": "2026-10-24T13:00:00Z",
  "note": "Why these people (for example, rotation).", "by": "AI assistant", "created": "2026-10-17T13:00:00Z" }
```

`when` (an ISO date and time) is optional: Flightdeck lists plans by it and shows a plan on Home from 24 hours before. People also plan runs in the app; those plans are `proposals/plan-<process>-<random>.json`, with `by` set to a person's ID and, when duplicated from a run, `from` set to that run (`<process>/<run id>`).

### Run details

`details` are always text. For a typed run detail, write the value the way its kind stores it: `yes` or `no`, a date as `YYYY-MM-DD`, a plain decimal like `1234.5`, or a choice option exactly as the checklist spells it. Other text is converted only when its meaning is certain (`Y` becomes `yes`); anything else starts empty and waits for a person to fill it in, and nothing that uses it can go ahead until then.

## Asking for a run

This is for another app, such as a scheduler or a deploy tool, that needs a run. An assistant planning a run in this folder writes a plan instead, as above.

The app runs `flightdeck plan request <team folder> <request.json> --key <key> --json`. It writes one planned run to `proposals/`, once, for a person to start in Flightdeck; the same key and request again writes nothing. It never starts a run. Add `--dry-run` to see what it would write.

The CLI asks; the recorder applies. `loop start --item`, `loop start-all`, `loop approve` and `loop send-back [--reason]`, each with `--as <person id>` and `--dry-run` to preview, file a request; the recorder's window starts the runs or records the approval, and `loop read` shows each request as pending, applied or refused. Never write `run.json` yourself.

Exit code 0 is requested, already requested, or (with `--dry-run`) what it would write; 4 nothing written, because something it depends on couldn't be read; 1 refused; 5 no such process or version. The request's format is in docs/apps.md of the Flightdeck repository.

### Loops

A `{for.each}` step starts one run of another checklist for each item in a list (a loop): environments, documents, people, services, or Jira stories. Its `noun:` (like environment / environments; item / items when left out, story / stories for Jira) is what `loop read` returns in `noun`; use it when you talk about the rows. Its list is kept as scope records in `proposals/`, written only by `flightdeck loop`; never write, edit or delete one by hand.

Read a loop with `flightdeck loop read <team folder> <process>/<run> <loop step> --json`: its items (with `kind`, `noun`, `source`, and each item's `link`), the exact counts ("11 in scope · 9 cleared by validation · 1 approved without a run · 1 needs work"), what holds its gate, and the approval with every change since. Say the summary as it is; never round it into "all done".

Ask for a change with `flightdeck loop sync` (`--from` what a search or the loop's own feed read, whole; a list of items takes `source: {"feed": "<the step's source:>"}` and is refused from any other feed or scope), `loop add --keys` (and `--title`, `--link` with one key on a list of items; keys are taken exactly as typed), `loop exclude --item --reason`, `loop restore --item`, `loop exception --item --reason --approver`, `loop withdraw --item`, `loop owner --item --owner`, `loop choose --item --run` (which of an item's competing runs counts), or `loop review --accept|--keep --as <person>` (a person's decision, recorded on their behalf). Every one takes `--tool <name>@<version> --key <key>` and writes one file, once. Run it with `--dry-run` first and show the person the preview. A loop's list changes when Flightdeck next reads the folder; the command never starts a run, and people start each item's run in Flightdeck.

Exit code 0 is requested, already requested, or (with `--dry-run`) what it would write; 4 nothing written, because a scope record or part of the folder couldn't be read; 1 refused (a key already used for a different request, or a request that isn't valid); 5 no such run or loop step. If it can't confirm the save, retry with the same key, never a new one: a new key could ask twice. The formats are in docs/apps.md of the Flightdeck repository.

## Evidence packs

**Evidence packs:** when a person asks for a run's evidence, run `flightdeck export <team folder> --run <process>/<id> --out <a folder outside the team folder>` (or `--process <id> --from YYYY-MM-DD --through YYYY-MM-DD --tz Area/City` for the runs started on those days). It only reads. Exit code 0 is a complete pack, 4 a partial one (its top lists what changed or was missing), 1 no pack.

Where the pack goes, and what to give the person with it, is in *What you may write* in `AGENTS.md`.
