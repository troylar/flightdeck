---
name: flightdeck-living-run
description: "Use when asked what is left to do on a Flightdeck run, or to add, check off, drop or move a to-do on one: reads the run's to-dos and asks for one change through flightdeck todo, for a person to decide"
---

Read a running Flightdeck run's to-dos, and ask for one change to them. You only ask: a person decides in Flightdeck (or a delegation they made covers it), and the run's recorder's window applies it. You never write `run.json`, never decide a request and never write a file in `proposals/` by hand.

The person's request names the run (`<process>/<run id>`) and what they want: what is left, or one to-do to add, check off, drop, move or reopen.

Read `AGENTS.md` in this team folder first.

How the commands work is in *Asking for a run* in the command guide, under To-dos.

## Steps

1. **Read the run's to-dos:** `flightdeck todo list <team folder> <process>/<run id> --json`. Each to-do has its `id`, `text`, `state` (open, done, wont, moved) and the gate it comes before; each request has its `status` (waiting for approval, queued for the recorder, applied, declined, held, disputed) and why. Say what is open and what waits, as it is. If `held` names anything, or the exit code is 4, say that part of the folder couldn't be read and stop: nothing can be asked safely until it can.
2. **Preview the change** with `--dry-run --json` and the same `--tool <name>@<version> --key <key>` you will use to write it. Pick a key that names this one change (like `release-41-add-screenshots`); the same key always means the same request.
   - add: `flightdeck todo add <team folder> <process>/<run id> --text "..." --phase <phase id>` (or `--step <step id>`). The text is what needs doing, at most 200 characters, from the person's own words.
   - check off: `todo done ... --todo <to-do id>`; reopen: `todo reopen ... --todo <to-do id>`.
   - drop: `todo wont ... --todo <to-do id> --reason "<why it won't be done>"`. The reason is the person's.
   - move or defer: `todo move ... --todo <to-do id> --to <ticket like ABC-123 | https link | <process>/<run id>>`.
   - `--as <person id>` names the person you ask for. It is who asked, never their approval.
3. **Show the person the preview** (`data.preview`): where it goes (`gate`), who must approve it (`authority.needs`: a person, or a delegation that covers it), what it would send back for review (`consequence.reopens`) or release (`consequence.releases`), and that the recorder applies it (`queue`). Ask before you write it.
4. **Write it** with the same command, without `--dry-run`. `requested` means one file was written; `already` means that key's request is already there, and nothing was written. Tell the person it is waiting for approval or queued for the recorder, never that it is done.

## Never

- Never say a to-do is done, dropped or moved until `todo list` shows it applied.
- Never use a new key to retry. If the command can't confirm the save, retry with the same key: a new key could ask twice.
- Never ask to drop or move work to make a gate pass, and never pass a gate. A person decides that.
- Never put secrets, tokens or customer data in a to-do's text, reason or destination.

Remember that OneDrive may be up to a minute behind, so say what you read, not what is guaranteed.
