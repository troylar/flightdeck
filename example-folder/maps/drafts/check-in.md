---
process: check-in
title: Check in code
category: Code
group: Engineering / Code
tags: git, review
owner: person-avery
context: branch, commit, story
roles: author, reviewer
---

## Before the pull request · DO-CONFIRM {#before-pr}
- [!] {run.command} Branch rebased onto master ^commit @author {#rebase}
  command: git fetch origin && git rebase origin/master
  where: Your repository
- [!] {run.command} Full test gate green after the rebase ^commit @author {#gate}
  command: ./test/run.sh
  expected: Every test passes
- [!] {confirm} No secrets, real names or customer data in the diff @author {#secrets}
- [ ] {confirm} Files committed by path, not with add-all @author {#by-path}
- [~] {confirm} Jira key in the commit message ^story @author {#jira-key}

## Gate: Ready for review · owner @author {#ready-review}
  approves: review of `^commit` on ^branch

## Review · READ-DO {#review}
- [!] {bitbucket.pr} Review and approve the pull request @reviewer {#approve}
  action: review
  repo: web-app
  from: ^branch
  to: master
  > Look for tests that cover the new behavior and for unrelated changes.
- [ ] {jira.issue} Move the story to In Review ^story @author {#move-story}
  action: transition
  issue: ^story
  issueType: Story
  status: In Review
