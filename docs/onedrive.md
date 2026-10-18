# Flightdeck and OneDrive

Flightdeck reads and writes files in the team folder on your computer. OneDrive carries them between computers, usually within seconds, sometimes a minute or more. Flightdeck can't make that faster, so it's honest about it.

## Set up

1. Put the team folder in OneDrive and mark it **Always keep on this device** on every computer.
2. Open `flightdeck.html` in Edge or Chrome, choose **Open team folder**, and pick it.

## What keeps runs safe

- **One writer per file.** The recorder's window writes `run.json`; each window writes its own `notes-<window>.jsonl` and `history-<window>.jsonl`; publishing writes a new folder every time. That keeps ordinary use conflict-free. **It is a discipline, not a guarantee:** two computers that can't see each other's changes yet can still both write.
- **One recorder per run.** Other windows are read-only for the run itself.
  - **Hand off** saves the run and names the exact revision being passed on. The old window stops writing at once. The new recorder sees the handoff only once that revision has synced to their computer, and their log says which revision they picked up.
  - **Take over** is for emergencies. If the old recorder's computer still has changes OneDrive hasn't delivered, they arrive as a **conflict copy**, and someone has to choose.
- **Every save leaves a receipt.** Before writing `run.json`, a window writes its version to its own `candidate-<window>-<save>.json`, and `run.json` lists the saves it includes. Windows on one computer save one at a time (Web Locks); two browsers or two computers can't take turns, so if one save replaces another, the replaced save's candidate isn't on the list and shows up in the run as a conflict copy after a minute. Candidates that made it in are cleaned up by the next save.
- **A check before every save.** If `run.json` changed at all since this window read it (another save, a sync, an unreadable file), Flightdeck doesn't overwrite it. It switches to the other version and **writes yours next to it as `run.conflict-<window>-<time>.json`**.
- **Conflict copies are reviewed in the app.** A run with other versions shows a panel listing each one: **Compare** (what differs: answers, evidence, filled-in values, gates, details, roles, follow-ups and outcome), **Keep this one** (recorder only; the current version is first saved beside it as `replaced-*.json`, then the copy becomes the next revision, and its file is removed only after that save succeeds), and **Delete**. A copy of another run or another checklist version can't be kept. OneDrive's own copies (`run-<COMPUTER>.json`) appear there too. Nothing is merged automatically.
- **Half-synced publications are refused.** A version can't be used until all its files have arrived and match. Reference screenshots are copied into the version, so replacing an image later never changes an old version.
- **Each folder keeps to itself.** Switching folders discards anything still being read from the old one; a save always goes to the folder its change was made in; changes kept in this browser are filed under their folder's name.
- **An unreadable folder isn't an empty one.** If OneDrive or permissions stop Flightdeck reading the folder, it keeps showing what it last read, says when that was, and offers **Try again**.

## What refreshing costs

While a run is open, Flightdeck rereads only that run and its notes every 5 seconds (about four files). The rest of the folder refreshes every 30 to 60 seconds, and finished runs and published versions are remembered rather than reread. **Refresh** in the top bar rereads everything. With 500 runs, a routine refresh reads about 10 files instead of about 2,000.

## What it can't promise

- **Freshness:** another screen may be a minute behind. Each run shows three separate facts: when this computer saved, when it last checked the folder, and whether it can read the folder at all. None of them proves another computer has the change yet.
- **Gates aren't locks:** a gate means "passed for this commit, by this person, at this time". It doesn't mean nobody changed anything since. People confirm irreversible actions themselves.
- **Clocks:** each computer's clock can be slightly off. Deadlines come from the real tool (for example Jenkins), not from Flightdeck.

## Who writes the other files

| File | Writer |
|---|---|
| `maps/drafts/*.md` | An AI assistant (or one person editing by hand). Two editors at once produce a OneDrive copy; keep one. |
| `people.json` | One named person on the team. Edit it, save, and let it sync before anyone else edits it. |
| `proposals/*.json` | An AI assistant writes its plans; a window writes each plan a person makes as a new file, once, and never over one that's there. Each person's decision is its own `*.status-<window>.json`. |
| `publications/` | Flightdeck, one new folder per publish. Never edited. |

## Before the first real release

Do a rehearsal on two computers with the real folder: start a run, follow it from the second computer, add notes from both, hand off recording, change the commit, block and unblock a step, pass a gate, and finish with a receipt. Then rehearse the bad night: pause OneDrive on one computer, take over from the other, resume OneDrive, and resolve the conflict copy in the app.
