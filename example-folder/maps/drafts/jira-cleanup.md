---
process: jira-cleanup
title: Weekly Jira cleanup
category: Product
group: Delivery / Backlog
tags: jira, solo
owner: person-morgan
runs: solo
context: board
roles: owner
---

## Triage new issues · READ-DO {#triage}
- [!] {confirm} Every new issue has a component and a priority ^board @owner {#fields}
  where: Board filter "Created in the last 7 days"
- [ ] {jira.issue} Duplicates linked to the original and closed @owner {#dupes}
  action: link
  issue: Each duplicate
  linkTo: The original issue
- [ ] {decide} Unclear issues: ask the reporter or close? @owner {#unclear}
  options: Ask the reporter, Close as unclear, Keep as is

## Tidy the backlog · DO-CONFIRM {#tidy}
- [!] {jira.issue} Stale issues moved to "Won't do" with a comment @owner {#stale}
  action: transition
  issue: Board filter "Not updated in 90 days"
  status: Won't do
- [ ] {confirm} Top 20 backlog items are in priority order @owner {#order}
- [ ] {confirm} Next sprint's candidates have acceptance criteria @owner {#criteria}
  evidence: note

## Gate: Backlog ready · owner @owner {#ready}
  approves: the ^board backlog for sprint planning
