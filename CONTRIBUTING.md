# Contributing to Flightdeck

## What you need

- **Python 3**, run as `python3` (`build.py` and the folder checker use only the standard library).
- **Node 18 or later** (`package.json` `engines`). There is nothing to install: Flightdeck has no dependencies.
- **Bash** for `./test/run.sh` (Git Bash on Windows).
- **A full clone with its tags** for the cross-version tests. In a shallow clone or one without tags, those rules are skipped with a message; `git fetch --tags --unshallow` fixes it.

## Build and test

```bash
./test/run.sh
```

That builds `dist/flightdeck.html` (`python3 build.py`), runs every test file in `test/` (each file runs even after another fails, and the failed files are listed at the end), and checks that the build is one self-contained file. Commit `dist/flightdeck.html` with your change, so anyone can copy the latest build. The build also rewrites `CHANGELOG.md` and `package.json`'s version from `src/releases.json`; commit them when they change.

### Running some of the tests

`./test/run.sh` with no settings is the full run, the only one that counts as the final gate. While you work, run less:

| Setting | What it runs | Example |
|---|---|---|
| `ONLY=<name>[,<name>]` | Just these jobs, printing only their results. A name is a file (every shard, and its budgets if it has any), one shard, or a file's budgets alone. A name no job has is an error. | `ONLY=app,find-walk ./test/run.sh`, `ONLY=app.2of12 ./test/run.sh`, `ONLY=perf.budgets ./test/run.sh` |
| `TIER=fast` | Everything but the slowest files and the speed budgets, in about 2 minutes. | `TIER=fast ./test/run.sh` |
| `TIER=rest` | The files `TIER=fast` leaves out. `fast`, `rest` and `perf` together are exactly the full run. | `TIER=rest ./test/run.sh` |
| `TIER=perf` | The speed budgets only, alone, after waiting for a quiet moment. | `TIER=perf ./test/run.sh` |
| `RULE=<text>` | Only the rules whose names contain the text, in whichever jobs run. | `RULE='gate' ./test/run.sh` |
| `TIMES=1` | Also prints every job's time, slowest first. | `TIMES=1 ./test/run.sh` |

**Speed budgets.** A rule that asserts a wall-clock time is written with `budget()` instead of `rule()`, and its file is listed in `BUDGET_FILES` in `test/run.sh`. The parallel jobs skip these rules; they run alone at the end. The pass waits up to `PERF_WAIT` seconds (60) for no more than `PERF_BUSY` percent of the CPUs (25) to be in use, and says what it found. A budget missed on a busy machine is measured again, up to `PERF_TRIES` times (3). If it still misses, the run fails and says the machine was busy, so run `TIER=perf` when it's quiet. A miss on a quiet machine is a real slowdown. Never raise a budget to get past either one.

Every test file runs its rules through `test/harness.js`, so these work in any file:

| Setting | What it does | Example |
|---|---|---|
| `ONLY=<text>` | Runs only the rules whose names contain the text (the rest are skipped, so a file with no match prints "0 passed"). | `ONLY='gate' node test/rules.test.js`; for every file, `RULE='gate' ./test/run.sh` |
| `STACK=1` | Prints a failing rule's stack trace instead of only its message. | `STACK=1 node test/sync.test.js` |
| `PERF=big` | Adds the 6,000-run profile to `test/perf.test.js`'s folder-call budgets. | `PERF=big node test/perf.test.js` |
| `SEEDS=<n>` | How many seeded random walks `test/app.test.js` runs for its save and lookup races (24 and 8 by default). `TYPED_SEEDS`, `THUMB_SEEDS` and `LOAD_SEEDS` do the same for the typed-value, thumbnail and loading walks (6, 6 and 8). Raise them after changing saving or loading. | `SEEDS=200 node test/app.test.js` |
| `TZ` | The computer's time zone. Rules that depend on it set it themselves (`test/rules.test.js` uses America/New_York, `test/typed.test.js` loops over three zones), and evidence and export rules pass their zone explicitly, so the tests shouldn't depend on yours. To check a change doesn't, run under another zone. | `TZ=Pacific/Kiritimati node test/typed.test.js` |
| `CI=1` | A release tag missing from the clone fails the cross-version rules instead of skipping them (`tools/old-bundles.js`, `test/old-bundles.test.js`). The repo has no CI configuration of its own; set it when you need that strictness. | `CI=1 node test/compat.test.js` |

**Build first when you run one file.** The suites that boot the app (`test/app-harness.js`: every `*-app.test.js`, `app.test.js`, `light*.test.js`, `ui-states.test.js` and others), the command-line tests (`bin/flightdeck.js` runs the built app's code) and `test/build.test.js` read `dist/flightdeck.html` as it is. `./test/run.sh` builds; a single file doesn't, so run `python3 build.py` first.

## Code layout

| Folder | What's there | Rules |
|---|---|---|
| `src/core/` | Pure logic, one module per file, each starting with a comment that says what it holds: `util`, `envelope` (file formats), `values` (typed values), `types` (step types), `map` (the checklist parser), `outline` (the builder's edits), `timeline` (Undo and saved history), `conditions` (`only when`), `publish`, `plans`, `pins`, `staging`, `run`, `practice`, `corrections`, `followups`, `insights`, `skills`, `signature`, `people`, `setup`, `attach`, `contract`, `health` (Folder health), `connection` (the connection check), `search`, `sha256`, `zip`, `evidence` (evidence packs), `appjson` (what the `--json` commands print), `requests` (requests from other apps), `reports` (reports from tools), `proposals` (AI assistants' proposals), `jira`, `nav` (Back and Forward) | No DOM, no files. Every rule has a test. |
| `src/storage/` | `fs.js` (folder access) and `repo.js` (reading, saving, conflict checks, caching, publishing, the scan) | Every file in the team folder has one writer. Tested in `test/folder.test.js`, `test/failed-reads.test.js`, against simulated OneDrive sync between two computers in `test/sync.test.js`, and for cost in `test/perf.test.js`. |
| `src/ui/` | Screens in `views/` (`builder`, `common`, `evidence`, `flight`, `health`, `home`, `insights`, `manage`, `overlays`, `pages`, `practice`, `process`, `reports`, `run`, `setup`), wiring (`app.js`), the Export evidence dialog (`exporter.js`), what each entry box asks (`guide.js`), the example history (`examples.js`) and icons (`icons.js`) | Views return HTML strings. Everything from files goes through `esc()` or the escape-first Markdown. |
| `src/page.html` | Styles and the page shell | Colors are tokens with light and dark values. No external resources. |
| `src/releases.json`, `src/baselines.json`, `src/fonts/` | Release notes (the app's version), the hashes of every shipped `AGENTS.md` and skill, the embedded fonts | `releases.json` is edited by hand; `baselines.json` only by `tools/baselines.js`. |
| `example-folder/` | A complete example team folder | Synthetic people only. Also built into the app as the examples. Its `AGENTS.md` and `.flightdeck/skills/` are what every team folder gets. |
| `test/` | 52 suites, all in `test/run.sh`: rules for the core (`rules`, `envelope`, `typed`, `conditions`, `staging`, `test-runs`, `readiness-stage`, `pins`, `practice`, `run-polish`, `scale`, `reports`, `insights`, `outline`, `timeline`, `search`, `guide`, `skills-parity`); storage (`folder`, `failed-reads`, `sync`, `perf`); screens without a browser (`views`, `light-views`, `ui-states`); the built app (`app`, `app-reports`, `staging-app`, `test-runs-app`, `readiness-stage-app`, `propose-app`, `live-app`, `shots-app`, `practice-app`, `scale-app`, `guide-editor`, `light`, `wrong-record`); the command, the checker and the package (`cli`, `checker`, `evidence`, `build`, `readers`, `docs`); older releases (`compat`, `compat-bridge`, `compat-formats`, `compat-pins`, `compat-typed`, `compat-conditions`, `compat-staging`, `old-bundles`). Helpers: `harness.js`, `app-harness.js`, `compat-harness.js`, `compat-matrix.js`, `compat-readers.js`, `big-folder.js`, `read-fixture.js`, `evidence-fixture.js`, `entry-golden.js`, `check_pack.py`. | Tests read like rules. |
| `test/fixtures/` | Run files from earlier versions; `folders/<tag>/`, team folders written by each older release (`tools/old-folders.js`); `old-bundles/record.json`, the commit and SHA-256 of each older release the tests run; `v2/`, the frozen 2.0 samples and probes; `entry-boxes/`, the 2.4.0 type definitions and outputs the entry-box guide must not change | Never edit one; add a new fixture when the run format changes, so old runs keep loading. |
| `tools/` | Small scripts | `type-table.js` writes the step-type table in `docs/map-format.md` and copies the file into the skills; `baselines.js` records the shipped `AGENTS.md` and skills in `src/baselines.json`; `old-bundles.js` and `old-folders.js` keep the older releases the cross-version tests run (below); `v2-samples.js` writes the frozen 2.0 samples; `readers.js` is the lint that every JSON parse reaches a checked reader (run by `test/readers.test.js`); `big-folder.js` makes a big synthetic team folder for the perf tests (`--out <dir>` writes one to try); `scale-limits.js` turns browser measurements into Folder health's run limits (docs/design.md section 25). |

`build.py` joins the files in a fixed order (`CORE` and `APP` at its top) into one HTML file, and checks `src/releases.json`.

## Common changes

- **Add a step type:**
  1. Add it to `LIST` in `src/core/types.js` (id, label, icon, hint, `fields`, `record`) and to `GROUPS` there.
  2. Mirror it in `BUILTIN` in `example-folder/.flightdeck/skills/_flightdeck/check_folder.py` (`test/checker.test.js` compares them).
  3. Add an icon to `src/ui/icons.js` if needed.
  4. Give every field and record field an entry in `src/ui/guide.js` (`FIELDS` and `RECORD`): a question, an example its box accepts, and a why. `test/guide.test.js` checks the coverage and tries each example in its real control.
  5. `node tools/type-table.js --write` updates the table in `docs/map-format.md` and its copy in the skills, then `node tools/baselines.js --write`, since that copy is a shipped skill file.
  6. Add a rule test.
  - Keep `PF.types.VERSION` as it is (see *Add a built-in step type* below).
  - Two rules pin the frozen type definitions to `test/fixtures/entry-boxes/types-2.4.0.json` (`test/guide.test.js`, `test/guide-editor.test.js`), so a new type fails them. Changing that fixture is a deliberate decision: make it in the same change and say why in the pull request.
  - `fields` describe the step in the checklist. `required` means "usually there": leaving it out is a tip, not an error. `requiredWhen` / `requiredUnless` tie that to the step's `action`.
  - `record` is evidence that can be noted when the step is checked. It's optional unless the checklist's `require:` line names it. `when` limits it to one action; `long: true` gives it a multi-line box.
- **Add a field kind** (beyond text, url, code, message, list, choice and the others `KNOWN_KINDS` lists): it touches six places, then the docs.
  1. Validation in `types.checkFields` / `types.checkRecord`, and `types.understood` (`src/core/types.js`).
  2. Its copy, `KNOWN_KINDS` in `check_folder.py`.
  3. Display in `fieldsBlock` (the selected step) in `src/ui/views/run.js`.
  4. The input in `fieldInput`, in the same file (Fill in and the record form).
  5. The editor's step form, `fieldRow` in `src/ui/views/builder.js` (since 2.6 the editor draws each field itself, with choice buttons for up to five options).
  6. A guide entry whose example the kind's control accepts (`src/ui/guide.js`; `test/guide.test.js` tries it).
  - Then `docs/map-format.md`, `node tools/type-table.js --write` and `node tools/baselines.js --write`, and a rule test for its validation.
- **Change a rule** (gates, re-checks, what counts as answered): change `src/core/run.js` and add or update a rule in `test/rules.test.js`. Tests are written as sentences; keep them that way.
- **Change how a step is answered** (Done, the row's check, keys, Done differently): change `answerStep` in `src/ui/app.js`, the one path they all share, and add a case to `test/app.test.js`.
- **Change corrections** (their format, grouping or decisions): change `src/core/corrections.js` with a rule in `test/rules.test.js`, and keep `docs/design.md` and the `flightdeck-learn-from-runs` skill in step.
- **Change the checklist format:**
  1. The parser, `src/core/map.js`.
  2. The builder, `src/core/outline.js`, which reads the format branch for branch (docs/design.md section 20).
  3. The folder checker, `check_folder.py`, which mirrors the parser and uses the same messages.
  4. `docs/map-format.md`, then `node tools/type-table.js --write` (it copies the file into the skills; `test/rules.test.js` fails if the copies differ) and `node tools/baselines.js --write`.
  5. `example-folder/AGENTS.md` and the `flightdeck-*` skills, so they still describe the format correctly.
  6. If older copies must refuse the new syntax, it's a file-format change (next item): a feature in `PF.envelope`, and rules in the cross-version tests (`test/compat-formats.test.js` and its neighbors) showing every older release refuses it by name and writes nothing.
- **Change a file format** (docs/design.md section 28): two rules first. Flip the field an older reader looks at first (a `format`, a `kind`, a version number, a line of syntax), so older copies refuse it; and write the oldest format that holds the record. Then: the family's row in `PF.envelope.FAMILIES` (`src/core/envelope.js`) and its mirror in `check_folder.py` where the checker reads it, a feature name registered only in the slice that builds it, a sample in `tools/v2-samples.js` (`node tools/v2-samples.js --write`), and a rule in `test/compat-bridge.test.js`. Every reader of a family goes through its one checked reader in `src/core/`; `tools/readers.js` fails on a parse whose fields are read first.
- **Change the run format:** keep `sanitize()` in `src/core/run.js` accepting older files, add the new field to `KNOWN` in the same file (otherwise this copy treats runs that have it as written by a newer copy and opens them read-only), and add a fixture to `test/fixtures/`.
- **Change a step type's properties:** a frozen type with a property, field kind or type version this copy doesn't know makes its version unusable (`types.understood`, mirrored in `check_folder.py`). Add new properties to both, and test them in `test/checker.test.js`.
- **Change `example-folder/AGENTS.md`, a skill or `docs/map-format.md`:** run `node tools/baselines.js --write`, so `flightdeck install` recognizes the new text as a Flightdeck default in folders that have it. A test fails until you do. (`docs/map-format.md` counts because `tools/type-table.js --write` copies it into the skills.)
- **Add a built-in step type:** keep `PF.types.VERSION` as it is. Every built-in is frozen into each publication's `types.json` with the current version, so raising it makes every new version unusable in older copies, even ones that use only `confirm`. A new type built from fields, kinds and settings older copies already know runs there from its frozen definition (`test/rules.test.js` checks this with a copy that lacks the type). Raise `VERSION`, together with `TYPES_VERSION` in `check_folder.py`, only when what an existing setting means changes.
- **Add a screen or a tab:** give it a route in `PF.nav` (`src/core/nav.js`: `locate`, `format` and `parse`) and its heading in `headingOf()` in `src/ui/app.js`, and open it from history through the click's own function in `moveTo()`. A test fails for a screen without a route (docs/design.md section 29).
- **Add a Folder health check:** add it to `PF.health.check` in `src/core/health.js` with exactly one action and, when it has one, a `help` anchor that is a section of `docs/recovery.md` (a rule test checks both), plus an all-clear line for when it finds nothing. Add its threshold to `LIMITS` and to docs/design.md section 21.
- **Change the connection check's wording:** never "synced" or "everyone" (a rule test checks); it proves one trip, nothing more.
- **Change what other apps read** (the `--json` commands, docs/apps.md): change the shape and its `SCHEMA` in `src/core/appjson.js` and the command in `bin/flightdeck.js`, document the field in `docs/apps.md` (a build test checks every field, problem kind and exit code is there), and add a rule to `test/cli.test.js`. Adding a field is fine; removing one or changing what it means needs a new contract version. Reading must stay read-only and must name every file it couldn't read or understand: note it in the ledger (`repo.ledger`) rather than leaving it out or using a default.
- **Change saving or loading:** add a case to `test/sync.test.js`. Its two simulated computers sync only when told to, which is how OneDrive behaves on release night. `test/perf.test.js` counts folder calls on a 2,000-run folder; its ceilings may only go down (lower them when a change earns it). `PERF=big` adds the 6,000-run profile.
- **A long list on a page:** page it with `PF.vk.paged` (50 at a time, Show 50 more) rather than drawing everything; the first view of Runs draws at most 100 cards.

## Older releases: the cross-version tests

`test/compat.test.js` runs every release from v1.10.0 on (1.11.1 is the supported floor; older ones are characterizations) from its own shipped code against this version and its files. docs/design.md section 28 says what it covers. A rule about refusing a newer file takes that file from `newer(t)` in `test/compat-harness.js` (what 2.0 writes, for a 1.x release; what only a later release writes, for 2.0; a frozen feature no release builds yet, for 2.1), and where a 2.x release does something a 1.x one didn't, the rule says what it does instead of leaving it out.

- **Where the old code comes from:** `node tools/old-bundles.js` takes each tag's `dist/flightdeck.html`, `bin/flightdeck.js` and `check_folder.py` with `git show`, caches them in `.old-bundles/` (not committed) and checks them against the commit and SHA-256 in `test/fixtures/old-bundles/record.json`. After the first run it works offline. It also lists the tags not recorded yet. In a clone without the tags those rules are skipped with a message; run with `CI=1`, they fail (`git fetch --tags --unshallow`).
- **Running it:** `node test/compat.test.js` (in `./test/run.sh`); `ONLY=v1.15.0` runs one release's rules, as `ONLY=` does in every file. `test/compat-harness.js` gives `loadCopy(tag)` (core and storage headless) and `bootCopy(tag)` (the whole page in the app harness).
- **After tagging a release:** step 8 of *Shipping a release* below. A tag that isn't recorded yet is named in the output, never a failure, so tagging never breaks the tests. If tags were missed, record each one the same way, oldest first.
- **Changing the scenario** in `tools/old-folders.js`: use only writers the matrix gives that release, then `node tools/old-folders.js --write`; the test fails if a release writes its folder differently, so the folders stay real output of real old code. Never edit a folder by hand.
- **The 2.0 samples and probes:** `test/fixtures/v2/` (from `tools/v2-samples.js`) holds the frozen 2.0 wire contracts and, under `probes/`, a file in an unknown major and one with an unknown feature for every family. `test/compat-bridge.test.js` lays the samples over each release's baseline folder (matrix A, both directions, zero writes) and runs the probes through every real reader of this version.
- **A new rule:** say what each release does today, quirks included. A gap a later slice closes is a rule named `Known:`; change it on purpose in the slice that closes it.

## Release notes: every user-visible change gets one

`src/releases.json` is the source of the What's new panel, of `CHANGELOG.md` and of the app's version (and of `package.json`'s, which the build sets). Newest release first.

- **Add an entry in the same change that ships the behavior.** If someone using Flightdeck can notice it, it goes in. Refactors, docs-only and test-only changes don't.
- **Bump the version:** a fix is a patch (1.6.0 → 1.6.1); anything new or improved is a minor (→ 1.7.0); a change to the checklist or run file format that older copies can't read is a major (→ 2.0.0). The app's version is always the newest release; there is no other version to update.
- **The shape** `build.py` checks (it fails the build on anything else):

  ```json
  {
    "version": "2.6.1",
    "date": "2026-10-25",
    "headline": "1 to 140 characters",
    "changes": [
      {
        "kind": "fixed",
        "area": "1 to 30 characters",
        "title": "1 to 90 characters",
        "now": "1 to 400 characters",
        "before": "optional, 1 to 400 characters",
        "where": "optional, 1 to 200 characters"
      }
    ]
  }
  ```

  `version` is `MAJOR.MINOR.PATCH`, listed once, newest first; `date` is a real `YYYY-MM-DD`, never after the newer release's; `changes` has at least one entry; `kind` is `new`, `improved` or `fixed`; no other fields.
- **Write for the people running checklists**, not for engineers: what they'll notice and where to find it. US English, plain words, no people's names, no employer or client names.
- `build.py` regenerates `CHANGELOG.md`. **Never edit `CHANGELOG.md` by hand**; a test fails if it differs from what the release file generates.
- Release text is embedded with every `<` and line separator escaped, so it can't break out of the page's script; `test/build.test.js` proves it.

## Shipping a release

In this order:

1. **Add the release** to `src/releases.json` (version, date, headline, changes; the fields and limits above, `build.py`'s checks). The version comes only from there.
2. **Regenerate what the version keys:** `node tools/type-table.js --write` if `docs/map-format.md` or the step types changed, then `node tools/baselines.js --write` (baselines are recorded per version, so a new version fails `test/build.test.js` until it runs).
3. **`./test/run.sh`**, with every file passing. It builds; the build writes `package.json`'s version and `CHANGELOG.md`. Commit them with `dist/flightdeck.html` and `src/baselines.json`.
4. **The two-computer rehearsal**, when the release needs one (below), or the project owner's recorded waiver.
5. **Pull request, merge**, then `./test/run.sh` again on the merged `main`.
6. **`npm pack --dry-run`:** check the version and that the file list is `dist/flightdeck.html`, `dist/FONT-LICENSE.txt`, `bin/flightdeck.js`, `README.md`, `CHANGELOG.md` and `LICENSE` (with `package.json`), and nothing else.
7. **Publish and tag:** `npm publish --otp=<code>` (`prepublishOnly` only rebuilds, so the one-time password is still fresh when npm uploads; run the tests before, never inside it). Tag the merge commit `vX.Y.Z` and push the tag. Then download the pinned file, `https://unpkg.com/@troylar/flightdeck@X.Y.Z/dist/flightdeck.html`, check the version it shows, save it locally and open it in Edge or Chrome.
8. **After tagging, one follow-up commit:**
   - `node tools/old-bundles.js --write` records the new tag's bundle (hashes already recorded are kept).
   - Review the capability matrix (`test/compat-matrix.js`): add or extend a row for anything the release newly writes or reads. Each row has a probe that runs against every release, so a wrong row fails.
   - Review the path and reader inventory (`test/compat-readers.js`): add a family for any new path in the team folder (an unknown path or folder fails), with each reader as a call, a valid specimen and what its output must show (the test runs it, damages the specimen and expects the output to change, so a wrong claim fails).
   - `node tools/old-folders.js --write` generates the release's baseline folder. Never write one by hand.
   - Rerun the cross-version suites (`node test/compat.test.js`, the other `test/compat-*.test.js` files and `node test/old-bundles.test.js`), then commit the record, the matrix and inventory changes and the folders.
   - Shipped tags are never moved.

   `tools/readers.js` is a different check: the lint that every JSON parse reaches a checked reader, run by `test/readers.test.js` in every suite run.

To put a release in a team folder, `npx @troylar/flightdeck@X.Y.Z install <folder>` (docs/updating.md), or copy `dist/flightdeck.html` into the folder as `flightdeck.html`. Anyone running an older copy sees "Flightdeck X is in the team folder" in the top bar.

### The two-computer rehearsal

The release gate is unchanged: a minor or major release that touches `src/storage/`, the run or notes formats, saving or sync code in `src/ui/app.js` (how runs are saved, replaced and recovered, how reads of the folder are applied, applying proposals, the save queue), or the connection check ships only with a rehearsal record. The script, the results template and the functions that count are in [docs/rehearsals/README.md](docs/rehearsals/README.md#the-release-gate).

When a rehearsal can't be run, the project owner may waive it for that release. The waiver is recorded, never assumed, in `docs/rehearsals/<version>-<date>-waiver.md` ([waiver template](docs/rehearsals/README.md#waiver-template)), with four sections:

1. **Why it was required:** what in the release meets the gate.
2. **What the rehearsal would have covered:** the script's steps and any setup the release needs.
3. **What covers it instead:** the automated tests, all passing on the release commit.
4. **What remains unproven on real OneDrive:** what only a real two-computer rehearsal shows, and the steps that still need a manual rehearsal.

A waived release isn't rehearsed, and its record's title says so.

## Before you commit

- `./test/run.sh` passes.
- No real names, customer data, tokens or internal URLs in examples or tests.
- US English in all text people see.
