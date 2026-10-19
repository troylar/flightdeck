---
process: release
title: Production release
category: Releases
group: Engineering / Releases
tags: production, deploy
owner: person-casey
context: ticket, commit, environment, tag
roles: release-lead, qa, backend
---

## Before production changes · DO-CONFIRM {#prep}
- [!] {change.request} Change request approved for tonight's window @release-lead {#approved}
  system: Change board
  window: The release window on the ticket
  require: number
- [!] {ci.gate} Full test gate green on the release commit ^commit {#tests}
  pipeline: web-app gate
  page: https://ci.example.com/job/web-app-gate/
  require: run
  > Run the gate **after** the rebase. A green run on an earlier commit doesn't count.
- [!] {confirm} Feature flags set in the deploy values ^environment @backend {#flags}
  > New features ship off. Turn them on in the environment's values file, never in code.
- [!] {confirm} Rollback commit written in the release ticket @release-lead {#rollback}
- [ ] {run.process} Check in the release notes for this commit @release-lead {#notes}
  process: check-in
  carry: commit
  > Starts a linked check-in run. This step is checked when that run completes.
- [ ] {communicate} Post "starting release" in the team channel @release-lead {#announce}
  channel: #team-releases
  message: Starting the production release of ^commit (^ticket). I'll post again when it's verified.

## Gate: Ready to deploy · owner @release-lead {#ready}
  approves: deploy of `^commit` to ^environment

## Deploy · READ-DO {#deploy}
- [!] {bitbucket.pr} Merge the release branch to master ^commit @release-lead {#merge}
  action: merge
  repo: web-app
  from: release
  to: master
  require: all
  sets: tag
  > Merging to master **is** the production release. Rebase first; never merge commits into the branch. The merge creates the release tag; record it here and every later step uses it.
- [!] {jenkins.job} Start the production deploy job ^tag @backend {#jenkins}
  job: web-app-deploy-prod
  parameters: TICKET=^ticket TAG=^tag
  stage: Stage 5 asks for the release ticket number
  require: build
  expect: 25m
  after: 2h
  > The job stops at stage 5 and asks for the release ticket number. Type it exactly as it appears in Jira.
- [!] {ui.action} Approve the deploy in Jenkins before it rolls back @release-lead {#approve}
  system: Jenkins
  deadline: external
  > Jenkins rolls the deploy back if nobody approves within 30 minutes. Copy its deadline into Flightdeck with **Set deadline** so everyone sees the countdown.
- [!] {run.command} New pods stay up with no restarts @backend {#pods}
  command: kubectl get pods -l app=web-app
  where: Your terminal
  expected: RESTARTS is 0 for every new pod after 10 minutes
  expect: 10m

## Gate: Deployed · owner @release-lead {#deployed}
  approves: `^commit` running in ^environment

## Verify in production · READ-DO {#verify}
### Track: Product checks @qa {#checks}
- [!] {confirm} Smoke prompts return their expected answers @qa {#smoke}
  where: Release ticket, "Smoke prompts" section
  evidence: note
- [ ] {verify.health} No new error events on the logs dashboard @qa {#logs}
  dashboard: https://logs.example.com/d/web-app-errors
  metric: New error events
  threshold: None that weren't there before the release
  watch: 30m
### Track: Wrap-up @release-lead {#wrap}
- [ ] {communicate} Post the result in the team channel @release-lead {#result}
  channel: #team-releases
  message: ^tag (^commit) is live in ^environment and verified. Thanks, everyone.
- [ ] {deploy} Deploy record shows ^tag in ^environment @release-lead {#deploy-record}
  environment: ^environment
  artifact: web-app
  version: ^tag
  tool: https://deploy.example.com/apps/web-app
  rollback: The rollback commit in the release ticket
  > The Jenkins job does the deploy. This step records what actually landed, so the receipt says which version went out and when.
- [ ] {jira.issue} Close the release ticket @release-lead {#close}
  action: transition
  issue: ^ticket
  issueType: Release
  status: Done
