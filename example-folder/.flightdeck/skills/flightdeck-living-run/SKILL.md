---
name: flightdeck-living-run
description: "Use when asked what is left to do on a Flightdeck run, or to add, check off, drop or move a to-do on one, or to require something of every item of a loop (a spread): reads the run's to-dos and spreads and asks for changes through flightdeck todo and flightdeck spread, for a person to decide"
---

Read a running Flightdeck run's to-dos and spreads, and ask for changes to them. You only ask: a person decides in Flightdeck (or a delegation they made covers it), and the run's recorder's window applies it. You never write `run.json`, never decide a request and never write a file in `proposals/` by hand.

The person's request names the run (`<process>/<run id>`) and what they want: what is left, one to-do to add, check off, drop, move or reopen, or a requirement on every item of a loop (a spread).

Read `AGENTS.md` in this team folder first.

How the commands work is in *Asking for a run* in the command guide, under To-dos and Spreads.

## Steps

1. **Read the run's to-dos:** `flightdeck todo list <team folder> <process>/<run id> --json`. Each to-do has its `id`, `text`, `state` (open, done, wont, moved) and the gate it comes before; each request has its `status` (waiting for approval, queued for the recorder, applied, declined, held, disputed) and why. Say what is open and what waits, as it is. If `held` names anything, or the exit code is 4, say that part of the folder couldn't be read and stop: nothing can be asked safely until it can.
2. **Preview the change** with `--dry-run --json` and the same `--tool <name>@<version> --key <key>` you will use to write it. Pick a key that names this one change (like `release-41-add-screenshots`); the same key always means the same request.
   - add: `flightdeck todo add <team folder> <process>/<run id> --text "..." --phase <phase id>` (or `--step <step id>`). The text is what needs doing, at most 200 characters, in plain words: what the person said, or what you found.
   - check off: `todo done ... --todo <to-do id>`; reopen: `todo reopen ... --todo <to-do id>`.
   - drop: `todo wont ... --todo <to-do id> --reason "<why it won't be done>"`. The reason is the person's.
   - move or defer: `todo move ... --todo <to-do id> --to <ticket like ABC-123 | https link | <process>/<run id>>`.
   - `--as <person id>` names the person you ask for. It is who asked, never their approval.
3. **Say what the preview says** (`data.preview`): where it goes (`gate`), who must approve it (`authority.needs`: a person, or a delegation that covers it), what it would send back for review (`consequence.reopens`) or release (`consequence.releases`), and that the recorder applies it (`queue`).
   - An addition the person asked for or you found while doing the task they gave you, or a fact (this is done), goes on without asking when the preview neither sends an approval back nor releases work: it is still only a request, and someone who may decide accepts it in Flightdeck.
   - Ask the person first before anything that drops or moves work (`consequence.releases`), stops a spread, or sends an approval back for review (`consequence.reopens` isn't empty), and write it only once they agree.
4. **Write it** with the same command, without `--dry-run`. `requested` means one file was written; `already` means that key's request is already there, and nothing was written. Tell the person it is waiting for approval or queued for the recorder, never that it is done.

## Spreads

A spread requires something of every item of a loop ("security sign-off on every open story"). It is asked on the parent run, and each item's own run decides its own addition.

1. **Read them:** `flightdeck spread list <team folder> <process>/<run id> --json`. Say each spread's `row` and `preview`, any `notices` (items that joined and now owe it) and what holds the loop, as it is.
2. **Add one** with `flightdeck spread add ... --loop <loop step> --text "..." --before <child gate id> --tool <name>@<version> --key <key> --dry-run --json` first. Say the preview in its own words: which open items it is required on, that every item joining later owes it too, and which cleared items stay unchanged. Then write it as in step 3 above: adding one within the task goes on; on an approved loop it sends the approval back, so ask first.
3. **Ask each item's run** once the spread is applied: `flightdeck spread sync ... --spread <spread id> --tool <name>@<version>`, previewed with `--dry-run --json`. It writes one request per item that owes it and hasn't been asked. If the exit code is 4 and `status` is `partial`, say which items weren't asked and run the same `sync` again; it asks only what is missing.
4. **Include a cleared item** (`spread include --spread <id> --item <key>`), or bind an item to the run that covers it now (`--run <process>/<run id>`), when the task calls for it, as in step 3 above. **Stop a spread** (`spread stop --spread <id> --reason "..."`) only with the person's agreement and reason: it stops items that join later from owing it, and keeps what is owed now.

## Never

- Never say a to-do is done, dropped or moved, or that an item has met a spread, until `todo list` or `spread list` shows it applied.
- Never use a new key to retry. If the command can't confirm the save, retry with the same key: a new key could ask twice.
- Never drop or move work, stop a spread or send an approval back without the person's agreement. Never ask for any of them to make a gate pass, and never pass a gate. A person decides that.
- Never put secrets, tokens or customer data in a to-do's or a spread's text, reason or destination.

Remember that OneDrive may be up to a minute behind, so say what you read, not what is guaranteed.
