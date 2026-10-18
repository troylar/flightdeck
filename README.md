<div align="center">

<picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/banner-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/banner-light.png" alt="Flightdeck: fly it by hand, then put it on autopilot" width="1000"></picture>

<br>

[![npm](https://img.shields.io/npm/v/@troylar/flightdeck?color=e7a300&label=npm)](https://www.npmjs.com/package/@troylar/flightdeck)
[![license](https://img.shields.io/badge/license-MIT-1d7650)](#license)
[![dependencies](https://img.shields.io/badge/dependencies-0-1d7650)](#safe-by-design)
[![offline](https://img.shields.io/badge/runs-offline-16202a)](#safe-by-design)
[![node](https://img.shields.io/badge/node-%E2%89%A518-5a55a8)](#install)

**[Install](#install)** · **[Tour](#a-tour)** · **[Write a checklist](#a-checklist-in-twenty-lines)** · **[Process to skill](#process-to-skill-traceability)** · **[FAQ](#faq)**

</div>

<br>

Every team has processes that live in someone's head: the release, the check-in, the incident, the sprint start. Flightdeck writes them down as **checklists**, runs them with **gates** between phases, and keeps a record of every run. Once a version is proven, it becomes the brief your AI assistant uses to build a **skill**: reusable instructions for the assistant. Flightdeck links each registered skill to the process version and steps it follows, and flags when a process change affects it.

It's **one HTML file**. No server, no sign-in, no network, no AI inside. It works offline in Edge or Chrome and keeps everything in a folder your team already shares.

<p align="center"><a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/run-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/run-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/run-light.png" alt="A release in progress: run details including a release tag set by an earlier step, roles, phases on the left with their gates, the current phase, and step notes on the right" width="1000"></picture></a></p>

<br>

## The loop

<p align="center"><a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/loop-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/loop-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/loop-light.png" alt="Write a checklist, publish a frozen version, run it, prove it with three clean runs and the owner sign-off, then your AI assistant builds the skill from the brief. A step done differently becomes a suggested checklist change; a new version that changes a covered step marks the skill as needing an update." width="1000"></picture></a></p>

Flightdeck keeps checklists and run records together, links to skills stored elsewhere, and flags process changes that affect them.

<br>

## Install

```bash
npm install -g @troylar/flightdeck

flightdeck open                        # opens the app on built-in examples
flightdeck install ~/OneDrive/Team     # puts flightdeck.html in your team folder
flightdeck skills  ~/OneDrive/Team     # adds the skills for your AI assistant there
```

Then open `flightdeck.html` from the team folder, go to **Settings → Open team folder**, pick the same folder, and choose who you are in the top right. That's the whole setup.

> **Prefer no npm?** `flightdeck.html` is self-contained. Copy it anywhere and open it.

<br>

## A tour

`flightdeck open` starts on a team folder with a month of history in it. Choose **Casey Nguyen** in the top right and follow along. Six sections sit in the top bar: **Home, Runs, Processes, Skills, Step types, Settings**.

<table>
<tr>
<td width="50%" valign="top">

**Home** shows only what needs you, each with one button: the run you're recording, a plan to review, a skill to update.

<a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/home-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/home-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/home-light.png" alt="Home: three things that need you, each with one button, and counts of runs, processes, skills and step types"></picture></a>

</td>
<td width="50%" valign="top">

**Processes** are your templates, in your team's own hierarchy and tags. **New process** starts one.

<a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/processes-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/processes-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/processes-light.png" alt="Processes: the team templates grouped by hierarchy, with tags, skill counts and last run"></picture></a>

</td>
</tr>
<tr>
<td valign="top">

**A process** is one page: its checklist with skill badges, whether it's ready for a skill, its skills, versions and recent runs.

<a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/process-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/process-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/process-light.png" alt="The Production release process: the v2 checklist, Ready for a skill, two skills marked needs update, versions and recent runs"></picture></a>

</td>
<td valign="top">

**Edit** in place: the Markdown beside a live check and preview. If the draft changed since you opened it, you see both and choose.

<a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/edit-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/edit-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/edit-light.png" alt="Editing a draft: the Markdown on the left, Ready to publish and a live preview on the right"></picture></a>

</td>
</tr>
<tr>
<td valign="top">

**Skills**: every skill built from your processes, wherever it lives, and which ones need an update.

<a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-light.png" alt="Skills: two skills that need an update, then every skill in the team hierarchy with tag filters"></picture></a>

</td>
<td valign="top">

**A skill** says what changed under it and gives your LLM the exact before and after.

<a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-light.png" alt="The release-deploy skill: needs an update because one of its steps changed in v2, with a Copy the update brief button and where the skill lives"></picture></a>

</td>
</tr>
</table>

<br>

## What it does

<table>
<tr>
<td width="50%" valign="top">

### Checklists with teeth
Every phase ends at a **gate**. Nothing after it opens until someone passes it, and a gate approves exactly what it says: `deploy of d9d8514 to production`. Must-do steps can't be skipped. Change the commit mid-run and every step tied to it comes back for a re-check.

</td>
<td width="50%" valign="top">

### One recorder, everyone watching
One person records; everyone else follows on their own screen and adds notes and screenshots to any step. Hand recording over, or pick it up from another window. Two computers saving at once never overwrite each other: the loser becomes a copy you can compare and keep.

</td>
</tr>
<tr>
<td valign="top">

### Steps that know their tools
Steps are typed: `jenkins.job`, `bitbucket.pr`, `jira.issue`, `run.command`, `decide`, `review` and more, plus your team's own types. Each asks for the evidence that matters (a build number, a PR link, a decision) only where the checklist says it's required.

</td>
<td valign="top">

### Jira, the way it really is
Point Flightdeck at your real Jira workflow and a transition can't publish if Jira can't make it. Checking it asks for the transition's required fields, with a hint for each, and fills in the ones it can from the run.

</td>
</tr>
<tr>
<td valign="top">

### Time, tracks and pauses
Give a step a clock time, a deadline, or "within 2 hours of starting" and it gets a badge, a place on the day timeline, and a reminder. Split a phase into parallel tracks. Pause a run with a reason; paused time never counts.

</td>
<td valign="top">

### Processes inside processes
A step can start another process as a linked child run, passing on the details it needs. The parent step is checked only when that child completes, with the same values it was started for.

</td>
</tr>
<tr>
<td valign="top">

### Values that flow
A step can **set** a run detail: the merge step records the release tag, and every later `^tag` in commands, messages and Jira fields uses it. Correct it later and the steps that used the old value come back for a re-check.

</td>
<td valign="top">

### Runs that teach the checklist
Every "did it differently", every block, every re-check is kept. A process's **How runs go** shows typical time per phase, the steps that go off-script most, and who has never held which role yet, so the next rotation is obvious.

</td>
</tr>
</table>

<br>

## A checklist, in twenty lines

Checklists are Markdown. Your LLM writes them; people publish them.

```markdown
---
process: release
title: Production release
group: Engineering / Releases
tags: production, deploy
owner: person-casey
context: ticket, commit, environment, tag
roles: release-lead, qa, backend
---

## Before production changes · DO-CONFIRM {#prep}
- [!] {ci.gate} Full test gate green on the release commit ^commit {#tests}
  require: run

## Gate: Ready to deploy · owner @release-lead {#ready}
  approves: deploy of `^commit` to ^environment

## Deploy · READ-DO {#deploy}
- [!] {bitbucket.pr} Merge the release branch to master ^commit @release-lead {#merge}
  sets: tag
- [!] {jenkins.job} Start the production deploy job ^tag @backend {#jenkins}
  parameters: TICKET=^ticket TAG=^tag
  after: 2h
```

| Mark | Means |
|---|---|
| `[!]` · `[ ]` · `[~]` | Must do · a step · automation planned |
| `{type}` | What kind of step, so it knows its fields and evidence |
| `@role` · `^detail` | Who does it · a run detail it depends on (change the detail, redo the step) |
| `sets: tag` | This step produces a run detail later steps use |
| `## Gate:` · `approves:` | The pause point, and exactly what passing it approves |
| `### Track: Name @role` | Parallel work inside a phase |
| `at:` · `due:` · `after:` | A clock time, a deadline, or a due time after the run starts |
| `{run.process}` · `carry:` | Start another process as a linked child run, passing these details |
| `group:` · `tags:` | Where the process sits in your hierarchy, and how to find it |

Publishing freezes a checklist as a numbered version, with who, when and why. Runs keep the version they started with, forever. The full format is in [docs/map-format.md](https://github.com/troylar/flightdeck/blob/main/docs/map-format.md).

<br>

## Manage your templates in the app

A process is one page, with its checklist in the middle:

- **Read it** the way a run shows it, or switch on **Markdown** to see and copy the source.
- **Edit** it in place: the Markdown beside a live check (what blocks publishing, and what's just a tip) and a preview, updated as you type. **Done** takes you back; **Publish** appears when the draft has changes.
- **Look back**: pick any version from the version list or the Versions panel. An older version shows with a way back to the current one and **Restore as draft**.
- **How runs go**: typical time per phase, the steps that go off-script most, and who has held each role.

Beside the checklist: whether it's ready for a skill, its skills, its versions and its recent runs.

Saving is careful. A save only goes through if the draft is still exactly what you opened. If a teammate or your LLM changed it meanwhile, nothing is saved: you see their version and choose to keep yours or take theirs. One limit: a shared folder can't lock a file, so a change that lands in the instant between that check and the write can still be replaced. Edit a draft with one person (or one LLM) at a time. Saving never publishes; publishing is a separate, logged step.

**New process** on the Processes page asks for an ID, title, group, tags, run details, roles and owner, starts the draft, and opens it in the editor.

<br>

## Your own step types

Built-in types cover common tools. When your team has its own kind of step (a change request, a security sign-off), make it a type:

1. **Step types → New step type**, or **Copy to a team type** on any built-in.
2. Add rows for its **fields** (what a checklist can say about the step) and its **evidence** (what's recorded when it's checked). The form checks it as you go and shows the checklist line and the file it will save.
3. **Save step type** writes `step-types/<id>.json`. Checklists can use `{your.type}` right away; publishing freezes it into each version, so editing it later never changes an old one.

Or describe it to your AI assistant: `/flightdeck-new-step-type a change request the CAB approves, with the change number as evidence`.

<p align="center"><a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/types-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/types-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/types-light.png" alt="Step types: your team types, then each built-in type with what it is for, how many checklists use it, and a button to copy it to a team type" width="1000"></picture></a></p>

<br>

## Process-to-skill traceability

This is what Flightdeck is for. Outside the team it's usually called **SOP-to-skill**: turning a standard operating procedure into an agent skill. Flightdeck adds the part that's usually missing: **traceability**. Each registered skill links to the exact process version and steps it follows, and runs are the evidence. Flightdeck flags process changes that affect a skill; it doesn't detect changes to the skill itself.

**1. Prove a version.** Each process page shows its run evidence. A run counts as clean only when it ended Completed, every covered step was done, every gate on that work (and the one before it) was passed, and nothing was blocked, re-checked, marked N/A or done differently, even in answers since archived.

**2. Sign off.** With three clean runs, the process owner signs the version off. Only the owner's sign-off counts, and only for that exact published version.

**3. Brief your LLM.** One click copies a brief with the process in order: phases and their mode, tracks, every step with its fields, evidence and screenshots, every gate with what it approves, the run details it receives, and what people actually did differently.

**4. Register the skill.** It can live anywhere: a repo, a shared folder, a local path. Its `location` is the skill's source path or link:

```json
{
  "name": "release-deploy",
  "version": "1.3.0",
  "location": "https://bitbucket.example.com/projects/WA/repos/team-skills/browse/release-deploy",
  "implements": "release@4",
  "steps": ["merge", "jenkins"],
  "group": "Engineering / Releases",
  "tags": ["deploy"]
}
```

Leave out `steps` for a skill that covers the whole process. A process can have many skills.

**5. Stay in step.** When a new version is published, every skill is checked against it:

| Status | Meaning | What you do |
|---|---|---|
| **current** | Built from the version in use | Nothing |
| **note version** | The process changed, but none of this skill's steps did | Move its `implements` forward |
| **needs update** | Its steps, their order, their gates, their step types, screenshots or run details changed | Copy the update brief: the exact before and after, for your LLM |
| **check it** | It can't be matched: a missing version, a clash, or an unreadable file | Fix the registration |

The same rules are in the `flightdeck-skill-brief` skill for your AI assistant, so a brief from your LLM and a brief from the app agree.

<p align="center"><a href="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-light.png" title="Open full size"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-light.png" alt="A skill that needs an update: the step that changed and the button that copies the update brief" width="1000"></picture></a></p>

<br>

## Command line

| Command | Does |
|---|---|
| `flightdeck open` | Opens the app on its built-in examples |
| `flightdeck install <folder>` | Copies `flightdeck.html` into a team folder. Won't replace a newer copy or an unrecognized file without `--force`. Also updates a `preflight.html` already there |
| `flightdeck skills <folder>` | Adds or updates the skills for your AI assistant in `<folder>/.flightdeck/skills`. Leaves files someone changed alone unless you add `--force` |
| `flightdeck skills --to <dir>` | The same, into any other folder you name (absolute or relative), such as your assistant's own skills folder or another repo. `<dir>` is created if it's missing |
| `flightdeck path` | Prints where the app file is |
| `flightdeck version` | Prints the version |

<br>

## The team folder

```
people.json            who's on the team
maps/drafts/           checklists being written (Markdown)
publications/          published versions, frozen (Flightdeck writes these)
runs/                  one folder per run: run.json, everyone's notes, screenshots
skills/                skill registrations: each skill's source, what it implements
validations/           owners' sign-offs that a version is ready for a skill
step-types/            your team's own step types (create them in the app)
jira/workflows.json    your real Jira workflows, with required fields
proposals/             runs your LLM planned, waiting for a person to start them
images/                screenshots that checklists refer to
AGENTS.md              the rules any AI assistant follows in this folder
.flightdeck/skills/    the Flightdeck skills for your AI assistant
```

Every file has exactly one writer, so a shared folder never corrupts. Your LLM writes checklists, plans, step types, workflows and skill registrations; people publish, run and sign off.

<br>

## Skills for your AI assistant

`flightdeck skills` installs these into the team folder's `.flightdeck/skills/`, or anywhere else with `--to <dir>`. They're plain `SKILL.md` files (a name, a description and instructions), so any assistant that supports skills can use them: install them where your assistant looks for skills, or point it at the folder. Then open the team folder with your assistant and ask for one by name:

| Skill | Does |
|---|---|
| `/flightdeck-new-checklist` | Turns a runbook, notes or a conversation into a checklist |
| `/flightdeck-edit-checklist` | Changes a checklist and keeps its step IDs |
| `/flightdeck-review-checklist` | Checks a checklist for format errors and quality, without changing it |
| `/flightdeck-learn-from-runs` | Turns what actually happened in runs into suggested checklist changes |
| `/flightdeck-plan-run` | Plans the next run, rotating roles fairly |
| `/flightdeck-status` | Summarizes the folder: what needs a person, what's running, what's stale |
| `/flightdeck-new-step-type` | Creates or changes a team step type from a description |
| `/flightdeck-skill-brief` | Writes the brief to create a skill from a signed-off version, or update one |

<br>

## Safe by design

- **Nothing leaves your machine.** The app makes no network requests and loads nothing from the internet; its fonts and code are inside the file.
- **No server to run, no accounts to manage.** Your data is files in a folder you already control.
- **One writer per file, and checked saves.** Two computers saving a run at once never overwrite each other: the loser becomes a copy you compare and keep. Drafts and step types are saved only over the version you opened; a change that lands in the instant between that check and the write is the one case a shared folder can't catch, so edit them one at a time.
- **Built for OneDrive.** Folders that sync a minute late are expected; a gate means "passed for this commit, by this person," never a live lock.
- **The command is careful too.** No dependencies, nothing runs on install, no network. It refuses to write through links, writes whole files atomically, and never replaces a newer version without `--force`.
- **Accessible.** Every control has a label, errors sit next to their field, shortcuts can be turned off, and it works with a keyboard.

<br>

## Coming from Preflight

Flightdeck was called Preflight before 1.9.0. Team folders, runs and published versions carry over untouched. `flightdeck install` also updates a `preflight.html` already in the folder, so anyone still opening that file gets the new version and keeps what their browser saved. A browser keeps saved examples and your name per file, so `flightdeck.html` starts those fresh.

<br>

## FAQ

**Does Flightdeck run anything for me?** No. It never calls Jenkins, Bitbucket or Jira, and never runs a command. It shows the command to copy, records what happened, and keeps the clock. Your skills do the automating.

**Where does the AI live?** Outside Flightdeck. Your AI assistant writes checklists and builds skills from Flightdeck's briefs. Flightdeck versions the checklists and records which process version each skill follows.

**Can a skill cover only part of a process?** Yes. List its `steps`. The brief tells it which gate to wait for before its first step, and the evidence and status consider only those steps.

**Can a skill come first?** Yes. Ask your AI assistant to draft a checklist from an existing skill, publish it, and register the skill against that process version; then run and prove the checklist as usual. If the skill changes first, update and publish the checklist, then update the registration. Flightdeck doesn't detect skill changes. A guided skill-first workflow and skill change detection are planned.

**Can people edit checklists in the app, or only the LLM?** Both. The app's editor and your LLM write the same draft files. The app saves only over the version you opened and shows both when they differ; since a shared folder can't lock a file, edit a draft with one of them at a time.

**What's new in each version?** The top bar shows the version and **What's new**, the full searchable history. It's also in [CHANGELOG.md](https://github.com/troylar/flightdeck/blob/main/CHANGELOG.md).

**Where's the source?** [github.com/troylar/flightdeck](https://github.com/troylar/flightdeck). The design and its decisions are in [docs/design.md](https://github.com/troylar/flightdeck/blob/main/docs/design.md).

<br>

## License

[MIT](https://unpkg.com/@troylar/flightdeck/LICENSE). The embedded Barlow Condensed fonts are licensed under the SIL Open Font License 1.1; see [`dist/FONT-LICENSE.txt`](https://unpkg.com/@troylar/flightdeck/dist/FONT-LICENSE.txt).

<div align="center">
<br>

*Inspired by* The Checklist Manifesto: *a checklist doesn't fly the plane. It makes sure the crew doesn't forget the things that matter.*

</div>
