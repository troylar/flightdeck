# When something goes wrong

What to do when a team folder looks wrong. Each section says what you see, what it means, what to do, and what not to do. Flightdeck never merges two versions of anything by itself and never deletes a copy you haven't chosen to delete, so in almost every case nothing is lost yet. Go slowly.

Before you change anything by hand, back up the folder: `flightdeck backup <team folder>` (see [Updating Flightdeck](updating.md#4-back-up)).

Flightdeck has this guide too: **Settings → When something goes wrong**. **Settings → Folder health** checks the whole team folder and links each problem it finds to its section here, and the **What to do** links on a run's conflict copies and on the top bar's "can't read it" open the right section.

## A run has conflict copies

**What you see:** a run shows a panel listing other versions, with **Compare copies**. In the folder, the run has files like `run.conflict-<window>-<time>.json`, `run-<COMPUTER>.json` or `candidate-*.json` next to `run.json`.

**What it means:** two windows saved the run without seeing each other's change, usually because OneDrive was paused, offline or slow on one computer, or someone used **Take over**. Flightdeck refused to overwrite and kept the other version beside it.

**What to do:**

1. Open the run and choose **Compare** on each copy. It lists what differs: answers, evidence, filled-in values, gates, details, roles, follow-ups and the outcome.
2. The recorder chooses **Keep this one** on the right copy. The current version is saved beside it first as `replaced-*.json`, so it can still be read.
3. Anything only the other copy has (a step checked there, a note) has to be redone by hand in the kept version. Then **Delete** the copy you didn't keep.

**If there's no `run.json`:** Folder health lists copies of a run that didn't load when the run's own `run.json` is missing or can't be read. Wait a few minutes for OneDrive; if it doesn't arrive, restore `run.json` from a backup or OneDrive's version history (see [A file can't be read](#a-file-cant-be-read)), then compare the copies in the run as above.

**What not to do:** don't delete or rename copies in the folder by hand, and don't edit `run.json`. Nothing is merged for you: if both copies have answers you need, keep one and redo the other's answers in the app.

## A run's file is gone

**What you see:** a run says **This run's file is gone from the team folder**, the Runs page marks a run "file is gone", or **Folder health** lists copies or a saved copy of a run whose `run.json` is missing.

**What it means:** the run's `run.json` isn't in the folder any more. Someone deleted or moved it (on purpose, or by tidying the folder), or OneDrive is still bringing it back. Flightdeck never writes it back by itself: a window that still has the run won't quietly undo someone's deletion.

**What to do:**

1. Wait a minute and choose **Refresh**. If OneDrive was only replacing the file, the run comes back on its own.
2. Ask the team whether it was deleted on purpose. If it was, leave it gone; reload Flightdeck and it's no longer listed.
3. To bring it back from a window that still has it open, the recorder (or, for an ended run, whoever recorded or ended it) chooses **Restore it here**. That writes this window's version back as a new save and notes it in the run's log.
4. No window has it: restore `run.json` from OneDrive's version history or a backup (see [Restoring from a backup](#restoring-from-a-backup)). If only save receipts are left (`candidate-<window>-<save>.json`), each is a whole copy of the run as of that save: copy the newest one to `run.json`, then open the run and check it.

**What not to do:** don't restore a run someone deleted on purpose without asking them. Don't delete the save receipts or conflict copies until the run is back.

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

- **The whole folder:** ask everyone to close Flightdeck first. Then restore the backup over the team folder (or OneDrive's own **Restore your OneDrive** for a point in time), wait for OneDrive to finish syncing on every computer, and reopen Flightdeck. Open **Settings → Folder health** and deal with what it lists before anyone starts recording.
- **One draft or `people.json`:** copying a single file back from a backup is fine. Tell the team, since it replaces any change made since.
- **One run's `run.json`:** don't copy it over the current one. Put the backup copy next to it as `run.conflict-restored.json`; the run then shows it under **Compare copies**, and the recorder chooses with **Keep this one**. That way the current version is kept as `replaced-*.json`.

**What not to do:** never restore part of `publications/`. A published version is a whole folder that's checked as a unit; restore all of a version's folder or none of it. Don't restore while anyone is recording a run.

## A file can't be read

**What you see:** **Folder health** or the Runs page says a file can't be read, like `runs/release/<run>/run.json isn't complete JSON`, or a page says part of the team folder couldn't be read.

**What it means:** usually the file is still arriving: OneDrive delivers big files a piece at a time, or the computer has only a placeholder (the folder isn't set to keep files on this device). Sometimes an editor or a failed copy left it damaged. Flightdeck never writes over a file it can't read, and keeps showing what it read before.

**What to do:**

1. Wait a minute and choose **Check again** in Folder health (or **Refresh**).
2. If it stays unreadable, make sure the folder is set to **Always keep on this device** (see [OneDrive isn't syncing](#onedrive-isnt-syncing)).
3. Still unreadable: restore that one file as in [Restoring from a backup](#restoring-from-a-backup). For a run's `run.json`, put the backup next to it as `run.conflict-restored.json`, never over it.

**What not to do:** don't fix the JSON by hand in a text editor, and don't delete the file. A run file someone fixed by hand may open read-only.

## Leftover files

**What you see:** **Folder health** lists leftover temporary files (`*.tmp`) or old save receipts (`candidate-*.json`) in run folders.

**What it means:** a save, a copy or an install stopped partway, often because a computer went to sleep. Old save receipts are saves that are already in the run, kept until the run's next save tidies them away.

**What to do:** save receipts need nothing; the next save of that run removes them. A temporary file older than a couple of hours, while nobody is saving or installing, can be deleted.

**What not to do:** don't delete a `candidate-*.json` that the run lists as a conflict copy (it shows under **Compare copies**). That one is a save that would otherwise be lost.

## The folder is getting big

**What you see:** **Folder health** says the folder has many runs, a run folder holds many files, attachments take a lot of space, some file paths are very long, or refreshing takes a long time on this computer.

**What it means:** Flightdeck still works, but every computer keeps every file, and opening the folder reads more each time. Past about 2,000 runs, or 1 GB of attachments, it gets slow. Windows refuses paths that get too long once the team folder's own location is added.

**What to do:**

- **Many runs:** start a new team folder for new runs (**Settings → Start a new team folder**), copy the drafts and step types into it, and keep the old folder as the record.
- **Big attachments:** keep large logs and recordings elsewhere and attach a link or a short excerpt. A `.zip` of many small files is one file instead of many.
- **Long paths:** use shorter process IDs and file names in new checklists.
- **Slow refreshing on one computer:** check that OneDrive has the folder's files on this computer (**Always keep on this device**), and close other Flightdeck windows on the same folder. If every computer is slow, the folder is too big: start a new one.
- **Step types or skills not read:** Flightdeck reads the first 100 step types and the first 500 skill registrations, by name. Remove ones nobody uses.

**What not to do:** don't delete or move old runs to save space. Runs are the record; move the whole folder or start a new one.

## Two windows used the same name

**What you see:** **Folder health** says two windows wrote under the same name: notes with the same ID but different text, or connection checks from two computers carrying the same window name.

**What it means:** every Flightdeck window gives the files it writes its own name, so no two windows ever write the same file. Two with the same name usually means a browser profile or a whole computer was copied, with Flightdeck open.

**What to do:**

1. Reload Flightdeck in every window on both computers. Each window takes a fresh name when it opens.
2. Open the runs Folder health lists and read their notes. A note that's missing or garbled can be added again.

**What not to do:** don't edit or delete the notes files by hand.

## Someone left the team

**What you see:** checklists, gates or the team's people list name someone who's gone.

**What to do:**

1. The folder owner or backup owner opens **Settings → People** and chooses **Mark inactive** for them: their entry stays (runs and sign-offs refer to it), and they're no longer offered for roles. Never delete or reuse their ID. If they were the folder owner, the backup owner marks them inactive, then chooses **Make folder owner** on themselves and picks a new backup.
2. Give their checklists a new owner: change `owner:` in each draft and publish a new version. Until then, a checklist's `backup:` owner can sign off its versions. Sign-offs from before stay with the versions they were for.
3. If they were recording a run, someone uses **Take over** on it, and checks the run for conflict copies afterward.
4. If they updated Flightdeck for the team, choose who does now, and give them [Updating Flightdeck](updating.md).

**What not to do:** don't edit their old runs or sign-offs to show the new owner. History stays as it happened.

## A newer Flightdeck wrote files

**What you see:** "Update Flightdeck to run it" on a version, a run that opens read-only, or "Flightdeck X is in the team folder" in the top bar.

**What it means:** someone used a newer copy of Flightdeck, and it wrote files with features this copy doesn't understand. This copy leaves them alone rather than risk erasing what it can't read.

**What to do:** open the team folder's own `flightdeck.html` (the newest one), not a copy you saved elsewhere. If the team folder's copy is the older one, whoever updates Flightdeck installs the newer version there (see [Updating Flightdeck](updating.md)).

**What not to do:** don't go back to an older copy to "fix" the run. It can't record on files a newer copy wrote.
