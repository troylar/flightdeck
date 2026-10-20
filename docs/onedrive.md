# Flightdeck and OneDrive

Flightdeck reads and writes files in the team folder on your computer. OneDrive carries them between computers, usually within seconds, sometimes a minute or more. Flightdeck can't make that faster, so it's honest about it.

## Set up

1. Put the team folder in OneDrive and mark it **Always keep on this device** on every computer.
2. Open `flightdeck.html` in Edge or Chrome, choose **Open team folder**, and pick it.

## What keeps runs safe

- **One writer per file.** The recorder's window writes `run.json`; each window writes its own `notes-<window>.jsonl` (notes and corrections) and `history-<window>.jsonl`, and names every attached file it adds in the run's `files/` folder after itself; publishing writes a new folder every time. That keeps ordinary use conflict-free. **It is a discipline, not a guarantee:** two computers that can't see each other's changes yet can still both write.
- **One recorder per run.** Other windows are read-only for the run itself.
  - **Hand off** saves the run and names the exact revision being passed on. The old window stops writing at once. The new recorder sees the handoff only once that revision has synced to their computer, and their log says which revision they picked up.
  - **Take over** is for emergencies. If the old recorder's computer still has changes OneDrive hasn't delivered, they arrive as a **conflict copy**, and someone has to choose.
- **Every save leaves a receipt.** Before writing `run.json`, a window writes its version to its own `candidate-<window>-<save>.json`, and `run.json` lists the saves it includes. Windows on one computer save one at a time (Web Locks); two browsers or two computers can't take turns, so if one save replaces another, the replaced save's candidate isn't on the list and shows up in the run as a conflict copy after a minute. Candidates that made it in are cleaned up by the next save.
- **A check before every save.** If `run.json` changed at all since this window read it (another save, a sync, an unreadable file), Flightdeck doesn't overwrite it. It switches to the other version and **writes yours next to it as `run.conflict-<window>-<time>.json`**.
- **Conflict copies are reviewed in the app.** A run with other versions shows a panel listing each one: **Compare** (what differs: answers, evidence, filled-in values, gates, details, roles, follow-ups and outcome), **Keep this one** (recorder only; the current version is first saved beside it as `replaced-*.json`, then the copy becomes the next revision, and its file is removed only after that save succeeds), and **Delete**. A copy of another run or another checklist version can't be kept. OneDrive's own copies (`run-<COMPUTER>.json`) appear there too. Nothing is merged automatically.
- **Half-synced publications are refused.** A version can't be used until all its files have arrived and match. Reference screenshots are copied into the version, so replacing an image later never changes an old version.
- **A newer Flightdeck's files are left alone.** A version or run written by a newer copy, with features this copy doesn't understand, shows "Update Flightdeck to run it": the version can't be started and the run opens read-only. Every save also checks the run's own version record, so one replaced in the folder by a newer copy can't be recorded on, even before the next full refresh lists it as unusable. Put the newest `flightdeck.html` in the team folder when anyone updates.
- **Each folder keeps to itself.** Switching folders discards anything still being read from the old one; a save always goes to the folder its change was made in; changes kept in this browser are filed under their folder's name.
- **An unreadable folder isn't an empty one.** If OneDrive or permissions stop Flightdeck reading the folder, it keeps showing what it last read, says when that was, and offers **Try again**. If only part of it can't be read (one run, the skills), that part keeps what was read before, everything else refreshes, and Folder health and the Runs page name what couldn't be read.
- **Folder health and the connection check.** **Settings → Folder health** reads every file on request and lists what needs a person (conflict copies, OneDrive's second copies, files that can't be read, versions still arriving after 2 hours, hand-offs nobody picked up, runs nobody saved for a week, clocks that are off, a folder getting big), each with one thing to do. **Settings → Connection check** sends a small file from this computer and times another computer's answer, so you can see files travel both ways before a release. It proves the trip happened just now; it doesn't promise the next one will be as quick.

## What refreshing costs

While a run is open, Flightdeck rereads that run and its notes every 5 seconds (about four files). The rest of the folder refreshes every 30 to 60 seconds, and how much each run costs depends on how long it's been, measured on both this computer's timer and its clock, whichever says more time has passed. Setting the clock back never delays anything (a small step back, as time sync makes, is ignored; a big one makes Flightdeck read everything again), and time the computer spent asleep counts:

- **Running runs and runs that ended in the last week** have their file sizes and times checked on every refresh, and are read again as soon as either changes.
- **A finished run is checked at least every 10 minutes and read in full at least every hour; a running run, at least every 5 minutes, including the one you have open, and however often you save or add notes yourself.** The checks are spread out, a share on each refresh, never all at once. Size and time are only a shortcut: an edit that keeps a file's size and time (which some sync tools and editors can do) still shows up by the next full read.
- **Decisions** (corrections and follow-ups) are listed on every refresh. A new one is read at once; one already read is read again at least every hour; one that couldn't be read is tried on every refresh.
- **Refresh** in the top bar reads everything now. So does **Folder health**.
- While the tab is hidden, or Flightdeck is busy saving, nothing is read. When you come back, whatever went past its time while you were away is read first.

The first time a big folder opens, runs appear as they're read, running runs first when Flightdeck already knows them, and Home and Runs say "Still reading runs (640 of 2,000)". A run not read yet is never shown as gone. Opening a folder reads each file once, with its size and time from the same read, and pictures are read only when they scroll into view, a few at a time. **Folder health** says when refreshing has been slow on this computer three times in a row. On a synthetic folder of 2,000 runs, a routine refresh costs about 1,750 folder calls instead of about 10,000, and opening it about 14,600 instead of 32,600. A routine refresh also lists `connection/` and reads only the checks from the last 15 minutes; the Connection check page does that every 5 seconds while it's open. **Folder health** lists and checks every file, so it runs only when you open it or choose Check again.

## What it can't promise

- **Freshness:** another screen may be a minute behind. Each run shows three separate facts: when this computer saved, when it last checked the folder, and whether it can read the folder at all. None of them proves another computer has the change yet.
- **Gates aren't locks:** a gate means "passed for this commit, by this person, at this time". It doesn't mean nobody changed anything since. People confirm irreversible actions themselves.
- **Who's editing:** "Being edited by" shows the editors this computer can see right now. Another computer's editor can arrive late, and a tab in the background may stop saying it's there, so an AI assistant can still write a draft directly while someone elsewhere has unsaved changes. Their save is then refused with Keep mine / Take theirs; nothing of theirs is lost.
- **Applying a proposal on two computers:** each window records an attempt before it applies anything, and windows on one computer take turns. A window on another computer that started before the first attempt reached it can still apply the same proposal a second time; once both computers sync, the proposal shows **Applied twice**. When two computers have the draft open, take back an assistant's change with **Decline** on the process page rather than undoing it in the editor.
- **A write in the gap:** a shared folder has no atomic compare-and-swap. A hand edit, an older copy of Flightdeck or a direct file write that lands between Flightdeck's final check and its write can still be replaced, as before 1.19.
- **Clocks:** each computer's clock can be slightly off. Deadlines come from the real tool (for example Jenkins), not from Flightdeck.

## Who writes the other files

| File | Writer |
|---|---|
| `maps/drafts/*.md` | One person in Flightdeck's editor, or an AI assistant through `flightdeck draft save`, which writes only when no editor this computer can see has the draft open and the draft is exactly the text it read; otherwise the change becomes a proposal. Flightdeck saves only over the exact text it opened, but two editors at once can still produce a OneDrive copy; keep one. |
| `proposed/<process>/<operation>.json` | The `flightdeck draft` command, once per proposal (created exclusively, never changed or deleted). |
| `proposed/<process>/<proposal>.<window>.<rev>.json`, `<proposal>.attempt.<window>.<n>.json` | The window that decided (applied, declined, reopened) or started applying the proposal, once each. |
| `presence/<window>.json` | The window it's named for, every 10 seconds while it holds a draft editor. **The second exception to one writer per file:** any window that writes presence may delete files there older than 24 hours (at most 20 at a time), after checking they didn't change. |
| `people.json` | One named person on the team. Edit it, save, and let it sync before anyone else edits it. |
| `proposals/*.json` | An AI assistant writes its plans; a window writes each plan a person makes as a new file, once, and never over one that's there. Each person's decision is its own `*.status-<window>.json`. |
| `publications/` | Flightdeck, one new folder per publish. Never edited. |
| `step-types/*.json` | One person in Flightdeck's Step types form, or an AI assistant. Saved only over the file the form opened. |
| `runs/<process>/<id>/notes-<window>.jsonl` | The window it's named for: its notes and its corrections (a correction is a note with `kind: "correction"`). Older copies show a correction as a plain note and keep its files. |
| `runs/<process>/<id>/files/*` | The window that attached the file, named with the time, a random part and that window, so two windows never write the same name. Written once. |
| `corrections/<process>/<group>.<window>.<rev>.json` | Each decision on a correction is a new file named for the window and the decision's `rev`, written once; nobody edits another's, or their own. Two decided at once both stay, and the app says Needs review. |
| `suggestions/<process>/*.json` | Decisions on suggested fixes from before 1.13. Read, no longer written. |
| `followups/<process>/<run>.<follow-up>.<window>.<rev>.json` | What became of a follow-up (done, moved to a ticket or another run, won't do, reopened): a new file per decision, named for the window and the decision's `rev`, written once by whoever decided. `run.json` never changes. Two decided at once both stay, and the app says Needs review. Copies before 1.16 never read the folder. |
| `AGENTS.md` | Between its `flightdeck:begin` and `flightdeck:end` markers: `flightdeck install`, run by the person who updates Flightdeck. Below them (Team notes): the team, one person at a time. |
| `.flightdeck/skills/**` | `flightdeck install` or `flightdeck skills`, run by the person who updates Flightdeck. A team that changes a skill keeps one person editing it. |
| `.flightdeck/installed.json` | `flightdeck install` or `flightdeck skills`, and Flightdeck once when it starts a new team folder. Records which defaults the folder's AGENTS.md and skills are based on. |
| `.flightdeck/updates/<version>/` | `flightdeck install` or `flightdeck skills`: new defaults waiting to be merged, with a README.md, and copies of the files `--force` replaced. The person merging (or their AI assistant) deletes each copy when it's merged. |
| `history/drafts/<process>/<window>.jsonl`, `history/step-types/<id>/<window>.jsonl` | The window it's named for: one line appended after each of its successful saves of that draft or step type (`<window>-2.jsonl` and on past 512 KB). Never rewritten or deleted. An AI assistant may append to its own `agent-<name>.jsonl` there and never touches the others. Read only when someone opens History; older copies never list `history/`. |
| `connection/probe-<time>-<id>.<window>.json` | The window that sent the connection check, once. |
| `connection/ack-<check id>.<window>.json` | The window that answered that check, once. |
| `connection/` files older than 7 days | **The one exception to one writer per file:** any Flightdeck window may delete them when it sends a check. Nobody waits on a check that old, and only checks from the last 15 minutes are ever read. AI assistants never touch `connection/`; older copies of Flightdeck never read it. |

## Release gate: the two-computer rehearsal

The tests simulate two computers on a slow OneDrive, but only real OneDrive shows how it really behaves. So a release that could change how files travel between computers ships only after two people (or one person with two computers) rehearse it on real OneDrive and write down what happened.

**When it's required:** every minor or major release that touches `src/storage/`, the run or notes file formats, saving or sync code in `src/ui/app.js`, or the connection check. A patch that touches none of these doesn't need one. When in doubt, rehearse.

**What ships with the release:** a record in `docs/rehearsals/<version>-<date>.md`, made from the results template below. Use synthetic names in it (Avery, Blake), not the testers' real names. A release with a step that failed ships only once the failure is fixed and that part rehearsed again, or with the failure listed under its known limits.

### The script (about 35 minutes)

Two computers, A and B, both signed in to OneDrive with the same shared test folder synced locally (**Always keep on this device**), Edge or Chrome on each, and the same Flightdeck version on both (check What's new). Use a test copy of the team folder, never the real one. Write down anything that doesn't match "Expect", and the delays you see.

**Before you start (3 min)**

0. On both computers open **Settings → Connection check**. On A, **Send a check**. Expect on A, within about a minute: "<B's person> · <B's computer> saw check 1 …" with both legs timed. Then send one from B. Expect on B: A's answer, and on A, under Checks from other computers, "Their computer has your answer" once B's next check arrives. Note both round-trip times in the Delay column. If the page says the clocks differ, note that too.
1. On A: open `flightdeck.html`, choose **Open team folder**, and choose yourself under You are. Expect: the processes load.
2. On B: the same, choosing a different person. Expect: the same processes.
3. Note the version shown in What's new on both, and the OneDrive version (OneDrive menu → Settings → About).

**A normal run (10 min)**

4. A: start a run of the release checklist. Expect on B within about 30 seconds: the run appears under Runs.
5. B: open the run. Expect: B follows ("Casey is recording. You can add notes.").
6. A: check two steps. Expect on B within about 10 seconds: both show done, and the revision number matches A's.
7. B: add a note with an attachment (a screenshot) on step 3. Expect on A: the note and its thumbnail appear, and opening the image works.
   - 7b. Pause OneDrive on B. On B, add another note with an attachment, then resume OneDrive. Expect on A: the note may arrive before its file, showing **Missing**; the thumbnail replaces it once the file arrives.
8. A: add a note on the same step. Expect on B: both notes, in order.
9. A: change a run detail (the commit) in Details. Expect on both: the steps tied to it go back to re-check.
10. A: mark a step Blocked with a reason, then unblock it. Expect on B: both changes, with the reason.
11. A: **Correct this step** on one step (change the wording). B: the same on another step. Expect on both computers: both show in the process page's Corrections panel.
12. A: **Hand off**. B: **Pick up recording**. Expect: B records and A follows; B continues from A's revision.
    - 12b. B: close the browser in the middle of the run and open it again. Choose **Reconnect** if Flightdeck asks, open the run, then **Record here**. Expect: B records again from the latest revision, and nothing B did before closing is missing.
13. B: pass a gate, finish the run, and open the Receipt. Expect: the same receipt on A after sync.

**A bad night (14 min)**

14. B: start a second run and check one step. Wait until A shows it.
15. Pause OneDrive on B (OneDrive menu → Pause syncing → 2 hours).
16. B: check two more steps. They're saved on B only.
17. A: open that run, choose **Take over** (emergency), and check one different step.
18. Resume OneDrive on B. Wait one to two minutes.
19. Expect on both: the run shows a conflict copy panel (**Compare copies**). Nothing is silently lost: every step checked on A and B is in one of the copies.
20. Recorder: compare, keep the right copy, and delete the other. Expect: both computers settle on the kept copy; the deleted copy's answers stay visible in the comparison until it's deleted.
21. Pause OneDrive on A and edit a draft in the builder, then Save. On B, edit the same draft and Save. Both saves succeed: neither computer can see the other's change yet. Resume A. Expect: OneDrive keeps both versions, one of them as a copy with a computer's name (`release-LAPTOP.md`). Nothing is silently lost: both edits are in one of the two files. Resolve it as in [When something goes wrong](recovery.md#onedrive-made-a-copy-of-a-draft-peoplejson-or-a-step-type). Expect **Settings → Folder health** to list both drafts under Needs action.
    - 21b. With both computers syncing, open the same draft on A and B. On B, make an edit and don't save it yet. Then A edits and saves. Wait until A's save has reached B, then save on B. Expect on B: the save is refused with "Someone else changed this draft", offering Keep mine and Take theirs. Undo never brings back text over A's change.
    - 21c. On B, an AI assistant saves the draft with `flightdeck draft save` while A has the draft open in its editor (wait until A's "Being edited by" shows on B first). Expect: the command says `proposed` with `why` `open`; on A, the editor says "Your AI assistant proposed changes" and the process page lists it. On A: **Review**, then **Apply**. Expect on both: the draft has the change, and the proposal shows **Applied**.
    - 21e. Pause OneDrive on A and type in its editor without saving. On B, close every editor, then have the assistant save the draft (B can't see A's editor, so it writes directly). Resume A, then save on A. Expect on A: "Someone else changed this draft" with Keep mine and Take theirs; A's text is still there.
    - 21f. Open the same draft on A and B. On A, choose **Make this the main editor**. Expect on B, within a minute: "… made their editor the main one for this draft. You can still edit and save."
- P. Pause OneDrive on A. Publish a new version of a checklist on A, then resume. Expect on B: until every file of the new version has arrived, the version is either not there or shown as still syncing. It's never offered for a run before it's complete.
- R. With a run open on both computers, restore that run's `run.json` to an earlier version from OneDrive's version history (on the OneDrive website: the run's folder → `run.json` → Version history → Restore). Then the recorder checks a step. Expect: the save is refused and a conflict copy appears; both the restored version and the recorder's are there to compare. Nothing is silently lost.

**Corrections from both computers (6 min)**

22. A: in a running run, **Correct this step**'s wording and attach a log. Expect on B: it shows in the run's Corrections and on the process page, with the file. Then B corrects the same step with the same wording (spacing may differ; letter case may not). Expect: the process page shows one group with both people. Then pause OneDrive on the recorder's computer, mark a step **Done differently** with **Fix the checklist too**, and resume. Expect: the answer and its correction both arrive, and the receipt joins them.
23. Pause OneDrive on both computers. Both: open the process page's Corrections panel and pick the same open group. A: **Mark as applied**. B: **Decline** with a reason. Resume both. Expect on both: both decisions arrive and the group shows **Needs review**, listed under Open, never silently decided. Also check that **Withdraw** is offered only to the person who suggested every correction in the group.

**Accounting tally (2 min).** Go through every answer and note entered on either computer during the rehearsal. Each one must be in the run, in a conflict copy, or in a `replaced-*.json` file. One that's in none of them is a failed rehearsal, whatever else passed.

What the app can't prove for you: how long OneDrive takes to deliver a change, and that nobody acted on something's old state in the meantime. That's why the record notes the delays you saw.

### Results template

Copy this into `docs/rehearsals/<version>-<date>.md` and fill it in.

```markdown
# Two-computer rehearsal: Flightdeck <version>

- Version and commit: <version> (<git SHA>)
- Date: <YYYY-MM-DD>
- Tester(s): <synthetic names, for example Avery and Blake>
- Computer A: <OS>, <browser and version>
- Computer B: <OS>, <browser and version>
- OneDrive client version: <A> / <B>
- Test folder: <name>
- Sync conditions: <same network or not, VPN, anything unusual>

| # | Expect | Result (OK / what happened) | Delay seen | Evidence file |
|---|---|---|---|---|
| 0 | Each computer's connection check answered by the other | | | |
| 1 | Processes load on A | | | |
| 2 | Same processes on B | | | |
| 3 | Same version on both | | | |
| 4 | New run appears on B | | | |
| 5 | B follows | | | |
| 6 | Two steps done on B, same revision | | | |
| 7 | Note and thumbnail on A; image opens | | | |
| 7b | Missing, then the thumbnail | | | |
| 8 | Both notes on B, in order | | | |
| 9 | Commit change re-checks its steps on both | | | |
| 10 | Blocked and unblocked on B, with the reason | | | |
| 11 | Both corrections on both computers | | | |
| 12 | B records from A's revision | | | |
| 12b | Record here after reopening; nothing missing | | | |
| 13 | Same receipt on A | | | |
| 14 | Second run's step shows on A | | | |
| 15-18 | Paused B, take over on A, resumed | | | |
| 19 | Compare copies on both; every answer in a copy | | | |
| 20 | Both settle on the kept copy | | | |
| 21 | Both offline saves kept: the draft plus a OneDrive copy | | | |
| 21b | Save after A's change arrived is refused; Undo safe | | | |
| 21c | Proposal from B listed on A and applied once | | | |
| 21e | Late presence: direct write; A's save refused, A's text kept | | | |
| 21f | Main editor claim seen on B | | | |
| P | Half-synced version never usable on B | | | |
| R | Restored run.json gives a conflict copy | | | |
| 22 | Corrections group with both people; Done differently joined | | | |
| 23 | Needs review under Open on both; Withdraw only for the suggester | | | |

- Accounting tally: <every answer and note found: yes, or what's missing>
- Mismatches filed: <issue links>
- Verdict: <Pass / Pass with known limits (list them) / Fail>
```
