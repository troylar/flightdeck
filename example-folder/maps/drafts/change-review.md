---
process: change-review
title: Review a service change
category: Changes
group: Engineering / Changes
tags: family, review
owner: person-blake
context: service, ticket, verdict:choice(approved|needs-work)
roles: reviewer
result: verdict
---

## Review · DO-CONFIRM {#review}
- [!] {confirm} Change description on ^ticket read end to end @reviewer {#read}
- [!] {confirm} Tests cover the new behavior @reviewer {#tests}
- [!] {confirm} Rollback written down in ^ticket @reviewer {#rollback}
- [!] {decide} Is the change to ^service ready to roll out? @reviewer {#verdict}
  options: approved, needs-work
  sets: verdict=decision
  > This decision is the checklist's result. The run that started this review routes on it.
