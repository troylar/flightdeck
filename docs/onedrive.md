# Flightdeck and OneDrive

> **For:** whoever sets up a team folder, and anyone curious how a shared folder can be a safe backend.
>
> **You'll get:** the setup, the rules that keep runs safe while OneDrive syncs, what refreshing costs, and the limits nobody can engineer away.

Flightdeck reads and writes files in the team folder on your computer. OneDrive carries them between computers, usually within seconds, sometimes a minute or more. Flightdeck can't make that faster, so it's honest about it.

In short:

- **Every file has one writer**, so OneDrive never has to merge two saves.
- **Every run save checks first and leaves a save receipt**, so a run save that loses a race is kept as a copy, never silently dropped. A draft save that finds a change writes nothing.
- **A gate is a record, not a lock.** It means "passed for this commit, by this person, at this time."

**On this page:** [Set up](onedrive.md#set-up) · [What keeps runs safe](onedrive.md#what-keeps-runs-safe) · [What refreshing costs](onedrive.md#what-refreshing-costs) · [What it can't promise](onedrive.md#what-it-cant-promise) · [Older copies](onedrive.md#older-copies) · [Who writes the other files](onedrive.md#who-writes-the-other-files) · [Release gate](onedrive.md#release-gate-the-two-computer-rehearsal)

## Set up

1. Put the team folder in OneDrive and mark it **Always keep on this device** on every computer.
2. Open `flightdeck.html` in Edge or Chrome. On the welcome screen:
   - **The first person** chooses **Start your team**, then **Choose the folder** and picks an empty folder (Flightdeck checks it can save there), adds the team's people and a backup owner, and chooses **Create the team folder**.
   - **Everyone else** chooses **Join your team's folder**, then **Open team folder**, picks the same folder and chooses who they are.
   - **Look around the examples** opens a made-up team kept in this browser only.
3. Later, **Settings → Change team folder** switches to another folder (it says **Open team folder** while none is open).

## What keeps runs safe

- **One writer per file.** The recorder's window writes `run.json`; each window writes its own `notes-<window>.jsonl` (notes and corrections) and `history-<window>.jsonl`, and names every attached file it adds in the run's `files/` folder after itself; publishing writes a new folder every time. That keeps ordinary use conflict-free. **It is a discipline, not a guarantee:** two computers that can't see each other's changes yet can still both write.
- **One recorder per run.** Other windows are read-only for the run itself.
  - **Hand off** saves the run and names the exact revision being passed on. The old window stops writing at once. The new recorder sees the handoff only once that revision has synced to their computer, and their log says which revision they picked up.
  - **Take over recording** is for emergencies. If the old recorder's computer still has changes OneDrive hasn't delivered, they arrive as a **conflict copy**, and someone has to choose.
- **Every save leaves a save receipt.** Before writing `run.json`, a window writes its version to its own `candidate-<window>-<save>.json`, and `run.json` lists the saves it includes. Windows on one computer save one at a time (Web Locks); two browsers or two computers can't take turns, so if one save replaces another, the replaced save's candidate isn't on the list and shows up in the run as a conflict copy after a minute. Candidates that made it in are cleaned up by the next save.
- **A check before every save.** If `run.json` changed at all since this window read it (another save, a sync, an unreadable file), Flightdeck doesn't overwrite it. It compares a SHA-256 of the file's exact text, from 2.1; `people.json` and step types are saved only over the exact text that was read. It switches to the other version and **writes yours next to it as `run.conflict-<window>-<time>.json`**.
- **Conflict copies are reviewed in the app.** A run with other versions shows a panel listing each one: **Compare** (what differs: answers, evidence, filled-in values, gates, details, roles, follow-ups and outcome), **Keep this one** (recorder only; the current version is first saved beside it as `replaced-*.json`, then the copy becomes the next revision, and its file is removed only after that save succeeds), and **Delete**. A copy of another run or another checklist version can't be kept. OneDrive's own copies (`run-<COMPUTER>.json`) appear there too. Nothing is merged automatically.
- **Half-synced publications are refused.** A version can't be used until all its files have arrived and match. Reference screenshots are copied into the version (a phase's and a gate's too, from 2.0, each checked against the version's payload), so replacing an image later never changes an old version.
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
- **Applying a proposal on two computers:** each window records an attempt before it applies anything, and windows on one computer take turns. A window on another computer that started before the first attempt reached it can still apply the same proposal a second time; once both computers sync, the proposal shows **Applied twice**. When two computers have the draft open, take back an assistant's change with **Decline** on the process page rather than undoing it in the editor. The same holds for a change applied live in the main editor: each computer's main editor decides from the presence files it has received, so two computers can each apply it once before they sync.
- **A write in the gap:** a shared folder has no atomic compare-and-swap. A hand edit, an older copy of Flightdeck or a direct file write that lands between Flightdeck's final check and its write can still be replaced, as before 1.19.
- **Clocks:** each computer's clock can be slightly off. Deadlines come from the real tool (for example Jenkins), not from Flightdeck.

## Older copies

Teammates won't all update on the same day. Every Flightdeck from 1.11.1 on refuses a file in a format it doesn't know: it shows it by name, never writes it, and refuses to save over it, writing nothing. From 1.21 on it also says which Flightdeck the file needs and lists those files in Folder health. Two things it can't do, because older copies can't be changed:

- Copies older than 1.11.1 (1.10.0 and 1.11.0) have no format check: they may hide runs made with Flightdeck 2.0 and offer a 2.0 version as the latest.
- A change an older window couldn't save stays in that window only. It can't be restored from there; re-enter it in a newer Flightdeck.

So move every computer to 1.21 before anyone records on a Flightdeck 2.0 version (see [Updating Flightdeck](updating.md#when-computers-run-different-versions)). To rehearse it, run the [two-computer rehearsal](rehearsals/README.md) with one computer on 1.21 and one on 2.0.

## Who writes the other files

| File | Writer |
|---|---|
| `maps/drafts/*.md` | One person in Flightdeck's editor, or an AI assistant through `flightdeck draft save`, which writes only when no editor this computer can see has the draft open and the draft is exactly the text it read; otherwise the change becomes a proposal. Flightdeck saves only over the exact text it opened, but two editors at once can still produce a OneDrive copy; keep one. |
| `proposed/<process>/<operation>.json` | The `flightdeck draft` command, once per proposal (created exclusively, never changed or deleted). |
| `proposed/<process>/<proposal>.<window>.<rev>.json`, `<proposal>.attempt.<window>.<n>.json` | The window that decided (applied, declined, reopened) or started applying the proposal, once each. |
| `presence/<window>.json` | The window it's named for, every 10 seconds while it holds a draft editor. From 1.21 on it says which Flightdeck that window runs (`app`), for Folder health's "Teammates are using an older Flightdeck". **The second exception to one writer per file:** any window that writes presence may delete files there older than 24 hours (at most 20 at a time), after checking they didn't change. |
| `people.json` | One named person on the team. Edit it, save, and let it sync before anyone else edits it. |
| `proposals/*.json` | An AI assistant writes its plans; a window writes each plan a person makes as a new file, once, and never over one that's there; `flightdeck plan request` writes each request from another app (`req-<tool>-<hash>.json`) once, never over a file that's there. Each person's decision is its own `*.status-<window>.json`. Two computers that request the same key while disconnected each write it, and OneDrive keeps both (see [A planned run arrived twice](recovery.md#a-planned-run-arrived-twice)). |
| `publications/` | Flightdeck, one new folder per publish. Never edited. |
| `staged/<process>/stage-<random>/` | Flightdeck, one new folder per stage (2.1). Never edited; made the default by copying it into `publications/`. |
| `staged/<process>/decisions/<stage>.<window>.<rev>.json` | Each retire or reopen is a new file named for the window and the decision's number (2.1). Never edited. |
| `validations/<process>.v<N>.<window>.json`, `validations/<process>.<stage>.<window>.json` | The window that signed off a version, or a staged version (2.1), named for that window. |
| `step-types/*.json` | One person in Flightdeck's Step types form, or an AI assistant. Saved only over the file the form opened. |
| `runs/<process>/<id>/notes-<window>.jsonl` | The window it's named for: its notes and its corrections (a correction is a note with `kind: "correction"`). Older copies show a correction as a plain note and keep its files; 1.13 to 1.21 show a correction on a phase's or a gate's note (2.0, `cv: 2`) as a described problem. |
| `runs/<process>/<id>/files/*` | The window that attached the file, named with the time, a random part and that window, so two windows never write the same name. Written once. |
| `corrections/<process>/<group>.<window>.<rev>.json` | Each decision on a correction is a new file named for the window and the decision's `rev`, written once; nobody edits another's, or their own. Two decided at once both stay, and the app says Needs review. |
| `suggestions/<process>/*.json` | Decisions on suggested fixes from before 1.13. Read, no longer written. |
| `followups/<process>/<run>.<follow-up>.<window>.<rev>.json` | What became of a follow-up (done, moved to a ticket or another run, won't do, reopened): a new file per decision, named for the window and the decision's `rev`, written once by whoever decided. `run.json` never changes. Two decided at once both stay, and the app says Needs review. Copies before 1.16 never read the folder. |
| `reports/<process>/<run>.<step>.<tool>.<id>.json` | The tool that did the work, once, through `flightdeck report write` (created exclusively, read back byte for byte, never replaced). Nobody edits or deletes one. OneDrive's copy of a report is the same report; copies whose bytes differ can't be accepted until a person deletes the wrong one. Copies before 2.0 never list the folder. |
| `report-decisions/<process>/<run>.<hash>.<window>.<rev>.json` | The recorder's window, once per decision (accepted, declined, reopened). An acceptance's decision is written only after the run's save holds the accepted answer. Two decided at once both stay, and the app says Needs review. Copies before 2.0 never list the folder. |
| `AGENTS.md` | Between its `flightdeck:begin` and `flightdeck:end` markers: `flightdeck install`, run by the person who updates Flightdeck. Below them (Team notes): the team, one person at a time. |
| `.flightdeck/skills/**` | `flightdeck install` or `flightdeck skills`, run by the person who updates Flightdeck. A team that changes a skill keeps one person editing it. |
| `.flightdeck/installed.json` | `flightdeck install` or `flightdeck skills`, and Flightdeck once when it starts a new team folder. Records which defaults the folder's AGENTS.md and skills are based on. |
| `.flightdeck/updates/<version>/` | `flightdeck install` or `flightdeck skills`: new defaults waiting to be merged, with a README.md, and copies of the files `--force` replaced. The person merging (or their AI assistant) deletes each copy when it's merged. |
| `history/drafts/<process>/<window>.jsonl`, `history/step-types/<id>/<window>.jsonl` | The window it's named for: one line appended after each of its successful saves of that draft or step type (`<window>-2.jsonl` and on past 512 KB). Never rewritten or deleted. An AI assistant may append to its own `agent-<name>.jsonl` there and never touches the others. Read only when someone opens History; older copies never list `history/`. |
| `connection/probe-<time>-<id>.<window>.json` | The window that sent the connection check, once. |
| `connection/ack-<check id>.<window>.json` | The window that answered that check, once. |
| `connection/` files older than 7 days | **The one exception to one writer per file:** any Flightdeck window may delete them when it sends a check. Nobody waits on a check that old, and only checks from the last 15 minutes are ever read. AI assistants never touch `connection/`; older copies of Flightdeck never read it. |

## Release gate: the two-computer rehearsal

A release that changes storage, how the folder is written, or how syncs and reads are applied ships only after two people rehearse it on real OneDrive, or with a recorded waiver. That's for whoever ships Flightdeck, not for setting up a team folder: the gate, the script, and the templates for a rehearsal record or a waiver are in [Two-computer rehearsals](rehearsals/README.md).
