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

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/run-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/run-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/run-light.png" alt="A release in progress on the full-page run screen: a slim header with 7/14 answered, a strip saying you're recording with Pause and Hand off and the run's details, Phases with each gate's state, the checklist with Next up pinned at its top, and the selected step with what to do, its timing, Record the result, Done, Done differently and Blocked" width="1000"></picture></a></p>

<br>

## Your skills, tied to the process they automate

Teams are turning runbooks into AI skills fast. Then the process changes, and nobody can say which skills are now wrong.

Flightdeck keeps that link, version by version:

- **Built from proof.** Prove a version with three clean runs and its owner's sign-off, then brief your AI assistant to build the skill.
- **Traced to the step.** Each registered skill links to an exact process version and the steps it covers (or the whole process), plus where its source lives.
- **Changes flagged.** Publish a new version and Flightdeck shows which registered skills follow steps that changed, and which are still current.
- **Fixes, briefed.** One click copies an update brief: the before and after of each changed step, and the process as it is now.
- **Evidence kept.** Every run keeps who checked each step, what was marked N/A, and where people did it differently.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/skills-traced-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-traced-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-traced-light.png" alt="A process goes from v1 to v2 and one step changes. Flightdeck checks the registered skills: release-deploy and release-notes need an update, pr-opener is current. The update brief for release-deploy shows the exact before and after for your AI assistant." width="1000"></picture></a></p>

<br>

## The loop

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/loop-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/loop-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/loop-light.png" alt="Write a checklist, publish a frozen version, run it, prove it with three clean runs and the owner sign-off, then your AI assistant builds the skill from the brief. A step done differently becomes a suggested checklist change; a new version that changes a covered step marks the skill as needing an update." width="1000"></picture></a></p>

Flightdeck keeps checklists and run records together, links to skills stored elsewhere, and flags process changes that affect them.

<br>

## Install

```bash
npm install -g @troylar/flightdeck

flightdeck open                        # opens the app: start your team, join one, or look around the examples
```

**Starting a team?** In the app, choose **Start your team** and pick a new, empty shared OneDrive folder (an empty folder, so nothing already there is replaced). When setup is done, put Flightdeck in that folder so everyone opens the same version:

```bash
flightdeck install ~/OneDrive/Team     # adds flightdeck.html; keeps the AGENTS.md and skills setup wrote
```

**Joining a team?** Open `flightdeck.html` from your team's folder in Edge or Chrome.

The first screen offers three ways in:

- **Start your team** (the first person): pick an empty shared OneDrive folder (Flightdeck checks it can save there), add your people and a backup owner, publish a first checklist (Code check-in, Weekly review, blank, or one your AI assistant writes), do a first run on your own, then send a teammate the way in and check that their computer answers. Home shows **Getting started · N of 5** until all five are done; each step ticks itself from what's in the folder.
- **Join your team's folder** (everyone else): open the folder and choose who you are. Not on the list? Copy a request to the folder owner; only the folder owner and backup owner change `people.json`.
- **Look around the examples**: a made-up team, saved in this browser only.

Setup writes `people.json`, `AGENTS.md` and the skills itself; `flightdeck install` afterwards only adds what's missing or still a default. Run it before setup and the folder isn't empty any more, so setup asks for another one.

To update later, run `flightdeck install` again: it updates what's still a Flightdeck default and keeps what your team changed. [Updating Flightdeck](docs/updating.md) walks through it, including backups and mixed versions; [When something goes wrong](docs/recovery.md) covers conflict copies, lost folder access and restoring.

> **Prefer no npm?** `flightdeck.html` is self-contained. Copy it anywhere and open it.

<br>

## A tour

`flightdeck open` starts on a team folder with a month of history in it. Choose **Casey Nguyen** in the top right and follow along. Six sections sit in the top bar: **Home, Runs, Processes, Skills, Step types, Settings**.

<table>
<tr>
<td width="50%" valign="top">

**Home** shows only what needs you, each with one button: the run you're recording, a plan to review, a skill to update.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/home-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/home-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/home-light.png" alt="Home: three things that need you, each with one button, and counts of runs, processes, skills and step types"></picture></a>

</td>
<td width="50%" valign="top">

**Processes** are your templates, in your team's own hierarchy and tags. **New process** starts one.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/processes-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/processes-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/processes-light.png" alt="Processes: the team templates grouped by hierarchy, with tags, skill counts and last run"></picture></a>

</td>
</tr>
<tr>
<td valign="top">

**A process** is one page: its checklist with skill badges, the Corrections people recorded during runs, whether it's ready for a skill, its skills, versions and recent runs.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/process-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/process-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/process-light.png" alt="The Production release process: the v2 checklist with skill badges, How runs go, Start a run and Plan a run, and its Corrections panel with two open corrections"></picture></a>

</td>
<td valign="top">

**Edit** in place, as an outline or as Markdown, beside a live check and preview. If the draft changed since you opened it, you see both and choose.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/edit-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/edit-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/edit-light.png" alt="Editing a draft: the Markdown on the left, Ready to publish and a live preview on the right"></picture></a>

</td>
</tr>
<tr>
<td valign="top">

**Skills**: every skill built from your processes, wherever it lives, and which ones need an update.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/skills-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-light.png" alt="Skills: two skills that need an update, then every skill in the team hierarchy with tag filters"></picture></a>

</td>
<td valign="top">

**A skill** says what changed under it and gives your AI assistant the exact before and after.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/skill-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-light.png" alt="The release-deploy skill: needs an update because one of its steps changed in v2, with a Copy the update brief button and where the skill lives"></picture></a>

</td>
</tr>
<tr>
<td valign="top">

**Flight plan** shows a version's shape: phases from start to landing, gates as checkpoints, tracks side by side, and, from that version's runs, typical times, autopilot (steps skills cover) and turbulence.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/flight-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/flight-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/flight-light.png" alt="The release v1 as a flight plan: Start, three phases with typical times, gates as striped checkpoints, a connecting flight to Check in code, autopilot and turbulence notes, and two parallel tracks"></picture></a>

</td>
<td valign="top">

The **Builder** edits a draft as an outline: drag a step or press Alt+Up / Alt+Down, change it in the side form, and **Undo**. It writes the same Markdown.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/builder-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/builder-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/builder-light.png" alt="The outline builder: phases as cards with steps as rows and a striped gate bar; the selected step's side form with its text, kind, type, roles, run details and fields"></picture></a>

</td>
</tr>
<tr>
<td valign="top">

**Runs**: what's running, what's **planned** (by a person or your AI assistant) and what finished.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/runs-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/runs-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/runs-light.png" alt="Runs: one release running, two planned releases (one by Casey Nguyen with a time, one by an AI assistant), and finished runs"></picture></a>

</td>
<td valign="top">

**Plan a run** for later: the details you know, who does what, and an optional time. Nothing starts until someone starts it.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/plan-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/plan-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/plan-light.png" alt="Plan a run: run name, ticket and environment filled in, a time and a note, and suggested people for each role"></picture></a>

</td>
</tr>
<tr>
<td valign="top">

**Correct this step** during a run: it starts on the wording, with a live Before/After redline, and **Change something else** covers a missing step, the order, who does it, a screenshot, removing the step, or any other problem. The checklist's own text stays on screen.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/correction-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/correction-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/correction-light.png" alt="Correct this step during a run: the checklist's text, the suggested wording, a Before/After redline, why, and Attach for files"></picture></a>

</td>
<td valign="top">

**Corrections** on the process page, grouped by step: the same correction from several runs shows once, "Suggested in 3 runs". **Review and apply** compares what the run's version said, the draft now and the result side by side, then applies it to the draft in one click as one change you can undo; if the draft already has it, **Link this correction**. Mark one as applied, decline it with a reason, or reopen it, and copy a correction brief for your AI assistant. The draft editor marks the steps with open corrections. Publishing records which applied corrections the version includes, so a correction says **Published in v5** once v5 both lists it and says it; runs of v5 show **Changed in v5** on that step, with **Why is this here?**, and Home tells whoever suggested it.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/corrections-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/corrections-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/corrections-light.png" alt="Corrections on the process page: a wording change suggested in two runs, with the runs listed, and a missing step, each with Mark as applied and Decline, then Copy correction brief"></picture></a>

</td>
</tr>
</table>

**A run** fills the window, like the editor. The header says how far it is (`7/14 answered`); a strip under it says who's recording, with **Pause** and **Hand off** (or **Pick up**, **Record here**, **Take over**) right beside it, and what this window saved and when it last checked the folder. Below, three panes scroll on their own: **Phases** with each gate's state, the **checklist** with **Next up** pinned at its top, and the **selected step**: how to do it, the values to copy, the evidence to record, **Done**, **Done differently** (say what happened, and fix the checklist too if it should change), **Blocked** and **N/A**, then the step's corrections and notes. Check the step Next up points at and the next one is selected, ready for **Space**. The row's check, **Done**, **Space** and **Done differently** all answer that one step with the evidence typed on it. Typed evidence, Fill in values and unsent notes stay with their step (and their team folder) when you move around, and the row says **Draft**; while a step's Fill in is open or unsaved, Done says "Save or cancel Fill in first." Notes and corrections take files: drop them on the note box, paste, or **Attach** (images, PDF, text and logs, CSV, JSON, YAML and .zip, up to 10 MB each). On a phone the checklist scrolls and a step opens as a full-screen sheet.

<br>

## What it does

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/features-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/features-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/features-light.png" alt="Eight features: gates that approve exactly what they say; one recorder with everyone watching; typed steps for Jenkins, Bitbucket, Jira and commands; real Jira workflows with required fields; clock times, deadlines, tracks and pauses; linked runs of other processes; run details that flow to later steps; and insights from every run." width="1000"></picture></a></p>

<details>
<summary><b>Every feature, in detail</b></summary>

<table>
<tr>
<td width="50%" valign="top">

### Checklists with teeth
Every phase ends at a **gate**. Nothing after it opens until someone passes it, and a gate approves exactly what it says: `deploy of d9d8514 to production`. Must-do steps can't be skipped. Change the commit mid-run and every step tied to it comes back for a re-check.

</td>
<td width="50%" valign="top">

### One recorder, everyone watching
One person records; everyone else follows on their own screen and adds notes, screenshots and files (logs, PDFs, .zip) to any step. Hand recording over, or pick it up from another window. Every save first checks the file hasn't changed; if it has, yours is kept next to it as a copy you can compare and keep. Where two computers can't take turns, a save that gets replaced is still kept as a receipt and shown as a copy, so nothing is silently lost.

</td>
</tr>
<tr>
<td valign="top">

### Steps that know their tools
Steps are typed: `jenkins.job`, `bitbucket.pr`, `github.pr`, `jira.issue`, `jira.sprint`, `deploy`, `verify.health`, `measure`, `run.command`, `decide`, `review` and more, plus your team's own types. Each asks for the evidence that matters (a build number, a PR link, a decision) only where the checklist says it's required.

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
Every block, every re-check and every step **done differently** (with what happened) is kept. Anyone in a run can **correct a step**: what the checklist said, what it should say, and files to show why. Corrections are part of the run's record and its receipt, and wait on the process page, where anyone applies them to the draft (after a side-by-side comparison), marks them applied or declines them with a reason; one click copies a correction brief for your AI assistant. Once published, a correction says which version has it, and that version's runs say why the step changed. A process's **How runs go** shows typical time per phase, the steps that go off-script most, and who has never held which role yet, so the next rotation is obvious.

</td>
</tr>
</table>

</details>

<br>

## A checklist, in twenty lines

Checklists are Markdown. Your AI assistant writes them; people edit and publish them, in the builder or as Markdown.

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
- **See its shape** with **Flight plan**: phases as waypoints from start to landing, gates as checkpoints, tracks as parallel lanes, linked processes as connecting flights, and, from that version's own runs and skills, typical times, the steps covered by skills (autopilot) and the steps that go off-script most (turbulence). Choose a phase to jump to it in the checklist.
- **Edit** it on a page of its own (Parts, the outline and an inspector with Selected, Checks and Preview tabs, each scrolling on its own): the **Builder** (phases as cards, steps as rows, parallel lanes side by side, gates as striped bars; add phases, lanes, gates and any type of step from the parts box by dragging, or by choosing a part and a place with the arrow keys; drag a step or press Alt+Up / Alt+Down to move it; change a step's text, type, roles, run details and fields, or a lane's name and role, in the side form; **Undo** and **Redo** step back and forward through builder changes) or the **Markdown**, beside a live check (what blocks publishing, and what's just a tip) and a preview. Both edit the same Markdown: the builder changes only the lines you touch and never a step ID, and keeps comments and lines it doesn't understand. **Done** takes you back; **Publish** appears when the draft has changes.
- **Look back**: pick any version from the version list or the Versions panel. An older version shows with a way back to the current one and **Restore as draft**.
- **Versions this copy can't use** are listed with the reason instead: still syncing, damaged, or written by a newer Flightdeck ("update Flightdeck to run it"). They can't be started, planned or picked, and a run started on one by a newer copy opens read-only, so this copy never saves over it.
- **How runs go**: typical time per phase, the steps that go off-script most, and who has held each role.

Beside the checklist: whether it's ready for a skill, its skills, its versions and its recent runs.

**Plan a run** for later, next to **Start a run**: a name, the details you know, who does what and an optional time. **Plan another like this** on any run or receipt copies its details and roles, never its answers. Planned runs are listed by time under **Runs** and show on Home when they're due; a plan starts on the version it was planned on until you switch to the newer one.

Saving is careful. A save only goes through if the draft is still exactly what you opened. If a teammate or your AI assistant changed it meanwhile, nothing is saved: you see their version and choose to keep yours or take theirs. One limit: a shared folder can't lock a file, so a change that lands in the instant between that check and the write can still be replaced. Edit a draft with one person (or one AI assistant) at a time. Saving never publishes; publishing is a separate, logged step.

**New process** on the Processes page asks for an ID, title, group, tags, run details, roles and owner, starts the draft, and opens it in the editor.

<br>

## Your own step types

Built-in types cover common tools, grouped as General, Tools and Automation, with your team's types in their own groups and a tag filter. When your team has its own kind of step (a change request, a security sign-off), make it a type:

1. **Step types → New step type**, or **Copy to a team type** on any built-in.
2. Give it a **group** and **tags** if you like (they only organize the list), then add rows for its **fields** (what a checklist can say about the step) and its **evidence** (what's recorded when it's checked). The form checks it as you go and shows the checklist line and the file it will save.
3. **Save step type** writes `step-types/<id>.json`. Checklists can use `{your.type}` right away; publishing freezes it into each version, so editing it later never changes an old one.

Or describe it to your AI assistant: `/flightdeck-new-step-type a change request the CAB approves, with the change number as evidence`.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/types-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/types-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/types-light.png" alt="Step types: your team types, then each built-in type with what it is for, how many checklists use it, and a button to copy it to a team type" width="1000"></picture></a></p>

<br>

## Process-to-skill traceability

This is what Flightdeck is for. Outside the team it's usually called **SOP-to-skill**: turning a standard operating procedure into an agent skill. Flightdeck adds the part that's usually missing: **traceability**. Each registered skill links to the exact process version and steps it follows, and runs are the evidence. Flightdeck flags process changes that affect a skill; it doesn't detect changes to the skill itself.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/trace-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/trace-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/trace-light.png" alt="Five steps from process to skill: prove it with 3 clean runs, the owner signs it off, copy the brief, register the skill with its source and the steps it follows, and stay in step as new versions flag the skills they affect. Skill statuses: current, note version, needs an update, check it." width="1000"></picture></a></p>

<details>
<summary><b>How it works, step by step</b></summary>

**1. Prove a version.** Each process page shows its run evidence. A run counts as clean only when it ended Completed, every covered step was done, every gate on that work (and the one before it) was passed, and nothing was blocked, re-checked, marked N/A or done differently, even in answers since archived.

**2. Sign off.** With three clean runs, the process owner signs the version off. Only the owner's sign-off counts, and only for that exact published version.

**3. Brief your AI assistant.** One click copies a brief with the process in order: phases and their mode, tracks, every step with its fields, evidence and screenshots, every gate with what it approves, the run details it receives, and what people actually did differently.

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
| **needs update** | Its steps, their order, their gates, their step types, screenshots or run details changed | Copy the update brief: the exact before and after, for your AI assistant |
| **check it** | It can't be matched: a missing version, a clash, or an unreadable file | Fix the registration |

The same rules are in the `flightdeck-skill-brief` skill for your AI assistant, so a brief your AI assistant writes and a brief from the app agree.

</details>

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/skill-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-light.png" alt="A skill that needs an update: the step that changed and the button that copies the update brief" width="1000"></picture></a></p>

<br>

## Command line

| Command | Does |
|---|---|
| `flightdeck open` | Opens the app on its built-in examples |
| `flightdeck install <folder>` | Copies `flightdeck.html` into a team folder, and adds or updates `AGENTS.md` and the skills for your AI assistant in `.flightdeck/skills`. Won't replace a newer app or an unrecognized file without `--force`. Also updates a `preflight.html` already there |
| `flightdeck skills <folder>` | Adds or updates only the skills, in `<folder>/.flightdeck/skills` |
| `flightdeck skills --to <dir>` | The same, into any other folder you name (absolute or relative), such as your assistant's own skills folder or another repo. `<dir>` is created if it's missing |
| `flightdeck backup <folder>` | Copies the whole team folder to `~/Flightdeck backups/<folder> backup <date> <time>/`, or under `--to <dir>`. Skips links and temporary files, and refuses a destination inside the folder |
| `flightdeck path` | Prints where the app file is |
| `flightdeck version` | Prints the version |

| Option | Does |
|---|---|
| `--check` | With `install` or `skills`: lists what would change and changes nothing. Exit code 0: nothing to do; 2: updates to install; 3: files your team changed need merging; 1: a problem |
| `--app-only` | With `install`: copies only `flightdeck.html` |
| `--force` | Replaces a newer app, an unrecognized file, or files your team changed. Like every install, it first saves a checked copy of each file it replaces in `.flightdeck/updates/<version>/replaced/` |

Install and skills sort every `AGENTS.md` and skill file the same way. A file that's still a Flightdeck default (this version's or an earlier one) is updated. A file your team changed is left alone. If this version changed that file's default too, the new default goes to `.flightdeck/updates/<version>/`, with a `README.md` holding a prompt for your AI assistant to merge it. In `AGENTS.md` only the part between the `flightdeck:begin` and `flightdeck:end` markers is Flightdeck's; Team notes, below it, are never touched. `.flightdeck/installed.json` records which defaults the folder is based on; it can make install more careful, never less. Every file install replaces is first copied to `.flightdeck/updates/<version>/replaced/`. A file that changes while install runs is left alone and install exits with 1. Nothing is written through a link or outside the folder (see [Updating Flightdeck](docs/updating.md) for the limits).

<br>

## The team folder

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/folder-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/folder-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/folder-light.png" alt="The team folder and who writes each part: people.json and validations by people; drafts and step types by people and your AI assistant; skills, Jira workflows and proposals by your AI assistant; publications and runs by Flightdeck." width="1000"></picture></a></p>

<details>
<summary><b>The folder, as text</b></summary>

```
people.json            who's on the team, with the folder owner and backup owner
maps/drafts/           checklists being written (Markdown)
publications/          published versions, frozen (Flightdeck writes these)
runs/                  one folder per run: run.json, everyone's notes and corrections, attached files
skills/                skill registrations: each skill's source, what it implements
validations/           owners' sign-offs that a version is ready for a skill
corrections/           decisions on corrections (applied, declined, reopened, withdrawn), each a file written once
suggestions/           decisions on suggested fixes from before 1.13 (still read)
step-types/            your team's own step types (create them in the app)
jira/workflows.json    your real Jira workflows, with required fields
proposals/             planned runs (from the app or your AI assistant), waiting for a person to start them
images/                screenshots that checklists refer to
AGENTS.md              the rules any AI assistant follows in this folder (your own go under Team notes)
.flightdeck/skills/    the Flightdeck skills for your AI assistant
.flightdeck/installed.json   which Flightdeck defaults AGENTS.md and the skills are based on
.flightdeck/updates/   new defaults waiting to be merged, and copies of files --force replaced
```

</details>

Every file has exactly one writer, which keeps ordinary use of a shared folder free of conflicts; when two saves do collide, the replaced one is kept for you to recover. Your AI assistant writes checklists, plans, step types, workflows and skill registrations; people publish, plan, run and sign off.

<br>

## Skills for your AI assistant

`flightdeck install` puts these in the team folder's `.flightdeck/skills/` (`flightdeck skills` does only the skills), or `flightdeck skills --to <dir>` puts them anywhere else. They're plain `SKILL.md` files (a name, a description and instructions), so any assistant that supports skills can use them: install them where your assistant looks for skills, or point it at the folder. Then open the team folder with your assistant and ask for one by name:

| Skill | Does |
|---|---|
| `/flightdeck-new-checklist` | Turns a runbook, notes or a conversation into a checklist |
| `/flightdeck-edit-checklist` | Changes a checklist and keeps its step IDs |
| `/flightdeck-review-checklist` | Checks a checklist for format errors and quality, without changing it |
| `/flightdeck-learn-from-runs` | Reads runs and their corrections and proposes checklist changes |
| `/flightdeck-plan-run` | Plans the next run, rotating roles fairly |
| `/flightdeck-status` | Summarizes the folder: what needs a person, what's running, what's stale |
| `/flightdeck-new-step-type` | Creates or changes a team step type from a description |
| `/flightdeck-skill-brief` | Writes the brief to create a skill from a signed-off version, or update one |

<br>

## Safe by design

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/safe-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/safe-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/safe-light.png" alt="Safe by design: nothing leaves your machine; no server or accounts; saves that check first; built for OneDrive; a careful command; accessible." width="1000"></picture></a></p>

<details>
<summary><b>The details</b></summary>

- **Nothing leaves your machine.** The app makes no network requests and loads nothing from the internet; its fonts and code are inside the file.
- **No server to run, no accounts to manage.** Your data is files in a folder you already control.
- **One writer per file, and checked saves.** A run is saved only if its file hasn't changed since this window read it; otherwise this window's version is kept beside it as a copy to compare and keep. Two computers that can't see each other's changes yet can still both write, so every save first leaves its own receipt: one that gets replaced shows up in the run as a copy, never silently lost (see [docs/onedrive.md](https://github.com/troylar/flightdeck/blob/main/docs/onedrive.md)). Drafts and step types are saved only over the version you opened; a change that lands in the instant between that check and the write is the one case a shared folder can't catch, so edit them one at a time.
- **Built for OneDrive.** Folders that sync a minute late are expected; a gate means "passed for this commit, by this person," never a live lock.
- **The command is careful too.** No dependencies, nothing runs on install, no network. It refuses to write through links, writes whole files atomically, and never replaces a newer version without `--force`.
- **Accessible.** Every control has a label, errors sit next to their field, shortcuts can be turned off, and it works with a keyboard.

</details>

<br>

## Coming from Preflight

Flightdeck was called Preflight before 1.9.0. Team folders, runs and published versions carry over untouched. `flightdeck install` also updates a `preflight.html` already in the folder, so anyone still opening that file gets the new version and keeps what their browser saved. A browser keeps saved examples and your name per file, so `flightdeck.html` starts those fresh.

<br>

## FAQ

<details>
<summary><b>Does Flightdeck run anything for me?</b></summary>

No. It never calls Jenkins, Bitbucket or Jira, and never runs a command. It shows the command to copy, records what happened, and keeps the clock. Your skills do the automating.

</details>

<details>
<summary><b>Where does the AI live?</b></summary>

Outside Flightdeck. Your AI assistant writes checklists and builds skills from Flightdeck's briefs. Flightdeck versions the checklists and records which process version each skill follows.

</details>

<details>
<summary><b>Can a skill cover only part of a process?</b></summary>

Yes. List its `steps`. The brief tells it which gate to wait for before its first step, and the evidence and status consider only those steps.

</details>

<details>
<summary><b>Can a skill come first?</b></summary>

Yes. Ask your AI assistant to draft a checklist from an existing skill, publish it, and register the skill against that process version; then run and prove the checklist as usual. If the skill changes first, update and publish the checklist, then update the registration. Flightdeck doesn't detect skill changes. A guided skill-first workflow and skill change detection are planned.

</details>

<details>
<summary><b>Can people edit checklists in the app, or only the AI assistant?</b></summary>

Both. The app's editor and your AI assistant write the same draft files. The app saves only over the version you opened and shows both when they differ; since a shared folder can't lock a file, edit a draft with one of them at a time.

</details>

<details>
<summary><b>The checklist was wrong during a run. What do I do?</b></summary>

Select the step and choose **Correct this step** (or press C): change its wording with a live Before/After, or choose **Change something else** for a missing step, the order, who does it, a screenshot or removing it. Attach files to show why. It never answers the step. If you already did the step another way, use **Done differently** beside Done and choose **Fix the checklist too**. Corrections wait on the process page, grouped by step, where anyone marks one as applied to the draft or declines it with a reason. Then edit the draft and publish as usual.

</details>

<details>
<summary><b>Is Flightdeck secure?</b></summary>

It's as private as the OneDrive folder it lives in, and no more. There's no server and no sign-in; nothing leaves your computers except through OneDrive.

Roles in Flightdeck prevent ordinary mistakes: only the folder owner and backup owner change the people list, and only a checklist's owner (or its backup owner, while the owner is away) signs off a version. They aren't security. Anyone who can open the team folder can change any file in it, with Flightdeck or without. Who can open it is set by how you share it in OneDrive.

Keep secrets, tokens and customer data out of checklists, notes and attachments.

</details>

<details>
<summary><b>What if someone on the team has a newer Flightdeck?</b></summary>

A version or run saved by a newer copy, with checklist features this copy doesn't understand, is shown with the reason and "Update Flightdeck to run it." It can't be started here, and a run on it opens read-only, so an older copy never records over what a newer one wrote. Put the newest `flightdeck.html` in the team folder; anyone on an older copy sees that a newer one is there.

</details>

<details>
<summary><b>What's new in each version?</b></summary>

The top bar shows the version and **What's new**, the full searchable history. It's also in [CHANGELOG.md](https://github.com/troylar/flightdeck/blob/main/CHANGELOG.md).

</details>

<details>
<summary><b>Where's the source?</b></summary>

[github.com/troylar/flightdeck](https://github.com/troylar/flightdeck). The design and its decisions are in [docs/design.md](https://github.com/troylar/flightdeck/blob/main/docs/design.md).

</details>

<br>

## License

[MIT](https://unpkg.com/@troylar/flightdeck/LICENSE). The embedded Barlow Condensed fonts are licensed under the SIL Open Font License 1.1; see [`dist/FONT-LICENSE.txt`](https://unpkg.com/@troylar/flightdeck/dist/FONT-LICENSE.txt).

<div align="center">
<br>

*Inspired by* The Checklist Manifesto: *a checklist doesn't fly the plane. It makes sure the crew doesn't forget the things that matter.*

</div>
