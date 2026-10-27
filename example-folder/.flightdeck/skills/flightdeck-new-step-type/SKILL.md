---
name: flightdeck-new-step-type
description: "Use when asked to add or change one of the team's own Flightdeck step types (a kind of step the built-in types don't cover): writes step-types/<id>.json from a plain description"
---

Reference: `../_flightdeck/map-format.md` (relative to this skill's folder). Read it before you start.

Create or change a step type for this Flightdeck team folder.

The person's request says what the step type is for.

Read `AGENTS.md` in this team folder first, then *Team step types* in the checklist format (the reference file above). Look in `step-types/` for the team's existing types and reuse or change one rather than adding a near-duplicate; check the built-in types in the checklist format's table too.

## Write `step-types/<id>.json`

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

- `id`: lowercase letters, numbers and dashes in parts separated by dots, starting with a letter, like `change.request`; at most 40 characters; not a built-in type's id, and not one another file in `step-types/` already defines. The file name is exactly `<id>.json`.
- `label` (up to 40 characters) and `hint` (up to 120): what people see.
- `group` (optional): where it sits on the Step types page, levels separated by `/`, up to 80 characters. `tags` (optional): up to 10 words of up to 30 characters, without commas. Both only organize; they never change a published version.
- `icon`: one of check, chat, people, fork, doc, hourglass, cursor, gear, merge, ticket, terminal, script, spark, pipeline, nest. Any other icon shows as check.
- `fields`: what a checklist can say about the step. At most 30. A field name starts with a letter and has up to 30 letters, numbers, `_` or `-`, and can't be one every type already accepts: `link`, `expect`, `deadline`, `evidence`, `require`, `at`, `due`, `after` or `sets`. Each has a `label` (1 to 40 characters) and a kind: `text`, `url`, `code`, `message`, `list`, `choice` (with `options`, a list of short names up to 40 characters). `"required": true` means "usually filled in" (a tip, never a blocker).
- `record`: evidence people can record when they check the step. At most 20. Names follow the field-name rules, must be unique, and can't be `evidence`, start with `jf-` or `rd-`, or be a built-in JavaScript name like `constructor`. Each has a `label` (1 to 40 characters) and a kind: `text`, `url`, `choice` (with `options`); `"long": true` gives a multi-line box. A checklist makes evidence required with `require: <name>` or `require: all`.
- **Typed evidence (Flightdeck 2.0):** a record can also be `number` (optional `min` and `max`, written as decimal text like `"0"` or `"12.5"`, and `unit`, up to 20 characters), `yes-no` or `date`. A file that records any of those three starts with `"format": "flightdeck-step-type/2", "features": ["typed-evidence"]`; without them Flightdeck refuses the file. Every checklist that uses the type then publishes a version only Flightdeck 2.0 runs, and in a 2.0 file a choice's options can't differ only in capitals. Use one only when the team uses 2.0, for example `{ "name": "count", "label": "Rows copied", "kind": "number", "min": "0" }`.
- No other top-level keys.

## When you change an existing type

Keep its `id`. Adding a field, or `text`, `url` or `choice` evidence, is safe. Adding `number`, `yes-no` or `date` evidence makes the file a 2.0 step type: teammates on Flightdeck 1.x can no longer use it, and checklists that use it publish versions they can't run, so do it only when the person confirms the team uses 2.0. Renaming or removing one breaks checklists that use it: search `maps/drafts/` for `{<id>}` and update them in the same change. Published versions are never affected: each froze its own copy of the type.

## Then

Tell the person what you created, and that people can see and edit it in Flightdeck on the Step types page (open it from Checklists, from Settings › Library, or by searching for it). Skills built from checklists that use a changed type will show as needing an update once a new version of those checklists is published.
