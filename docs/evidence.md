# Evidence packs

An evidence pack is a zip of what the team folder holds about one run, or about the runs of a process started between two days: the original files, byte for byte, a page to read, and SHA-256 hashes to check them by. Make one from a run's **Receipt** or its **More** menu, from **Runs › Export evidence…**, or with `flightdeck export`. Making one never changes the team folder, and a pack is never written into it.

## What's in a pack

| Path | What it is |
|---|---|
| `evidence.html` | A page to read in any browser. It runs no script and loads nothing: its Content Security Policy is exactly `default-src 'none'; img-src data:; style-src 'unsafe-inline'`. Pictures are inline; every other file is listed with its path, size and SHA-256. Anything that changed while the pack was made, and any check that failed, is shown first, in red. |
| `originals/…` | The files, at their paths in the team folder. A name that would clash with another one on Windows (letters differing only in case) gets " (2)", and `manifest.json` gives its real path. |
| `manifest.json` | When collecting started and ended, the time zone, which runs and which revisions were read (`run.json`'s `rev` and SHA-256, the run folder's listing), every file with its path, size, SHA-256, what it is and any flag, the generated files' SHA-256, what was left out and why, what's unresolved, and whether this window had unsaved changes. |
| `SHA256SUMS` | The SHA-256 of every file above and of `manifest.json`, in the format `sha256sum -c` reads. |
| `README.txt` | What's in the pack and how to check it. |

**For each run, the pack keeps** every file directly in the run folder: `run.json`, every `notes-*.jsonl` and `history-*.jsonl`, conflict copies (`run.conflict-*.json`), `replaced-*.json`, OneDrive's copies (`run-LAPTOP.json`, `run (1).json`, any `run*.json`) and any other file, plus everything in `files/`. A save receipt (`candidate-*.json`) that `run.json`'s lineage doesn't list is kept and flagged "a save that may not be in run.json". It also keeps the run's follow-up decisions in `followups/<process>/` (OneDrive's copies too, and any that can't be read, flagged), the decisions in `corrections/<process>/` on this run's corrections and on the groups they're in, legacy decisions in `suggestions/<process>/` on this run's suggested fixes, any file in those two folders that can't be read ("couldn't be read; may relate to this run"), and the version the run ran: `map.md`, `types.json`, `publication.json` and its screenshots.

**"Published in vN" comes with its proof.** When one of the run's corrections was published in a later version, that version's `map.md`, `types.json` and `publication.json` are in the pack, and the page names them. A version that lists the correction but whose files aren't all there, or don't check out, gives "Can't be confirmed from this pack", with the reason.

**What's left out, always with its reason:** save receipts that `run.json`'s lineage lists ("already included in run.json, which lists it in its lineage"), temporary files left by a save, links (never followed), attachments when you choose to leave them out ("left out, not hashed": listed with their size, never read), and, in the browser, a single file over 100 MB. The people directory (`people.json`) is left out; the page shows names and IDs read from it.

**Checks.** For each run, the page and the manifest say whether the run's copy of its checklist is byte for byte the version's `map.md`, whether its frozen step types are the version's `types.json` (compared as data), whether the checklist fingerprint it recorded matches `map.md`, and whether the version itself checks out. A file this copy can't fully understand (a run from a newer Flightdeck, malformed notes lines, a version it can't verify) is packed as it is, and the page says "This page shows only what this copy understands; the original files are complete." Malformed notes lines are listed by file and line number; two notes with the same ID both appear.

## Checking a pack

The hashes make a graph:

1. `manifest.json` lists the SHA-256 of every payload file: everything in `originals/`, `evidence.html` and `README.txt`.
2. `SHA256SUMS` lists the payload **and** `manifest.json`, but not itself.
3. The pack's own SHA-256 is shown when it's made (in the dialog, with Copy, and printed by `flightdeck export`). Keep it somewhere separate from the pack.

Checking these hashes shows whether the files still match. Compare the pack's own digest with one you kept separately. An unsigned pack can't prove by itself that it hasn't changed, or who made it.

```bash
shasum -a 256 the-pack.zip           # compare with the SHA-256 you kept
unzip the-pack.zip -d pack && cd pack
shasum -a 256 -c SHA256SUMS          # macOS; on Linux: sha256sum -c SHA256SUMS
```

On Windows, `Get-FileHash -Algorithm SHA256 <file>` gives a file's hash to compare with its line in `SHA256SUMS`.

## A pack is a snapshot of the folder, and says when it isn't

- Collecting records when it started and ended. After reading a run it lists the run folder again, rereads `run.json`, checks every file's size and lists the decision folders again. If anything changed, the run is collected again, up to 2 more times. Anything still changing is listed at the top of the page and in `manifest.json` ("The run changed while this pack was made: notes-w3.jsonl grew."), and the pack is **partial**. So is a pack whose `run.json` is missing (it holds what's there), or a date range with a run whose start can't be read (it's included so nothing is hidden).
- The pack holds what's saved in the team folder. If the window making it has a change to the run that isn't in the folder yet, the dialog says "This window has a change that isn't in the team folder yet. The pack holds only what's saved in the folder." and offers **Wait for the save**; the manifest records it.

## Privacy

The people directory and its email fields are left out. Original records and attachments may contain personal information. Anyone you give a pack to can read everything in it. A redacted report, if one is ever made, would be a separate thing that names its redactions; it would never be the evidence pack.

## Limits and sizes

- Packs are stored ZIP files (no compression), with CRC-32 and UTF-8 names and no Zip64, so they follow PKWARE's limits: at most 65,535 files, and no file, offset or the pack itself past 4 GB. Names are relative, at most 512 bytes, with no `..`, leading `/`, `\` or drive letter, and unique ignoring letter case.
- Before reading anything in full, Flightdeck estimates the size from the listing (files, headers, and the page at its largest: pictures as base64, records escaped) and refuses a pack that won't fit. While writing, every byte goes through checked counters.
- In the browser a pack is made in memory: up to 500 MB on a desktop and 150 MB on a phone-width screen or a device with 4 GB of memory or less, and up to 200 runs. Files are read and hashed 1 MB at a time, with a pause between pieces, and **Cancel** stops between them.
- `flightdeck export` has only the ZIP limits. It streams: attachments are hashed 1 MB at a time and copied again when the pack is written, checked against the same size and CRC.

## The readable report

**Readable report** in the dialog makes `evidence.html` on its own, labeled "A readable report, not the evidence pack". It leaves out the original files, the hashes of attachments that weren't read, and what conflict copies and other copies say.

## Command line

```bash
flightdeck export "<team folder>" --run release/run-2026-10-17 [--out <dir>] [--no-attachments] [--tz Area/City]
flightdeck export "<team folder>" --process release --from 2026-10-01 --through 2026-10-31 [--tz Europe/London] [--out <dir>]
```

- `--from` and `--through` are days, both included: from 00:00:00.000 on the first through 23:59:59.999 on the last, in `--tz` (this computer's time zone unless you say; it's printed and recorded in the manifest), compared with when each run started (`created`).
- The pack goes to `~/Flightdeck evidence/` unless `--out` names another folder; one inside the team folder is refused. It's written as `<name>.zip.partial`, created so it never replaces a file, and renamed when it's done (with " (2)" if the name is taken). Ctrl+C or a failure removes the partial file.
- Exit codes: `0` a complete pack, `4` a partial pack (made, with what's unresolved listed), `1` no pack.
- It runs the core and storage code from its own installed `flightdeck.html` (the `pf-core` and `pf-storage` blocks), never a team folder's copy. It reads the folder through a read-only adapter that checks every folder on a path for links, opens files without following links and checks each is the file it listed; a link is left out and named.

## For AI assistants

An assistant may run `flightdeck export` when a person asks for a run's evidence, with `--out` outside the team folder. It never puts a pack, or anything unpacked from one, in the team folder, and gives the person the SHA-256 it prints.
