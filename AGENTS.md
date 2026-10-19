# Instructions for AI assistants working on Flightdeck

Read this, then README.md, CONTRIBUTING.md and docs/design.md.

Flightdeck turns how the team works into checklists in the spirit of *The Checklist Manifesto*: versioned **process checklists** made of **strongly typed steps**, with **gates** between phases. People run them alone (a developer's check-in, a product owner's Jira cleanup) or together (a production release). It is **one offline HTML file**. There's no server and no AI inside it. Data lives in a shared OneDrive folder, and assistants like you manage the checklists.

## In short

- Run `./test/run.sh` after every change. It must pass before you say a change is done.
- Keep the build one self-contained HTML file: no CDN scripts, no web fonts, no fetches to other hosts.
- Keep logic in `src/core/` pure and tested. UI code calls core functions; it never reimplements a rule.
- Every file in the team folder has exactly one writer (see docs/design.md section 4). Don't introduce a second writer for any file.
- Escape everything shown from files (`PF.util.esc`, `mdInline`, `mdBlock`). Never insert raw HTML from a checklist, note or run.
- Gates are never live locks. Don't add wording or features that imply a gate guarantees "safe right now".
- Examples and tests use synthetic people and data only.
- Write user-facing text in plain US English: short sentences, say what happens, no jargon.
- Every user-visible change adds an entry to `src/releases.json` (patch for a fix, minor for new or improved, major for an incompatible file format). `build.py` regenerates `CHANGELOG.md`; never edit it by hand.

The team owns this code. Leave it easier to change than you found it.

## The 60-second map

| Path | What it is | Rule |
|---|---|---|
| `src/core/` | `util`, `types`, `jira`, `map`, `outline` (the builder's line-preserving edits of a draft), `timeline` (Undo, Redo and History for the draft editor and the step-type form: text patches, typing units, baselines; saved history: its lines, their checks and their order), `publish`, `run`, `corrections` (corrections recorded in runs: format, groups, decisions, the run's record), `followups` (what became of a run's follow-ups: decisions in `followups/`, their order, Home's and Folder health's lists), `insights` (How runs go: numbers per publication folder with their denominators and exclusions, drill-downs, Runs filters; `DEFS` is checked against docs/design.md section 23), `skills`, `attach` (which files notes and corrections can carry, and how each is named and shown), `contract` (what part of `AGENTS.md` and the skills a hash covers, and the embedded baselines), `health` (Folder health: issues with one action each, the all-clear list, the recovery guide's sections), `connection` (the connection check: file names, records, results in words): every rule | Pure functions. No DOM, no files. Every rule has a test. |
| `src/storage/` | `fs` (folder access), `repo` (load, save, publish, conflicts, cache, Folder health's scan, the connection check's files, saved history's files) | One writer per file, always. |
| `src/ui/` | `views/` (HTML strings: `common` (top bar and sections), `home` (Home, Runs, Processes, Skills), `process`, `manage` (the checklist panel on a process page, draft editor, new process, step types, Settings), `builder` (the draft editor's outline builder), `run` (the run workspace: header, status strip, Phases, the checklist with Next up, and the inspector), `pages`, `overlays`, `flight` (the read-only Flight plan diagram of a checklist), `insights` (How runs go and the Runs page's filters and drill-downs), `health` (Folder health, Connection check, When something goes wrong)), `app` (state, events, refresh, patching), `examples` (the example folder's seeded run history), `icons` | Calls core; never reimplements a rule. |
| `src/page.html` | Styles, color tokens, page shell | Light and dark tokens; no external resources. |
| `build.py` | Joins `src/` into `dist/flightdeck.html` | Order is fixed in `CORE` and `APP` at the top. |
| `example-folder/` | A complete team folder, built into the app as examples | Synthetic people only. Its `AGENTS.md` is the contract for working **in a team folder**; its `.flightdeck/skills/` are the Flightdeck skills for AI assistants that every new team folder gets (`flightdeck skills --to <dir>` installs them anywhere else). |
| `test/` | `rules`, `insights`, `outline`, `timeline`, `folder`, `sync`, `views`, `checker`, `app`, `build`, `cli` and `perf` tests, `fixtures/`, `big-folder.js` (a big synthetic folder in memory that counts folder calls), `run.sh` | `sync.test.js` simulates two computers on a delayed OneDrive. `perf.test.js` asserts folder-call ceilings that may only go down. |
| `tools/type-table.js` | Writes the step-type table in `docs/map-format.md` | A test fails if docs and code disagree. |
| `tools/big-folder.js` | Makes a big synthetic team folder from a seed (2,000 runs by default; profiles in docs/design.md section 25) for the perf tests, or on disk with `--out` | Synthetic people only. |
| `tools/baselines.js` | Writes `src/baselines.json`: every `AGENTS.md` and skill file shipped, by hash, which `flightdeck install` uses to tell an old default from a team's change | A test fails if this version's files aren't recorded. |
| `bin/flightdeck.js` | The `flightdeck` command: install, skills, backup | No dependencies. Never writes through a link or outside the target folder. |
| `docs/` | `design.md` (the spec), `map-format.md`, `onedrive.md` (including the release gate), `updating.md` and `recovery.md` (for team leads) | Update them in the same change as the code. |

## Commands

```bash
python build.py                    # build dist/flightdeck.html
bash test/run.sh                   # build + every test + "one self-contained file" check (Git Bash on Windows)
node tools/type-table.js --write   # after changing step types
node tools/baselines.js --write    # after changing example-folder/AGENTS.md or a skill
```

**A change is done only when `bash test/run.sh` passes**, `dist/flightdeck.html` is rebuilt, and the docs say what the code now does. Commit `dist/flightdeck.html` with the change. Show the test output; don't summarize it as "tests pass".

## How the app thinks

- **Checklist → publication → run.** A Markdown draft in `maps/drafts/` is published into an immutable folder `publications/<process>/v<N>-<id>/`. A run pins that publication forever.
- **Typed steps.** Each type (`confirm`, `decide`, `jenkins.job`, `bitbucket.pr`, `jira.issue`, `run.command`…) has *checklist fields* that describe the step and *evidence* that can be recorded when it's checked. Both are optional. Evidence is required only when the checklist says `require:` (named evidence) or `evidence: link|note` (proof on a plain step). During a run, values can be filled in with **Fill in**; that's logged and never triggers a re-check, except correcting a value the step set with `sets:`, which re-checks the later steps that used it.
- **One recorder per run.** Only the recorder's window writes `run.json`. Everyone else views and adds notes to their own `notes-<session>.jsonl`. Hand off names the revision it passes on; take over is for emergencies.
- **Gates** end phases. A gate tied to a detail (`^commit`) goes to `review` when that detail changes and stays there until passed again.
- **Saving is checked.** Before writing, `repo.saveRun` compares a fingerprint of the file with what this window read. On any difference it writes this window's version as `run.conflict-*.json` and refuses. People resolve copies in the app's recovery panel.
- **Solo is first-class.** `R.solo(r)` is true when only the recorder is involved. Solo runs drop team wording and ceremony.
- **Finishing** collects follow-ups and lists the run's corrections, then shows the receipt.
- **Follow-ups** live in `run.json` (the recorder adds them); what became of each (done, moved, won't do, reopened) is a write-once decision file in `followups/<process>/`, ordered by `rev` like corrections' decisions. `run.json` never changes for it. See docs/design.md, Follow-ups after the run.
- **Corrections** are notes (`kind: "correction"`) in their author's own notes file; they never answer a step. Decisions are write-once files in `corrections/<process>/`; `PF.corrections` groups them (exact text apart from spacing, never case-folded) and orders decisions by `rev`, never by clocks. See docs/design.md, Corrections.
- **One answer path.** Every way of answering a step (the row's check, Done, Space and X, a Done differently landing, Mark it now) goes through `answerStep(key, id, how)` in `src/ui/app.js`. It answers that step only, with that step's own typed evidence, refuses while that step's Fill in is open or unsaved, and closes only that step's forms. Don't add another caller of `R.done` in the app (`examples.js` only seeds example history).
- **Drafts** (typed evidence, an open Fill in, an unsent note) are kept per team folder, run and step (`draftKey`), never shared across folders or steps.
- **Pause** stops steps, gates and timers (`R.pause`, `R.resume`, `R.activeMs`); paused time never counts in durations or analytics.
- **Tracks, times and child runs** come from the checklist: `### Track:` groups steps inside a phase; `at:`, `due:` and `after:` feed `R.schedule`; a `{run.process}` step starts a linked child run and settles when it ends.
- **Team files** are read, never trusted: `step-types/<id>.json` (checked by `T.checkCustom`, frozen into each publication) and `jira/workflows.json` (checked by `PF.jira.check`, copied into each run). Evidence always comes from `R.evidenceFor`, which adds a Jira transition's required fields.

## Rules you must not break

1. **The build stays one self-contained HTML file.** No CDN scripts, no font or network fetches. Fonts are embedded by `build.py`.
2. **One writer per file in the team folder.** Never add a second writer to an existing file. New shared data gets a per-session file. The one documented exception: any window may delete `connection/` files older than 7 days (docs/design.md section 21).
3. **Escape everything that comes from files.** Use `esc`, `mdInline` or `mdBlock`. Never put raw HTML from a checklist, note or run into the page. Links must stay `http(s)` or `mailto`.
4. **`R.sanitize` guards every run read from disk.** A new run field gets a sanitize line with an allowed type and a length cap, an entry in `KNOWN` (a run with a field this copy doesn't know opens read-only, so a newer copy's data is never erased), plus a fixture in `test/fixtures/` showing that older files still load.
5. **Gates are never locks.** Don't write UI or docs implying "safe right now". Irreversible actions keep a person's confirmation.
6. **Don't drop records.** History past the `run.json` caps must go to `history-*.jsonl` through `r._overflow` (via `addLog`/`answer`, never by trimming arrays directly), including when a save is refused. Conflict copies stay until a person deletes them, and keeping one saves the version it replaces as `replaced-*.json`. Follow-ups stop at 100 with a message.
7. **Synthetic data only** in examples and tests: `person-avery`, `example.com`, `ABC-123`. No real names, tickets, hosts or secrets.
8. **Fail safe on what this copy doesn't understand.** `PF.publish.verify` rejects a version with an unknown format, syntax or step type (and a frozen type this copy can't fully read); such a version is never started, planned or picked, and `repo.saveRun` refuses to write a run on it. `check_folder.py` must agree; `test/checker.test.js` proves it.

## Code style

- `src/` is **ES5**: `var`, `function`, no arrow functions, no `let`/`const`, no modules. Each file is an IIFE that assigns `PF.<name>`. Match the file you're in.
- Tests are modern Node and **read like rules**: `rule('A gate can't be waived while a step in its phase is blocked', …)`. Name the behavior, not the function.
- Compare objects from the test sandbox with `same()` (it compares JSON copies), not `deepStrictEqual` directly.
- Comments explain *why*, briefly. Don't narrate the code.
- `test/harness.js` loads core and storage into a `vm` sandbox. If storage needs a new browser global (`Blob`, `fetch`), add it to the sandbox list.

## Common changes

- **New step type:** add it to `LIST` in `src/core/types.js` (`fields`, `record`, `hint`, `icon`) and to `GROUPS` there, and mirror it in `BUILTIN` in `check_folder.py`. Add an icon in `src/ui/icons.js` if needed. Don't raise `PF.types.VERSION` for a new type (CONTRIBUTING.md says why). Then run `node tools/type-table.js --write` and add a rule test. In `fields`, `required` means "usually there" (a tip, not an error); `requiredWhen` ties it to `action`. In `record`, `when` limits evidence to one action, and `long: true` gives a multi-line box.
- **New rule:** change `src/core/run.js` or `map.js` first, with a test, then call it from the UI.
- **Saving, loading or sync:** read *Saving and sync rules* below first, then add a scenario to `test/sync.test.js` (two simulated computers that sync only when told) or `test/app.test.js` (the built app with races paused at exact points). Run `test/perf.test.js`: its folder-call ceilings may only go down. A run read comes back as `fresh`, `cached`, `unreadable`, `missing` or `pending`; only a fresh read clears a failure, and the cache keeps texts, never an object the app changes (docs/design.md section 25). Freshness is elapsed time (`opts.clock`, `performance.now()`), never a count of refreshes or the wall clock; size and time are a shortcut, never proof a file is unchanged. A progressive batch never marks a run missing; only the complete result does.
- **Fingerprints, publication checks or plan decisions:** `example-folder/.flightdeck/skills/_flightdeck/check_folder.py` repeats them in Python for the skills; `test/checker.test.js` fails if it and the app disagree. Change both together.
- **Screens:** `test/views.test.js` renders views without a browser; add a case for anything a run file or a failed save can make a screen show. Links go through `U.safeUrl`, everywhere.
- **The assistant contract** (`example-folder/AGENTS.md` or anything in `example-folder/.flightdeck/skills/`): run `node tools/baselines.js --write` so `flightdeck install` recognizes the new text as a default. Keep Flightdeck's instructions between the `flightdeck:begin` and `flightdeck:end` markers in `AGENTS.md`; never put anything Flightdeck must update below them.
- **Checklist syntax:** change `map.js`, `docs/map-format.md` and `example-folder/AGENTS.md` together, then run `node tools/type-table.js --write`. That also refreshes the skills' copy of the format, and a test fails if they differ. Check the `flightdeck-*` skills still describe the format correctly.
- **UI text:** plain US English, short sentences, say what happens next. Write "Pass the gate", not "Submit". No emoji in UI text; the few status symbols (✓ ■ ↻ ⏱) are deliberate.
- **Colors:** add a token to `:root` and both dark blocks in `page.html`. Form-field borders use `--field` (3:1 contrast).

## Saving and sync rules

Each rule exists because a review reproduced data loss without it. Keep all of them true.

- **Bound to a folder.** Anything that finishes later captures `state.fs`, `gen` and the run's key when it starts, and does nothing if `gen` changed (switching folders bumps it). Opening a folder takes an `opening` token, so a later open wins.
- **One way to change a run:** `mutateRun(key, gen, fn, opts)`. Every edit bumps the run's version (`editCount` via `bump()`, kept outside the run object); accepting a newer copy from the folder bumps it too.
- **Leaving a screen (`go()`):** it refuses while any control on the page or in an open dialog differs from what the page drew. A new form needs nothing registered; mark boxes kept as drafts `data-draft-kept`, boxes safe to leave `data-nav-safe` (search boxes are already), Input kept in app state (a correction being written, picked files, a refused New process form) must survive leaving the screen: keep it per folder, run and step through `leaveContext()` (called first in every context change) and `enterContext()`, never write over a live form, give async completions a token so they act only on the form they came from, and clear it only on Cancel, a successful save or a folder switch.
- **Shared maps:** `R.mapOf` returns one parsed checklist shared by every run of a version. Never change it; tests deep-freeze it. Parse a private copy (`M.parse(r.snapshot)`) if you need one to change.
- **One way to replace a run:** every read goes through `canReplace(id, revsAtReadStart)`, never over an unsaved change, a save in flight (`state.pendingSaves`), or an edit made since the read began. A run a read may not replace stays even if the read didn't list it; a read that finds its file readable still clears an old "couldn't be read" or "gone" (see `applyRunRead`).
- **Saves:** a save clears "unsaved" only for the change it carried; Try again saves the newest version with the original options. `busyStart()` pauses background refreshes and returns a release tied to its folder.
- **Two identities per window.** `WRITER` is fresh per page load and names every file a window writes besides `run.json` (notes, history, conflict copies, plan decisions, attachments), so two windows never share a file. `SESSION` survives a reload and only says who records; without Web Locks it equals `WRITER`, so a duplicated tab is view-only. `sessionReady` gates the write queue.
- **`run.json` is protected twice.** `repo.saveRun` checks and writes under a Web Lock per run, so windows on one computer take turns. Every save first writes `candidate-<writer>-<save>.json`, and `run.json.lineage` lists the saves it includes, so a save replaced from another browser or computer surfaces as a conflict copy.
- **Recovery** (keeping a conflict or browser copy) goes through `recover()`: it waits for pending saves, locks the run (`state.recovering`; other changes are refused with a message), backs up the current version and applies only if nothing changed since (`expect`, `expectText`).
- **Drafts and step types use checked saves** (`repo.saveChecked`): the editor remembers the file's fingerprint when it opens, the save is refused if the file changed since, and the file is read back after writing. **Known limit:** a write from another computer or an AI assistant that lands between the check and the write can still be replaced; the read-back after writing catches only a write that lands after Flightdeck's and before its read-back. A shared folder gives no atomic compare-and-swap, so keep it this way rather than claiming more, and keep one person (or one AI assistant) editing a draft at a time.

## Names that stay "preflight" on purpose

The app was called Preflight before 1.9.0. These internal names keep the old word so nothing anyone saved is lost; never rename them: the run and publication formats (`preflight-run/2`, `preflight-publication/1`), browser storage keys (`preflight:*`), the folder picker id, Web Lock names, and the code namespace `PF`. The newer-copy check also reads an old `preflight.html`.

The same goes for "map". Since 1.10.0 people see "checklist" for a process's written-down steps, but the internal names keep "map" so existing team folders keep working: code identifiers (`map.js`, `PF.map`, `run.map`, `mapVer`, `data-act`/`data-id` values, element ids, state keys), the `maps/` folder (`maps/drafts/`), the `map.md` file in each publication, the `docs/map-format.md` path and its skills' copy `_flightdeck/map-format.md`, and the file formats.

## Releases

The npm package `@troylar/flightdeck` ships `dist/flightdeck.html`, `bin/flightdeck.js` (no dependencies), the README, the changelog and the license. `build.py` sets its version from `src/releases.json`. Check its contents with `npm pack --dry-run` before publishing; Run `./test/run.sh` before publishing; `prepublishOnly` only rebuilds, so a one-time password is still fresh when npm uploads (the full tests take longer than a code lasts). Nothing in the package may name an employer, a colleague or an internal system; the only person named is the package owner (the `@troylar` scope and the license).

Every user-visible change adds an entry to `src/releases.json` in the same change (see CONTRIBUTING.md): patch for a fix, minor for new or improved, major for a file format older copies can't read. Write `now` for the people using Flightdeck, not for engineers. `python build.py` checks it and regenerates `CHANGELOG.md`; never edit that file by hand. The version shown in the app is the newest release.

## Accessibility is part of done

Every input has a label (a visible `<label>` or `.sr`). Errors appear next to their field (`ferr`), not only at the top of the page. Single-key shortcuts must respect `state.keys`, and Space must not steal a focused button's action. Dialogs use `openOverlay` and `closeOverlay`, which lock the page and return focus to the opener by selector (redraws replace nodes). On a phone the step panel acts as a dialog too (`sheet()`). Field errors set `state.fieldErr`, which renders `aria-invalid` and `aria-describedby` on the inputs. Screen readers and real keyboards still need testing by a person; the view tests only check the markup. Messages go through `say()`, which announces them in the `#live` region. Check new screens at 375 px: no sideways scroll.

## Deliberate decisions (not defects)

Don't file or "fix" these choices without a change to `docs/design.md`. They never excuse bugs inside them: lost data, a hidden failed save or an accessibility failure is still a defect.

- No server, no sign-in, no AI in the app. AI assistants edit files; Flightdeck reads them.
- One recorder per run, not live co-editing. Conflicts are shown and resolved by people, never auto-merged.
- Typed fields are informational. Missing usual fields are tips; evidence is opt-in with `require:`.
- A plain `confirm` is one click. Only required evidence opens a form.
- `run.json` keeps 300 log entries and 10 earlier answers per step; older ones are archived, not lost.
- Polling, not push. A run view rereads only that run every 5 seconds; complete publications are cached, and other runs are checked on an elapsed-time schedule (sizes and times within 10 minutes, a full read within an hour, or 5 minutes for running runs; docs/design.md section 25), so a late note on an old run can take up to 10 minutes to show. Refresh reads everything. The Connection check page lists `connection/` every 5 seconds; Folder health reads every file only when asked.
- Screens are HTML strings; `render()` patches only the regions that changed (`patch`/`morph` in `app.js`), so focus, the caret and typed text stay put. Don't add per-element listeners; events are delegated by `data-act`.
- Reminders and the timeline work only while the app is open. There are no notifications.
- Flightdeck never calls Jira. `jira/workflows.json` is what the team says its workflow is.

## Before you say it's done

- `bash test/run.sh` output is shown, with every suite passing.
- Docs and `example-folder/AGENTS.md` match the change.
- A user-visible change has its release entry, and `CHANGELOG.md` was regenerated by the build.
- Nothing from a file reaches the page unescaped. No new external resource. No second writer.
- For anything that touches sync: say plainly what still needs the real two-computer rehearsal in `docs/onedrive.md`.
- **Release gate:** a minor or major release that touches `src/storage/`, the run or notes formats, saving or sync code in `app.js`, or the connection check ships only with a rehearsal record in `docs/rehearsals/` (see *Release gate* in `docs/onedrive.md`). You can't run it; say that it's needed.
