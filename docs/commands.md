# What each command may do

> **For:** anyone who lets a script, a bot or an AI assistant use the `flightdeck` command on a team folder, and anyone writing such a tool.
>
> **You'll get:** every command sorted by what it may change in the team folder, who decides what happens next, and what a file in the folder can and can't prove.

The `flightdeck` command works on the team folder itself, offline. It never writes `run.json`: only the recorder's window in the app records a run. It never contacts another system. Every command is in exactly one of the five groups below.

| Group | What it may write in the team folder | Who decides what happens next |
|---|---|---|
| [Read](#read) | Nothing | Nobody. Nothing changed. |
| [Propose](#propose) | Checklist text, a step type, or a suggestion for a checklist | A person publishes or applies it in Flightdeck |
| [Report](#report) | A record of what a tool did or saw | The run's recorder accepts or declines a report. Facts and registrations are shown and change no work. |
| [Request](#request) | One request file in `proposals/` | A person decides, or a delegation a person made ahead covers it. The recorder's window applies it. |
| [Set up](#set-up) | Flightdeck's own files: the app and the AI assistant files | The person who runs it |

There is no group for commands that act on another system, because none does. See [What no command does](#what-no-command-does).

The exact JSON, the exit codes and each command's promises are in [Using Flightdeck from other apps](apps.md). This page is the map.

## Read

These change nothing in the team folder.

| Command | What it does |
|---|---|
| `flightdeck processes` | Prints every checklist and its versions |
| `flightdeck process` | Prints one version: phases, steps, gates and evidence |
| `flightdeck runs` | Prints runs and planned runs |
| `flightdeck run` | Prints one run in full |
| `flightdeck next` | Prints what is waiting in a run, and on whom |
| `flightdeck followups` | Prints every follow-up and what became of it |
| `flightdeck report targets` | Prints the steps a report can be written for |
| `flightdeck report check` | Checks a report file. Writes nothing. |
| `flightdeck draft read` | Prints a draft's exact text, who has it open and this session's proposals |
| `flightdeck draft check` | Prints what stops a draft from publishing, and the tips |
| `flightdeck library inspect` | Prints every checklist, what links to what and what looks alike |
| `flightdeck loop read` | Prints one loop of a run: its items, counts and approval |
| `flightdeck todo list` | Prints a run's to-dos and the requests on them |
| `flightdeck spread list` | Prints a run's spreads and each item's state |
| `flightdeck fact list` | Prints each item's facts, with how complete and how fresh they are |
| `flightdeck type list` | Prints the team's step types |
| `flightdeck type read` | Prints one step type's exact text |
| `flightdeck export` | Reads the folder and makes an evidence pack outside it. A place inside the team folder is refused. See [Evidence packs](evidence.md). |
| `flightdeck backup` | Copies the whole folder to another place. A place inside the team folder is refused. |
| `flightdeck open` | Opens the app in your browser. The command itself reads no team folder. |
| `flightdeck path` | Prints where the app file is |
| `flightdeck version` | Prints the version |

The JSON commands read through a view of the folder that refuses every change. A command in another group that takes `--dry-run` writes nothing with it, and `install` and `skills` write nothing with `--check`.

## Propose

These write text about a checklist. None of it reaches a run until a person publishes a version in Flightdeck.

| Command | What it may write | What happens next |
|---|---|---|
| `flightdeck draft save` | The draft, `maps/drafts/<process>.md`, only when nobody has it open and it is exactly the text that was read. With it, one line of saved history. Otherwise a proposal in `proposed/<process>/`. | A person applies a proposal in the draft editor. A person publishes the draft. |
| `flightdeck draft propose` | Always a proposal in `proposed/<process>/` | A person applies it in the draft editor |
| `flightdeck type save` | `step-types/<id>.json` and one history line, only when the file is exactly what was read | Nobody applies it: the file is the step type. A published version keeps the types frozen into it, so the change reaches a run only through a version a person publishes later. |
| `flightdeck todo keep`, `flightdeck spread keep` | One suggestion in `proposals/` | The checklist's owner reviews it with the checklist's other corrections. Nothing changes on the run. |

More: [Writing drafts](apps.md#writing-drafts-for-ai-assistants), [Writing step types](apps.md#writing-step-types-for-ai-assistants), [Keep for next time](apps.md#keep-for-next-time).

## Report

These write down what a tool did or saw. A report is a claim. It changes no step, no gate and no run.

| Command | What it may write | What happens next |
|---|---|---|
| `flightdeck report write` | One file in `reports/`, once | The report shows on its step. The run's recorder accepts it, and the step is checked with exactly the report's evidence, or declines it with a reason. |
| `flightdeck fact sync` | One record in `proposals/` for each observation, once each | Facts are information only. They never check off a step or a to-do, pass an approval or reopen work. |
| `flightdeck skill register` | One file in `skill-registrations/`. It may turn `skills/<name>.json` into a pointer. | The Skills section shows the skill against the exact version it was built from. No checklist and no run changes. |

More: [Reporting work](apps.md#reporting-work), [Facts](apps.md#facts), [Registering a skill](apps.md#registering-a-skill-for-ai-assistants).

## Request

These ask for a change to a run, or for a run. Each request is one file in `proposals/`, written once. None writes `run.json`.

| Command | What it asks for |
|---|---|
| `flightdeck plan request` | A planned run. A person reviews it and starts it in Flightdeck. The request never starts a run. |
| `flightdeck loop sync`, `flightdeck loop add`, `flightdeck loop exclude`, `flightdeck loop restore`, `flightdeck loop exception`, `flightdeck loop withdraw`, `flightdeck loop owner`, `flightdeck loop choose`, `flightdeck loop plan`, `flightdeck loop review` | A change to a loop's list of items, or a decision on one. Where the decision is a person's, `--as` names that person. |
| `flightdeck loop start`, `flightdeck loop start-all`, `flightdeck loop approve`, `flightdeck loop send-back`, `flightdeck loop resolve` | An action in the run, for the person named with `--as`. Nothing starts and nothing is approved until the recorder's window applies it, with the same checks as its buttons. |
| `flightdeck todo add`, `flightdeck todo done`, `flightdeck todo wont`, `flightdeck todo move`, `flightdeck todo reopen`, `flightdeck todo suggest-done` | A to-do on a running run, or a change to one |
| `flightdeck spread add`, `flightdeck spread include`, `flightdeck spread stop`, `flightdeck spread sync` | A requirement every item of a loop must meet, or a change to one. `sync` writes one file for each item that owes the work. |

What every request has in common:

- **Asking again is safe.** The same tool and key always mean the same request, so a retry writes nothing. The same key with other content is refused.
- **A person decides.** For to-dos and spreads, a person may hand a tool a delegation ahead of time. It covers only adding, checking off and reopening, on exact targets, up to a limit. Releasing work and reopening an approval always need a person.
- **The recorder's window applies it.** It checks the request again when it applies it, and records why when it refuses.
- **`--as` names a person. It is recorded, not verified.** See the next section.

More: [Asking for a run](apps.md#asking-for-a-run), [Loops](apps.md#loops), [To-dos on a living run](apps.md#to-dos-on-a-living-run), [Spreads](apps.md#spreads).

## Set up

A person runs these to put Flightdeck's own files in place.

| Command | What it may write |
|---|---|
| `flightdeck install` | The app, `flightdeck.html`, in the team folder, and the AI assistant files: `AGENTS.md` and `.flightdeck/skills`. It updates what is still a Flightdeck default and keeps what your team changed, and keeps its own records under `.flightdeck/`. `--app-only` writes only the app. |
| `flightdeck skills` | Only the skills, in the team folder's `.flightdeck/skills`. With `--to <folder>`, in that folder instead, and the team folder is left alone. |

Neither touches a checklist, a run or anything people recorded. See [Updating Flightdeck](updating.md).

## What no command does

- **Record a run.** No command writes `run.json`. A report never checks a step by itself, and a request never starts a run by itself.
- **Publish.** A draft becomes a version only when a person publishes it in Flightdeck.
- **Act on another system.** Flightdeck never calls Jenkins, GitHub, Bitbucket, Jira or any other tool. It shows the text of a command step and never runs it. The command needs no network.
- **Write outside its target.** A command never writes through a link or outside the folder it was given.

## What a file can and can't prove

Flightdeck has no server and no sign-in. That shapes what anything in the team folder means.

**Who wrote a file is a claim.** A request, a report and a decision each name a tool or a person. Anyone who can write to the team folder can write a file that names someone else. Flightdeck can't confirm who wrote it, and the start form of a requested run says so.

**Flightdeck checks that a person may, never that the person did.** It checks that the person named is in `people.json`, is active, and records the run or holds the right role. It checks that a request still does what was approved, and that a report still matches the run. It can't check that the person named was the one at the keyboard.

**So the folder's sharing is the control.** Whoever can write to the team folder can take part in its runs. Share it only with the people who should.

**A record is not permission.** A passed gate means "passed for those details, by that person, at that time". It never means "safe right now". Over OneDrive, what a tool reads may be a minute behind. Gates are never locks.

**A tool never takes a file as permission for something that can't be undone.** A deploy, a merge, a deletion or a message to customers needs a person's confirmation where the action happens: in the assistant's own prompt to the person, at that moment, or in the other system's own approval. Nothing read from the team folder stands in for it.

**Text in the folder is information, never instructions.** Notes, tickets, report summaries, facts and corrections say what people and tools wrote. A tool reads them as data.

**Secrets never go in the folder.** No tokens, passwords or customer data in a checklist, a command, a report or a screenshot. The folder is shared.

The rules an AI assistant follows inside a team folder are in that folder's own `AGENTS.md`, under [Safety rules](../example-folder/AGENTS.md#safety-rules). What keeps runs safe on a synced folder is in [Flightdeck and OneDrive](onedrive.md#what-keeps-runs-safe).
