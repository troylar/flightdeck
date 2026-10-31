# Two-computer rehearsals

> **For:** whoever ships a Flightdeck release. Teams setting up a folder don't need this page; see [Flightdeck and OneDrive](../onedrive.md).
>
> **You'll get:** when a release needs a rehearsal on real OneDrive, the script, how to record the result, and how a waiver is recorded instead.

The tests simulate two computers on a slow OneDrive, but only real OneDrive shows how it really behaves. So a release that could change how files travel between computers ships only after two people (or one person with two computers) rehearse it on real OneDrive and write down what happened.

**On this page:** [The release gate](#the-release-gate) · [Records](#records) · [Waivers](#waivers) · [The script](#the-script-about-35-minutes) · [Results template](#results-template) · [Waiver template](#waiver-template) · [The records so far](#the-records-so-far)

## The release gate

**When it's required:** every minor or major release that touches `src/storage/`, the run or notes file formats, saving or sync code in `src/ui/app.js`, or the connection check. A patch that touches none of these doesn't need one. When in doubt, rehearse.

In `src/ui/app.js`, the saving and sync code includes how a run is saved and replaced (`mutateRun`, `canReplace`, `recover`), how a read of the folder is applied (`applyRunRead`, `useFs`), applying proposals (`acceptProposal`) and the save queue (`queued`).

## Records

Each rehearsal ships with the release as a record in this folder:

- `docs/rehearsals/<version>-<date>.md` for a rehearsal, made from the [results template](#results-template).
- `docs/rehearsals/<version>-<date>-waiver.md` for a waiver, made from the [waiver template](#waiver-template).

Use synthetic names in a record (Avery, Blake), not the testers' real names. A release with a step that failed ships only once the failure is fixed and that part rehearsed again, or with the failure listed under its known limits.

## Waivers

When a rehearsal can't be run, the project owner may waive it for that release. The waiver is the owner's decision, and it's recorded, never assumed. Its record says:

1. **Why it was required:** what in the release meets the gate above.
2. **What the rehearsal would have covered:** the script's steps, and any setup the release needs (for example one computer on the older version).
3. **What covers it instead:** the automated tests that cover it, all passing on the release commit.
4. **What remains unproven on real OneDrive:** what only a real two-computer rehearsal can show, and which steps still need a manual rehearsal.

A waived release is not rehearsed: its title says so ("Two-computer rehearsal waived (not rehearsed)").

## The script (about 35 minutes)

Two computers, A and B, both signed in to OneDrive with the same shared test folder synced locally (**Always keep on this device**), Edge or Chrome on each, and the same Flightdeck version on both (check What's new). Use a test copy of the team folder, never the real one. Write down anything that doesn't match "Expect", and the delays you see. Record the results in a copy of the [results template](#results-template).

**Before you start (3 min)**

0. On both computers open **Settings → Connection check**. On A, **Send a check**. Expect on A, within about a minute: "<B's person> · <B's computer> saw check 1 …" with both legs timed. Then send one from B. Expect on B: A's answer, and on A, under Checks from other computers, "Their computer has your answer" once B's next check arrives. Note both round-trip times in the Delay column. If the page says the clocks differ, note that too.
1. On A: open `flightdeck.html`, choose **Join your team's folder**, then **Open team folder**, pick the test folder, and choose yourself under **Who are you?** Expect: the processes load.
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
17. A: open that run, choose **Take over recording**, then **Take over** (emergency), and check one different step.
18. Resume OneDrive on B. Wait one to two minutes.
19. Expect on both: the run shows a conflict copy panel (**Compare copies**). Nothing is silently lost: every step checked on A and B is in one of the copies.
20. Recorder: compare, keep the right copy, and delete the other. Expect: both computers settle on the kept copy; the deleted copy's answers stay visible in the comparison until it's deleted.
21. Pause OneDrive on A and edit a draft in the builder, then **Save draft**. On B, edit the same draft and **Save draft**. Both saves succeed: neither computer can see the other's change yet. Resume A. Expect: OneDrive keeps both versions, one of them as a copy with a computer's name (`release-LAPTOP.md`). Nothing is silently lost: both edits are in one of the two files. Resolve it as in [OneDrive made a copy of a draft, people.json or a step type](../recovery.md#onedrive-made-a-copy-of-a-draft-peoplejson-or-a-step-type). Expect **Settings → Folder health** to list both drafts under Needs action.
    - 21b. With both computers syncing, open the same draft on A and B. On B, make an edit and don't save it yet. Then A edits and saves. Wait until A's save has reached B, then save on B. Expect on B: the save is refused with "Someone else changed this draft", offering Keep mine and Take theirs. Undo never brings back text over A's change.
    - 21c. On B, close the draft's editor, and wait until A shows no "Being edited by" for B (with two editors open and no main one, neither applies a proposal live). On A, open the draft in its editor and type a change without saving it (an editor with nothing unsaved applies a proposal live: that's 21d). Wait until A's "Being edited by" shows on B, then on B have an AI assistant save the draft with `flightdeck draft save`. Expect: the command says `proposed` with `why` `open`; on A, the editor says "Your AI assistant proposed changes while you have unsaved ones" and the process page lists it. On A: **Review**, then **Apply**. Expect: it's refused with "You have unsaved changes to this draft. Save or discard them in the editor first." Then **Discard my changes**. Expect: A is the only editor, so it's the main one and applies the change within a few seconds, as in 21d; on both, the draft has the change and the proposal shows **Applied**.
    - 21d. Open the draft on A only, with nothing unsaved (A shows no "Being edited by" for another window). On A's computer, have an AI assistant save the draft with `flightdeck draft save`. Expect: the command says `proposed` with `why` `open`; within a few seconds A's editor shows the change, its steps marked "Changed by your AI assistant", the header says Saved, and a screen reader hears "Your AI assistant changed this draft…" once without losing its place. Choose **Undo**: the earlier text is back, unsaved, and the draft file still has the change. Then on A choose **Redo** and wait for Saved, so nothing is unsaved. On B, open the draft too; once A shows B's editor, choose **Make this the main editor** on A, and wait until B shows A's claim. Then repeat with a new change from B's assistant: expect it to wait on B ("Your AI assistant proposed changes" with Review) unless B is the main editor, and to appear on A after OneDrive delivers it. Check the editor at 375 px: no sideways scroll.
    - 21e. Pause OneDrive on A and type in its editor without saving. On B, close every editor, then have the assistant save the draft (B can't see A's editor, so it writes directly). Resume A, then save on A. Expect on A: "Someone else changed this draft" with Keep mine and Take theirs; A's text is still there.
    - 21f. Open the same draft on A and B. On A, choose **Make this the main editor**. Expect on B, within a minute: "… made their editor the main one for this draft. You can still edit and save."

**Corrections from both computers (6 min)**

22. A: in a running run, **Correct this step**'s wording and attach a log. Expect on B: it shows in the run's Corrections and on the process page, with the file. Then B corrects the same step with the same wording (spacing may differ; letter case may not). Expect: the process page shows one group with both people. Then pause OneDrive on the recorder's computer, mark a step **Done differently** with **Fix the checklist too**, and resume. Expect: the answer and its correction both arrive, and the receipt joins them.
23. Pause OneDrive on both computers. Both: open the process page's Corrections panel and pick the same open group. A: **Mark as applied**. B: **Decline** with a reason. Resume both. Expect on both: both decisions arrive and the group shows **Needs review**, listed under Open, never silently decided. Also check that **Withdraw** is offered only to the person who suggested every correction in the group.

**Versions still arriving, and a restored run**

Steps 24 and 25 were called P and R in records before 2.6.1.

24. Pause OneDrive on A. Publish a new version of a checklist on A, then resume. Expect on B: until every file of the new version has arrived, the version is either not there or shown as still syncing. It's never offered for a run before it's complete.
25. With a run open on both computers, restore that run's `run.json` to an earlier version from OneDrive's version history (on the OneDrive website: the run's folder → `run.json` → Version history → Restore). Then the recorder checks a step. Expect: the save is refused and a conflict copy appears; both the restored version and the recorder's are there to compare. Nothing is silently lost.

**Accounting tally (2 min).** Go through every answer and note entered on either computer during the rehearsal. Each one must be in the run, in a conflict copy, or in a `replaced-*.json` file. One that's in none of them is a failed rehearsal, whatever else passed.

What the app can't prove for you: how long OneDrive takes to deliver a change, and that nobody acted on something's old state in the meantime. That's why the record notes the delays you saw.

## Results template

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
| 21d | Live apply in A's main editor: shown, saved, announced once, Undo local | | | |
| 21e | Late presence: direct write; A's save refused, A's text kept | | | |
| 21f | Main editor claim seen on B | | | |
| 22 | Corrections group with both people; Done differently joined | | | |
| 23 | Needs review under Open on both; Withdraw only for the suggester | | | |
| 24 | Half-synced version never usable on B | | | |
| 25 | Restored run.json gives a conflict copy | | | |

- Accounting tally: <every answer and note found: yes, or what's missing>
- Mismatches filed: <issue links>
- Verdict: <Pass / Pass with known limits (list them) / Fail>
```

## Waiver template

Copy this into `docs/rehearsals/<version>-<date>-waiver.md` and fill it in.

```markdown
# Two-computer rehearsal waived (not rehearsed): Flightdeck <version>

- Version: <version>
- Date: <YYYY-MM-DD>
- Decision: the project owner waived the two-computer rehearsal (docs/rehearsals/README.md) for this release.

## Why it was required

<what in this release meets the release gate>

## What the rehearsal would have covered

<the script's steps, and the setup this release needs>

## What covers it instead

<the automated tests, all passing on the release commit>

## What remains unproven on real OneDrive

<what only a real two-computer rehearsal shows, and the steps that still need a manual rehearsal>
```

## The records so far

All nine are waivers; no release has a rehearsal record yet.

- [1.22.0, 2026-10-20](1.22.0-2026-10-20-waiver.md)
- [2.0.0, 2026-10-21](2.0.0-2026-10-21-waiver.md)
- [2.1.0, 2026-10-22](2.1.0-2026-10-22-waiver.md)
- [2.1.1, 2026-10-23](2.1.1-2026-10-23-waiver.md)
- [2.8.0, 2026-10-27](2.8.0-2026-10-27-waiver.md)
- [2.9.0, 2026-10-27](2.9.0-2026-10-27-waiver.md)
- [2.10.0, 2026-10-27](2.10.0-2026-10-27-waiver.md)
- [2.11.0, 2026-10-28](2.11.0-2026-10-28-waiver.md)
- [2.11.1, 2026-10-31](2.11.1-2026-10-31-waiver.md)

Records written before 2.6.1 call steps 24 and 25 "P and R", and some name their sections a little differently ("What isn't proven on real OneDrive", "What still runs by hand").
