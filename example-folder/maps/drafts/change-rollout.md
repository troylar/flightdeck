---
process: change-rollout
title: Roll out a service change
category: Changes
group: Engineering / Changes
tags: family, rollout
owner: person-casey
context: service, ticket
roles: operator
---

## Roll out · READ-DO {#rollout}
- [!] {run.command} Deploy ^service @operator {#deploy}
  command: ./scripts/deploy.sh ^service
  where: The deploy host
- [!] {confirm} Health checks green for 10 minutes after the deploy @operator {#health}
- [ ] {communicate} Post the rollout in the team channel @operator {#announce}
  channel: #team-changes
  message: ^service is rolled out for ^ticket.
