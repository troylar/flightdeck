---
name: flightdeck-living-run
description: "Use when asked what is left to do on a Flightdeck run, or to add, check off, drop or move a to-do on one, to require something of every item of a loop (a spread), or to record what a tool found about a loop's items (PRs, commits, status, blockers) and suggest a to-do done on it: reads the run's to-dos, spreads and facts and asks for changes through flightdeck todo, flightdeck spread and flightdeck fact, for a person to decide"
---

Read a running Flightdeck run's to-dos, spreads and facts, and ask for changes to them. You only ask: a person decides in Flightdeck (or a delegation they made covers it), and the run's recorder's window applies it. You never write `run.json`, never decide a request and never write a file in `proposals/` by hand.

The person's request names the run (`<process>/<run id>`) and what they want: what is left, one to-do to add, check off, drop, move or reopen, a requirement on every item of a loop (a spread), or what is known about a loop's items (facts).

Read `AGENTS.md` in this team folder first.

How the commands work is in *Asking for a run* in the command guide, under To-dos, Spreads and Facts.

## Steps

1. **Read the run's to-dos:** `flightdeck todo list <team folder> <process>/<run id> --json`. Each to-do has its `id`, `text`, `state` (open, done, wont, moved) and the gate it comes before; each request has its `status` (waiting for approval, queued for the recorder, applied, declined, held, disputed) and why. Say what is open and what waits, as it is. If `held` names anything, or the exit code is 4, say that part of the folder couldn't be read and stop: nothing can be asked safely until it can.
2. **Preview the change** with `--dry-run --json` and the same `--tool <name>@<version> --key <key>` you will use to write it. Pick a key that names this one change (like `release-41-add-screenshots`); the same key always means the same request.
   - add: `flightdeck todo add <team folder> <process>/<run id> --text "..." --phase <phase id>` (or `--step <step id>`). The text is what needs doing, at most 200 characters, from the person's own words.
   - check off: `todo done ... --todo <to-do id>`; reopen: `todo reopen ... --todo <to-do id>`.
   - drop: `todo wont ... --todo <to-do id> --reason "<why it won't be done>"`. The reason is the person's.
   - move or defer: `todo move ... --todo <to-do id> --to <ticket like ABC-123 | https link | <process>/<run id>>`.
   - `--as <person id>` names the person you ask for. It is who asked, never their approval.
3. **Say what the preview says** (`data.preview`): where it goes (`gate`), who must approve it (`authority.needs`: a person, or a delegation that covers it), what it would send back for review (`consequence.reopens`) or release (`consequence.releases`), and that the recorder applies it (`queue`).
   - When the person asked for exactly this addition, or told you a fact (this is done), and the preview neither sends an approval back nor releases work, go on and write it: it is still only a request, and someone who may decide accepts it in Flightdeck.
   - When it drops or moves work (`consequence.releases`), sends an approval back for review (`consequence.reopens` isn't empty), or isn't what the person said in their own words, ask them first and write it only once they agree.
4. **Write it** with the same command, without `--dry-run`. `requested` means one file was written; `already` means that key's request is already there, and nothing was written. Tell the person it is waiting for approval or queued for the recorder, never that it is done.

## Spreads

A spread requires something of every item of a loop ("security sign-off on every open story"). It is asked on the parent run, and each item's own run decides its own addition.

1. **Read them:** `flightdeck spread list <team folder> <process>/<run id> --json`. Say each spread's `row` and `preview`, any `notices` (items that joined and now owe it) and what holds the loop, as it is.
2. **Add one** with `flightdeck spread add ... --loop <loop step> --text "..." --before <child gate id> --tool <name>@<version> --key <key> --dry-run --json` first. Say the preview in its own words: which open items it is required on, that every item joining later owes it too, and which cleared items stay unchanged. Then write it as in step 3 above: adding one the person asked for may go on; on an approved loop it sends the approval back, so ask first.
3. **Ask each item's run** once the spread is applied: `flightdeck spread sync ... --spread <spread id> --tool <name>@<version>`, previewed with `--dry-run --json`. It writes one request per item that owes it and hasn't been asked. If the exit code is 4 and `status` is `partial`, say which items weren't asked and run the same `sync` again; it asks only what is missing.
4. **Include a cleared item** (`spread include --spread <id> --item <key>`), or bind an item to the run that covers it now (`--run <process>/<run id>`), only when the person asks for it. **Stop a spread** (`spread stop --spread <id> --reason "..."`) only with the person's agreement and reason: it stops items that join later from owing it, and keeps what is owed now.

## Facts

A fact is what a tool observed about one item of a loop (its PRs, commits, status or blockers). It is information only: it never checks anything off.

1. **Read them:** `flightdeck fact list <team folder> <process>/<run id> --json`. Say each item's facts in their `words`, with when they were checked. A domain that says "not checked" is unknown: never say there are no blockers unless a complete, fresh blockers fact says none are open.
2. **File what you observed** with `flightdeck fact sync ... --from <file> --tool <name>@<version> --dry-run --json` first, then without `--dry-run`. Give each observation a new `key`, and say `complete: true` only when you read the whole list without an error. If the exit code is 4 and `status` is `partial`, run the same `sync` again; it files only what is missing. Filing facts the person asked for may go on: they change no work.
3. **Suggest a to-do done** on a fact only when the person asks, or when a fact plainly shows the to-do's work done: `flightdeck todo suggest-done ... --todo <to-do id> --fact <fact id> --tool <name>@<version> --dry-run --json` first. If it is refused, say why (stale, incomplete, replaced, another fact disagrees) and don't work around it. Otherwise write it: it waits for a person's decision (or a delegation), and the recorder applies it only if the evidence still holds then.

## Keep for next time

When a to-do or a spread shows a step the checklist itself is missing, it can be kept as a suggestion for next time. It changes nothing on this run.

1. **Keep one** only when the person asks, or offer it when the same to-do keeps coming back: `flightdeck todo keep <team folder> <process>/<run id> --todo <to-do id> --tool <name>@<version> --dry-run --json` first (`flightdeck spread keep ... --spread <spread id>` for a spread). No `--key`: asking again is `already`. Say the preview: which checklist and version it goes to, and where (the end of a phase, or after a step). Then write it.
2. **Place item work.** A to-do on one item of a loop belongs to the checklist the items run, and needs `--phase <phase id>` or `--after <step id>` in that checklist; read it first (`flightdeck read`) and ask the person if where it goes isn't plain. Without one it is kept as needing placement, and says so.
3. **Say where it stands** as it is: Suggested, Applied to draft, or Published in vN. Only the checklist's owner decides it, in Flightdeck.

## Never

- Never say a to-do is done, dropped or moved, or that an item has met a spread, until `todo list` or `spread list` shows it applied. A suggestion on evidence is a request like any other.
- Never use a new key to retry. If the command can't confirm the save, retry with the same key: a new key could ask twice.
- Never drop or move work, stop a spread or send an approval back without the person's agreement. Never ask for any of them to make a gate pass, and never pass a gate. A person decides that.
- Never say a kept step is in the checklist until a published version has it.
- Never put secrets, tokens or customer data in a to-do's or a spread's text, reason or destination, in a keep's text or reason, or in a fact's entries, errors or source.

Remember that OneDrive may be up to a minute behind, so say what you read, not what is guaranteed.
