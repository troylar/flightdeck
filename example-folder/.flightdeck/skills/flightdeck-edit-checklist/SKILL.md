---
name: flightdeck-edit-checklist
description: "Use when asked to change, fix, reword or extend an existing Flightdeck checklist (or apply review fixes or corrections to one): edits its draft safely, keeping its step IDs"
---

Reference: `../_flightdeck/map-format.md` and `../_flightdeck/good-checklists.md` (relative to this skill's folder). Read them before you start.

Change an existing Flightdeck draft checklist. The change is reviewed and published by a person in Flightdeck.

The person's request names the checklist and the change to make.

Read `AGENTS.md` in this team folder first. The checklist format and the guide to good checklists are in the reference files above.

If the folder has `step-types/` or `jira/workflows.json`, read them too: use the team's own step types where they fit, and only Jira statuses the workflow actually has (with `issueType:` when it has more than one type). Use tracks, `at:`/`due:`/`after:` times and `{run.process}` steps only where the source describes parallel work, a real time, or another process run inside this one. When one step creates a value later steps use (a release tag, a build number), list it in `context`, add `sets: <detail>` to that step and use `^<detail>` after it.

## Steps

1. **Find the checklist.**
   - **With the command:** run `flightdeck draft read <team folder> <process> --or-latest --json` and keep `session`, `continueFrom.rev` and `continueFrom.text` (save the text to a file: it's what you started from). When there's no draft, `continueFrom` is the latest published version (`kind: "version"`), and your save creates the draft from it. Never copy a version into `maps/drafts/` yourself.
   - **Without the command:** open `maps/drafts/<process>.md`. If there's no draft but the process is published, copy the `map.md` of the **current** version, found by running `python3 .flightdeck/skills/_flightdeck/check_folder.py` from the team folder (`python` or `py` on Windows; if the skills were installed somewhere other than `.flightdeck/skills`, run the `_flightdeck/check_folder.py` next to this skill's folder instead, with the team folder as its argument): it checks every version's files and fingerprints exactly as Flightdeck does and prints `current` per process. If it reports a `clash`, or no complete version, stop and report it; a person resolves that in Flightdeck. Save the copy to `maps/drafts/<process>.md` first, and say you did.
2. **Read the newest published version too,** so you know what people are running today.
3. **Make the change with these rules:**
   - **Keep every existing ID** (`{#…}`) when you reword, move or retype a step. Notes, skills and run history follow the ID.
   - New work gets a new ID. **Never reuse an ID** that was removed: collect the IDs from every published `map.md` of this process (all versions), not just the newest, and from every staged version's `map.md` in `staged/<process>/` (test runs and their corrections use those IDs too).
   - Removing a step is fine; say so in your report, because it disappears from future runs.
   - Changing a step's type is allowed, but check its fields still fit the new type.
   - Keep phases at 9 steps or fewer, steps on one line, explanations in `>` notes.
   - Don't add `require:` or `[!]` unless the request asks for stricter evidence or a real harm justifies it.
4. **Check it** against the checklist format: unique IDs, known types and fields, choice values, declared roles and details, and `only when` tests the detail's kind allows (only `is set` and `is not set` on a plain-text detail).
5. **Save** with `flightdeck draft save <team folder> <process> --session <session> --expect <continueFrom.rev> --from <your new text> --base <the text you read> --json`. If its `outcome` is `proposed`, someone has the draft open or it changed since you read it: your change is a proposal: if the person has the draft open in Flightdeck's main editor with nothing unsaved, it appears there within a few seconds and is saved for them (they can Undo it); otherwise it waits for them to review it on the process page. Say which in your report. Then read `checks.blockers` in the output and fix every blocker before you report the work as done (read again with the same `--session` and save again). These checks don't know the team's people, step types, Jira workflows or other processes: a step using a type from `step-types/` shows as unknown, which is never a reason to remove or retype it; check the type exists and say Flightdeck's checks on the process page have the final word. Without the command: confirm nobody else is editing this draft, and if the file changed on disk since you read it, stop and report rather than overwrite. Never write `maps/drafts/` yourself when the command is available, and never edit `publications/`, `staged/`, `runs/`, `proposed/` or `presence/`.

## Report back

- Whether the draft was written or your change waits as a proposal (and why: `open`, `changed`), so the person knows to apply it on the process page.
- What changed, as a short list: added, reworded, moved, removed, retyped (with IDs).
- Anything that changes how runs behave: new must-dos, new required evidence, new `^detail` ties, gates added or removed.
- Any blockers from `checks.blockers` you couldn't clear, and why.
- A one-line change note the person can paste when publishing, such as "Deploy phase: Jenkins job now records the build number."
- Next step for the person, in Flightdeck: **Practice** the draft on the real run screen (nothing is recorded), then **Save draft** and **Review & publish**, or stage it for a test run first when the change should be tried before it's the default.
