---
process: incident
title: First 15 minutes of an incident
category: Incidents
group: Operations / Incidents
tags: on-call, production
owner: person-avery
context: alert
roles: incident-lead, comms
---

## Sign in · READ-DO {#sign-in}
- [!] {communicate} Incident channel opened with the alert link ^alert @incident-lead {#channel}
  channel: A new incident channel
  message: Incident opened for ^alert. Updates here every 15 minutes.
  after: 5m
- [!] {confirm} One incident lead named out loud {#lead}
  evidence: note
- [ ] {confirm} Deploys in the last 2 hours checked {#recent-deploys}

## Stabilize · READ-DO {#stabilize}
### Track: Fix @incident-lead {#fix}
- [!] {decide} Roll back, turn a flag off, or keep investigating @incident-lead {#decide}
  options: Roll back, Turn a flag off, Keep investigating
  criteria: Customer impact right now, and whether the last deploy lines up with the alert
- [ ] {wait} Waiting on the owning team, if another system is involved {#wait}
  for: The owning team's on-call
### Track: Comms @comms {#comms}
- [ ] {communicate} First status update posted in the incident channel @comms {#status}
  channel: The incident channel
  after: 20m
- [ ] {communicate} Support told what to say to customers @comms {#support}
  channel: #support-leads
