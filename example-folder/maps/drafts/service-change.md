---
process: service-change
title: Ship a service change
category: Changes
group: Engineering / Changes
tags: family, review, rollout
owner: person-avery
backup: person-blake
context: service, ticket, review:choice(approved|needs-work)
roles: change-lead
---

## Review · READ-DO {#review}
- [!] {run.process} Review the change @change-lead {#first-review}
  process: change-review
  carry: service, ticket
  accepts: approved, needs-work
  sets: review=result
  > Starts a linked review run. Its result picks the route: approved goes straight to rollout, needs-work goes through rework and a second review first.

## Gate: Review returned · owner @change-lead {#reviewed}
  approves: the route the review chose for ^service

## Rework · READ-DO {#rework}
  only when ^review is needs-work
- [!] {run.process} Make the changes the review asked for @change-lead {#fix}
  process: change-rework
  carry: service, ticket
- [!] {run.process} Review the change again @change-lead {#second-review}
  process: change-review
  carry: service, ticket
  accepts: approved
  > This review must come back approved. Needs-work again holds this step until a new review run approves the change.

## Gate: Ready to roll out · owner @change-lead {#ready}
  approves: rollout of ^service for ^ticket

## Roll out · READ-DO {#rollout}
- [!] {run.process} Roll out the change @change-lead {#roll-out}
  process: change-rollout
  carry: service, ticket
