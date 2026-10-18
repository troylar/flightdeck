# Writing a checklist people will actually use

Flightdeck checklists follow *The Checklist Manifesto* (Atul Gawande). A checklist doesn't teach a job; it catches the steps that skilled people skip when they're busy, tired or interrupted.

## What makes a good checklist

- **Pause points, not procedures.** Each phase ends where people naturally stop: before a merge, before production, after the deploy. That's where the gate goes.
- **Short phases.** 5 to 9 steps. Past 9, split at a natural stopping point.
- **One line per step,** about 12 words or fewer, naming an action or a state to confirm: "Rollback commit written in the release ticket". Explanations go in a `>` note under the step.
- **No filler.** Never start a step with "Make sure", "Ensure", "Don't forget" or "Remember to".
- **Must-dos are rare.** Mark `[!]` only where skipping the step causes real harm (a broken release, lost data, a missed approval). If everything is a must-do, nothing is.
- **READ-DO or DO-CONFIRM, on purpose.** READ-DO: read a step, then do it (unfamiliar or risky work, like a deploy). DO-CONFIRM: experienced people work from memory, then stop and confirm (routine prep).
- **The most specific step type.** A Jenkins job is `{jenkins.job}`, a pull request is `{bitbucket.pr}`, a Jira change is `{jira.issue}`. Use `{ui.action}` only for tools without their own type.
- **Fields describe; they don't have to be complete.** Fill in what's stable (the job name, the repo, the Jira action). Leave out what changes each run; people fill it in during the run.
- **Evidence only where it matters.** `require: build` on a production deploy, `require: all` on a merge to master. Most steps need none, so they check in one click.
- **Tie steps to what they depend on.** If a step is only valid for one commit or environment, add `^commit` or `^environment`. If that detail changes mid-run, the step comes back for a re-check, and so does any gate that approved it.
- **Solo checklists say so.** A developer's or product owner's routine gets `runs: solo`, one role or none, and no "together" steps.

## What a gate is for

A gate is the moment someone with authority says "this phase is done, for these details". Give it an `owner @role` when one person must approve. Give it an `approves:` line naming exactly what's being approved: "deploy of `^commit` to ^environment". Leave a phase without a written gate when "confirm and continue" is enough.

## Honesty rules

- Every step must come from a source: a runbook, notes, a ticket, or the person you're talking to. Never invent a step to make a phase look complete.
- If something is unclear, write it under `## Questions for the owner` instead of guessing. Flightdeck won't publish a checklist until the questions are answered and removed.
- Never put secrets, tokens, passwords, customer data or internal credentials in a checklist, a command or a screenshot.
