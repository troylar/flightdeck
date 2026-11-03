---
name: flightdeck-new-step-type
description: "Use when asked to add or change one of the team's own Flightdeck step types (a kind of step the built-in types don't cover): saves it with flightdeck type save from a plain description"
---

Reference: `../_flightdeck/map-format.md` (relative to this skill's folder). Read it before you start.

Create or change a step type for this Flightdeck team folder.

The person's request says what the step type is for.

Read `AGENTS.md` in this team folder first, then *Team step types* in the checklist format (the reference file above). Check the built-in types in the checklist format's table, and reuse or change an existing type rather than adding a near-duplicate.

## Use the commands, never the files

Never write, edit, rename or delete a file in `step-types/` yourself. `flightdeck type save` compares the exact bytes you read, refuses copies, checks the definition and records a history line; a direct write skips all of that.

1. `flightdeck type list <team folder> --json`: the team's types, in the order Flightdeck reads them, with copies marked.
2. `flightdeck type read <team folder> <id> --json`: one type. Keep `data.type.rev`. Only `state: "missing"` gives `rev: "none"`. Any state that couldn't be read (`unreadable`, `vanished`, `link`) gives `rev: null`, and then you don't save: tell the person the error, as printed.
3. `flightdeck type save <team folder> <id> --expect <rev from type read> --from - --json`, with the definition on standard input (or `--from <file>`). Use `--expect none` exactly when `type read` said `missing`. Add `--dry-run` to check without writing, `--asked-by <person ID>` when a person in `people.json` asked, and `--note "<what changed>"` for the history line.

Like two Flightdeck windows in different browsers, two saves at the same instant can replace one another without either being told. So read again after any outcome that isn't `done` or `same`, and never save twice without reading in between.

Before you tell the person a change is complete, handle every entry in `problems` and every line in `checks.warnings` of the last result. `complete: false` means part of the folder couldn't be read, so a check didn't finish. A warning such as "Couldn't check drafts in maps/drafts/" is your job to finish: look at those drafts yourself, or tell the person what's still unchecked. Never report a change as complete while one is open.

## The definition

```json
{
  "id": "change.request",
  "label": "Change request",
  "icon": "doc",
  "hint": "A change request the change board approves before production work.",
  "group": "Releases / Approvals",
  "tags": ["cab", "production"],
  "fields": {
    "system": { "label": "Change system", "kind": "text", "required": true }
  },
  "record": [
    { "name": "number", "label": "Change number", "kind": "text" }
  ]
}
```

- `id`: lowercase letters, numbers and dashes in parts separated by dots, starting with a letter, like `change.request`; at most 40 characters; not a built-in type's id. It's the `<id>` you save it as.
- `label` (up to 40 characters) and `hint` (up to 120): what people see.
- `group` (optional): where it sits on the Step types page, levels separated by `/`, up to 80 characters. `tags` (optional): up to 10 words of up to 30 characters, without commas. Both only organize; they never change a published version.
- `icon`: one of check, chat, people, fork, doc, hourglass, cursor, gear, merge, ticket, terminal, script, spark, pipeline, nest. Any other icon shows as check.
- `fields`: what a checklist can say about the step. At most 30. A field name starts with a letter and has up to 30 letters, numbers, `_` or `-`, and can't be one every type already accepts: `link`, `expect`, `deadline`, `evidence`, `require`, `at`, `due`, `after` or `sets`. Each has a `label` (1 to 40 characters) and a kind: `text`, `url`, `code`, `message`, `list`, `choice` (with `options`, a list of short names up to 40 characters). `"required": true` means "usually filled in" (a tip, never a blocker).
- `record`: evidence people can record when they check the step. At most 20. Names follow the field-name rules, must be unique, and can't be `evidence`, start with `jf-` or `rd-`, or be a built-in JavaScript name like `constructor`. Each has a `label` (1 to 40 characters) and a kind: `text`, `url`, `choice` (with `options`); `"long": true` gives a multi-line box. A checklist makes evidence required with `require: <name>` or `require: all`.
- **Typed evidence (Flightdeck 2.0):** a record can also be `number` (optional `min` and `max`, written as decimal text like `"0"` or `"12.5"`, and `unit`, up to 20 characters), `yes-no` or `date`. A definition that records any of those three needs `"format": "flightdeck-step-type/2"`: the format's major version is what turns them on, and without it Flightdeck refuses the definition. Flightdeck's editor also writes `"features": ["typed-evidence"]`; write it too. Every checklist that uses the type then publishes a version only Flightdeck 2.0 runs, and in a 2.0 type a choice's options can't differ only in capitals. Use one only when the team uses 2.0, for example `{ "name": "count", "label": "Rows copied", "kind": "number", "min": "0" }`. A definition with `format` or `features` and none of those kinds is refused: leave both out so every Flightdeck reads it.
- No other top-level keys, no key twice in one object, and no `__proto__`, `constructor` or `prototype` key anywhere.

## When you change an existing type

`type read` it, change the definition, and `type save --expect <rev>` with the rev you read. Keep its `id`. Adding a field, or `text`, `url` or `choice` evidence, is safe. Adding `number`, `yes-no` or `date` evidence makes it a 2.0 step type: teammates on Flightdeck 1.x can no longer use it, and checklists that use it publish versions they can't run, so do it only when the person confirms the team uses 2.0. Renaming or removing a field or evidence breaks checklists that use it: `type save` warns about drafts that still name it, so update those drafts in the same change. Published versions are never affected: each froze its own copy of the type.

## What to do after each outcome

| `outcome` | What you do next |
|---|---|
| `done` | Handle `problems` and `checks.warnings` first, then tell the person what was saved and the load sentence, as printed. |
| `same` | Tell the person nothing needed changing. |
| `checked` | Show the person the check; save only when they want it. |
| refused `changed` | `type read` again, redo the change on what's there now, and save once more with the new rev. If it changes again, stop and tell the person. |
| refused `copies` | Stop. Tell the person which files clash; don't pick, delete or merge either. |
| refused `newer` | Stop. Tell the person the file needs a newer Flightdeck. |
| refused `invalid` | Fix the definition from the error and save again. |
| refused `not-allowed` | Stop. Tell the person why, as printed. |
| refused `no-links` / failed `link-check` | Stop. Give the person the route below that matches `existing`. |
| `failed` / `held` | Tell the person, as printed, and follow the next step the words give (access, a person, or a sync); try again only when they say so. |
| `partial` | Tell the person the save stands; don't save it again. |
| `replaced` / `unverified` / `unsure` | `type read` again, compare with what you meant to save, and tell the person. Don't save again without reading. |

## When the command can't save: the person's route in Flightdeck

Use these after `no-links` or `link-check`, and when the command isn't available (no Node, or an older package). Then look in `step-types/` read only to see what's there, and don't write the file instead.

| What's there | Route to give the person |
|---|---|
| `existing: missing` | Step types → New type, enter the definition, Save. |
| `appLoads: true` (whatever `existing` says) | Open the type → Edit, make the change, Save. Don't offer New type with that ID: it stops at "There's already a step type". |
| `appLoads: false`, selected, not newer | Edit won't open it. Step types → New type with the same ID and the corrected definition → Save → Keep mine in the conflict. That replaces it through Flightdeck's own checked save. |
| `appLoads: false`, past the 100-file limit | Stop: Flightdeck doesn't read it. Tell the person; which files to remove is theirs to decide. |
| `existing: newer` | Stop: it needs a newer Flightdeck. Never offer New type → Keep mine here: it would replace a file this copy can't read. |

## Then

Tell the person what you saved, and that people can see and edit it in Flightdeck on the Step types page (open it from Checklists, from Settings › Library, or by searching for it). Skills built from checklists that use a changed type will show as needing an update once a new version of those checklists is published.
