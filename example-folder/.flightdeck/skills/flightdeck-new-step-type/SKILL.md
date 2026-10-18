---
name: flightdeck-new-step-type
description: "Create or change a team step type in step-types/<id>.json from a plain description"
---

Reference: `../_flightdeck/map-format.md` (relative to this skill's folder). Read it before you start.

Create or change a step type for this Flightdeck team folder.

What the step type is for: the user's request

Read `AGENTS.md` in this team folder first, then *Team step types* in the checklist format (the reference file above). Look in `step-types/` for the team's existing types and reuse or change one rather than adding a near-duplicate; check the built-in types in the checklist format's table too.

## Write `step-types/<id>.json`

```json
{
  "id": "change.request",
  "label": "Change request",
  "icon": "doc",
  "hint": "A change request the change board approves before production work.",
  "fields": {
    "system": { "label": "Change system", "kind": "text", "required": true }
  },
  "record": [
    { "name": "number", "label": "Change number", "kind": "text" }
  ]
}
```

- `id`: lowercase letters, numbers, dashes and dots, like `change.request`; not a built-in type's id. The file name is exactly `<id>.json`.
- `label` (up to 40 characters) and `hint` (up to 120): what people see.
- `icon`: one of check, chat, people, fork, doc, hourglass, cursor, gear, merge, ticket, terminal, script, spark, pipeline, nest.
- `fields`: what a checklist can say about the step. Kinds: `text`, `url`, `code`, `message`, `list`, `choice` (with `options`, a list of short names). `"required": true` means "usually filled in" (a tip, never a blocker). At most 30.
- `record`: evidence people can record when they check the step. Kinds: `text`, `url`, `choice` (with `options`); `"long": true` for a multi-line box. Names must be unique and can't be `evidence`, start with `jf-` or `rd-`, or be a built-in JavaScript name like `constructor`. At most 20. A checklist makes evidence required with `require: <name>` or `require: all`.

## When you change an existing type

Keep its `id`. Adding a field or evidence is safe. Renaming or removing one breaks checklists that use it: search `maps/drafts/` for `{<id>}` and update them in the same change. Published versions are never affected: each froze its own copy of the type.

## Then

Tell the person what you created, and that people can see and edit it in Flightdeck under **Step types**. Skills built from checklists that use a changed type will show as needing an update once a new version of those checklists is published.
