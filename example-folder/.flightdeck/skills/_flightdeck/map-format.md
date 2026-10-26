# Checklist format

A checklist is one Markdown file in the team folder's `maps/drafts/`. Flightdeck checks it; anyone can publish it.

## Example

```markdown
---
process: check-in
title: Check in code
category: Code
owner: person-avery
context: branch, commit, story
roles: author, reviewer
---

## Before the pull request · DO-CONFIRM {#before-pr}
- [!] {run.command} Branch rebased onto master ^commit @author {#rebase}
  command: git fetch origin && git rebase origin/master
  where: Your repository
- [!] {confirm} No secrets, real names or customer data in the diff @author {#secrets}
- [~] {confirm} Jira key in the commit message ^story @author {#jira-key}

## Gate: Ready for review · owner @author {#ready-review}
  approves: review of `^commit` on ^branch

## Review · READ-DO {#review}
- [!] {review} Review and approve the pull request @reviewer {#approve}
  focus: Tests for new behavior, no unrelated changes
  > Ask for changes in the PR, then mark this step Blocked until they're in.
```

## Front matter

| Key | Required | Meaning |
|---|---|---|
| `process` | yes | The process ID: lowercase letters, numbers and dashes, starting with a letter or number. Stays the same forever. |
| `title` | yes | What people see. |
| `category` | no | A one-level grouping: used on the Processes list, and for the process's skills, when there's no `group`. |
| `owner` | no | A person ID from `people.json`. The owner signs off a version as ready for a skill. |
| `backup` | no | The backup owner: another person ID from `people.json`. Signs off only while the owner is inactive or gone from `people.json`. Flightdeck before 1.15 ignores it and counts only the owner's sign-offs. |
| `group` | no | Where the process sits in the team's hierarchy, separated by `/` (`Engineering / Releases`). Up to 6 levels of 60 characters are kept. Without it, the category. |
| `tags` | no | Labels to filter by (`production, deploy`). Read in lowercase; up to 20 tags of 40 characters are kept. |
| `context` | no | Run details filled in when a run starts (`ticket, commit, environment`). At most 40, each a name of letters, numbers, dashes or underscores up to 60 characters. A detail can have a kind (Flightdeck 2.0): see [Typed run details](#typed-run-details). |
| `roles` | no | Roles people are assigned to in each run. |
| `runs` | no | `solo` if one person usually runs it alone (every role goes to whoever starts it), or `team` (the default). |
| `format`, `features` | no | Don't write them: Flightdeck works out what a version needs when it publishes. If they're there, `format:` must be `flightdeck-checklist/2`, `features:` may name only features Flightdeck knows, and the checklist must use something from [Needs Flightdeck 2.0](#needs-flightdeck-20) or `only when`. Anything else stops publishing, and so does `format: flightdeck-checklist/1`. |

Each line between the `---` lines is `key: value`; any other line there stops publishing. A key not in this table is kept and ignored. Run detail and role names can't be names Flightdeck keeps for itself (`constructor`, `__proto__` and the like).

In the builder, **Checklist details** sets `owner`, `backup`, `roles` and `context` without editing this block. Each step's form edits its note, and the Questions section has a panel with **Remove section**.

## Typed run details

Most run details are text, and that's the default: `context: ticket, commit` works as it always has. When a detail is always a number, a yes or no, a date, one of a few choices or a link, give it a kind after a colon (Flightdeck 2.0):

```
context: ticket, rows:number, due:date, approved:yes-no, env:choice(dev|test|prod), runbook:link
```

| Kind | Stored as | Typed in as |
|---|---|---|
| `number` | A plain decimal, never rounded: `1234.5`, `-3`, `0` | A box for decimals. `+12`, `007` and `3.50` are accepted and stored as `12`, `7` and `3.5`; `1,234`, `1e3` and words are refused. At most 30 characters. |
| `yes-no` | `yes` or `no` | Two choices, Yes and No |
| `date` | `YYYY-MM-DD`, a real calendar day | The browser's date box |
| `choice(a\|b)` | The option as written | Up to five options as choices, more as a list. A different capitalization of an option is accepted and stored as written here. 2 to 20 options, each up to 40 characters, with no `, \| ( ) :`, and no two that differ only in capitals. |
| `link` | A link that starts with `http://` or `https://` | A box that says so |

Steps and gates still use the bare name (`^rows`). Writing `name:text` is an error (just write `name`), so is an unknown kind or a name listed twice with a kind. A checklist with a typed detail, or with `number`, `yes-no` or `date` evidence, is published as a 2.0 version: an older Flightdeck names it and can't run it. A checklist without any stays exactly as before.

When a run starts from text (a plan, or a detail carried from a parent run), each typed detail is converted only when that's certain: `1234.50` becomes `1234.5`, `Y` becomes `yes`, `Prod` becomes `prod`. Anything else (`03/04/2026`, `1,234`) starts empty, with what it was shown beside it, until a person fills it in, and nothing that uses it (a step bound to it, a gate that approves it, a linked run that carries it) can go ahead before then. The run keeps a record of each conversion.

## Phases, steps and gates

| Line | Meaning |
|---|---|
| `## Title · READ-DO {#id}` | A phase where each step is read aloud, then done. |
| `## Title · DO-CONFIRM {#id}` | A phase where the work is done first, then confirmed together. |
| `## Title {#id}` | A phase without a mode. It works; the checks suggest choosing one. |
| `## Gate: Title · owner @role {#id}` | The gate at the end of the phase above it (`· owner @role` is optional, and is the only option a gate takes). Without one, the phase ends with an automatic confirm gate whose ID is `<phase id>-confirm`. |
| `  approves: text with ^details` | What passing the gate approves, shown on the confirm button. |
| `  > text` under a gate | The gate's note, shown above Pass the gate in every version. |
| `  > text` under a phase heading | The phase's note (Needs Flightdeck 2.0), shown under the phase's heading during a run. |
| `- [!] {type} Text {#id}` | A must-do step (can't be N/A, can't be waived). |
| `- [ ] {type} Text {#id}` | A step. |
| `- [~] {type} Text {#id}` | A step with automation planned. Still done by hand. |
| `@role` in a step | Who does it. A step can name more than one role. |
| `^detail` in a step | Ties the step to a run detail: if the detail changes, the step needs a re-check. |
| `  field: value` | A field of the step's type (see below). |
| `  > text` | A note shown in the step's panel. Markdown: **bold**, `code`, links, lists. |
| `  ![caption](images/…)` | A reference screenshot from the folder's `images/`. A step can have several (see Screenshots). Under a phase heading or a gate it Needs Flightdeck 2.0. |
| `### Track: Name @role {#id}` | Inside a phase: the steps below it, up to the next track or gate, are worked in parallel by that role (the editor calls tracks lanes). A step in a track without an `@role` of its own takes the track's roles. Every track finishes before the phase's gate. A track can't have a note or `only when`. |
| `  at: 15:00` | On a step or gate: it should start at that clock time on the run's day. |
| `  due: 17:30` | On a step or gate: it should be done by that clock time on the run's day. |
| `  sets: tag` | On a step: it produces these run details (comma-separated, each listed in `context`). Checking it asks for them; later `^tag` uses the value, and the start form leaves them out. Correcting the value re-checks later steps tied to it. |
| `  after: 2h` | On a step or gate: it should be done within that long after the run starts. |
| `  only when ^detail is value` | On a step, or right under a phase heading: it applies only when the run detail matches (Needs Flightdeck 2.1; see Only when). |

Clock times are read in the time zone of whoever started the run, so everyone sees the same moment in their own time. Give a step or gate one of `at:`, `due:` or `after:`, not more than one.

**IDs** (`{#id}`) are required on every phase, track, step and written gate. An ID is lowercase letters, numbers and dashes, starting with a letter or number (capitals are read as lowercase), at most 60 characters, and used once in the checklist. A phase without a written gate has the automatic gate ID `<phase id>-confirm`, so that ID is taken too. Keep a step's ID when you reword it; give genuinely new work a new ID; never reuse an old one.

## Screenshots

A step can show reference screenshots: one `![caption](images/…)` line each, indented under the step, in the order they're shown. The caption is plain text on one line, without `[` or `]`, and it's also the picture's alt text, so say what it shows. The file must be in the folder's `images/` (usually `images/<process>/`) as a PNG, JPEG, WebP or GIF. Its path uses only letters, numbers, `_`, `-`, `.` and `/` (no spaces, no `..`).

```markdown
- [ ] {confirm} Feature flags set in the deploy values {#flags}
  ![The flags page with checkout on](images/release/flags-1760000000000-w8k2m4q7xa-k3m9p2.png)
  ![The values file in the pull request](images/release/flags-1760000000123-w8k2m4q7xa-x7w1q4.png)
```

In the builder, select a step: its Screenshots section adds images with Choose files, by dropping them on it, or by pasting one. Each image is checked (PNG, JPEG, WebP or GIF, up to 5 MB, and its contents match), written once as `images/<process>/<step-id>-<time>-<window>-<random>.<ext>`, a name that includes the window adding it, so it never replaces another file, and read back; only then is its line added to the draft. Captions are edited in place, Move up and Move down reorder them, and Remove takes the line out of the draft only: the image stays in the folder, since other versions and runs may use it. Every one of these is a change Undo takes back, and nothing reaches the draft file until Save draft. Publishing copies each screenshot into the version, so a published version keeps its pictures even if `images/` changes later.

A phase can have a note and screenshots too, right under its heading and before its first step, and a gate can have screenshots under its note (both Need Flightdeck 2.0). In the builder, select a phase: its form has the note and a Screenshots section that works like a step's. During a run the phase's note and screenshots show under its heading until the phase is done, and a gate's show above Pass the gate.

```markdown
## Prepare · READ-DO {#prep}
  > Use the scratch server, never production.
  ![The scratch server's status page](images/backup/scratch.png)
- [ ] {confirm} Read the restore runbook {#read}

## Gate: Restored {#restored}
  > The restored copy opens and its row counts match.
  ![The row counts](images/backup/counts.png)
```

## Needs Flightdeck 2.0

A checklist that uses nothing on this list publishes as before, and every teammate can run it. One that uses any of these publishes a version that only Flightdeck 2.0 or later runs. The publish panel names what the draft uses before you publish; teammates on Flightdeck 1.22 or earlier see the version but can't run it until they update.

- A run detail with a kind (`rows:number` in `context`; see [Typed run details](#typed-run-details)).
- Typed evidence: `evidence: number`, `yes-no` or `date` on a step, or a step whose team step type records a number, a yes or no, or a date.
- A note on a phase (`  > text` under a phase heading).
- Screenshots on a phase (`  ![caption](images/…)` under a phase heading).
- Screenshots on a gate.
- `version:` on a `{run.process}` step (see [Nested processes](#nested-processes)).
- `skillVersion:` on a `{run.skill}` step (see [Skill versions](#skill-versions)).

A gate's note isn't on this list: every copy since 1.10 publishes it, and 2.0 shows it for every version.

`only when` goes one step further: a version that uses it needs Flightdeck 2.1, and the publish panel says **Needs Flightdeck 2.1** instead (see Only when).

## Only when

A step, or a whole phase, can apply only to some runs. Put `only when` under the step, or right under the phase heading before its first step. Every detail a condition tests is listed in `context`, with the kind its test needs:

```markdown
---
process: release
title: Release
context: hotfix:yes-no, risk:choice(low|high), amount:number
---

## Hotfix · DO-CONFIRM {#hotfix}
  only when ^hotfix is yes
- [!] {confirm} Page the on-call lead {#page}

## Release · READ-DO {#release}
- [ ] {confirm} Tell the change board {#board}
  only when ^risk is high
- [ ] {confirm} Get finance sign-off {#finance}
  only when ^amount is at least 10000
```

| Test | Works on |
|---|---|
| `^d is set`, `^d is not set` | Every detail, text and links included |
| `^d is v`, `^d is not v` | `number`, `yes-no`, `date`, `choice` |
| `^d is one of a\|b` | `choice` (2 to 20 values) |
| `^d is at least v`, `^d is at most v` | `number`, `date` |

The detail must be listed in `context:`, and only a typed detail can be compared: a plain-text detail (`context: risk`) can only be tested with `is set` or `is not set`, so `^risk is high` needs `risk:choice(low|high)`. Values are written as the detail's kind reads them (`High` is the choice `high`, `010.50` is `10.5`). Up to 4 `only when` lines on a step or phase, and all of them must match. A gate or a track can't have one: put it on the phase or its steps. A detail that a step sets (`sets:`) can decide only phases after that step's phase.

During a run each condition is read again from the run's details whenever they change:

- Matches: the step or phase applies as usual.
- Doesn't match: it's **Not needed**. It isn't counted, nobody checks it, and its reason is shown folded away. A phase whose own condition doesn't match, or whose steps are all Not needed, is skipped with its gate. An empty detail doesn't match any comparison, so `is not` matches it.
- Can't tell yet: when the detail is waiting for a person (a converted value to confirm) or holds a value that isn't valid, the step is **Waiting**: it counts as left to do and can't be checked until the detail is filled in.

Changing a detail that a checked step's condition uses asks for a re-check of that step, and gates that approved it go back to review. A checklist with `only when` publishes a version that needs Flightdeck 2.1: the publish panel says so before you publish, and every copy before 2.1, 2.0 included, names it and can't run it.

In the builder, a step's or a phase's form has one closed **Only when…** line (shown once the checklist has run details). Open it and write one condition a line, as after `only when`; leaving the box applies it, and a condition that can't be read is refused beside it. The builder writes each as `  only when ` and what you typed, in place, and leaves every other line as it was. `only when` lines written another way (another indent, capitals, spaces at the end) are shown but not changed there: edit them in Markdown. The process page and the flight plan show each condition as one muted line.

## Reports from tools

A tool that does a step's work can report it (docs/apps.md): the report names the step by its ID and its evidence by the step's evidence names (`flightdeck report targets` lists both). When a report depends on a run detail (a commit, a database), tie the step to that detail with `^detail` in its text: a later change to the detail then sends the step back for a re-check, in every copy. A step that isn't tied is only compared when the report is accepted.

## Step types

Each type has two kinds of fields. **Checklist fields** describe the step: the Jenkins job, the repo and branches, the Jira action. **Evidence** fields can be noted when the step is checked: build number, PR link, the decision.

Both are **optional by default**. A checklist can describe a step with only what's known ("open a PR", "create a Jira issue") so people and skills know what it involves; values that vary are filled in during the run, or never. **Bold** below marks the fields a step *usually* has: leaving one out is a tip on the process page, not an error. A wrong value (an `action` the type doesn't have) does block publishing.

To insist on evidence, add `require:` with the names to record, or `require: all`. Then checking the step opens a short form until those are filled in. Strict processes such as a release use it; most don't.

During a run, the recorder can **Fill in** any step's checklist fields and evidence as values become known (a Jenkins parameter, the PR link, a new issue key), before or after it's checked. Each change is logged, and the checklist's own value is shown next to anything changed. Filling in never sends a step back for a re-check; changing a run detail like `^commit` still does, including correcting a value a step set with `sets:` (later steps that used it go back for a re-check; the step that set it doesn't).

<!-- types:start (generated by tools/type-table.js) -->
| Type | For | Checklist fields (**usual**) | Evidence it can record |
|---|---|---|---|
| `confirm` | Check that something is true. | `where`, `looks` | nothing (use `evidence:`) |
| `communicate` | Tell people something. | **`channel`**, `audience`, `message` | `sent` |
| `meeting` | A scheduled conversation. | `attendees`, `agenda`, `join`, `outcome` | `outcome` |
| `decide` | A go/no-go or a choice. | **`options`**, `decider`, `criteria` | `decision`, `why` |
| `review` | Read or approve a document. | **`document`**, `focus` | `verdict`, `comments` |
| `wait` | Waiting on someone or something outside the team. | **`for`**, `contact` | `arrived` |
| `ui.action` | Do something by hand in a web tool. | **`system`**, `page` | `reference` |
| `jenkins.job` | Start or follow a Jenkins job by hand. | **`job`**, `page`, `parameters`, `stage` | `build`, `buildLink` |
| `bitbucket.pr` | Open, review or merge a Bitbucket pull request. | **`action`** (`open`, `review`, `merge`), **`repo`**, `from`, `to` | `pr`, `mergeCommit` (for merge) |
| `jira.issue` | Create or change a Jira issue by hand. | **`action`** (`create`, `update`, `transition`, `assign`, `link`), `issue` (unless create), `project` (for create), `issueType`, `status` (for transition), `assignee` (for assign), `linkTo` (for link), `set` | `key` (for create) |
| `run.process` | Start a linked run of another process; this step is done when it completes. | **`process`**, `carry` | nothing (use `evidence:`) |
| `run.command` | Shown as text to copy. Flightdeck never runs it. | **`command`**, `where`, `expected` | `result` |
| `run.script` | Shown as text to copy. Flightdeck never runs it. | **`script`**, `args`, `where`, `expected` | `result` |
| `run.skill` | Run a skill. | **`skill`**, `inputs`, `expected` | `output` |
| `ci.gate` | A build or test result for a specific commit. | **`pipeline`**, `page` | `run`, `runLink` |
| `jira.sprint` | Start or close a Jira sprint, move its unfinished issues, or set its goal. | **`action`** (`start`, `close`, `move-incomplete`, `set-goal`), **`board`**, **`sprint`**, `goal` (for set-goal) | `sprintLink`, `name` (for start), `dates` (for start), `carriedOver` (for close), `moved` (for move-incomplete) |
| `deploy` | Deploy a version of something to an environment. | **`environment`**, **`artifact`**, `version`, `tool`, `rollback` | `deployed`, `deployLink`, `finished` |
| `verify.health` | Watch a dashboard or metric for a while and say whether it stayed healthy. | **`dashboard`**, **`metric`**, `threshold`, `watch` | `result`, `observed`, `snapshot` |
| `github.pr` | Open, review, approve or merge a GitHub pull request. | **`action`** (`open`, `review`, `approve`, `merge`), **`repo`**, `pull` (unless open), `from`, `to` | `pr`, `checks`, `mergeCommit` (for merge) |
| `measure` | Record a number with its unit, like velocity or points carried over. | **`metric`**, `unit`, `where` | `value`, `unit` |
<!-- types:end -->

`version` on `{run.process}` and `skillVersion` on `{run.skill}` aren't in the table: they're pins (Needs Flightdeck 2.0), described under [Nested processes](#nested-processes) and [Skill versions](#skill-versions). No other type takes them.

Every type also accepts these nine fields:

- `link`: a link for the step.
- `expect`: how long it usually takes, like `25m`.
- `deadline`: `external` (the deadline is copied in from the real tool during the run) or a duration like `30m`.
- `evidence`: `link` or `note`, or in Flightdeck 2.0 `number`, `yes-no` or `date`. Checking the step then requires one.
- `require`: evidence names that must be recorded, or `all`.
- `at`, `due` and `after`: when it should start or be done (see the table above). A step takes one of the three, not more.
- `sets`: the run details it produces.

Durations are written like `20m`, `1h30m` or `90s` (`h`, `m` and `s`). Field values can use `^details`, like `parameters: TICKET=^ticket`; those aren't checked against `context`, so spell them exactly. Choices are matched without regard to capitals and stored as the type spells them (`action: Merge` is `merge`).

**Pull requests.** The editor shows one Pull request step, whose first question, "Where is the pull request?", is GitHub or Bitbucket. Files, reports and JSON keep the two types, `{github.pr}` and `{bitbucket.pr}`. Only GitHub has `action: approve`, the `pull` field and the `checks` evidence. Switching a step from GitHub to Bitbucket keeps every value and flags the ones Bitbucket doesn't use; those stop publishing until they're removed.

Recorded links must start with `http://` or `https://`. Flightdeck never calls Jenkins, GitHub, Bitbucket, Jira or any other tool; these types only make sure the right things are written down.

## Nested processes

A `{run.process}` step starts a linked run of another published process:

```markdown
- [ ] {run.process} Check in the release notes for this commit @release-lead {#notes}
  process: check-in
  carry: commit
```

`carry:` lists the run details passed to the child (all matching details if it's left out). The step is checked only by its child run: done when the child completes with the details it was started for, and blocked if it ends any other way (a new child can then replace it). It can't be ticked by hand; a step that isn't must-do can still be marked N/A. If a carried detail changes, the step goes back for a re-check and needs a new child run.

Add `version:` to run one exact version of the other process (Needs Flightdeck 2.0):

```markdown
- [ ] {run.process} Check in the release notes for this commit @release-lead {#notes}
  process: check-in
  version: 4
```

Publishing resolves `version: 4` to the one published folder numbered 4 and records it in the version. It stops the publish, saying why, when there's no v4 of that process in the folder, two folders are numbered 4, or v4 can't be used. Every run of the version starts its child on exactly that folder. If the folder is later missing or replaced, the step refuses to start the child: "This step runs Check in code v4, which can't be used here: …". It never falls back to the latest.

Without `version:`, a run made with Flightdeck 2.0 pins each linked process when it starts, at its latest version then, so a version published during the run doesn't change what it runs. A run made with Flightdeck 1.x follows the latest, as it always has, but never starts or adopts a child on a version only Flightdeck 2.0 runs. It offers **Start it as a Flightdeck 2.0 run** instead: a new run of the same version with the same details and roles and no answers, and the old step is marked Blocked, "Continued in run …".

## Skill versions

Add `skillVersion:` to a `{run.skill}` step to say which version of the skill it expects (Needs Flightdeck 2.0):

```markdown
- [ ] {run.skill} Write the release notes @release-lead {#write}
  skill: release-notes
  skillVersion: 1.2.0
```

When the step is checked in a run made with Flightdeck 2.0, the run records the skill's registration as it was then: "Registered as release-notes 1.2.0 when this step was checked". If the team folder registers another version, the step shows a warning ("This step expects release-notes 1.2.0. The team folder registers 1.3.0.") and can still be checked.

## Team step types

A team can add its own types as `step-types/<id>.json` in the team folder. The file name must match the `id`, the id can't reuse a built-in one, and two files can't define the same id:

```json
{
  "id": "change.request",
  "label": "Change request",
  "icon": "doc",
  "hint": "A change request the change board approves before production work.",
  "group": "Releases / Approvals",
  "tags": ["cab", "production"],
  "fields": { "system": { "label": "Change system", "kind": "text", "required": true } },
  "record": [ { "name": "number", "label": "Change number", "kind": "text" } ]
}
```

Field kinds are `text`, `url`, `code`, `message`, `list` and `choice` (with `options`); evidence kinds are `text`, `url` and `choice`, and in Flightdeck 2.0 also `number` (with optional `min` and `max`, written as plain decimals like `"0"`, and `unit`, up to 20 characters), `yes-no` and `date`. A file that records one of those three is a 2.0 step type: it starts with `"format": "flightdeck-step-type/2"` and `"features": ["typed-evidence"]`, and Flightdeck says so if they're missing. A teammate on an older Flightdeck sees it as a type they can't use until they update. In a 2.0 file, a choice's options can't differ only in capitals. `group` (optional, up to 80 characters, levels separated by `/`) and `tags` (optional, up to 10 short words) only organize the Step types page; they're never frozen into a version, so changing them doesn't change any process or skill. Publishing freezes the type into the publication, so a later edit to the file never changes an old version. A broken file is listed on the process page and its type can't be used.

The limits a team step type is checked against:

- `id`: lowercase letters, numbers and dashes in parts separated by dots, starting with a letter (`change.request`), at most 40 characters.
- `label`: 1 to 40 characters. `hint`: at most 120.
- `icon`: one of `check`, `chat`, `people`, `fork`, `doc`, `hourglass`, `cursor`, `gear`, `merge`, `ticket`, `terminal`, `script`, `spark`, `pipeline`, `nest`. Any other icon shows as `check`.
- `fields`: at most 30. A field name starts with a letter and has up to 30 letters, numbers, `_` or `-`, and can't be one of the nine fields every type accepts (`link`, `expect`, `deadline`, `evidence`, `require`, `at`, `due`, `after`, `sets`). Each field has a `label` of 1 to 40 characters and a `kind`. `"required": true` marks a field a step usually has: a tip when it's left out, never a blocker. Only a `choice` has `options`: a list of texts of up to 40 characters.
- `record`: at most 20, each with a `name` (the same rules as a field name, used once, never `evidence`, never starting with `jf-` or `rd-`, never a name like `constructor`), a `label` of 1 to 40 characters and a `kind`. `"long": true` gives a multi-line box. Only a `number` has `min`, `max` and `unit`.
- `group`: at most 80 characters. `tags`: at most 10, each up to 30 characters, without commas.
- No other top-level keys, apart from `format`, `features` and `app` in a file that has a format.

Flightdeck reads at most 100 files in `step-types/`.

## Jira workflows

`jira/workflows.json` describes the team's real Jira workflow per issue type: its statuses, its transitions and the fields each transition requires.

```json
{
  "Story": {
    "statuses": ["To Do", "In Progress", "In Review", "Done"],
    "transitions": [
      { "from": "In Progress", "to": "In Review", "fields": [
        { "name": "Reviewer", "hint": "The person reviewing the pull request", "source": "role:reviewer" }
      ] },
      { "from": "*", "to": "Done", "fields": [ { "name": "Resolution", "hint": "Usually Done", "options": ["Done", "Won't Do"] } ] }
    ]
  }
}
```

A `{jira.issue}` step with `action: transition` must move to a status the workflow has and some transition reaches (name `issueType:` when the file has more than one type). When the run reaches that step, Flightdeck asks for the transition's required fields, shows each field's `hint`, and fills in the value where `source` says: `detail:<run detail>`, `role:<role>` (that person's name) or `value:<fixed text>`. The step can't be checked until they're filled in. A run copies the workflow when it starts. Without the file, transitions aren't checked.

## What stops a checklist from publishing

Publishing lists every problem with its line. These stop it:

- **Front matter:** a missing `process` or `title`; a `process` that isn't lowercase letters, numbers and dashes; a line that isn't `key: value`; a `format:` or `features:` line that doesn't fit what the checklist uses (see Front matter); `runs:` other than `solo` or `team`.
- **Run details and roles:** more than 40 run details; a name that isn't letters, numbers, dashes or underscores up to 60 characters; a name Flightdeck keeps for itself (`constructor`, `__proto__`); a typed detail written `name:text`, with an unknown kind, listed twice with a kind, or a `choice` with fewer than 2 or more than 20 options, an option over 40 characters or holding `, | ( ) :`, or two options that differ only in capitals.
- **Structure:** no phases; a phase with no steps; a step, track or gate outside a phase, or a step or track after its phase's gate; a second gate on a phase; a gate option other than `owner @role`; a track with no name or no steps; a note that doesn't follow a phase heading, a step or a gate (a track takes no note); any other line Flightdeck doesn't understand.
- **IDs:** a phase, track, step or written gate without an ID; an ID over 60 characters; an ID used twice, the automatic `<phase id>-confirm` gate IDs included.
- **Steps and fields:** a step with no type, or an unknown one (a team type whose file is broken is unknown); a field the type doesn't have (for example `pull:` on `{bitbucket.pr}`); a value outside a field's choices (`action:`, `evidence:`); `options:` with fewer than two choices; `require:` naming evidence the type doesn't record; a bad `expect:`, `deadline:`, `at:`, `due:` or `after:`; more than one of `at:`, `due:` and `after:` on a step or gate; a `version:` that isn't a whole number, or a `skillVersion:` that isn't a version like `1.2.0`, or one on a step without `skill:`.
- **Roles and details in use:** an `@role` (on a step, track or gate) not listed in `roles`; a `^detail` in a step's text or a gate's `approves:` not listed in `context`; `sets:` naming a detail not in `context`; two `sets:` names too alike to tell apart.
- **Linked runs:** a `{run.process}` step that runs its own process, carries a detail that isn't in `context`, or both carries and sets the same detail; a `version:` with no such version of that process in the folder, two versions with that number, or one that can't be used.
- **Jira:** with `jira/workflows.json`, a transition to a status the issue type's workflow doesn't have or no transition reaches, or a workflow file that can't be read or has errors.
- **Screenshots:** a path outside `images/`, with characters other than letters, numbers, `_`, `-`, `.` and `/`, or a file that isn't in the folder.
- **Only when:** a line that can't be read; one that tests a detail not in `context`, or uses a test its kind doesn't allow; more than 4 on a step or phase; one on a gate or a track; one that tests a detail set (`sets:`) in the same phase or a later one.
- **Questions:** a `## Questions` section. It's where an AI assistant, or anyone writing the draft, leaves open questions for the owner; answer them and remove it.

Suggestions (phase modes, phases over 9 steps, step length, filler words like "make sure", no must-do steps, a usual field left out, an owner or backup not in `people.json`, a linked process that isn't published yet) don't stop it.

Only the syntax on this page is understood. Anything else (a field a step type doesn't have, a heading Flightdeck doesn't know) stops publishing, apart from front-matter keys, which are kept and ignored. A published version that contains such a line, written by hand or by a newer Flightdeck, shows as "can't be used here": this copy won't start or plan a run on it. Never edit a published version; publish a new one.
