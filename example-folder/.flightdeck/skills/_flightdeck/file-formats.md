# Flightdeck file formats

The long formats behind `AGENTS.md` in the team folder. `AGENTS.md` says what you may write; this file only says what these files look like. Nothing here allows you to write a file `AGENTS.md` tells you not to.

## Follow-up decisions

`followups/`: what became of each run's follow-ups (`followups/<process>/<run>.<follow-up>.<window>.<rev>.json`, `"kind": "followup-decision"`, `status` one of `done`, `ticket`, `moved`, `wont` with its `reason`, or `open` when reopened). `rev` is one more than the decision the person saw, which `seen` names; the highest `rev` counts, and two with the same `rev` (including OneDrive's copies such as `…1-LAPTOP.json`) were made at once, so the follow-up shows as Needs review, still open, until someone decides again.

## Team values and people

`people.json`. It's an array of `{ "id", "name", "initials", "email", "inactive", "folderRole" }`; `folderRole` is `"owner"` (one person) or `"backup"` (one person).

`team-values.json`. It's `{ "format": "flightdeck-team-values/1", "values": { "<name>": { "value": "…", "about": "…" } } }`: names are lowercase letters, digits and `-`; a value is at most 120 characters with no spaces at the start or end. A linked step passes one with `pass: name=team:<name>`.

## Skill registrations

For a version published with Flightdeck 2.0, the file you give `flightdeck skill register`:

```json
{
  "name": "release-deploy",
  "version": "1.3.0",
  "location": "https://bitbucket.example.com/projects/WA/repos/team-skills/browse/release-deploy",
  "implements": { "process": "release", "folder": "v2-k3m9p2q8" },
  "steps": ["merge", "jenkins"],
  "description": "Merges the release branch and starts the production deploy job."
}
```

`flightdeck skill register`. It takes only `name`, `version`, `location`, `implements` (`process` and the exact version `folder`), and optionally `steps`, `description`, `group`, `tags` and `by`. Exit 0 is registered (the JSON's `registered` has the `path`, `rev` and the exact `implements`); 1 is refused or failed, and `error.why` says what happened (for example, the folder isn't a usable version of that process, and nothing was written).

For a version published before 2.0, `skills/<name>.json`:

```json
{
  "name": "release-deploy",
  "version": "1.3.0",
  "location": "https://bitbucket.example.com/projects/WA/repos/team-skills/browse/release-deploy",
  "implements": "release@2",
  "steps": ["merge", "jenkins"],
  "group": "Engineering / Releases",
  "tags": ["deploy"],
  "description": "Merges the release branch and starts the production deploy job."
}
```

## Run files

- **Linked runs:** a `{run.process}` step's child is in `steps.<stepId>.child` (`process`, `id`, `inputs`, `failed`, and in a 2.0 run also `folder` and `retired`); the child run's `parent` names `process`, `id` and `step`. A 2.0 run's `pins.children` records the exact version each linked step starts, by step ID.

A version published by Flightdeck 1.16 or later can list the corrections it includes in `publication.json`: `"corrections": [{ "id": "g…", "result": { "step": "pods", "sig": "…" } }]` (`id` is a correction group, as in the decision files below).

## Corrections

One line in a person's own `notes-*.jsonl`:

```json
{ "id": "k3v9x2m7qa", "kind": "correction", "cv": 1, "version": 1, "folder": "v1-abcd1234", "step": "pods",
  "target": { "phase": "deploy", "step": "pods" }, "from": "New pods stay up with no restarts", "base": "0a1b2c3d",
  "change": { "op": "wording", "to": "New pods stay up for 20 minutes with no restarts" },
  "why": "The cache warms slowly.", "happened": "Watched for 20 minutes; two pods restarted at minute 12.",
  "text": "Correction to \"New pods stay up with no restarts\". Should say: …",
  "files": [], "by": "person-blake", "at": "2026-10-16T14:05:00.000Z", "session": "w8d2k4" }
```

- `change.op` is one of: `wording` (`to`, the step's new text), `add` (`text` of a missing step; `where` is `after` this step or `end` of its phase), `move` (`to` is `{ "after": "<step id>" }` or `{ "phase": "<id>", "where": "start" }`), `roles` (`to`, the roles who should do it), `screenshot` (`shot`, the screenshot to replace; the right one is in `files`), `remove` (from future versions; `why` says why) or `describe` (`why` describes the problem).
- A correction on a phase's note or a gate's (Flightdeck 2.0) has `"cv": 2`, `"step": ""` and `target` `{ "phase": "<id>" }` or `{ "gate": "<id>" }`; its `change.op` is `wording` (`to`, the whole new note), `screenshot` or `describe`, and it has no `from` or `base`.
- `from`, `base` and `text`: *Corrections* in `AGENTS.md`.
- `happened` is set when the step was answered "done differently" with this correction; the run's `steps.<stepId>.differently.note` says the same.
- `files` on any note or correction lists attachments under the run's `files/` (images, PDF, text and logs, CSV, JSON, YAML, .zip; up to 10 MB each), and `fileInfo` gives each one's name and size.
- Matching corrections (same step as it was, same change: exact apart from spacing, and letter case counts) from several runs are one group. People decide on a group in Flightdeck, and each decision is a new file written once by the window of whoever decided: `corrections/<process>/<group>.<window>.<rev>.json` = `{ "kind": "correction-decision", "group": "g…", "members": ["k3v9x2m7qa"], "status": "applied", "reason": "", "by": "person-casey", "at": "…", "rev": 2, "seen": "g….w8d2k4.1.json" }`. `status` is `applied` (in the draft; one applied or linked in Flightdeck 1.16 or later also has `result`, a fingerprint of the step as applied), `declined` (with a `reason`), `open` (reopened), `withdrawn` (by whoever suggested it) or `included` (a person said which published version has a correction applied before 1.16: `version` and `folder`). An `applied` decision with `"addressed": true` means the draft handles it differently from the proposal. `rev` is one more than the decision the person saw, which `seen` names. The current decision is the one with the highest `rev`; two with the same `rev` were made at once and show as Needs review until someone decides again.
- Older suggested fixes (`"kind": "fix"`, with `fixKind` and `target`) and their decisions in `suggestions/<process>/` still load: an accepted one shows as Applied (legacy).

## Saved history lines

One JSON object per line:

`{ "v": 1, "kind": "draft-edit", "id": "<random, letters and digits>", "process": "<process>", "writer": "agent-<name>", "seq": <1, 2, 3… in your file>, "by": "<the person you work for, a people.json ID>", "at": "<ISO time, shown only>", "from": "<fingerprint of the draft before>", "to": "<fingerprint after>", "seen": null, "source": "agent", "units": ["<what you changed, in a few words>"], "items": ["step:<step ID>"], "hunks": [{ "at": <0-based line in the text before>, "del": ["<lines removed>"], "ins": ["<lines added>"] }] }`

A fingerprint is 32-bit FNV-1a over the file's UTF-16 code units, as 8 lowercase hex digits (`text_hash` in `check_folder.py`).
