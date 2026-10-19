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

A copy left in any version's updates folder still counts as waiting, even after a later update, until someone deletes it.

`--force` replaces files your team changed with the new defaults instead. Each run saves a copy of every file it replaces in a new folder of its own under `.flightdeck/updates/<version>/replaced/`, and moves any copies still waiting to be merged for those files there too (under `staged/`). `--app-only` installs only `flightdeck.html`.

**What install trusts.** `.flightdeck/installed.json` only ever makes install more careful. Install replaces a file without `--force` only when it's exactly a default Flightdeck shipped; a record that's damaged or wasn't written by Flightdeck is ignored, and install says so. A file that changes while install is running (an AI assistant saving it, say) is left as it is, and install ends with exit code 1 so you run it again.

**Links.** Install never writes through a link or outside the folder: it checks every folder on the way, writes to a new temporary file, and checks again just before moving it into place. Those checks can't stop someone who renames folders inside your team folder at the same instant on purpose; that's outside what a file copy can guard against. Don't run install while something else is reorganizing the folder.

## 6. Verify

Open the team folder's `flightdeck.html` and check What's new shows the new version. Open a run and a process to make sure they load. Once they exist (a later 1.15 release), also check **Folder health** and run a connection check with a teammate.

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

So the worst case is someone who can't record until they reopen the newer copy. Nothing they had is erased.

## Rolling back

If an update goes wrong, install the older version over it:

```bash
npx @troylar/flightdeck@1.14.0 install "~/OneDrive/Team/Flightdeck" --force
```

Files the newer version already wrote (runs, publications) stay read-only to the older copy, as in the table above. They aren't lost; they work again once you update. Versions before 1.15 install only `flightdeck.html`; from 1.15 on, `--force` also puts back that version's `AGENTS.md` and skills, after saving a copy of each file it replaces. If you need the folder exactly as it was, restore your backup instead (see [When something goes wrong](recovery.md#restoring-from-a-backup)).
