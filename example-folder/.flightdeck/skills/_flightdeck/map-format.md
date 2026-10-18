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
| `process` | yes | The process ID: lowercase letters, numbers and dashes. Stays the same forever. |
| `title` | yes | What people see. |
| `category` | no | Groups processes on Home. |
| `owner` | no | A person ID from `people.json`. |
| `group` | no | Where the process sits in the team's hierarchy, separated by `/` (`Engineering / Releases`). Without it, the category. |
| `tags` | no | Labels to filter by (`production, deploy`). |
| `context` | no | Run details filled in when a run starts (`ticket, commit, environment`). At most 40, each a name of letters, numbers, dashes or underscores up to 60 characters. |
| `roles` | no | Roles people are assigned to in each run. |
| `runs` | no | `solo` if one person usually runs it alone (every role goes to whoever starts it), or `team` (the default). |

## Phases, steps and gates

| Line | Meaning |
|---|---|
| `## Title · READ-DO {#id}` | A phase where each step is read aloud, then done. |
| `## Title · DO-CONFIRM {#id}` | A phase where the work is done first, then confirmed together. |
| `## Gate: Title · owner @role {#id}` | The gate at the end of the phase above it. Without one, a phase ends with "confirm together". |
| `  approves: text with ^details` | What passing the gate approves, shown on the confirm button. |
| `- [!] {type} Text {#id}` | A must-do step (can't be N/A, can't be waived). |
| `- [ ] {type} Text {#id}` | A step. |
| `- [~] {type} Text {#id}` | A step with automation planned. Still done by hand. |
| `@role` in a step | Who does it. |
| `^detail` in a step | Ties the step to a run detail: if the detail changes, the step needs a re-check. |
| `  field: value` | A field of the step's type (see below). |
| `  > text` | A note shown in the step's panel. Markdown: **bold**, `code`, links, lists. |
| `  ![caption](images/…)` | A reference screenshot from the folder's `images/`. |
| `### Track: Name @role {#id}` | Inside a phase: the steps below it, up to the next track or gate, are worked in parallel by that role. Every track finishes before the phase's gate. |
| `  at: 15:00` | On a step or gate: it should start at that clock time on the run's day. |
| `  due: 17:30` | On a step or gate: it should be done by that clock time on the run's day. |
| `  sets: tag` | On a step: it produces these run details (comma-separated, each listed in `context`). Checking it asks for them; later `^tag` uses the value, and the start form leaves them out. Correcting the value re-checks later steps tied to it. |
| `  after: 2h` | On a step or gate: it should be done within that long after the run starts. |

Clock times are read in the time zone of whoever started the run, so everyone sees the same moment in their own time. Give a step or gate one of `at:`, `due:` or `after:`, not more than one.

**IDs** (`{#id}`) are required on every phase, step and written gate. Keep a step's ID when you reword it; give genuinely new work a new ID; never reuse an old one.

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
<!-- types:end -->

Every type also accepts `link`, `expect` (how long it usually takes, like `25m`), `deadline` (`external` means the deadline is copied in from the real tool during the run) `evidence` (`link` or `note`: checking the step then requires one) and `require` (evidence names that must be recorded, or `all`). Field values can use `^details`, like `parameters: TICKET=^ticket`.

Recorded links must be `https://` links. Flightdeck never calls Jenkins, Bitbucket or Jira; these types only make sure the right things are written down.

## Nested processes

A `{run.process}` step starts a linked run of another published process:

```markdown
- [ ] {run.process} Check in the release notes for this commit @release-lead {#notes}
  process: check-in
  carry: commit
```

`carry:` lists the run details passed to the child (all matching details if it's left out). The step is checked only by its child run: done when the child completes with the details it was started for, and blocked if it ends any other way (a new child can then replace it). It can't be ticked by hand; a step that isn't must-do can still be marked N/A. If a carried detail changes, the step goes back for a re-check and needs a new child run.

## Team step types

A team can add its own types as `step-types/<id>.json` in the team folder. The file name must match the `id`, and the id can't reuse a built-in one:

```json
{
  "id": "change.request",
  "label": "Change request",
  "icon": "doc",
  "hint": "A change request the change board approves before production work.",
  "fields": { "system": { "label": "Change system", "kind": "text", "required": true } },
  "record": [ { "name": "number", "label": "Change number", "kind": "text" } ]
}
```

Field kinds are `text`, `url`, `code`, `message`, `list` and `choice` (with `options`); evidence kinds are `text`, `url` and `choice`. Publishing freezes the type into the publication, so a later edit to the file never changes an old version. A broken file is listed on the process page and its type can't be used.

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

A line Flightdeck doesn't understand, a missing or duplicate ID, a missing or unknown type, a field the type doesn't have, a value outside a field's choices (`action:`, `evidence:`, `runs:`), `require:` naming evidence the type doesn't record, a role or detail that isn't declared, a bad `expect:`, `deadline:`, `at:`, `due:` or `after:`, a track with no steps or an unknown role, a `{run.process}` step that runs its own process or carries a detail it doesn't have, a Jira transition the team's workflow doesn't have, a screenshot outside `images/` or missing from the folder, or a `## Questions` section. Suggestions (phase types, step length, filler words like "make sure", a usual field left out) don't stop it.
