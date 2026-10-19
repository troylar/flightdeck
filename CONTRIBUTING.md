# Contributing to Flightdeck

## Build and test

```bash
./test/run.sh
```

That builds `dist/flightdeck.html` and runs every test. Commit `dist/flightdeck.html` with your change, so anyone can copy the latest build.

## Code layout

| Folder | What's there | Rules |
|---|---|---|
| `src/core/` | Pure logic: checklists, the builder's edits (`outline.js`), publishing, runs, gates, corrections, skills, Folder health (`health.js`) and the connection check (`connection.js`) | No DOM, no files. Tested in `test/rules.test.js` and `test/outline.test.js`. |
| `src/storage/` | The team folder: reading, saving, conflict checks, caching | Every file has one writer. Tested in `test/folder.test.js`, and against simulated OneDrive sync between two computers in `test/sync.test.js`. |
| `src/ui/` | Screens (`views/*.js`), wiring (`app.js`), the example history (`examples.js`), icons | Views return HTML strings. Everything from files goes through `esc()` or the escape-first Markdown. |
| `src/page.html` | Styles and the page shell | Colors are tokens with light and dark values. No external resources. |
| `example-folder/` | A complete example team folder | Synthetic people only. Also built into the app as the examples. |
| `test/fixtures/` | Run files from earlier versions | Never edit one; add a new fixture when the run format changes, so old runs keep loading. |
| `tools/` | Small scripts | `type-table.js` writes the step-type table in `docs/map-format.md`; `baselines.js` records the shipped `AGENTS.md` and skills in `src/baselines.json`. |

`build.py` joins the files in a fixed order into one HTML file.

## Common changes

- **Add a step type:** add it to `LIST` in `src/core/types.js` (id, label, icon, hint, `fields`, `record`), add an icon to `src/ui/icons.js` if needed, then run `node tools/type-table.js --write` to update the docs table. A test fails if the table and the code disagree.
  - `fields` describe the step in the checklist. `required` means "usually there": leaving it out is a tip, not an error. `requiredWhen` / `requiredUnless` tie that to the step's `action`.
  - `record` is evidence that can be noted when the step is checked. It's optional unless the checklist's `require:` line names it. `when` limits it to one action; `long: true` gives it a multi-line box.
- **Add a field kind** (beyond text, url, code, message, list, choice): it touches four places. Validation in `types.checkFields` / `types.checkRecord` (and `types.understood`, with its copy `KNOWN_KINDS` in `check_folder.py`), display in `fieldsBlock` (the selected step) and the input in `fieldInput`, both in `views/run.js`, and the docs. Add a rule test for its validation.
- **Change a rule** (gates, re-checks, what counts as answered): change `src/core/run.js` and add or update a rule in `test/rules.test.js`. Tests are written as sentences; keep them that way.
- **Change how a step is answered** (Done, the row's check, keys, Done differently): change `answerStep` in `src/ui/app.js`, the one path they all share, and add a case to `test/app.test.js`.
- **Change corrections** (their format, grouping or decisions): change `src/core/corrections.js` with a rule in `test/rules.test.js`, and keep `docs/design.md` and the `flightdeck-learn-from-runs` skill in step.
- **Change the checklist format:** update `src/core/map.js`, `docs/map-format.md`, and `example-folder/AGENTS.md` together.
- **Change the run format:** keep `sanitize()` in `src/core/run.js` accepting older files, add the new field to `KNOWN` in the same file (otherwise this copy treats runs that have it as written by a newer copy and opens them read-only), and add a fixture to `test/fixtures/`.
- **Change a step type's properties:** a frozen type with a property, field kind or type version this copy doesn't know makes its version unusable (`types.understood`, mirrored in `check_folder.py`). Add new properties to both, and test them in `test/checker.test.js`.
- **Change `example-folder/AGENTS.md` or a skill:** run `node tools/baselines.js --write`, so `flightdeck install` recognizes the new text as a Flightdeck default in folders that have it. A test fails until you do.
- **Add a built-in step type:** keep `PF.types.VERSION` as it is. Every built-in is frozen into each publication's `types.json` with the current version, so raising it makes every new version unusable in older copies, even ones that use only `confirm`. A new type built from fields, kinds and settings older copies already know runs there from its frozen definition (`test/rules.test.js` checks this with a copy that lacks the type). Raise `VERSION`, together with `TYPES_VERSION` in `check_folder.py`, only when what an existing setting means changes.
- **Add a Folder health check:** add it to `PF.health.check` in `src/core/health.js` with exactly one action and, when it has one, a `help` anchor that is a section of `docs/recovery.md` (a rule test checks both), plus an all-clear line for when it finds nothing. Add its threshold to `LIMITS` and to docs/design.md section 21.
- **Change the connection check's wording:** never "synced" or "everyone" (a rule test checks); it proves one trip, nothing more.
- **Change saving or loading:** add a case to `test/sync.test.js`. Its two simulated computers sync only when told to, which is how OneDrive behaves on release night.

## Release notes: every user-visible change gets one

`src/releases.json` is the source of the What's new panel, of `CHANGELOG.md` and of the app's version. Newest release first.

- **Add an entry in the same change that ships the behavior.** If someone using Flightdeck can notice it, it goes in. Refactors, docs-only and test-only changes don't.
- **Bump the version:** a fix is a patch (1.6.0 → 1.6.1); anything new or improved is a minor (→ 1.7.0); a change to the checklist or run file format that older copies can't read is a major (→ 2.0.0). The app's version is always the newest release; there is no other version to update.
- **Each change:** `kind` (`new`, `improved` or `fixed`), `area`, `title`, `now`, and where they help, `before` and `where`. Write for the people running checklists, not for engineers: what they'll notice and where to find it. US English, plain words, no people's names, no employer or client names.
- `build.py` validates the file and fails the build on a bad entry (out-of-order versions or dates, an unknown kind, a missing or misspelled field) and regenerates `CHANGELOG.md`. **Never edit `CHANGELOG.md` by hand**; a test fails if it differs from what the release file generates.
- Release text is embedded with every `<` and line separator escaped, so it can't break out of the page's script; `test/build.test.js` proves it.
- **Sync-touching releases need a rehearsal record.** A minor or major release that touches `src/storage/`, the run or notes formats, saving or sync code in `src/ui/app.js`, or the connection check ships only with a two-computer rehearsal record in `docs/rehearsals/<version>-<date>.md`. The script and the results template are in `docs/onedrive.md`, *Release gate*.
- To ship, copy `dist/flightdeck.html` into the team folder as `flightdeck.html`. Anyone running an older copy sees "Flightdeck X is in the team folder" in the top bar.

## Before you commit

- `./test/run.sh` passes.
- No real names, customer data, tokens or internal URLs in examples or tests.
- US English in all text people see.
