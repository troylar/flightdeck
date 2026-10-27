<div align="center">

<picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/banner-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/banner-light.png" alt="Flightdeck: fly it by hand, then put it on autopilot" width="1000"></picture>

<br>

[![npm](https://img.shields.io/npm/v/@troylar/flightdeck?color=e7a300&label=npm)](https://www.npmjs.com/package/@troylar/flightdeck)
[![license](https://img.shields.io/badge/license-MIT-1d7650)](#license)
[![dependencies](https://img.shields.io/badge/dependencies-0-1d7650)](#safe-by-design)
[![offline](https://img.shields.io/badge/runs-offline-16202a)](#safe-by-design)
[![node](https://img.shields.io/badge/node-%E2%89%A518-5a55a8)](#quick-start)

**[Quick start](#quick-start)** · **[How it works](#how-it-works)** · **[Checklist format](#the-checklist-format)** · **[Process to skill](#process-to-skill)** · **[Command line](#command-line)** · **[FAQ](#faq)**

</div>

<br>

**Flightdeck turns the processes your team keeps in its head into checklists you can run, prove and hand to your AI assistant.**

- **What it is:** one HTML file. No server, no sign-in, no network, no AI inside. It runs offline in Edge or Chrome, on a folder your team shares (OneDrive is the tested setup).
- **Who it's for:** teams with work they repeat: the release, the incident, the access review, the month-end close, the check-in.
- **Why it's different:** the shared folder is the whole backend. Every checklist version is frozen, every run is a record, and every AI skill you build is tied to the exact steps it automates. Change a step, and Flightdeck tells you which skills are now out of date.

## Quick start

1. `npx @troylar/flightdeck open` opens the app in your browser (needs Node 18 or later).
2. No Node? Save [flightdeck.html](https://unpkg.com/@troylar/flightdeck@2.6.1/dist/flightdeck.html) from the npm package as a file (right-click, **Save link as…**) and open that file in Edge or Chrome.
3. Choose **Look around the examples** to try it, or **Start your team** to set up your team's folder.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/run-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/run-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/run-light.png" alt="A release in progress on the run screen: 7/15 answered in the header with Details, Screen share, Receipt and More; a strip saying you're recording, with Pause and Hand off and the run's details; Phases with each gate's state; the checklist with Next up pinned at its top; and the selected step, whose text shows the run's tag (Start the production deploy job v2026.10.16), with the values to copy, Record the result, Done, Done differently and Blocked" width="1000"></picture></a></p>

## Words this README uses

- A **checklist** is something your team does, written down; the app lists them under **Checklists** (called Processes before 2.10). Its steps are written as Markdown and published as numbered **versions** (v1, v2, …).
- A **run** is one time through a checklist. One person **records** it (the **recorder**); everyone else follows along.
- A **window** is one open Flightdeck tab. Some file names include the window that wrote them.
- A **run detail** is a value a run carries, like the commit or the release tag. Steps refer to one as `^commit`.
- A **gate** ends a phase. Nothing after it opens until someone passes it, and it approves exactly what it says.
- The **Receipt** is a run's printable summary page. A **save receipt** is a file (`candidate-<window>-<save>.json`) a window writes before each run save, so a replaced save is never lost. They are different things.

## Getting started

**Install the command** (or use `npx @troylar/flightdeck <command>` each time):

```bash
npm install -g @troylar/flightdeck
flightdeck open
```

`flightdeck open` opens the app that came with the package. The first time, it shows the welcome screen. After that it opens the team folder you chose, when the browser kept it and its permission; otherwise the top bar says **The team folder needs your OK again** with a **Reconnect** button.

| Choice | Who | What happens |
|---|---|---|
| **Start your team** | The first person | Pick an empty shared folder (Flightdeck checks it can save there), add your people and a backup owner, publish a first checklist (Code check-in, Weekly review, blank, or one your AI assistant writes), do a first run on your own, then send a teammate the way in and check that their computer answers. Home shows **Getting started · N of 5** to the folder owner and backup owner until all five are done. |
| **Join your team's folder** | Everyone else | Open the folder and choose who you are. Not on the list? Copy a request to the folder owner. Only the folder owner and backup owner change `people.json`. |
| **Look around the examples** | Anyone curious | A made-up team, saved in this browser only. Choose **Casey Nguyen** in the top right to see what a checklist owner sees. |

**After setup**, put Flightdeck in the team folder so everyone opens the same version:

```bash
flightdeck install ~/OneDrive/Team     # adds flightdeck.html; keeps the AGENTS.md and skills setup wrote
```

Run it after setup, not before: setup wants an empty folder. Teammates then open `flightdeck.html` from the team folder in Edge or Chrome. Setting the folder up in OneDrive is covered in [Flightdeck and OneDrive](https://github.com/troylar/flightdeck/blob/main/docs/onedrive.md#set-up).

**Finding your way around.** The top bar has **Home**, **Runs**, **Checklists** and **Settings**. **Skills** and **Step types** open from the Checklists page, from Settings and from search (Ctrl+K, or Cmd+K on a Mac), which finds runs, steps, notes, corrections, follow-ups, step types and skills, and keeps its index in memory on your computer.

**Home** shows only what's yours, each with one button: the run you're recording, a plan to review, a skill to update, and your open follow-ups. **Checklists** lists every checklist in your team's own groups, with **Filter by tag** and each one's version and last run. **New checklist** starts one.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/home-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/home-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/home-light.png" alt="Home for Casey: the things that need Casey, each with one button, then Your follow-ups with Done, Moved to a ticket, Moved to another run and Won't do" width="49%"></picture></a> <a href="https://github.com/troylar/flightdeck/blob/main/docs/images/processes-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/processes-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/processes-light.png" alt="Processes: the team's processes grouped by hierarchy, each with its version, when it last ran and its skills, with Filter by tag, and Skills, Step types and New process at the top" width="49%"></picture></a></p>

## How it works

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/loop-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/loop-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/loop-light.png" alt="The Flightdeck loop: write a checklist, practice it, publish it as a frozen version, run it, and learn from the runs, with corrections flowing back into the next version; proven versions are handed to an AI assistant as skills" width="1000"></picture></a></p>

The loop is five steps: **write** a checklist, **practice** it, **publish** it, **run** it, and **learn** from the runs. Proven versions then become skills for your AI assistant ([Process to skill](#process-to-skill)).

### 1. Write a checklist

A checklist is a Markdown file a person can read and an AI assistant can write. This one is complete:

```markdown
---
process: docs
title: Publish the docs
owner: person-casey
context: commit
---

## Build · DO-CONFIRM {#build}
- [!] {run.command} Docs build with no warnings ^commit {#build-docs}
  command: npm run docs
- [ ] {confirm} Screenshots match the current app {#shots}

## Gate: Ready to publish {#ready}
  approves: publishing `^commit`

## Publish · READ-DO {#publish}
- [!] {run.command} Push the site ^commit {#push}
  command: npm run docs:publish
```

Two phases, three steps and one gate, plus the final confirmation every checklist gets. `[!]` is a must-do. `{run.command}` is the step's type, so the run shows the command with a Copy button. `^commit` ties a step to a run detail. The gate approves exactly one thing: publishing that commit.

You don't have to write Markdown. **New checklist** on the Checklists page asks for a title and opens the editor with the **Add a step** box ready: type a step, press Enter, type the next. The group, tags, run details, roles, owner and file name are under **More options**. You can also start from Code check-in or Weekly review, or copy a prompt for your AI assistant.

**Edit** on a checklist's page opens its draft on a page of its own: the **Builder** (an outline) or the **Markdown**, beside **Checks** (what blocks publishing, and what's only a tip) and a **Preview**. Both views edit the same file; the builder changes only the lines you touch and never a step ID. Your AI assistant's changes to a draft you have open, with nothing unsaved, show up within seconds, marked and one Undo away.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/builder-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/builder-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/builder-light.png" alt="The editor's Builder, with Save draft and Review &amp; publish in the header: the parts box with Phase, Gate, Step, Must-do and All parts; phases as cards with steps as rows and a striped gate bar; and the selected step's form, scrolled to its Fields: each box asks a question (Which job?, Which parameters?, Which stage do you watch?) with a short why under it, then + Job page for a box it doesn't usually need, and How long does it usually take?" width="1000"></picture></a>

**The step form** starts short: what needs to be done, who does it, **Must be done**, and **+ Add instructions**. A step with a type shows its type and the boxes it usually needs at the top. Everything else (guidance, proof, timing, conditions, automation planning) is under **More options**, which stays open once you open it; anything a step already uses is shown outside it. Each box asks a question, with a gray example and why it matters, and boxes not shown yet are one click away behind **+ add** buttons. A choice of five or fewer is a row of buttons. **When it's checked, they record** lists exactly what a run will ask for. In the outline, drag a step or press Alt+Up / Alt+Down to move it, and **Undo** and **Redo** step through changes.

**Details in any box.** Type `^` in a step's text, a gate's approval or a text field to pick a run detail, or use **Insert a detail**. A misspelled one is marked with a one-click fix ("Use ^environment"), and a detail that may not be set yet at that step says which step sets it. **In a run:** under the box shows it filled in, with the values from your latest run. A caret that isn't a detail, like `grep ^ERROR`, stays as written. To rename a detail everywhere at once, use **Rename** in Checklist details; a linked step in this checklist keeps passing the same value to its child. If another checklist runs this one at its latest and passes the detail by the old name, Rename says so, and Folder health flags that checklist once this version is published, until it's changed to match.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/autocomplete-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/autocomplete-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/autocomplete-light.png" alt="A Jenkins step's parameters box: typing ^en offers ^environment, a text detail asked when a run starts, or adding ^en as a new run detail" width="49%"></picture></a> <a href="https://github.com/troylar/flightdeck/blob/main/docs/images/rename-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/rename-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/rename-light.png" alt="Checklist details: each run detail with how many places use it and Rename; renaming ^tag to build_tag lists the steps that follow it" width="49%"></picture></a></p>

**Run another checklist.** A step can start another checklist as a linked run. Pick the checklist from a list, and say where each of its details comes from: one of this run's details (under another name if you like), a fixed value, or asked when it starts. Publishing checks that against the other checklist as it is now. When you start it, its form opens with what's passed already filled in and asks only what's left (2.8).

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/nested-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/nested-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/nested-light.png" alt="A linked step in the editor: Check in code chosen from a list, Latest when this run starts, and what Check in code needs: branch asked when it starts, commit from this run's ^commit, story from this run's ^ticket" width="38%"></picture></a> <a href="https://github.com/troylar/flightdeck/blob/main/docs/images/child-start-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/child-start-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/child-start-light.png" alt="Starting the Check in code run: commit and story passed from this run, branch asked, and who's doing what" width="60%"></picture></a></p>

**Save draft** saves your work. **Review & publish** goes back to the checklist's page: there you can compare the draft with the last version, write what changed in one line, and choose **Publish vN**. Anything that blocks publishing disables the button; suggestions don't. A save goes through only if the draft is still what you opened; if a teammate changed it meanwhile, nothing is saved and you choose between their version and yours. A shared folder can't lock a file, so edit a draft with one person (or one AI assistant) at a time.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/edit-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/edit-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/edit-light.png" alt="Editing a draft as Markdown, with Practice, Save draft and Review &amp; publish in the header: the open corrections with links to their lines, the Markdown on the left, and the Checks and Preview tabs on the right"></picture></a>

### 2. Practice it, and stage it

**Practice** in the editor runs the draft on the real run screen, marked **Practice · not recorded**: check steps, pass gates and give run details sample values, as a run would. **Edit** on a step or gate takes you to the editor with it selected; **Back to practice** returns you to the same place, with the steps you changed marked **Try it again**. **Run from here** starts partway. Practice lives in this browser tab only (a `#/practice/<process>` link reopens it); nothing is written to the team folder and it never counts as a run. Links and commands you follow still act on real systems.

To rehearse a change with real people before everyone uses it, **stage** it. A staged version is tried by **test runs** while every real run stays on the current default:

1. **Stage it.** At the end of Practice, write what changed and choose **Stage it for a test run**; or on the checklist's page open **All versions** and choose **Stage the draft for testing**. It's written once to `staged/` and never edited.
2. **Try it.** **Start a test run** on the staged line. A test run is recorded like any run but is labeled **Test run** everywhere it shows, and it's never counted as a real run: How runs go, Home's running number, last-run dates and role rotation leave it out. Its follow-ups and corrections are real.
3. **Prove it.** The staged line counts clean test runs ("2 of 3 clean test runs"). With three, the owner, or the backup owner while the owner is away, gets **Sign off staged v3**.
4. **Make it the default.** **Make v3 the default** publishes exactly what was staged as the next version (if someone published meanwhile, it takes the next number and says so). Its clean test runs and sign-off then count for that version.

**Retire** sets a stage aside and **Reopen** brings it back; each is logged with who did it. Plans never start a test run, and a test run starts no linked runs.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/testrun-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/testrun-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/testrun-light.png" alt="A test run of staged v3: Test run beside its name and Test run · staged v3 under it, risk low among the run's details, and at the end of the first phase 1 step not needed, open to show the change board step applies only when risk is high. The next phase, behind its gate, offers Preview steps." width="1000"></picture></a></p>

### 3. Publish it

Publishing freezes the checklist as a numbered version, with who, when and why, in a folder that is written once and never changed. Every run keeps the version it started on, forever, and carries its own copy of the checklist and step types, so it reads the same years later. Before you publish, the panel names anything the draft uses that older copies can't run, under **Needs Flightdeck 2.0** or **Needs Flightdeck 2.1**.

A checklist's page shows its steps (as **Checklist**, **Flight plan** or **Markdown**), **Start a run**, **Plan a run**, **How runs go** and its versions; an older version offers **Restore as draft**. Its owner and backup owner also see open corrections, **Ready for a skill?** and its skills; everyone else sees each of those as one line.

<a href="https://github.com/troylar/flightdeck/blob/main/docs/images/process-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/process-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/process-light.png" alt="The Production release process as its owner sees it: the v2 checklist with skill badges, the Checklist, Flight plan and Markdown views, Edit, Start a run and Plan a run, and the Corrections panel with two open corrections" width="1000"></picture></a>

### 4. Run it

**Start a run** and type the run's details. Or **Plan a run** for later, with the details you know, who does what and an optional time; nothing starts until a person starts it, and a plan starts on the version it was planned on until you switch it. **Plan another like this** on any run copies its details and roles, never its answers.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/runs-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/runs-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/runs-light.png" alt="Runs: one release running, two planned releases (one by Casey Nguyen with a time, one requested by an AI assistant), the newest finished runs, and a More menu with Export evidence…" width="49%"></picture></a> <a href="https://github.com/troylar/flightdeck/blob/main/docs/images/plan-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/plan-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/plan-light.png" alt="Plan a run: run name, ticket, commit and environment filled in, a time and a note, and a person for each role with the rotation's suggestion" width="49%"></picture></a></p>

The run screen fills the window:

| Part | What it shows |
|---|---|
| **Header** | How far it is (`7/15 answered`), **Details**, **Screen share**, **Receipt** and **More** (with **Copy run key** and **Export evidence…**). A test run says **Test run** beside its name. |
| **Recording strip** | Who's recording, with **Pause** and **Hand off** (which names the exact revision passed on), the run's details, and what this window saved and when it last checked the folder. Another window sees **Pick up recording** (when it was handed to you), **Record here** (when you're recording elsewhere) or **Take over recording** (for emergencies, when the recorder's computer is gone). |
| **Phases** | Each phase and its gate's state by name ("Confirm deploy · Passed"), the day timeline and follow-ups. |
| **Checklist** | Every step, with **Next up** pinned at the top. Step text shows the run's details: `Start the production deploy job v2026.10.16`, or `‹tag›` until the tag is set. A phase behind its gate offers **Preview steps**; a finished one folds to a tally with **Show steps**. Steps this run doesn't need fold into one line at the end of their phase ("1 step not needed"), each with its reason. |
| **Selected step** | What to do (only when there's something to say), the values to copy, the evidence to record (**Fill in** only when there's something to fill in), then **Done**, **Done differently**, **Blocked** and **N/A**, and its corrections and notes. |

Check the step Next up points at and the next one is selected, ready for **Space**. Typed evidence and unsent notes stay with their step while you move around. Notes and corrections take files (drop, paste or **Attach**): images, PDF, text and logs, CSV, JSON, YAML and .zip, up to 10 MB each. On a phone the checklist scrolls and a step opens as a full-screen sheet.

Every answer keeps who and when, and a re-check keeps the earlier answer as history. A gate remembers what it approved: change the commit mid-run, and the gate and every step tied to `^commit` come back for a re-check. A run can be paused with a reason (paused time never counts) and ends with **End run…** as Completed, Stopped early or Canceled.

### 5. Learn from runs

When the checklist is wrong mid-run, anyone can **Correct this step** (or press C): change its wording with a live Before/After, or choose **Change something else** for a missing step, the order, who does it, a screenshot or removing it, with files to show why. If you already did it another way, **Done differently** asks what happened and offers **Fix the checklist too**.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/correction-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/correction-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/correction-light.png" alt="Correct this step during a run: what the checklist says, the suggested wording, a Before/After redline, why, Attach for files, and Save correction" width="49%"></picture></a> <a href="https://github.com/troylar/flightdeck/blob/main/docs/images/corrections-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/corrections-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/corrections-light.png" alt="Corrections on the checklist's page: a wording change suggested in two runs, with the runs listed, and a missing step, each with Review and apply, Mark as applied and Decline, then Copy correction brief" width="49%"></picture></a></p>

Corrections wait on the checklist's page, grouped by step ("Suggested in 2 runs"). **Review and apply** shows what the run's version said, the draft now and the result side by side, and applies it to the draft as one change you can undo; you can also **Mark as applied**, **Decline** with a reason, or copy a correction brief for your AI assistant. The version that includes it records that, its runs show **Changed in v5** with **Why is this here?**, and Home tells whoever suggested it.

**How runs go** shows typical time per phase, the steps that go off-script most, and who has held each role. **Flight plan** draws a version's shape: phases as waypoints, gates as checkpoints, tracks side by side, and, from its runs, typical times, autopilot (steps skills cover) and turbulence (steps that go off-script most).

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/flight-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/flight-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/flight-light.png" alt="The release v1 as a flight plan: Start with autopilot, phases with typical times, turbulence notes and a connecting flight to Check in code, and gates as striped checkpoints" width="1000"></picture></a></p>

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/features-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/features-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/features-light.png" alt="Eight features: gates that approve exactly what they say; one recorder with everyone watching; typed steps for Jenkins, pull requests, Jira and commands; real Jira workflows with required fields; clock times, deadlines, tracks and pauses; linked runs of other processes; run details that flow to later steps; and insights from every run." width="1000"></picture></a></p>

## The checklist format

Your AI assistant writes checklists; people edit and publish them in the editor. A fuller one:

```markdown
---
process: release
title: Production release
group: Engineering / Releases
tags: production, deploy
owner: person-casey
context: ticket, commit, environment, tag, risk:choice(low|high)
roles: release-lead, qa, backend
---

## Before production changes · DO-CONFIRM {#prep}
- [!] {ci.gate} Full test gate green on the release commit ^commit {#tests}
  require: run
- [!] {confirm} Change board approved the release ^ticket {#cab}
  only when ^risk is high

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
| `[!]` · `[ ]` · `[~]` | Must be done · a step · automation planned |
| `READ-DO` · `DO-CONFIRM` | How a phase is worked; the app shows "Read, then do" and "Do, then confirm" |
| `{type}` | The step's type, so it knows its fields and evidence ([Step types](#step-types)) |
| `@role` · `^detail` | Who does it · a run detail it depends on (change the detail, redo the step) |
| `sets: tag` | This step produces a run detail later steps use |
| `only when ^risk is high` | Under a step, or right under a phase heading: it applies only to runs whose details match; otherwise it's Not needed, with the reason |
| `## Gate:` · `approves:` | The pause point, and exactly what passing it approves |
| `### Track: Name @role` | Parallel work inside a phase |
| `at:` · `due:` · `after:` | A clock time, a deadline, or a due time after the run starts |
| `{run.process}` · `carry:` · `pass:` · `version:` | Start another process as a linked child run, passing these details (under another name, as a fixed value, or asked when it starts, with `pass:`, 2.8; or a team value, `team:`, 2.9), on an exact version if you name one |
| `group:` · `tags:` | Where the process sits in your hierarchy, and how to find it |
| `context: rows:number, due:date` | Typed run details (number, yes-no, date, choice, link), checked as they're typed |
| `> note` · `![caption](images/…)` | A note or screenshot, under a step, a phase or a gate |

**Branching** is `sets:` plus `only when`: one step sets a detail, and a later step or phase applies only when it matches. A step a run doesn't need isn't counted and nobody checks it; a phase it doesn't need is skipped with its gate.

Typed details, phase notes, phase and gate screenshots and `version:` need Flightdeck 2.0; `only when` needs 2.1. Teammates on an older copy see such a version but can't run it. Every mark, field and rule, and what stops a checklist from publishing, is in [the checklist format](https://github.com/troylar/flightdeck/blob/main/docs/map-format.md).

## Step types

Built-in types cover common work and tools: `confirm`, `communicate`, `meeting`, `decide`, `review`, `wait`, `ui.action`, `jenkins.job`, `github.pr`, `bitbucket.pr`, `jira.issue`, `jira.sprint`, `ci.gate`, `deploy`, `verify.health`, `measure`, `run.command`, `run.script`, `run.skill` and `run.process`. Each asks for the evidence that matters (a build number, a link, a decision), and evidence can be typed (a number, yes or no, a date) and is checked as you type it.

**Pull requests are one step in the editor.** The parts box and type picker show one **Pull request**, whose first question is **Where is the pull request?** (GitHub or Bitbucket). Checklist files, reports and the JSON commands still say `github.pr` or `bitbucket.pr`. The `approve` action, the `pull:` field and the `checks` record exist only on GitHub: switching a step to Bitbucket keeps those values, flags them, and publishing refuses them until you remove them.

**Your team's own types** (a change request, a security sign-off) come first on the Step types page. **New step type**, or **Copy to a team type** on any built-in, opens a form for its fields (what a checklist can say about the step) and its evidence (what's recorded when it's checked). **Save step type** writes `step-types/<id>.json`, usable at once; publishing freezes it into each version. Or ask your AI assistant: `/flightdeck-new-step-type a change request the CAB approves, with the change number as evidence`.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/types-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/types-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/types-light.png" alt="Step types: your team's types first, then the built-in types opened, each with what it's for, how many checklists use it, and Copy to a team type" width="1000"></picture></a></p>

**Jira, the way it really is.** Describe your real Jira workflows in `jira/workflows.json`, and a transition can't publish if Jira can't make it; checking it asks for the transition's required fields. Flightdeck never calls Jira, Jenkins or any other tool.

## Process to skill

This is what Flightdeck is for. Outside the team it's usually called **SOP-to-skill**: turning a standard operating procedure into an AI agent skill. Flightdeck adds **traceability**: each registered skill links to the exact process version and steps it follows, and runs are the evidence. Flightdeck flags process changes that affect a skill; it doesn't detect changes to the skill itself.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/trace-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/trace-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/trace-light.png" alt="Five steps from process to skill: prove it with 3 clean runs, the owner or backup owner signs it off, copy the brief, register the skill with its source and the steps it follows, and stay in step as new versions flag the skills they affect. Skill statuses: current, note version, needs an update, check it." width="1000"></picture></a></p>

**1. Prove a version.** **Ready for a skill?** on the checklist's page counts clean runs. A run is clean only when it ended Completed; every covered step was done; every gate on that work (and the one before it) was passed; nothing was blocked, re-checked, marked N/A or done differently, even in answers since archived; it has no unresolved conflict copies; and it kept a full record of deviations from its start (runs from before 1.9.0 can't show that). A step the run didn't need isn't held against it. A test run counts only for its staged version and the version made from exactly what was staged.

**2. Sign off.** With three clean runs, the process owner signs the version off. The backup owner's sign-off counts too, recorded as the backup's, and Flightdeck offers it only while the owner is away (marked inactive or no longer on the team). A sign-off counts only for that exact published version, or, with **Sign off staged v3**, for the staged version and the version made from it.

**3. Brief your AI assistant.** One click copies a brief: the process in order, with every step's fields, evidence and screenshots, every gate and what it approves, the run details it receives, what people actually did differently, and how to register the skill.

**4. Register the skill.** It can live anywhere: a repo, a shared folder, a local path. Your AI assistant registers it with the command, which checks the version exists and records it exactly, with fingerprints, in `skill-registrations/`:

```bash
flightdeck skill register ~/OneDrive/Team --from registration.json --json
```

```json
{
  "name": "release-deploy",
  "version": "1.3.0",
  "location": "https://git.example.com/team-skills/release-deploy",
  "implements": { "process": "release", "folder": "v4-abcd1234" },
  "steps": ["merge", "jenkins"]
}
```

`implements.folder` is the published version's folder (`publications/release/v4-abcd1234/`). Leave out `steps` for a skill that covers the whole process. Never write `skill-registrations/` by hand. The brief says which way to register: for a version that uses no Flightdeck 2.0 feature, it may give the older form, a `skills/<name>.json` file with `"implements": "release@4"` that copies older than 2.0 also read. Details are in [Registering a skill](https://github.com/troylar/flightdeck/blob/main/docs/apps.md#registering-a-skill-for-ai-assistants).

**5. Stay in step.** When a new version is published, every skill is checked against it:

| Status | Meaning | What you do |
|---|---|---|
| **current** | Built from the version in use | Nothing |
| **note version** | The process changed, but none of this skill's steps did | Note the new version: register it again (an older `skills/` file: move its `implements` forward) |
| **needs an update** | Its steps, their order, their gates, their step types, screenshots or run details changed | Copy the update brief: the exact before and after, for your AI assistant |
| **check it** | It can't be matched: a missing version, a clash, or an unreadable file | Fix the registration |

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/skills-traced-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-traced-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-traced-light.png" alt="A process goes from v1 to v2 and one step changes. Flightdeck checks the registered skills: release-deploy and release-notes need an update, pr-opener is current. The update brief for release-deploy shows the exact before and after for your AI assistant." width="1000"></picture></a></p>

**Skills** lists every skill built from your processes, wherever it lives, and which need an update. **A skill** says what changed under it and gives your AI assistant the exact before and after.

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/skills-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skills-light.png" alt="Skills: two skills that need an update, then every skill in the team hierarchy with a tag filter" width="49%"></picture></a> <a href="https://github.com/troylar/flightdeck/blob/main/docs/images/skill-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/skill-light.png" alt="The release-deploy skill: needs update because one of its steps changed in v2, with Copy the update brief, where the skill lives and which steps it covers" width="49%"></picture></a></p>

## The team folder

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/folder-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/folder-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/folder-light.png" alt="The team folder and who writes each part: people in the app write people.json, sign-offs and decisions on corrections, follow-ups and reports; people and your AI assistant write drafts, step types and planned runs; your AI assistant writes skills, proposed draft changes and Jira workflows; the skill register command writes skill-registrations; other apps write reports and planned runs; Flightdeck writes publications, staged versions and runs when people publish, stage and run" width="1000"></picture></a></p>

There's no server. Everyone opens the same `flightdeck.html` from a folder the team shares; the app reads and writes plain files there and the sync tool carries them between computers. What keeps that safe:

- **Every file has one writer.** The recorder's window writes `run.json`; every other window writes its own `notes-<window>.jsonl`. Publishing writes a new folder every time, and decisions are new files, written once. In ordinary use nobody saves over anybody, so the sync tool never has to merge.
- **Saves check first.** Before each `run.json` save, a window compares a SHA-256 of the file with the one it read; if it changed, it writes its version beside the file as a conflict copy. It also leaves a save receipt first, so if two computers that can't see each other both save, the replaced save shows up in the run as a copy to compare, never silently lost. Nothing is merged automatically.
- **A failed read is never "nothing there."** A run, sign-off or plan that's still syncing or can't be read is named, and isn't counted until it reads.
- **An older copy never damages what a newer one wrote.** It shows the version or run with the reason, opens it read-only, and never saves over it.
- **A gate is a record, not a live lock.** A synced folder can be a minute behind, so a gate means "passed for this commit, by Casey, at 9:52," never "safe right now."

More in [Flightdeck and OneDrive](https://github.com/troylar/flightdeck/blob/main/docs/onedrive.md#what-keeps-runs-safe).

<details>
<summary><b>The folder, as text</b></summary>

```
people.json            who's on the team, with the folder owner and backup owner
team-values.json       shared settings like a Bitbucket base URL, changed in Settings by the folder owner and backup owner
maps/drafts/           checklists being written (Markdown)
publications/          published versions, frozen (Flightdeck writes these)
staged/                staged versions only test runs use, and each retire or reopen, written once
runs/                  one folder per run: run.json, each window's notes, save receipts, attached files
skills/                older skill registrations (implements "release@4")
skill-registrations/   skills registered with flightdeck skill register, one file per revision
validations/           sign-offs that a version, or a staged version, is ready for a skill
corrections/           decisions on corrections (applied, declined, reopened, withdrawn), each written once
followups/             what became of each follow-up (done, moved, won't do, reopened), each written once
suggestions/           decisions on suggested fixes from before 1.13 (still read)
step-types/            your team's own step types
jira/workflows.json    your real Jira workflows, with required fields
proposals/             planned runs (from the app, your AI assistant or another app), waiting for a person to start them
proposed/              draft changes your AI assistant proposed, waiting to be applied or declined
reports/               reports from tools that did a step's work (flightdeck report write)
report-decisions/      the recorder's accept or decline on each report
images/                screenshots that checklists refer to
history/               saved history of drafts and step types
presence/              which drafts a window has open, so your AI assistant knows to propose instead of save
connection/            connection checks between computers (Settings → Folder health)
AGENTS.md              the rules any AI assistant follows in this folder (your own go under Team notes)
.flightdeck/           the skills for your AI assistant, installed.json, and updates waiting to be merged
```

</details>

### How big a folder can get

Thousands of runs open and refresh without stalling. **Settings → Folder health** watches these sizes. None of them locks anything; each says what to do, and [The folder is getting big](https://github.com/troylar/flightdeck/blob/main/docs/recovery.md#the-folder-is-getting-big) has the steps.

| Size | What happens |
|---|---|
| More than 500 runs | A warning: the first read is getting slower |
| More than 2,000 runs | Marked as a stop: start a new team folder for new runs and keep this one as the record |
| Three refreshes in a row each over 15 seconds | A warning, measured on this computer |
| An attachment over 10 MB | Refused when you attach it |
| Attachments over 1 GB in all | A warning: every computer with the folder keeps every file |
| A path over 200 characters | A warning: Windows and OneDrive refuse paths that get too long |
| A run folder with more than 500 files | A warning for that run |
| More than 100 files in `step-types/` | Only the first 100 are read; the rest are named |
| More than 500 files in `skills/`, or 500 revision files in `skill-registrations/` | Only the first 500 are read (revision files, so fewer skills); the rest are named |

## Command line

| Command | Does |
|---|---|
| `flightdeck open` | Opens the app that came with the package: the welcome screen the first time, then the team folder you chose when the browser kept it (otherwise it offers **Reconnect**) |
| `flightdeck install <folder>` | Copies `flightdeck.html` into a team folder and adds or updates `AGENTS.md` and the skills in `.flightdeck/skills`. Keeps what your team changed, and won't replace a newer app or an unrecognized file without `--force`. Also updates a `preflight.html` already there |
| `flightdeck skills <folder>` | Adds or updates only the skills, in `<folder>/.flightdeck/skills`; `--to <dir>` puts them in any other folder, such as your assistant's skills folder |
| `flightdeck backup <folder>` | Copies the whole team folder to `~/Flightdeck backups/<folder> backup <date> <time>/`, or under `--to <dir>` |
| `flightdeck export <folder> --run <process>/<id>` | Makes an evidence pack of one run in `~/Flightdeck evidence/` (or `--out <dir>`); `--process <id> --from YYYY-MM-DD --through YYYY-MM-DD` packs every run of a process started on those days. See [Evidence packs](https://github.com/troylar/flightdeck/blob/main/docs/evidence.md) |
| `flightdeck path` · `flightdeck version` | Prints where the app file is · the version |

| Option | Does |
|---|---|
| `--check` | With `install` or `skills`: lists what would change and changes nothing. Exit code 0: nothing to do; 2: updates to install; 3: files your team changed need merging; 1: a problem |
| `--app-only` | With `install`: copies only `flightdeck.html` |
| `--force` | Replaces a newer app, an unrecognized file, or files your team changed. Every install first copies each file it replaces to `.flightdeck/updates/<version>/replaced/` |
| `--no-attachments` | With `export`: lists attachments with their sizes instead of packing them |

**For other apps and AI assistants**, the command also reads checklists and runs as JSON (`processes`, `process`, `runs`, `run`, `next`, `followups`), asks for a run (`flightdeck plan request`), reports the work a tool did on a step (`report`), reads and saves drafts safely (`draft read`, `draft save`, `draft propose`) and registers skills (`skill register`). A person always decides: a request becomes a planned run someone starts, and a report is accepted or declined by the recorder. Every command, its contract and its exit codes are in [Using Flightdeck from other apps](https://github.com/troylar/flightdeck/blob/main/docs/apps.md). `flightdeck --help` lists them all.

## Skills for your AI assistant

`flightdeck install` puts these in the team folder's `.flightdeck/skills/`, with an `AGENTS.md` that any assistant reads. They're plain `SKILL.md` files, so any assistant that supports skills can use them. Open the team folder with your assistant and ask for one by name:

| Skill | Does |
|---|---|
| `/flightdeck-new-checklist` | Turns a runbook, notes or a conversation into a checklist |
| `/flightdeck-edit-checklist` | Changes a checklist and keeps its step IDs |
| `/flightdeck-review-checklist` | Checks a checklist for format errors and quality, without changing it |
| `/flightdeck-learn-from-runs` | Reads runs and their corrections and proposes checklist changes |
| `/flightdeck-plan-run` | Plans the next run, rotating roles fairly |
| `/flightdeck-status` | Summarizes the folder: what needs a person, what's running, what's stale |
| `/flightdeck-new-step-type` | Creates or changes a team step type from a description |
| `/flightdeck-skill-brief` | Writes the brief to create a skill from a signed-off version, or update one, by the same rules as the app |

In `AGENTS.md`, only the part between the `flightdeck:begin` and `flightdeck:end` markers is Flightdeck's; your Team notes below it are never touched. A file your team changed is left alone on update, and the new default waits in `.flightdeck/updates/<version>/` with a prompt for your assistant to merge it.

## Safe by design

<p align="center"><a href="https://github.com/troylar/flightdeck/blob/main/docs/images/safe-light.png" title="Open in GitHub's image viewer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/safe-dark.png"><img src="https://raw.githubusercontent.com/troylar/flightdeck/main/docs/images/safe-light.png" alt="Safe by design: nothing leaves your machine; no server or accounts; saves that check first; built for OneDrive; a careful command; accessible." width="1000"></picture></a></p>

- **Nothing leaves your machine.** The app makes no network requests and loads nothing from the internet; its fonts and code are inside the file.
- **No server to run, no accounts to manage.** Your data is files in a folder you already control.
- **Saves that check first,** as described in [The team folder](#the-team-folder).
- **The command is careful too.** No dependencies, nothing runs on install, no network. It refuses to write through links, replaces a file only with a complete copy, and never replaces a newer version without `--force`.
- **Accessible.** Every control has a label, errors sit next to their field, keyboard shortcuts can be turned off, and everything works with a keyboard. Animations stop when your computer asks for less motion, and selections and focus stay visible in Windows high contrast.

Roles prevent ordinary mistakes, not attacks: anyone who can open the team folder can change any file in it. Keep secrets, tokens and customer data out of checklists, notes and attachments.

## Updating and when something goes wrong

Run `flightdeck install <folder>` again with the new version (or `npx @troylar/flightdeck@<version> install <folder>`). It updates what's still a Flightdeck default and keeps what your team changed. [Updating Flightdeck](https://github.com/troylar/flightdeck/blob/main/docs/updating.md) walks through backups, mixed versions and [rolling back](https://github.com/troylar/flightdeck/blob/main/docs/updating.md#rolling-back).

When the app shows a warning, **Settings → When something goes wrong** explains it in the app; the same guide is [online](https://github.com/troylar/flightdeck/blob/main/docs/recovery.md), covering conflict copies, lost folder access, OneDrive copies and restoring from a backup.

## FAQ

<details>
<summary><b>What changed in 2.2 through 2.6.1?</b></summary>

- **2.2:** **Practice** runs the draft while you edit, recording nothing; Enter in **Add a step** keeps the box open for the next one; stage from the end of Practice.
- **2.3:** Practice opens on the real run screen. **2.3.1:** step text shows the run's details, gates show their names, plain steps are quieter, and the editor's button is **Review & publish**.
- **2.4:** a visual refresh with a new body typeface, and animations that stop for less motion.
- **2.5:** folders with thousands of runs open and refresh without stalling.
- **2.6:** every box in the step form asks a question with an example and a why; only the usual boxes show; one **Pull request** step.
- **2.6.1:** `AGENTS.md`, the skills and these docs match the app. Run `flightdeck install` on your team folder to get the updated assistant files.

None of these adds a checklist feature that needs a newer copy to run: the publish panel still names only what needs 2.0 or 2.1. The full list is under **What's new** in the app and in [CHANGELOG.md](https://github.com/troylar/flightdeck/blob/main/CHANGELOG.md).

</details>

<details>
<summary><b>What if someone on the team has a newer or older Flightdeck?</b></summary>

A version or run with features a copy doesn't understand is shown there with the reason and "Update Flightdeck to run it," and opens read-only, so an older copy never records over a newer one's work. **Settings → Folder health** names older copies it saw in the last 7 days. Before anyone uses 2.0 features, every computer needs 1.21 or later; before anyone publishes `only when`, everyone needs 2.1; and 2.1.1's protection against starting a planned run twice works only once every computer has it. [When computers run different versions](https://github.com/troylar/flightdeck/blob/main/docs/updating.md#when-computers-run-different-versions) has the details.

</details>

<details>
<summary><b>Does Flightdeck run anything for me?</b></summary>

No. It never calls Jenkins, GitHub, Bitbucket or Jira, and never runs a command. It shows the command to copy, records what happened, and keeps the clock. Your skills do the automating, and the AI lives outside Flightdeck: your assistant writes checklists and builds skills from Flightdeck's briefs.

</details>

<details>
<summary><b>Do I need OneDrive?</b></summary>

OneDrive, in Edge or Chrome, is the setup Flightdeck is tested and documented for. The app works on any folder the browser can open; what matters is how the folder is shared and synced. [Flightdeck and OneDrive](https://github.com/troylar/flightdeck/blob/main/docs/onedrive.md) explains what a synced folder can and can't promise.

</details>

<details>
<summary><b>Can a skill cover only part of a process, or come first?</b></summary>

Yes to both. List its `steps` and the brief tells it which gate to wait for, and readiness and status consider only those steps. For a skill that exists first, ask your AI assistant to draft a checklist from it, publish it and register the skill against that version, then run and prove the checklist as usual.

</details>

<details>
<summary><b>I used Preflight. What happens?</b></summary>

Flightdeck was called Preflight before 1.9.0. Team folders, runs and published versions carry over untouched, and `flightdeck install` also updates a `preflight.html` already in the folder. A browser keeps saved examples and your name per file, so `flightdeck.html` starts those fresh.

</details>

## More docs

| Doc | For | You'll get |
|---|---|---|
| [Checklist format](https://github.com/troylar/flightdeck/blob/main/docs/map-format.md) | Anyone writing checklists, and their AI assistant | Every mark, field and step type, and what stops a checklist from publishing |
| [Flightdeck and OneDrive](https://github.com/troylar/flightdeck/blob/main/docs/onedrive.md) | Whoever sets up the team folder | What keeps runs safe on a synced folder, and what it can't promise |
| [Updating Flightdeck](https://github.com/troylar/flightdeck/blob/main/docs/updating.md) | Whoever keeps the team's copy current | A step-by-step update, mixed versions and rolling back |
| [When something goes wrong](https://github.com/troylar/flightdeck/blob/main/docs/recovery.md) | Anyone who sees a warning | What each problem means and what to do, step by step |
| [Evidence packs](https://github.com/troylar/flightdeck/blob/main/docs/evidence.md) | Anyone who needs proof of a run | What's in a pack and how to check it |
| [Using Flightdeck from other apps](https://github.com/troylar/flightdeck/blob/main/docs/apps.md) | Script and tool authors, AI assistants | The JSON commands, run requests, reports, drafts and skill registration |
| [Design](https://github.com/troylar/flightdeck/blob/main/docs/design.md) | Contributors | The full specification and its decisions |

## License

[MIT](https://unpkg.com/@troylar/flightdeck/LICENSE). The embedded Barlow Condensed and Instrument Sans fonts are licensed under the SIL Open Font License 1.1; see [`dist/FONT-LICENSE.txt`](https://unpkg.com/@troylar/flightdeck/dist/FONT-LICENSE.txt).

<div align="center">
<br>

*Inspired by* The Checklist Manifesto: *a checklist doesn't fly the plane. It makes sure the crew doesn't forget the things that matter.*

</div>
