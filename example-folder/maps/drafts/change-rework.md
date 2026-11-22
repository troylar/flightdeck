---
process: change-rework
title: Rework a service change
category: Changes
group: Engineering / Changes
tags: family, rework
owner: person-avery
context: service, ticket
roles: author
---

## Rework · DO-CONFIRM {#rework}
- [!] {confirm} Every review comment on ^ticket answered or fixed @author {#comments}
- [!] {run.command} Full test gate green after the fixes @author {#gate}
  command: ./test/run.sh
  expected: Every test passes
- [ ] {confirm} Change description updated with what changed @author {#describe}
