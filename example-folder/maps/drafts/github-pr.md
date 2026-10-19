---
process: github-pr
title: Merge a GitHub pull request
category: Code
group: Engineering / Code
tags: git, review, github
owner: person-avery
context: branch, pull
roles: author, reviewer
---

## Open · DO-CONFIRM {#open}
- [!] {github.pr} Pull request opened from ^branch @author {#open-pr}
  action: open
  repo: example-org/docs-site
  from: ^branch
  to: main
  sets: pull
  > Record the pull request link; every later step uses it as ^pull.
- [ ] {confirm} Description says what changed and how it was tested @author {#describe}

## Review · READ-DO {#review}
- [!] {github.pr} Review the pull request @reviewer {#review-pr}
  action: review
  repo: example-org/docs-site
  pull: ^pull
  > Look for tests that cover the new behavior and for unrelated changes.
- [!] {github.pr} Approve once the checks pass @reviewer {#approve-pr}
  action: approve
  repo: example-org/docs-site
  pull: ^pull
  require: checks

## Gate: Ready to merge · owner @reviewer {#ready}
  approves: merge of ^pull

## Merge · DO-CONFIRM {#merge}
- [!] {github.pr} Squash and merge into main @author {#merge-pr}
  action: merge
  repo: example-org/docs-site
  pull: ^pull
  to: main
  require: mergeCommit
- [ ] {run.command} Delete the branch @author {#delete-branch}
  command: git push origin --delete ^branch
  where: Your repository
