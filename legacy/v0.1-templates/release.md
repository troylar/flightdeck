---
title: Production release
category: Releases
owner: Release captain
when: Every merge to master
context: ticket, commit, environment
---

## Before production changes · DO-CONFIRM
- [!] Change approved and linked to the release ticket
- [!] Full test gate green on the commit being released ^commit
  > Run the gate **after** the rebase. A green run on an earlier commit doesn't count.
- [!] Feature flags set in the deploy values for this environment ^environment
- [!] Rollback commit written in the release ticket
- [ ] Smoke prompts and their expected answers written in the ticket

## Deploy · READ-DO
- [ ] Post "starting release" in the team channel
- [!] Merge to master (this is the production release) ^commit
- [auto] Deploy pipeline reports every stage green
  ![Every stage green before you move on](shot:pipeline)
- [!] New pods stay up 10 minutes with no restarts
  > Watch `kubectl get pods` for 10 minutes. Any restart: mark this step Blocked and check the logs.

## Verify in production · READ-DO
- [!] Smoke prompts return their expected answers
- [ ] No new error events on the logs dashboard
  ![Error events by tool, last 30 minutes](shot:logs)
- [ ] Post the result in the team channel
