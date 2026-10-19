# When something goes wrong

What to do when a team folder looks wrong. Each section says what you see, what it means, what to do, and what not to do. Flightdeck never merges two versions of anything by itself and never deletes a copy you haven't chosen to delete, so in almost every case nothing is lost yet. Go slowly.

Before you change anything by hand, back up the folder: `flightdeck backup <team folder>` (see [Updating Flightdeck](updating.md#4-back-up)).

## A run has conflict copies

**What you see:** a run shows a panel listing other versions, with **Compare copies**. In the folder, the run has files like `run.conflict-<window>-<time>.json`, `run-<COMPUTER>.json` or `candidate-*.json` next to `run.json`.

**What it means:** two windows saved the run without seeing each other's change, usually because OneDrive was paused, offline or slow on one computer, or someone used **Take over**. Flightdeck refused to overwrite and kept the other version beside it.

**What to do:**

1. Open the run and choose **Compare** on each copy. It lists what differs: answers, evidence, filled-in values, gates, details, roles, follow-ups and the outcome.
2. The recorder chooses **Keep this one** on the right copy. The current version is saved beside it first as `replaced-*.json`, so it can still be read.
3. Anything only the other copy has (a step checked there, a note) has to be redone by hand in the kept version. Then **Delete** the copy you didn't keep.

**What not to do:** don't delete or rename copies in the folder by hand, and don't edit `run.json`. Nothing is merged for you: if both copies have answers you need, keep one and redo the other's answers in the app.

## OneDrive made a copy of a draft, people.json or a step type

**What you see:** a second file with a computer's name in it, like `release-LAPTOP.md`, `people-DESKTOP.json` or `deploy-PC.json` (OneDrive's pattern is `name-COMPUTER.ext`), sometimes `name (1).ext`.

**What it means:** two people saved the same file before OneDrive delivered the first save. OneDrive kept both. Flightdeck checks before it saves a draft or step type, but it can't lock a shared file, so this can still happen, especially with an AI assistant editing at the same time.

**What to do:**

1. Ask who saved each copy, and agree which one is right.
2. Open both in a text editor (or ask your AI assistant to compare them) and copy anything missing from the right one into it.
3. Save the right one under the original name, and delete the other copy.
4. For a draft, open it in Flightdeck and check it still reads correctly before you publish.

**What not to do:** don't publish while two copies of a draft exist: you may publish the wrong one. Don't leave the copy "for later"; it confuses AI assistants too.

## Flightdeck lost access to the folder

**What you see:** the top bar says **The team folder needs your OK again** with **Reconnect**, or Flightdeck opens on the examples instead of your folder.

**What it means:** browsers forget folder permissions. It happens after a browser update or restart, when the folder was moved or renamed, on a new computer, or after someone cleared the browser's data.

**What to do:**

- **Needs your OK again:** choose **Reconnect** and allow access.
- **Moved or renamed folder, or a new computer:** go to **Settings → Open team folder** and pick the folder where it is now.
- **Browser data cleared:** open the folder again the same way. Changes that hadn't reached the folder yet were kept in the browser; if the browser's data was cleared, they're gone, but everything saved to the folder is safe.

Changes Flightdeck kept in this browser while it couldn't write are filed under their folder's name. Open the same folder again and they're offered back to you.

**What not to do:** don't pick a different copy of the folder (a download, an older backup) to get going again. You'd be recording into a folder nobody else sees.

## OneDrive isn't syncing

**What you see:** your teammates don't see your changes (or you don't see theirs) after a few minutes. Flightdeck says when it last saved and when it last checked the folder, but it can't see what OneDrive has delivered.

**What it means:** OneDrive is paused, signed out, offline, out of space, or the folder is set to download files only when they're opened.

**What to do:**

1. Open the OneDrive menu. If it says paused, choose **Resume syncing**. If it shows an error, fix that first (sign in, free up space).
2. Right-click the team folder and choose **Always keep on this device**. Flightdeck needs every file on the computer, not a placeholder.
3. If it still doesn't move, pause syncing and resume it once.
4. Wait for OneDrive to say it's up to date, then choose **Refresh** in Flightdeck's top bar.

**What not to do:** don't keep recording a run on two computers while one isn't syncing. Hand off or wait; otherwise you'll get conflict copies.

## Restoring from a backup

**What you see:** you need files back, after a bad merge, a deleted folder, or a mistake by an AI assistant.

**What to do:**

- **The whole folder:** ask everyone to close Flightdeck first. Then restore the backup over the team folder (or OneDrive's own **Restore your OneDrive** for a point in time), wait for OneDrive to finish syncing on every computer, and reopen Flightdeck. Once Folder health exists (a later 1.15 release), check it before anyone starts recording.
- **One draft or `people.json`:** copying a single file back from a backup is fine. Tell the team, since it replaces any change made since.
- **One run's `run.json`:** don't copy it over the current one. Put the backup copy next to it as `run.conflict-restored.json`; the run then shows it under **Compare copies**, and the recorder chooses with **Keep this one**. That way the current version is kept as `replaced-*.json`.

**What not to do:** never restore part of `publications/`. A published version is a whole folder that's checked as a unit; restore all of a version's folder or none of it. Don't restore while anyone is recording a run.

## Someone left the team

**What you see:** checklists, gates or the team's people list name someone who's gone.

**What to do:**

1. In `people.json`, keep their entry (runs and sign-offs refer to it) and add `"inactive": true` to it, so they're no longer offered for roles. Never delete or reuse their ID. One person edits `people.json` at a time.
2. Give their checklists a new owner: change `owner:` in each draft and publish a new version. Sign-offs from before stay with the versions they were for.
3. If they were recording a run, someone uses **Take over** on it, and checks the run for conflict copies afterward.
4. If they updated Flightdeck for the team, choose who does now, and give them [Updating Flightdeck](updating.md).

**What not to do:** don't edit their old runs or sign-offs to show the new owner. History stays as it happened.

## A newer Flightdeck wrote files

**What you see:** "Update Flightdeck to run it" on a version, a run that opens read-only, or "Flightdeck X is in the team folder" in the top bar.

**What it means:** someone used a newer copy of Flightdeck, and it wrote files with features this copy doesn't understand. This copy leaves them alone rather than risk erasing what it can't read.

**What to do:** open the team folder's own `flightdeck.html` (the newest one), not a copy you saved elsewhere. If the team folder's copy is the older one, whoever updates Flightdeck installs the newer version there (see [Updating Flightdeck](updating.md)).

**What not to do:** don't go back to an older copy to "fix" the run. It can't record on files a newer copy wrote.
