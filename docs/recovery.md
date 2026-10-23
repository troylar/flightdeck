# When something goes wrong

What to do when a team folder looks wrong. Each section says what you see, what it means, what to do, and what not to do. Flightdeck never merges two versions of anything by itself and never deletes a copy you haven't chosen to delete, so in almost every case nothing is lost yet. Go slowly.

Before you change anything by hand, back up the folder: `flightdeck backup <team folder>` (see [Updating Flightdeck](updating.md#4-back-up)).

Flightdeck has this guide too: **Settings → When something goes wrong**. **Settings → Folder health** checks the whole team folder and links each problem it finds to its section here, and the **What to do** links on a run's conflict copies and on the top bar's "can't read it" open the right section.

## A run has conflict copies

**What you see:** a run shows a panel listing other versions, with **Compare copies**. In the folder, the run has files like `run.conflict-<window>-<time>.json`, `run-<COMPUTER>.json` or `candidate-*.json` next to `run.json`.

**What it means:** two windows saved the run without seeing each other's change, usually because OneDrive was paused, offline or slow on one computer, or someone used **Take over**. Flightdeck refused to overwrite and kept the other version beside it. Right after a team moves to Flightdeck 2.1, a run that was already open in a browser tab makes one conflict copy on its first save (see [Updating Flightdeck](updating.md#two-things-to-know-when-moving-to-21)); compare it as below.

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

## A planned run arrived twice

**What you see:** under **Runs**, a planned run says "This request arrived twice" (or "This plan arrived twice"), or two planned runs say "Two different copies of this request are in the folder", and **Start the run** is off. In `proposals/` there are two files with the same start, like `req-backup-script-….json` and `req-backup-script-…-LAPTOP.json`.

**What it means:** the plan was written on two computers while OneDrive wasn't syncing, usually because another app asked for the run (`flightdeck plan request`) on each, and OneDrive kept both files. When they say the same thing, Flightdeck shows the request once and you can start it as usual. When they differ, it won't start either one until one is gone.

**What to do:**

1. Open both files in a text editor (or ask your AI assistant to compare them) and agree which one is right.
2. Delete the other copy. Keep the file without the computer's name when they're the same.
3. Back in Flightdeck, choose **Refresh**, then review and start the request.

**What not to do:** don't start the request in an older copy of Flightdeck while two files exist: older copies show each file as its own planned run, so it can be started twice. If it was started twice already, Runs shows the plan's decisions as disagreeing; keep one run and cancel the other.

## A started plan's run isn't in the folder

**What you see:** on a planned run, or in **Folder health**, "Started (run …); its run isn't in the folder." In the window that started it, "The plan is marked started, but its run didn't save", with **Try again**.

**What it means:** starting a plan marks it started first, naming its run, and then saves the run. Here the plan is marked started, but its `run.json` isn't in `runs/<process>/<run>/`. Either it's still syncing from another computer, or the run's save failed and the window that started it was closed before it tried again. The plan stays started either way, so it's never started a second time.

**What to do:**

1. In the window that started it, choose **Try again**. It saves exactly the run that was started, on the same version. Only the person who started it can, in that folder: choosing another person in the window, or opening another folder, forgets it, even while Try again is waiting its turn, and nothing is written. It does nothing if the run's folder already holds other files: then the run was started and worked on, and its `run.json` went missing later; restore it from a backup (see [Restoring from a backup](#restoring-from-a-backup)).
2. Anywhere else, wait and choose **Refresh**: the run may still be syncing.
3. If it never arrives, make a new plan (or **Start a run**) to run it again.

**What not to do:** don't delete the plan's decision (`proposals/<plan>.status-…-d.json`) to make the plan startable again: if the run does arrive later, it would be started twice.

## A plan file with another name can't be read

**What you see:** **Folder health** says a file in `proposals/` can't be read, and its name doesn't say which plan it's for, like `proposals/Copy of plan-release-….json`.

**What it means:** Flightdeck holds a plan while a file named for it (`<plan>.…`) can't be read, because that file could be a decision saying the plan was already started. A name shaped like a plan's or a request's (`plan-….json`, `req-….json`, and their `.status-…` files) says which plan it's for, even when that plan's own file can't be read either; those are listed as plan files that can't be read. A file with another name (a renamed copy, "Copy of …") could be such a decision too, but nothing says which plan, so it holds none. While it can't be read, the plan it belongs to could be started again.

**What to do:** if it's still arriving, wait and choose **Check again**. If it stays that way, restore it from a backup, or delete it if it's a stray copy.

## A request file is incomplete

**What you see:** `flightdeck plan request` exits with 4 (`held`) and names a file in `proposals/`, like `proposals/req-backup-script-….json`, saying it isn't complete JSON. Nothing was written.

**What it means:** the file is still arriving through OneDrive, another request is still writing it, or a request was cut short (a crash, a full disk). Flightdeck never removes it on its own, because it can't tell those apart.

**What to do:**

1. Wait a minute and run the request again. A file that was still arriving or being written is complete by then, and the request is either already there or refused with the details that differ.
2. If it's still incomplete, check that no other computer or script is asking for the same request right now.
3. Only then delete that one file, and run the request again.

**What not to do:** don't delete the file while another request might still be writing it, and don't edit it by hand to finish it.

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

First, choose **Refresh**. A big folder checks older runs a share at a time: a note added on another computer to a run that finished a while ago can take up to 10 minutes to show up (up to an hour if the file kept its size and time). **Refresh** reads everything at once. If it still doesn't show, OneDrive hasn't delivered it yet.

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

**A sign-off, a plan or a staged version.** These hold up only what they belong to, never the whole folder:

- A sign-off file (`validations/`) that can't be read: if this window read it before, what it said still counts and Folder health names the file. Otherwise, until it reads, **Ready for a skill?** and a staged version's line say they can't tell whether that version was signed off, and **Sign off** isn't offered for it.
- A planned run's file, or a decision on it, that can't be read: that plan stays shown as last read and can't be started, declined or switched until it reads. While `proposals/` itself can't be read, that goes for every plan shown.
- A staged version without its finished record, or a retire or reopen decision that can't be read: nothing runs from that staged version, and **All versions** offers no change to it until it reads. Stage the draft again if it stays that way.

Other JSON in `validations/` or `proposals/` that isn't a sign-off or a plan is named as ignored: move it out of that folder. A file in `proposals/` whose name doesn't say which plan it's for has its own section: [A plan file with another name can't be read](#a-plan-file-with-another-name-cant-be-read).

**A note.** A line in a run's notes file (`notes-….jsonl`) that isn't complete JSON is named on the run page and in Folder health: "A note in notes-….jsonl (line 3) couldn't be read." Usually it's still arriving and the warning goes on the next read. If it stays, the note on that line was cut short (a crash, or a sync cut off) and is lost; the run's other notes show as usual. Nothing is repaired or rewritten. If someone remembers what the note said, add it again.

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

## A draft says it's being edited, but nobody is

**What you see:** "Being edited by …" on a process page or in the editor, for someone who closed Flightdeck.

**What it means:** each window that holds a draft editor says so every 10 seconds in its own file in `presence/`. A window that crashed or lost its connection stops, and its notice goes away within a minute. Another computer's notice can arrive late, or stay a little longer, while OneDrive syncs.

**What to do:** wait a minute and choose Refresh. You can always choose **Edit anyway**: every save is checked against the draft you opened. Files in `presence/` older than 24 hours are cleaned up by Flightdeck on its own; you can also delete them by hand.

## A proposal was decided twice

**What you see:** "Decided twice" next to a proposal on the process page.

**What it means:** two people decided on the same proposal at the same time (on two computers, or before one decision synced), for example one declined and one reopened it. Flightdeck doesn't pick one, and never applies it on its own.

**What to do:** open **Review**, look at what happened, and decide again: Apply, Decline or Reopen. The new decision counts.

## A proposal can't be read

**What you see:** "1 proposal can't be read yet" on a process page, or "Can't tell what happened" on a proposal.

**What it means:** a proposal or one of its records is still arriving (a half-synced file fails its own check), or it isn't in the format. Flightdeck tries again on every refresh and never applies a proposal whose records it can't read.

**What to do:** wait for OneDrive and choose Refresh. If it stays, ask whoever made it (an AI assistant run through `flightdeck draft`) to save the change again; the file in `proposed/<process>/` can then be deleted by a person.

## A newer Flightdeck wrote files

**What you see:** "v5 needs Flightdeck 2.0" (or 2.1) on a version, "Made with Flightdeck 2.0" on a run that shows its name only, "Test run · needs Flightdeck 2.1" on a test run, "needs a newer Flightdeck" on a plan, a sign-off, a decision or a step type, or "Flightdeck X is in the team folder" in the top bar. Folder health lists each of these files under "A newer Flightdeck wrote some of these files".

**What it means:** someone used a newer copy of Flightdeck, and it wrote files this copy doesn't fully understand. This copy shows them by name and leaves them alone rather than risk misreading or erasing what it can't read. It never counts them as if they were something it knows.

**What to do:** open the team folder's own `flightdeck.html` (the newest one), not a copy you saved elsewhere. If the team folder's copy is the older one, whoever updates Flightdeck installs the newer version there (see [Updating Flightdeck](updating.md)).

**What not to do:** don't go back to an older copy to "fix" the run. It can't record on files a newer copy wrote.

## A teammate can't run a version

**What you see:** a teammate sees "v5 needs Flightdeck 2.0" or "v5 needs Flightdeck 2.1" (or, on Flightdeck 1.20 and earlier, "Update Flightdeck to run it") where you can start runs on v5.

**What it means:** v5 uses something their copy of Flightdeck can't read. Their copy shows it but won't run it, so runs already going on older versions aren't affected.

**What to do:** they open the team folder's own `flightdeck.html`. If their computer still has an older copy saved somewhere, they stop using it. Until every computer is on the newer Flightdeck, start runs of v5 only from a computer that has it.

## An older Flightdeck said it couldn't save

**What you see:** in an older copy of Flightdeck, a save fails with "saved by a newer copy of Flightdeck" or "Update Flightdeck", and the run is read-only. If that window was then switched to another folder and back, it may also list "A copy kept in this browser" with only a **Discard** button.

**What it means:** the run was saved by a newer Flightdeck while the older window had it open. The older copy refused to save over it and wrote nothing, so nothing in the team folder was lost. But the change made in that old window can't be restored from it: the copy kept in the browser offers only Discard, and switching folders to keep one isn't a way to get it back.

**What to do:** open the team folder's own `flightdeck.html` (Flightdeck 1.21 or newer) and re-enter the change there, or write it down in a note on the run. Then move that computer to the newer Flightdeck (see [Updating Flightdeck](updating.md)).

## A replaced file with no steps

**What you see:** a `replaced-<window>-<time>.json` file beside a run made with Flightdeck 2.0. Folder health calls it "a placeholder left by an older Flightdeck", and an evidence pack labels it the same way.

**What it means:** an older copy of Flightdeck tried to restore a change over a run it could only show by name. It kept the name-only view it had as a "replaced" file. That file holds no answers and isn't a version of the run.

**What to do:** nothing is lost. Once the run reads correctly in the newer Flightdeck, the placeholder can be deleted. Don't use it to restore anything.

## Teammates on an older Flightdeck

**What you see:** Folder health says "Teammates are using an older Flightdeck" and names the versions it saw in the last 7 days, from connection checks and draft editors.

**What it means:** some computers still run an older copy. Copies from 1.11.1 on refuse files they can't read and show them by name. Copies older than 1.11.1 (1.10.0 and 1.11.0) can't tell: they may hide runs made with Flightdeck 2.0 and offer a 2.0 version as if they could run it.

**What to do:** move every computer to the newest Flightdeck in the team folder before anyone records on a Flightdeck 2.0 version (see [Updating Flightdeck](updating.md)). If an older window said it couldn't save, re-enter that change (see [An older Flightdeck said it couldn't save](#an-older-flightdeck-said-it-couldnt-save)).

## A skill can't be matched

**What you see:** on a process page or Home, a skill marked "can't be matched", with one of these:

- "Two registrations for release-notes; keep one (skills/release-notes.json and skill-registrations/release-notes/…)."
- "Needs review: two registrations of release-notes at revision 3 (…). Keep one, then register it again."
- "A revision of release-notes can't be read here: … Resolve it first; until then no revision is current."
- "release-notes moved to skill-registrations/release-notes/, and its registration is still arriving. Can't be matched yet."
- "Can't be matched: built from release v4 (v4-abcd1234), which isn't in this folder." (or: another folder has that number, two folders do, its files don't match what was pinned, or it can't be used here).

**What it means:** Flightdeck 2.0 matches a skill to the exact version it was built from, never to a number and never to the latest. When it can't tell which registration is the skill's, or the version it names isn't the one in the folder, it says so instead of guessing. Nothing about the skill itself changed.

**What to do:**

- **Two registrations:** a skill registered with `flightdeck skill register` replaces its old `skills/<name>.json` with a pointer. If the old file came back (a OneDrive copy, a restore), delete it, or register the skill again, which turns it back into a pointer.
- **A revision can't be read here:** a revision made with a newer Flightdeck, or a damaged or misnamed file, is in `skill-registrations/<name>/`. If it says a newer Flightdeck, update Flightdeck; otherwise delete or fix that file. `flightdeck skill register` refuses until then, so it never registers past it.
- **Not every revision could be listed:** `skills/`, `skill-registrations/` or `skill-registrations/<name>/` can't be listed (a permissions error, a link, or a folder still syncing), or holds more registrations than a copy reads. Fix the folder's permissions or let it finish syncing, and remove registrations nobody uses. Until it lists in full, no revision of the skill is current and `flightdeck skill register` refuses.
- **Name mismatch:** `skills/<name>.json` records another skill's name, or a file in `skill-registrations/<name>/` says another name or id than its folder or file name. Rename the file to the name it records (or fix the name inside it). Until then `flightdeck skill register` refuses, so it never replaces another skill's file.
- **Needs review:** two computers registered the skill at the same time. Compare the two files in `skill-registrations/<name>/`, delete the wrong one, then register again so the current revision is clear.
- **Still arriving:** wait for OneDrive to finish syncing `skill-registrations/`. If it never arrives, register the skill again.
- **The version isn't there:** if the version folder is still syncing, wait. If it was deleted or replaced, rebuild or check the skill against a version in the folder and register it again with that version's folder.

**What not to do:** don't write or edit files in `skill-registrations/` by hand, and don't change a pointer in `skills/` back to a version number: older copies of Flightdeck would then match it to whatever has that number. `flightdeck skill register` is the only way to write a registration.

## A report can't be accepted

**What you see:** a report from another app on a run's step that has no **Accept** button, with one of these, or Folder health's "Some reports from other apps can't be used":

- "Two copies of this report differ (…), so neither can be accepted. Delete the wrong one."
- "This report can't be read: …" (not complete JSON, not UTF-8 text, over 64 KB, or a property this copy doesn't know).
- "This report was made with a newer Flightdeck." (Folder health lists it under what a newer Flightdeck wrote.)
- "Doesn't match: it examined env staging; the run's env is prod."
- "Accepted, but the report it accepted is gone or changed."
- A report naming a run that isn't in the folder.

**What it means:** a report is a claim another app wrote once. Flightdeck checks a step from a report only when a person accepts one it can read in full, whose copies agree, for the run's own version, whose inputs don't contradict the run. Anything else is shown and never used. An acceptance names the SHA-256 of the exact bytes accepted, so a report changed after it was accepted no longer matches.

**What to do:**

- **Copies differ:** OneDrive kept two versions of one report. Compare them, delete the one the app didn't write, and the other can be accepted.
- **Can't be read:** if it may still be arriving, wait and refresh. Otherwise ask the app that wrote it to write a new report (`flightdeck report check` says what's wrong with one before it's written); never edit a report by hand.
- **Doesn't match, or a run that isn't here:** the app examined something else. Ask it to write a report for this run, or check the step yourself.
- **Gone or changed after acceptance:** the step stays checked, and the run's log names the report and its SHA-256. If the report was replaced by mistake, restore it from a backup; otherwise check the step again from a new report or by hand.

**What not to do:** don't edit or rename files in `reports/` or `report-decisions/`. An edited report is a different report, and a decision file names exactly one.

## A plan or a linked run won't start on its version

**What you see:** "This plan starts on Release v3 (v3-…), which can't be used here: …. It won't start on another version by itself." on a planned run, or "This step runs Check in code v4, which can't be used here: …" on a step that starts another process.

**What it means:** the plan, or the version of the checklist, names one exact version, and that version folder is missing, replaced by another folder with the same number, published twice under that number, or damaged. Flightdeck 2.0 never quietly starts the latest instead.

**What to do:** if the folder is still syncing, wait and refresh. For a plan, if the version is really gone, choose **Start on v6 instead**: that switch is recorded in the team folder, and the plan then starts on that version on every computer. For a linked step, publish a new version of the checklist whose `version:` names a version that's in the folder, or start a new run. If two folders have the same number, delete the one that's wrong (see [A file can't be read](#a-file-cant-be-read)).

## A step says "Continued in run"

**What you see:** a step that starts another process is Blocked, "Continued in run release/…", in a run made with an older Flightdeck, and Reopen says it continues in that run.

**What it means:** the other process's newest version needs Flightdeck 2.0, which a run made with Flightdeck 1.x can't follow. Someone chose **Start it as a Flightdeck 2.0 run**: a new run of the same version, with the same details and roles and no answers, which starts the other process on its exact version. The old run stays as it was, readable by every copy.

**What to do:** carry on in the new run. End the old one when you're ready (Cancelled, with a note pointing to the new run, is usual).
