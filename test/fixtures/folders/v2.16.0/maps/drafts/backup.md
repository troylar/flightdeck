---
process: backup
title: Backup check
category: Operations
owner: person-avery
context: ticket
roles: lead, checker
---

## Prepare {#prep}
- [!] {confirm} Read the restore runbook @lead {#read}
  ![The runbook's first page](images/restore.png)
- [ ] {team.restore} Restore last night's backup ^ticket @checker {#restore}
  system: billing
- [ ] {confirm} Record where the copy is @checker {#where}
  evidence: link

## Gate: Restored {#restored}
  > The restored copy opens and its row counts match.

## Close {#close}
- [ ] {confirm} File the report @lead {#report}
