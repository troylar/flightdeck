---
process: backup
title: Backup check
category: Operations
owner: person-avery
context: ticket, rows:number, due:date, approved:yes-no
roles: lead, checker
---

## Prepare {#prep}
  > Use the scratch server, never production.
  ![The scratch server](images/scratch.png)
- [!] {confirm} Read the restore runbook @lead {#read}
- [ ] {team.count} Count the restored rows ^rows @checker {#count}
- [ ] {run.process} Verify the copy {#verify}
  process: verify
  version: 4
- [ ] {run.skill} Write the report {#report}
  skill: release-notes
  skillVersion: 1.2.0

## Gate: Restored {#restored}
  > The restored copy opens and its row counts match.
  ![Row counts side by side](images/counts.png)

## Close {#close}
- [ ] {confirm} File the report @lead {#file}
