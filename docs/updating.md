# Updating Flightdeck

> **For:** the person who keeps a team's Flightdeck up to date, usually the team lead.
>
> **You'll get:** seven steps from "is there a new release?" to "the team is on it," plus what to do when computers run different versions and how to roll back.

One person does this for each team folder, so two updates never cross.

**On this page:** [1. Learn about new releases](updating.md#1-learn-about-new-releases) · [2. Read What's new](updating.md#2-read-whats-new) · [3. Pick a time](updating.md#3-pick-a-time) · [4. Back up](updating.md#4-back-up) · [5. Install](updating.md#5-install) · [6. Verify](updating.md#6-verify) · [7. Tell the team](updating.md#7-tell-the-team) · [When computers run different versions](updating.md#when-computers-run-different-versions) · [Rolling back](updating.md#rolling-back)

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

For a while after an update, some people will still have the older copy open. Copies from 1.11.1 on never overwrite what they don't understand:

| A newer copy wrote | An older copy (1.11.1 on) |
|---|---|
| A published version with new step types or syntax | Shows "Update Flightdeck to run it" and won't start it. From 1.21 on it says which version it needs: "v5 needs Flightdeck 2.0" (or 2.1) |
| A run with fields it doesn't know | Opens the run read-only |
| A run in a newer run format (made with Flightdeck 2.0) | Shows its name only and won't change it. From 1.21 on: "Made with Flightdeck 2.0" |
| A staged version or a test run (2.1) | Never lists `staged/`. Shows a test run by name only and won't change it (2.0: "Test run · needs Flightdeck 2.1"), but counts it in Home's running number |
| A plan, a sign-off, a step type or a decision in a newer format | Doesn't use it. From 1.21 on, Folder health lists it with the version it needs |
| A note of a new kind (a correction, read by a copy older than 1.13) | Shows it as a plain note and keeps its files |
| A draft that uses new checklist syntax | Shows errors on the draft; publish it from the newer copy |
| `AGENTS.md`, the skills, `.flightdeck/installed.json` | Ignores them: the app doesn't read them |
| Connection checks in `connection/` (1.15) | Ignores them: copies before 1.15 never read that folder, and can't answer a check |

So the worst case is someone who can't record until they reopen the newer copy. Nothing in the team folder is erased.

### Two limits to know

- **Copies older than 1.11.1 can't tell.** Flightdeck 1.10.0 and 1.11.0 don't check a file's format. With Flightdeck 2.0 files in the folder they leave runs made with 2.0 out of their lists without a word, and they offer a 2.0 version as the latest, as if they could run it. Nobody should use them in a folder where anyone uses Flightdeck 2.0. Folder health (1.21 on) names older copies it saw answering connection checks or editing drafts in the last 7 days.
- **A change an older window couldn't save is lost from that window.** When a newer Flightdeck saves a run while an older window has it open, the older window refuses to save over it and writes nothing, which keeps the team folder safe. But the change made in that window isn't kept on disk. If the window is switched to another folder, the browser keeps a copy, and back in the first folder the older copy shows "A copy kept in this browser" with only a Discard button. That copy isn't a way to get the change back. Re-enter the change in Flightdeck 1.21 or newer (see [An older Flightdeck said it couldn't save](recovery.md#an-older-flightdeck-said-it-couldnt-save)).

### Moving a team to Flightdeck 2.0

1. Put Flightdeck 1.21 in the team folder and have everyone reopen it from there. Check Folder health: "Teammates are using an older Flightdeck" should be gone once every computer has answered a connection check or opened a draft with 1.21.
2. Then put Flightdeck 2.0 in the team folder.
3. Only then start using 2.0 features (notes and screenshots on phases and gates, exact versions of linked checklists and skills, typed run details and evidence, reports from tools). `only when`, staging and test runs are 2.1 features (below). A checklist that uses none of them still publishes as a version every copy from 1.11.1 on can run.

### Using conditions (2.1)

`only when` on a step or phase needs Flightdeck 2.1 on every computer that runs the checklist: a version that uses it shows on 2.0 and earlier as "needs Flightdeck 2.1" and won't start there, and its runs show by name only. Put 2.1 in the team folder and have everyone reopen it before anyone publishes a checklist with `only when`. The 1.21 step above still comes first for a team moving from 1.x; 2.1 doesn't change it. A checklist without `only when` publishes exactly as it does on 2.0.

### Staging and test runs (2.1)

A staged version and its test runs are only for copies on 2.1. Older copies never list `staged/`, show a test run by name only and never change it, but they count a test run in Home's running number until they update to 2.1. A version made the default from a stage is an ordinary version every copy from 1.11.1 on can run.

### Two things to know when moving to 2.1

- **A run open in a browser since before 2.1 makes one conflict copy.** 2.1 compares a run's whole file before saving over it. A run that was already open in a browser tab from before the update has only the older, shorter fingerprint, so its first save keeps your change as a conflict copy instead of writing over the run. Reopen the run and carry on; later saves work as usual.
- **Known issue: plan decisions and edit history still use the shorter fingerprint.** The fingerprint a plan decision records for its plan (`proposalHash`) and the from and to of each History entry stay 32-bit in 2.1, so files already in team folders keep reading. In the rare case two versions of a plan or a file share that fingerprint, those records can't tell them apart.

## Rolling back

If an update goes wrong, install the older version over it:

```bash
npx @troylar/flightdeck@1.14.0 install "~/OneDrive/Team/Flightdeck" --force
```

Files the newer version already wrote (runs, publications) stay read-only to the older copy, as in the table above. They aren't lost; they work again once you update. Versions before 1.15 install only `flightdeck.html`; from 1.15 on, `--force` also puts back that version's `AGENTS.md` and skills, after saving a copy of each file it replaces. If you need the folder exactly as it was, restore your backup instead (see [When something goes wrong](recovery.md#restoring-from-a-backup)).
