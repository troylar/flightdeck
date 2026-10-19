# Updating Flightdeck

For the person who keeps a team's Flightdeck up to date, usually the team lead. One person does this for each team folder, so two updates never cross.

An update has two parts. `flightdeck.html` is the app everyone opens. `AGENTS.md` and the skills in `.flightdeck/skills/` are the contract your team's AI assistants follow. `flightdeck install` updates both, and never replaces a file your team changed without asking.

## 1. Learn about new releases

Flightdeck never checks for updates itself; the app stays offline. Pick one of these:

- On GitHub, open [troylar/flightdeck](https://github.com/troylar/flightdeck), choose **Watch → Custom → Releases**. You get one notice per release and nothing else.
- Or now and then, run `npm outdated -g @troylar/flightdeck`. It lists a newer version if there is one.

## 2. Read What's new

Read the release's notes (the GitHub release, `CHANGELOG.md`, or What's new in the app once installed). The version number tells you how big the change is:

| Version change | Means |
|---|---|
| Patch (1.15.0 → 1.15.1) | Fixes. Safe to install any time. |
| Minor (1.15 → 1.16) | New or improved features. Files stay compatible: older copies still read what newer ones write, with the limits below. |
| Major (1.x → 2.0) | A file format older copies can't read. Everyone has to move to the new version together. |

## 3. Pick a time

People can keep working during a patch or minor update, but it's calmer if nobody is recording a run. Ask anyone recording to finish or hand off first, or update together at the start of the day. For a major update, everyone stops, you update, and everyone reopens.

## 4. Back up

```bash
flightdeck backup "~/OneDrive/Team/Flightdeck"
```

This copies the whole team folder to `Flightdeck backups` in your home folder, in a new folder named with the date and time. `--to <folder>` puts it somewhere else. It never puts a backup inside the folder it backs up, and it skips links and temporary files. Mark the team folder **Always keep on this device** first, so every file is really on your computer.

## 5. Install

```bash
npm install -g @troylar/flightdeck@latest
flightdeck install "~/OneDrive/Team/Flightdeck" --check
```

`--check` changes nothing. It lists what install would do and ends with an exit code:

| Exit code | Means |
|---|---|
| 0 | Nothing to do |
| 2 | Updates to install |
| 3 | Some files your team changed need merging |
| 1 | A problem (the folder is missing, a file is a link, the folder has a newer Flightdeck) |

Then install:

```bash
flightdeck install "~/OneDrive/Team/Flightdeck"
```

It copies `flightdeck.html`, then goes through `AGENTS.md` and each skill file:

| What install finds | What it does |
|---|---|
| Same as this version's default | Nothing |
| An earlier default (exactly a file some Flightdeck version shipped, which the built-in list of defaults proves) | Updates it |
| A file your team changed, when this version didn't change that default | Leaves it alone |
| A file your team changed, when this version changed that default too | Leaves it alone, and puts the new default in `.flightdeck/updates/<version>/` with a `README.md` |
| Missing | Adds it |

In `AGENTS.md`, only the part between `<!-- flightdeck:begin -->` and `<!-- flightdeck:end -->` is Flightdeck's. **Team notes**, below it, are yours, and install never changes them. Put your team's own instructions for AI assistants there.

**When files need merging:** open your AI assistant in the team folder and give it the prompt in `.flightdeck/updates/<version>/README.md`. It compares each new default with your file, keeps your changes, brings in the new ones, and deletes each copy once merged. Run `flightdeck install <folder> --check` again; 0 means nothing is left.

A copy left in any version's updates folder (`.flightdeck/updates/<version>/<the file's path>`) still counts as waiting, even after a later update and even if the file now matches the default, until someone deletes it or `--force` files it away. If this version changed that file's default again, its new default is staged in this version's folder too, so you merge both; the file counts as waiting until every copy is gone.

**Install always keeps a copy of every file it replaces** (`AGENTS.md`, skill files and `flightdeck.html`, an earlier default too) in a new folder of its own under `.flightdeck/updates/<version>/replaced/`, and says where. Each copy is written in full and read back before the file is replaced; if that fails, the file isn't replaced.

`--force` replaces files your team changed with the new defaults instead. It also moves any copies still waiting to be merged into that run's copy folder (under `staged/`), including copies for files that already match the default. `--app-only` installs only `flightdeck.html`.

**What install trusts.** `.flightdeck/installed.json` only ever makes install more careful. Install replaces a file without `--force` only when it's exactly a default Flightdeck shipped; a record that's damaged or wasn't written by Flightdeck is ignored, and install says so.

**A file that changes while install runs.** Just before replacing a file, install reads it again. If it changed since install first read it (an AI assistant saving it, say), install leaves it as it is and ends with exit code 1, so you run it again. A save that lands in the instant between that last read and the replacement is replaced. The copy install kept holds the file as it was before install, not that last save; whatever the save added is only in the program that made it, if it still has it. Close editors on `AGENTS.md` and the skills while you install.

**Links and disk errors.** Install never writes through a link or outside the folder: it checks every folder on the way, writes a new temporary file in full and reads it back, checks again, and then puts it in place in one step. A disk error at any point leaves the file as it was and removes the temporary file. Someone who renames folders inside your team folder at the same instant, on purpose, can still redirect a write; that's outside what a file copy can guard against. Don't run install while something else is reorganizing the folder.

## 6. Verify

Open the team folder's `flightdeck.html` and check What's new shows the new version. Open a run and a process to make sure they load. Then open **Settings → Folder health** and deal with anything under Needs action, and run a **Connection check** with a teammate on another computer (each of you sends one).

## 7. Tell the team

Say that Flightdeck was updated and to reopen it from the team folder's own `flightdeck.html`, not from a copy saved elsewhere or a browser bookmark to a download. Anyone still running an older copy sees "Flightdeck X is in the team folder" in the top bar.

## When computers run different versions

For a while after an update, some people will still have the older copy open. Older copies never overwrite what they don't understand:

| A newer copy wrote | An older copy |
|---|---|
| A published version with new step types or syntax | Shows "Update Flightdeck to run it" and won't start it |
| A run with fields it doesn't know | Opens the run read-only |
| A note of a new kind (a correction, read by a copy older than 1.13) | Shows it as a plain note and keeps its files |
| A draft that uses new checklist syntax | Shows errors on the draft; publish it from the newer copy |
| `AGENTS.md`, the skills, `.flightdeck/installed.json` | Ignores them: the app doesn't read them |
| Connection checks in `connection/` (1.15) | Ignores them: copies before 1.15 never read that folder, and can't answer a check |

So the worst case is someone who can't record until they reopen the newer copy. Nothing they had is erased.

## Rolling back

If an update goes wrong, install the older version over it:

```bash
npx @troylar/flightdeck@1.14.0 install "~/OneDrive/Team/Flightdeck" --force
```

Files the newer version already wrote (runs, publications) stay read-only to the older copy, as in the table above. They aren't lost; they work again once you update. Versions before 1.15 install only `flightdeck.html`; from 1.15 on, `--force` also puts back that version's `AGENTS.md` and skills, after saving a copy of each file it replaces. If you need the folder exactly as it was, restore your backup instead (see [When something goes wrong](recovery.md#restoring-from-a-backup)).
