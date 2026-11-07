# Checklist essentials

Nothing here allows you to write a file `AGENTS.md` tells you not to. This is the syntax most checklists need, from the front matter down; `map-format.md` beside this file (a copy of `docs/map-format.md` in the Flightdeck repository) has all of it, and *Writing a checklist* in `AGENTS.md` has the rules every checklist follows.

## Writing a checklist

Design it before you write it: `good-checklists.md` beside this file says how (the design brief, the library, one checklist or several).

The essentials:

### Front matter

- `process`, `title`, `category`, `group` (its place in the hierarchy, like `Engineering / Releases`), `tags`, `owner` (a person ID from `people.json`), `backup` (optional: another person ID, who signs off only while the owner is inactive or gone), `context` (run details), `roles`, and `runs: solo` when one person usually runs it alone.
- **Many processes are solo**: a developer's check-in, a product owner's weekly Jira cleanup. Write those for one person: `runs: solo`, one role or none, no "together" steps. Example:

  ```markdown
  ---
  process: jira-cleanup
  title: Weekly Jira cleanup
  runs: solo
  context: board
  ---
  ## Triage new issues · READ-DO {#triage}
  - [!] {confirm} Every new issue has a component and a priority ^board {#fields}
  - [ ] {jira.issue} Duplicates linked to the original and closed {#dupes}
    action: link
  ```

### Steps

- Every phase, step and written gate has a stable ID: `{#id}`.
- **Every step has a type**: `{confirm}`, `{communicate}`, `{meeting}`, `{decide}`, `{review}`, `{wait}`, `{ui.action}`, `{jenkins.job}`, `{bitbucket.pr}`, `{jira.issue}`, `{jira.sprint}`, `{github.pr}`, `{deploy}`, `{verify.health}`, `{measure}`, `{run.command}`, `{run.script}`, `{run.skill}`, `{ci.gate}`, `{run.process}`, plus any team types in `step-types/`. Pick the most specific one: a Jenkins job is `{jenkins.job}`, not `{ui.action}`.
- **Fill in the fields you know** (the table in the repo's `docs/map-format.md`): the job, the repo and branches, the Jira action. Leave out values that change each run; people fill them in during the run. Use `^details` for run values, like `parameters: TICKET=^ticket`, spelled exactly as in `context`: checks name a field's `^word` that isn't a run detail, and a run shows it as written.
- **Require evidence only where it matters**: add `require: build` (or `require: all`) on steps like a production deploy. Add `evidence: link` or `evidence: note` when a plain confirm needs proof. Most steps need neither.
- Keep steps to one line; put explanations in an indented `>` note.
- Don't pad phases to reach a number of steps. Two real steps beat five invented ones.

### Tracks and times

- **Parallel work** goes in tracks: `### Track: Name @role {#id}` inside a phase. **Times** go on steps or gates: `at: 15:00` or `due: 17:30` (clock times on the run's day, in the run's time zone), or `after: 2h` from the run's start.

### Run details

- **A run detail that's always a number, yes or no, date, one of a few choices or a link** (Flightdeck 2.0): give it a kind in `context`, like `rows:number, due:date, approved:yes-no, env:choice(dev|test|prod), runbook:link`. Leave everything else plain text. See map-format.md, Typed run details.
- **A value one step creates and later steps use** (a release tag, a build number): list it in `context`, put `sets: tag` on the step that creates it, and use `^tag` after that, in a later phase (checks flag a use the run may reach before it's set). Don't ask for it when the run starts.
- **A step or phase that only some runs need** (Flightdeck 2.1): put `only when ^risk is high` under the step, or right under the phase heading, with `risk:choice(low|high)` in `context`. Test only details listed in `context`. `is`, `is not`, `is one of`, `is at least` and `is at most` need a typed detail (`risk:choice(low|high)`, `amount:number`; see map-format.md, Typed run details); a plain-text detail can only be tested with `is set` or `is not set` (`only when ^ticket is set`).

### Linked processes and Jira

- **Another process inside this one** is a `{run.process}` step with `process:` and `carry:`. Don't copy another checklist's steps in. Add `version: 4` to run exactly that version of the other process (Flightdeck 2.0). Use `pass: environment=^env, region=us-east-1, notify=?` when a detail goes under another name, as a fixed value, or should be asked when the child starts (Flightdeck 2.8). Without it, a run made with Flightdeck 2.0 pins each linked process at its latest version when the run starts.
- **A result the parent can trust** (Flightdeck 3.0): when a checklist ends in a verdict that another checklist waits on, give it `result: <detail>` (a choice in `context`, like `disposition:choice(cleared|needs-work)`) and bind its one `{decide}` step with `sets: disposition=decision`, its `options:` the same choices in the same order. The linking `{run.process}` step adds `accepts: cleared` and, to keep the value, `sets: story_result=result`. Any other result holds that step and keeps its gate closed. Use it only for a verdict someone acts on; see map-format.md, Module results.
- **What a Jira search must find** (Flightdeck 2.16) is a `{jira.search}` step: `query:` (JQL, with `^details` only where a single value goes) or `filter:`, and `results: none` (or `any`, `exactly N`, `at least N`, `at most N`). One rule per search. Start with a scope search (`results: at least 1`, the release's stories) so an empty or misspelled release can't pass. Never write "all stories ready" as one `{confirm}`. Write a `^detail` in JQL without quotes (`fixVersion = ^version`): Flightdeck quotes the value. Publishing needs the team's Jira address in Team values. See map-format.md, Jira searches.
- **Jira transitions** name `issueType:` and a `status:` from `jira/workflows.json`. When you add a transition's required fields there, give each a `hint` saying what the value is or where it comes from, and a `source` (`detail:`, `role:` or `value:`) when Flightdeck can fill it in.
