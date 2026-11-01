# Skills for your AI assistant

A skill is reusable instructions for an AI assistant. Flightdeck ships eight: write a checklist, change one, review one, learn from runs, plan a run, see where things stand, add a step type, and brief a skill built from a process. You don't need to learn their names. [Back to the README](../README.md#skills-for-your-ai-assistant).

## Start the assistant

Open the team folder itself as the workspace, in Agent mode, or start a command-line tool in that folder. Then, in **Settings → AI assistant files**, choose **Copy instructions for your assistant** and paste it. The text is:

```text
Read AGENTS.md in this folder, to the end, and follow it. If this folder has no AGENTS.md, stop and tell me to open the team folder itself.

The Flightdeck skills are in .flightdeck/skills/, one folder per skill, each with a SKILL.md. Your tool may not load them on its own, so list that folder yourself. When one fits the job, read its SKILL.md and follow it. A name like /flightdeck-status or $flightdeck-status means .flightdeck/skills/flightdeck-status/SKILL.md.

Don't change anything yet. Tell me in a few lines what you can help with here, then ask me what I want done.
```

Why say all that? Not every tool opens `.flightdeck/skills/` on its own, and one stops reading `AGENTS.md` at 32 KiB unless it's told to read the file. The prompt covers both, and it stops if the wrong folder is open.

## Say what you need

Use your normal words. This is enough, and the assistant picks the skill:

> Here are my notes from the last release. Write a checklist from them, leave what you can't tell as questions for me, and save it as a draft. I'll review and publish it.

The assistant follows `AGENTS.md`: it never publishes, never edits a published version and never writes a run. People do those in Flightdeck.

## Choose the job

| Skill | Input | Result | Say something like |
|---|---|---|---|
| [flightdeck-new-checklist](../example-folder/.flightdeck/skills/flightdeck-new-checklist/SKILL.md) | Notes, a runbook, a ticket or a conversation | A new draft for a person to review and publish; what's unclear becomes questions for the owner | "Turn this runbook into a checklist." |
| [flightdeck-edit-checklist](../example-folder/.flightdeck/skills/flightdeck-edit-checklist/SKILL.md) | A process and the change you want | The draft changed, with its step IDs kept | "In the release checklist, add a step to tell support before the deploy." |
| [flightdeck-review-checklist](../example-folder/.flightdeck/skills/flightdeck-review-checklist/SKILL.md) | A process, or all of them | Format errors and quality problems, with nothing changed | "Check the release checklist before I publish it." |
| [flightdeck-learn-from-runs](../example-folder/.flightdeck/skills/flightdeck-learn-from-runs/SKILL.md) | A process and its recent runs | Proposed checklist changes from corrections and follow-ups, for a person to review | "What do the last few release runs say we should change?" |
| [flightdeck-plan-run](../example-folder/.flightdeck/skills/flightdeck-plan-run/SKILL.md) | A process and its run details | A planned run with roles by rotation, for a person to review and start | "Plan Thursday's release, and rotate the roles fairly." |
| [flightdeck-status](../example-folder/.flightdeck/skills/flightdeck-status/SKILL.md) | The team folder | A short summary of what needs a person, what's running and what's out of date, with nothing changed | "Where do things stand?" |
| [flightdeck-new-step-type](../example-folder/.flightdeck/skills/flightdeck-new-step-type/SKILL.md) | What the step is for | A team step type in `step-types/` | "We need a step type for a change request, with its ticket and approver." |
| [flightdeck-skill-brief](../example-folder/.flightdeck/skills/flightdeck-skill-brief/SKILL.md) | A process or skill, signed off | The brief for building or updating a skill, with nothing changed | "Write the brief for a skill from the signed-off release process." |

## Naming a skill

You can also ask for a skill by name. Most tools use a slash, like `/flightdeck-status`. Codex starts skill names with a dollar sign, like `$flightdeck-status`. A name only works where the tool has found the skill, and most tools don't look in `.flightdeck/skills/`. To put the skills where your tool looks, use **In another folder** on the same Settings screen, `flightdeck skills --to <folder>`, or the ZIP below. Without any of that, the first prompt above is enough: the assistant reads the file itself.

| Tool | Folders in the project it reads skills from |
|---|---|
| Copilot, in VS Code and the command line | `.github/skills/`, `.claude/skills/`, `.agents/skills/` |
| Claude Code | `.claude/skills/` |
| Codex | `.agents/skills/` |
| Cursor | `.agents/skills/`, `.cursor/skills/`, `.claude/skills/`, `.codex/skills/` |

**What was tried.** The Copilot and Cursor details here come from each tool's docs and have not been tried. The first prompt was tried on Codex and Claude Code. Tools change, so check your own version.

## Download skills ZIP

**Download skills ZIP**, on the same screen, gives you the same files at the same paths as `flightdeck skills --to <folder>`. It's made from what's already in the app file, so it needs no network, no folder and no folder access in your browser. Unzip it into the folder your tool reads skills from. Keep the `_flightdeck` folder beside the skills: they use the files in it. Updates don't reach an unzipped copy on their own, so download it again from a newer app, or use `flightdeck skills --to <folder>`, which keeps your changes safe.

## Instructions that get read to the end

`AGENTS.md` stays under 28 KiB, with the safety rules at the top. Your Team notes go at the end, and one tool stops reading at 32 KiB unless it's told to read the file, so keep them to about 4 KiB. Long file formats are in `.flightdeck/skills/_flightdeck/file-formats.md`, which `AGENTS.md` points to.
